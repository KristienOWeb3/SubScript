export function generateEscrowStatusTemplate(opts) {
    return `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */

"use client";

import React, { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { subscriptConfig } from "./subscript.config";

export function EscrowStatusTracker() {
  const { isConnected } = useAccount();
  const [hasEscrow, setHasEscrow] = useState(false);
  const [escrowDetail, setEscrowDetail] = useState<{ commitment: string } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("subscript_zk_secrets");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.commitment) {
          setHasEscrow(true);
          setEscrowDetail({ commitment: parsed.commitment });
        }
      } catch {
        // Ignore parsing errors
      }
    }
  }, []);

  if (!isConnected) {
    return null;
  }

  if (!hasEscrow || !escrowDetail) {
    return (
      <div style={{
        fontSize: "12px",
        color: "rgba(255,255,255,0.4)",
        padding: "12px",
        borderRadius: "8px",
        backgroundColor: "rgba(255,255,255,0.02)",
        textAlign: "center"
      }}>
        No active Escrow commitments found in browser cache.
      </div>
    );
  }

  return (
    <div style={{
      padding: "16px",
      borderRadius: "12px",
      backgroundColor: "rgba(0, 210, 180, 0.05)",
      border: "1px solid rgba(0, 210, 180, 0.2)",
      color: "#ffffff",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", color: "#00d2b4" }}>Active Privacy Premium Routing Pending Activation</h4>
      <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "rgba(255,255,255,0.6)", lineHeight: "1.4" }}>
        Your USDC deposit has been locked in the Escrow Router. Ready to submit ZK proof using a burner wallet.
      </p>
      <div style={{ fontSize: "10px", fontFamily: "monospace", wordBreak: "break-all", color: "rgba(255,255,255,0.5)" }}>
        Commitment: {escrowDetail.commitment}
      </div>
    </div>
  );
}
`;
}
