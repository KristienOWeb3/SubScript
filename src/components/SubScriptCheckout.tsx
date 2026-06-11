"use client";

import { useState, useMemo } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import {
  bytesToHex,
  createPublicClient,
  encodePacked,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  parseUnits
} from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { 
  ARC_TESTNET_CHAIN_ID,
  SUBSCRIPT_ROUTER_ADDRESS,
  STANDARD_CONTRACT_ADDRESS, 
  USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI, SUBSCRIPT_ROUTER_ABI, USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { Loader2, CheckCircle, AlertCircle, ShoppingBag } from "lucide-react";

/* Initialize standard viem public client targeting Arc Testnet */
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

const ERC20_ABI = USDC_ERC20_ABI;
const ROUTER_ABI = SUBSCRIPT_ROUTER_ABI;
const STANDARD_ABI = STANDARD_SUBSCRIPT_ABI;

interface SubScriptCheckoutProps {
  publishableKey?: string;
  merchantAddress?: string;
  planName?: string;
  amountCap?: string; /* e.g. "15" USDC */
  interval?: string; /* "weekly" | "monthly" | "yearly" */
  fundingChain?: string;
  mode?: "private" | "standard";
  onSuccess?: (txHash: string) => void;
}

export default function SubScriptCheckout({
  merchantAddress = "",
  planName = "Standard Subscription",
  amountCap = "15",
  interval = "monthly",
  mode = "standard",
  onSuccess,
}: SubScriptCheckoutProps) {
  const { address: userWallet, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [loadingState, setLoadingState] = useState<
    "idle" | "Awaiting USDC Approval" | "Preparing Secure Payment" | "Confirming Subscription" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);

  /* Calculate billing period in seconds */
  const periodSeconds = useMemo(() => {
    if (interval === "weekly") return BigInt(604800);
    if (interval === "yearly") return BigInt(31536000);
    return BigInt(2592000); /* default to monthly (30 days) */
  }, [interval]);

  const getCheckoutErrorMessage = (error: any) => {
    const code = error?.code || error?.cause?.code || error?.details?.code;
    const message = error?.shortMessage || error?.reason || error?.details || error?.message;
    if (code === 4001 || /user rejected|rejected by user|user denied/i.test(String(message || ""))) {
      return "Transaction was rejected in the wallet.";
    }
    if (/insufficient allowance/i.test(String(message || ""))) {
      return "USDC allowance is insufficient for this checkout.";
    }
    if (/insufficient funds|exceeds balance/i.test(String(message || ""))) {
      return "Wallet has insufficient USDC or gas balance.";
    }
    if (/execution reverted|revert/i.test(String(message || ""))) {
      return `Contract reverted: ${message}`;
    }
    return message || "An error occurred during subscription processing.";
  };

  const handleCheckout = async () => {
    if (!isConnected || !userWallet) {
      setErrorMessage("Please connect your wallet first.");
      setLoadingState("error");
      return;
    }

    if (!merchantAddress || !isAddress(merchantAddress)) {
      setErrorMessage("Invalid merchant payout address configured.");
      setLoadingState("error");
      return;
    }

    if (mode === "private") {
      setErrorMessage("Privacy Premium routing mode is currently unavailable.");
      setLoadingState("error");
      return;
    }

    setErrorMessage(null);
    setSuccessTxHash(null);
    setLoadingState("Awaiting USDC Approval");
    setStatusMessage("Checking USDC allowance...");

    try {
      if (chainId !== ARC_TESTNET_CHAIN_ID) {
        setStatusMessage("Switching to Arc Testnet...");
        await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
      }

      const userAddress = getAddress(userWallet) as `0x${string}`;
      const paymentRecipient = getAddress(merchantAddress) as `0x${string}`;
      const spenderAddress = STANDARD_CONTRACT_ADDRESS;
      const tokenDecimals = await publicClient.readContract({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: ERC20_ABI,
        functionName: "decimals",
      });

      if (Number(tokenDecimals) !== 6) {
        throw new Error(`Unexpected USDC decimals: ${tokenDecimals}. Expected 6.`);
      }

      const amount = parseUnits(amountCap || "0", Number(tokenDecimals));
      if (amount <= BigInt(0)) {
        throw new Error("Subscription amount must be greater than zero.");
      }

      const currentAllowance = await publicClient.readContract({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [userAddress, spenderAddress],
      });

      if (currentAllowance < amount) {
        setStatusMessage("USDC allowance insufficient. Awaiting wallet approval...");

        const approvalAmount = amount * BigInt(12);

        await publicClient.simulateContract({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          account: userAddress,
          args: [spenderAddress, approvalAmount],
        });

        const approveHash = await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spenderAddress, approvalAmount],
        });

        setStatusMessage("Waiting for USDC approval transaction confirmation...");
        
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash as `0x${string}`,
          timeout: 120_000,
        });

        if (approvalReceipt.status !== "success") {
          throw new Error("USDC approval transaction failed.");
        }

        const allowanceAfterApproval = await publicClient.readContract({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [userAddress, spenderAddress],
        });
        if (allowanceAfterApproval < amount) {
          throw new Error("USDC approval confirmed but allowance is still insufficient.");
        }
      }

      setLoadingState("Confirming Subscription");
      setStatusMessage("Submitting subscription transaction on-chain...");

      await publicClient.simulateContract({
        address: STANDARD_CONTRACT_ADDRESS,
        abi: STANDARD_ABI,
        functionName: "createSubscription",
        account: userAddress,
        args: [paymentRecipient, amount, periodSeconds],
      });

      const subscriptionHash = await writeContractAsync({
        address: STANDARD_CONTRACT_ADDRESS,
        abi: STANDARD_ABI,
        functionName: "createSubscription",
        args: [paymentRecipient, amount, periodSeconds],
      });

      setStatusMessage("Waiting for subscription confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: subscriptionHash as `0x${string}`,
        timeout: 120_000,
      });

      if (receipt.status !== "success") {
        throw new Error("Subscription transaction failed or reverted.");
      }

      setSuccessTxHash(subscriptionHash);
      setLoadingState("success");
      setStatusMessage("Subscription activated successfully.");
      
      if (onSuccess) {
        onSuccess(subscriptionHash);
      }
    } catch (err: any) {
      setErrorMessage(getCheckoutErrorMessage(err));
      setLoadingState("error");
    }
  };

  return (
    <div className="w-full bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 relative overflow-hidden flex flex-col justify-between shadow-2xl">
      <div className="absolute top-0 right-0 w-64 h-64 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-[#00d2b4]/5 via-transparent to-transparent -z-10 pointer-events-none" />

      <div>
        <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
          <span>Subscription Checkout</span>
          <span className="font-bold text-[#00d2b4] bg-[#00d2b4]/10 border border-[#00d2b4]/20 px-2.5 py-0.5 rounded-full">
            {mode.toUpperCase()} MODE
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-extrabold text-white tracking-tight uppercase">
              {planName}
            </h3>
            <p className="text-xs text-white/50 mt-1">
              Decentralized recurring Stablecoin subscription on the Arc Network.
            </p>
          </div>

          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-3 font-sans">
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Price</span>
              <span className="font-bold text-white font-mono">{amountCap} USDC</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Billing Interval</span>
              <span className="font-bold text-white uppercase">{interval}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Merchant Address</span>
              <span className="font-bold text-white font-mono break-all text-[10px] max-w-[200px] text-right">
                {merchantAddress || "Not configured"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {loadingState === "idle" && (
          <button
            onClick={handleCheckout}
            disabled={!isConnected || !merchantAddress}
            className="w-full py-4 bg-[#00d2b4] text-[#111111] hover:brightness-110 transition-all font-bold rounded-2xl text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-4 h-4 stroke-[2.5]" />
            Subscribe
          </button>
        )}

        {(loadingState === "Awaiting USDC Approval" || loadingState === "Preparing Secure Payment" || loadingState === "Confirming Subscription") && (
          <div className="w-full p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-center space-y-3">
            <div className="flex items-center justify-center gap-3 text-xs text-[#00d2b4] font-semibold">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{loadingState}</span>
            </div>
            <p className="text-[10px] text-white/50">{statusMessage}</p>
          </div>
        )}

        {loadingState === "success" && (
          <div className="w-full p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-bold uppercase tracking-wider">
              <CheckCircle className="w-4 h-4" />
              <span>Subscription Active</span>
            </div>
            <p className="text-[10px] text-white/60">
              Your subscription is successfully registered on the blockchain.
            </p>
            {successTxHash && (
              <div className="pt-2 border-t border-white/5 text-[9px] font-mono text-white/40 break-all text-left">
                Transaction: {successTxHash}
              </div>
            )}
            <button
              onClick={() => setLoadingState("idle")}
              className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              Back to Checkout
            </button>
          </div>
        )}

        {loadingState === "error" && (
          <div className="w-full p-5 bg-red-500/5 border border-red-500/20 rounded-2xl text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-xs text-red-400 font-bold uppercase tracking-wider">
              <AlertCircle className="w-4 h-4" />
              <span>Transaction Failed</span>
            </div>
            <div className="p-3 bg-red-500/10 border border-red-500/10 rounded-xl text-red-300 text-[10px] font-mono break-all text-left leading-relaxed">
              {errorMessage}
            </div>
            <button
              onClick={() => setLoadingState("idle")}
              className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
            >
              Retry Checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
