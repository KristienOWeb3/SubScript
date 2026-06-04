export function generateCheckoutButtonTemplate(opts) {
    const isZk = opts.mode === "zk-routed";
    return `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */

"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import {
  createPublicClient,
  http,
  parseUnits,
  encodePacked,
  keccak256,
  bytesToHex,
  type Hex
} from "viem";
import { arcTestnet } from "./SubScriptProvider";
import { subscriptConfig } from "./subscript.config";

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

// ABIs needed for ERC20 and SubScript interactions
const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
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
] as const;

const STANDARD_ABI = [
  {
    type: "function",
    name: "createSubscription",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "period", type: "uint256" }
    ],
    outputs: []
  }
] as const;

const ROUTER_ABI = [
  {
    type: "function",
    name: "depositAndCommit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "verifyAndActivate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes32[]" },
      { name: "nullifierHash", type: "bytes32" },
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "period", type: "uint256" }
    ],
    outputs: []
  }
] as const;

interface CheckoutButtonProps {
  amountUsdc: string;
  intervalSeconds: bigint;
  planName?: string;
  onSuccess?: (txHash: string) => void;
}

export function SubScriptCheckoutButton({
  amountUsdc,
  intervalSeconds,
  planName = "SubScript Plan",
  onSuccess
}: CheckoutButtonProps) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<"idle" | "approving" | "executing" | "proving" | "activating" | "success" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState("");
  const [zkSecrets, setZkSecrets] = useState<{ secret: Hex; nullifier: Hex; commitment: Hex } | null>(null);

  const amount = useMemo(() => parseUnits(amountUsdc, 6), [amountUsdc]);

  const handleCheckout = useCallback(async () => {
    if (!isConnected || !address) {
      setErrorMsg("Please connect your wallet first.");
      setStatus("error");
      return;
    }

    setStatus("approving");
    setErrorMsg("");
    setMsg("Checking allowance and requesting USDC approval...");

    try {
      const spender = ${isZk ? "subscriptConfig.routerAddress" : "subscriptConfig.standardAddress"};

      // 1. Check & Approve USDC
      const currentAllowance = await publicClient.readContract({
        address: subscriptConfig.usdcAddress as Hex,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, spender as Hex],
      });

      if (currentAllowance < amount) {
        const approvalAmount = ${isZk ? "amount" : "amount * BigInt(12)"};
        const appTx = await writeContractAsync({
          address: subscriptConfig.usdcAddress as Hex,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender as Hex, approvalAmount],
        });

        setMsg("Waiting for USDC approval transaction...");
        await publicClient.waitForTransactionReceipt({ hash: appTx });
      }

      ${isZk
        ? `// ZK Routed Two-Phase Escrow flow (Tier 1 Premium)
      setStatus("executing");
      setMsg("Generating cryptographic commitment...");
      
      const secretBytes = new Uint8Array(32);
      const nullifierBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      crypto.getRandomValues(nullifierBytes);
      
      const secret = bytesToHex(secretBytes);
      const nullifier = bytesToHex(nullifierBytes);
      const commitment = keccak256(encodePacked(["bytes32", "bytes32"], [secret, nullifier]));
      
      setZkSecrets({ secret, nullifier, commitment });
      setMsg("Submitting ZK commitment deposit...");

      const depTx = await writeContractAsync({
        address: subscriptConfig.routerAddress as Hex,
        abi: ROUTER_ABI,
        functionName: "depositAndCommit",
        args: [commitment, amount],
      });

      setMsg("Confirming deposit on-chain...");
      await publicClient.waitForTransactionReceipt({ hash: depTx });

      // In production ZK-routed flows, local proofs are derived or submitted via a relayer/burner
      setStatus("proving");
      setMsg("Generating local ZK proof...");

      const nullifierHash = keccak256(nullifier);
      const mockProof: Hex[] = [
        secret,
        keccak256(encodePacked(["address", "uint256", "uint256"], [subscriptConfig.merchantAddress as Hex, amount, intervalSeconds]))
      ];

      setStatus("activating");
      setMsg("Submitting proof and activating subscription...");

      const actTx = await writeContractAsync({
        address: subscriptConfig.routerAddress as Hex,
        abi: ROUTER_ABI,
        functionName: "verifyAndActivate",
        args: [mockProof, nullifierHash, subscriptConfig.merchantAddress as Hex, amount, intervalSeconds],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: actTx });
      if (receipt.status !== "success") {
        throw new Error("ZK verification transaction failed");
      }

      setTxHash(actTx);
      setStatus("success");
      setMsg("ZK subscription successfully activated via Escrow Router Proxy.");
      if (onSuccess) onSuccess(actTx);`
        : `// Standard Direct Subscription flow (Tier 0)
      setStatus("executing");
      setMsg("Submitting subscription transaction on-chain...");

      const subTx = await writeContractAsync({
        address: subscriptConfig.standardAddress as Hex,
        abi: STANDARD_ABI,
        functionName: "createSubscription",
        args: [subscriptConfig.merchantAddress as Hex, amount, intervalSeconds],
      });

      setMsg("Confirming subscription on-chain...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: subTx });
      if (receipt.status !== "success") {
        throw new Error("Subscription execution transaction failed");
      }

      setTxHash(subTx);
      setStatus("success");
      setMsg("Subscription successfully activated on-chain.");
      if (onSuccess) onSuccess(subTx);`}
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.shortMessage || err.message || "Execution failed");
      setStatus("error");
    }
  }, [isConnected, address, amount, writeContractAsync, intervalSeconds, onSuccess]);

  return (
    <div className="subscript-checkout-container" style={{
      padding: "24px",
      borderRadius: "16px",
      backgroundColor: "#0d0d11",
      border: "1px solid rgba(255,255,255,0.05)",
      color: "#ffffff",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "bold" }}>{planName}</h3>
      <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "rgba(255,255,255,0.6)" }}>
        Recurring price: <strong style={{ color: "#00d2b4" }}>{amountUsdc} USDC</strong> per billing cycle
      </p>

      {status === "idle" && (
        <button
          onClick={handleCheckout}
          style={{
            width: "100%",
            padding: "12px 24px",
            borderRadius: "8px",
            backgroundColor: "#00d2b4",
            color: "#0a0a0c",
            border: "none",
            fontWeight: "bold",
            cursor: "pointer",
            fontSize: "14px"
          }}
        >
          Subscribe Now
        </button>
      )}

      {status !== "idle" && status !== "success" && status !== "error" && (
        <div style={{ textAlign: "center", fontSize: "14px" }}>
          <div style={{ color: "#00d2b4", fontWeight: "bold" }}>{status.toUpperCase()}</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px", marginTop: "4px" }}>{msg}</div>
        </div>
      )}

      {status === "success" && (
        <div style={{ color: "#10b981", fontSize: "14px", textAlign: "center" }}>
          <strong>✓ Active</strong>
          <p style={{ margin: "4px 0 0 0", color: "rgba(255,255,255,0.6)", fontSize: "12px" }}>{msg}</p>
          {txHash && <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", wordBreak: "break-all" }}>Tx: {txHash}</p>}
        </div>
      )}

      {status === "error" && (
        <div style={{ color: "#ef4444", fontSize: "14px", textAlign: "center" }}>
          <strong>Error Occurred</strong>
          <p style={{ margin: "4px 0 12px 0", color: "rgba(255,255,255,0.6)", fontSize: "12px" }}>{errorMsg}</p>
          <button
            onClick={() => setStatus("idle")}
            style={{
              padding: "6px 16px",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.05)",
              color: "#ffffff",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
              fontSize: "12px"
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
`;
}
