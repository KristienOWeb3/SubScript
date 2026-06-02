"use client";

import { useState, useMemo } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { createPublicClient, http, parseUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { 
  STANDARD_CONTRACT_ADDRESS, 
  USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";
import { Loader2, CheckCircle, AlertCircle, ShoppingBag } from "lucide-react";

/* Initialize standard viem public client targeting Arc Testnet */
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

interface SubScriptCheckoutProps {
  publishableKey?: string;
  merchantAddress?: string;
  planName?: string;
  amountCap?: string; /* e.g. "15" USDC */
  interval?: string; /* "weekly" | "monthly" | "yearly" */
  fundingChain?: string;
  mode?: "zk" | "standard";
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
  const { address: userWallet, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [loadingState, setLoadingState] = useState<
    "idle" | "Awaiting USDC Approval" | "Confirming Subscription" | "success" | "error"
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

  /* Calculate plan amount in base units (6 decimals) */
  const requiredAmount = useMemo(() => {
    try {
      return parseUnits(amountCap || "0", 6);
    } catch (err) {
      return BigInt(0);
    }
  }, [amountCap]);

  const handleCheckout = async () => {
    if (!isConnected || !userWallet) {
      setErrorMessage("Please connect your wallet first.");
      setLoadingState("error");
      return;
    }

    if (!merchantAddress || merchantAddress.length !== 42 || !merchantAddress.startsWith("0x")) {
      setErrorMessage("Invalid merchant payout address configured.");
      setLoadingState("error");
      return;
    }

    setErrorMessage(null);
    setSuccessTxHash(null);
    setLoadingState("Awaiting USDC Approval");
    setStatusMessage("Checking USDC allowance...");

    try {
      /* Step 1: Pre-Flight Allowance Verification */
      const currentAllowance = await publicClient.readContract({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: [
          {
            type: "function",
            name: "allowance",
            stateMutability: "view",
            inputs: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" }
            ],
            outputs: [{ name: "", type: "uint256" }]
          }
        ] as const,
        functionName: "allowance",
        args: [userWallet as `0x${string}`, STANDARD_CONTRACT_ADDRESS as `0x${string}`],
      });

      /* Step 2: Implement the Multi-Step Approval Flow */
      /* Check if current allowance is strictly less than the subscription price */
      if (currentAllowance < requiredAmount) {
        setStatusMessage("USDC allowance insufficient. Awaiting wallet approval...");
        
        /* 
         * Request approval for standard contract address. 
         * Approve 12 periods worth of the monthly price to cover future keeper executions.
         */
        const approvalAmount = requiredAmount * BigInt(12);
        
        const approveHash = await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: [
            {
              type: "function",
              name: "approve",
              stateMutability: "nonpayable",
              inputs: [
                { name: "spender", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: [{ name: "", type: "bool" }]
            }
          ] as const,
          functionName: "approve",
          args: [STANDARD_CONTRACT_ADDRESS, approvalAmount],
        });

        setStatusMessage("Waiting for USDC approval transaction confirmation...");
        
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash as `0x${string}`,
        });

        if (approvalReceipt.status !== "success") {
          throw new Error("USDC approval transaction failed.");
        }
      }

      /* Step 3: Secure Subscription Execution */
      setLoadingState("Confirming Subscription");
      setStatusMessage("Submitting subscription transaction on-chain...");

      /* Execute primary subscription contract call createSubscription (selector 0x8a2405a8) */
      const subscriptionHash = await writeContractAsync({
        address: STANDARD_CONTRACT_ADDRESS,
        abi: [
          {
            type: "function",
            name: "createSubscription",
            stateMutability: "nonpayable",
            inputs: [
              { name: "_merchant", type: "address" },
              { name: "_amount", type: "uint256" },
              { name: "_period", type: "uint256" }
            ],
            outputs: [{ name: "subId", type: "uint256" }]
          }
        ] as const,
        functionName: "createSubscription",
        args: [merchantAddress as `0x${string}`, requiredAmount, periodSeconds],
      });

      setStatusMessage("Waiting for subscription confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: subscriptionHash as `0x${string}`,
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
      setErrorMessage(
        err?.shortMessage || err?.message || "An error occurred during subscription processing."
      );
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

        {(loadingState === "Awaiting USDC Approval" || loadingState === "Confirming Subscription") && (
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
