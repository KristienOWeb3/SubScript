"use client";

import { useState, useMemo, useEffect } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import {
  bytesToHex,
  createPublicClient,
  encodePacked,
  formatUnits,
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
  USDC_NATIVE_GAS_ADDRESS,
  CCTP_CONFIG
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI, SUBSCRIPT_ROUTER_ABI, USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { Loader2, CheckCircle, AlertCircle, ShoppingBag } from "lucide-react";
import { sepolia } from "viem/chains";

/* Initialize standard viem public client targeting Arc Testnet */
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

/* Initialize public client for Ethereum Sepolia */
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http("https://rpc.ankr.com/eth_sepolia"),
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

  const [arcBalance, setArcBalance] = useState<number>(0);
  const [sepoliaBalance, setSepoliaBalance] = useState<number>(0);
  const [showCctpOption, setShowCctpOption] = useState(false);
  const [useCctp, setUseCctp] = useState(false);

  const checkBalances = async () => {
    if (!userWallet) return;
    try {
      const arcBalRaw = await publicClient.readContract({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userWallet as `0x${string}`],
      });
      const arcBal = Number(formatUnits(arcBalRaw, 6));
      setArcBalance(arcBal);

      const required = Number(amountCap);
      if (arcBal < required) {
        const sepoliaUSDC = CCTP_CONFIG[11155111].usdc;
        const sepoliaBalRaw = await sepoliaClient.readContract({
          address: sepoliaUSDC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [userWallet as `0x${string}`],
        });
        const sepoliaBal = Number(formatUnits(sepoliaBalRaw, 6));
        setSepoliaBalance(sepoliaBal);

        if (arcBal + sepoliaBal >= required) {
          setShowCctpOption(true);
        } else {
          setShowCctpOption(false);
        }
      } else {
        setShowCctpOption(false);
      }
    } catch (err) {
      console.error("Error checking balances:", err);
    }
  };

  useEffect(() => {
    if (isConnected && userWallet) {
      checkBalances();
    }
  }, [isConnected, userWallet, amountCap]);

  const handleCctpBridge = async () => {
    if (!userWallet) {
      setErrorMessage("Wallet not connected.");
      setLoadingState("error");
      return;
    }
    setErrorMessage(null);
    setLoadingState("Preparing Secure Payment");
    try {
      const requiredAmount = parseUnits((Number(amountCap) - arcBalance).toString(), 6);
      const sepoliaConfig = CCTP_CONFIG[11155111];

      // Step 1: Switch to Sepolia
      setStatusMessage("Switching network to Ethereum Sepolia...");
      if (chainId !== 11155111) {
        await switchChainAsync({ chainId: 11155111 });
      }

      // Step 2: Approve Sepolia TokenMessenger
      setStatusMessage("Approving USDC spend on Sepolia...");
      const approveHash = await writeContractAsync({
        address: sepoliaConfig.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [sepoliaConfig.tokenMessenger, requiredAmount],
      });

      setStatusMessage("Waiting for Sepolia approval transaction confirmation...");
      const approveReceipt = await sepoliaClient.waitForTransactionReceipt({
        hash: approveHash,
        timeout: 120_000,
      });
      if (approveReceipt.status !== "success") {
        throw new Error("Sepolia USDC approval failed.");
      }

      // Step 3: Burn on Sepolia
      setStatusMessage("Initiating CCTP burn on Sepolia...");
      const mintRecipientBytes32 = ("0x" + userWallet.slice(2).padStart(64, "0")) as `0x${string}`;
      
      const burnHash = await writeContractAsync({
        address: sepoliaConfig.tokenMessenger,
        abi: [
          {
            type: "function",
            name: "depositForBurn",
            stateMutability: "nonpayable",
            inputs: [
              { name: "amount", type: "uint256" },
              { name: "destinationDomain", type: "uint32" },
              { name: "mintRecipient", type: "bytes32" },
              { name: "burnToken", type: "address" },
            ],
            outputs: [{ name: "nonce", type: "uint64" }],
          },
        ],
        functionName: "depositForBurn",
        args: [requiredAmount, 26, mintRecipientBytes32, sepoliaConfig.usdc],
      });

      setStatusMessage("Waiting for CCTP burn transaction confirmation...");
      const burnReceipt = await sepoliaClient.waitForTransactionReceipt({
        hash: burnHash,
        timeout: 120_000,
      });
      if (burnReceipt.status !== "success") {
        throw new Error("Sepolia CCTP burn transaction failed.");
      }

      // Step 4: Fetch Attestation from Circle
      setStatusMessage("Circle attestation in progress. Fetching signature...");
      const logs = parseEventLogs({
        abi: [{ type: "event", name: "MessageSent", inputs: [{ type: "bytes", name: "message", indexed: false }] }],
        logs: burnReceipt.logs,
      });
      if (logs.length === 0) {
        throw new Error("MessageSent event not found in transaction receipt.");
      }
      const messageBytes = (logs[0].args as any).message;
      const messageHash = keccak256(messageBytes);

      let attestation: `0x${string}` | null = null;
      let attempts = 0;
      while (attempts < 60) {
        attempts++;
        try {
          const res = await fetch(`https://iris-api-sandbox.circle.com/attestations/${messageHash}`);
          const data = await res.json();
          if (data.status === "complete") {
            const rawHex = data.attestation;
            attestation = (rawHex.startsWith("0x") ? rawHex : `0x${rawHex}`) as `0x${string}`;
            break;
          }
        } catch (e) {
          console.warn("Attestation fetch retry:", e);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      if (!attestation) {
        throw new Error("Timeout waiting for Circle attestation signature.");
      }

      // Step 5: Switch back to Arc Testnet
      setStatusMessage("Switching network back to Arc Testnet...");
      await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });

      // Step 6: Mint USDC on Arc
      setStatusMessage("Minting USDC on Arc Network...");
      const mintHash = await writeContractAsync({
        address: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", // Arc MessageTransmitter
        abi: [
          {
            type: "function",
            name: "receiveMessage",
            stateMutability: "nonpayable",
            inputs: [
              { name: "message", type: "bytes" },
              { name: "attestation", type: "bytes" },
            ],
            outputs: [{ name: "success", type: "bool" }],
          },
        ],
        functionName: "receiveMessage",
        args: [messageBytes, attestation],
      });

      setStatusMessage("Waiting for Arc mint confirmation...");
      const mintReceipt = await publicClient.waitForTransactionReceipt({
        hash: mintHash,
        timeout: 120_000,
      });
      if (mintReceipt.status !== "success") {
        throw new Error("USDC minting transaction failed on Arc.");
      }

      // Step 7: Proceed to Checkout
      setStatusMessage("USDC successfully bridged! Finalizing checkout...");
      await checkBalances();
      await handleCheckout();

    } catch (err: any) {
      setErrorMessage(getCheckoutErrorMessage(err));
      setLoadingState("error");
    }
  };

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
        {showCctpOption && loadingState === "idle" && (
          <div className="bg-[#ccff00]/5 border border-[#ccff00]/20 rounded-2xl p-4 space-y-3 font-sans text-xs mb-2">
            <p className="text-white/80 leading-relaxed">
              Your Arc USDC balance is insufficient (<strong>${arcBalance.toFixed(2)}</strong>). You have <strong>${sepoliaBalance.toFixed(2)} USDC</strong> on Sepolia.
            </p>
            <label className="flex items-center gap-2.5 cursor-pointer text-white/90">
              <input
                type="checkbox"
                checked={useCctp}
                onChange={(e) => setUseCctp(e.target.checked)}
                className="w-4 h-4 rounded border-white/10 bg-white/[0.02] text-[#ccff00] focus:ring-0 cursor-pointer"
              />
              <span>Top-up via Circle CCTP Bridge</span>
            </label>
          </div>
        )}

        {loadingState === "idle" && (
          <button
            onClick={useCctp ? handleCctpBridge : handleCheckout}
            disabled={!isConnected || !merchantAddress}
            className="w-full py-4 bg-[#00d2b4] text-[#111111] hover:brightness-110 transition-all font-bold rounded-2xl text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-4 h-4 stroke-[2.5]" />
            {useCctp ? "Bridge & Subscribe" : "Subscribe"}
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
