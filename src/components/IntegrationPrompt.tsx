"use client";

import { useState, useMemo } from "react";
import { useAccount } from "wagmi";
import { Copy, Check, Terminal, Sparkles } from "lucide-react";
import { 
  STANDARD_CONTRACT_ADDRESS, 
  SUBSCRIPT_ROUTER_ADDRESS, 
  USDC_NATIVE_GAS_ADDRESS, 
  ARC_TESTNET_CHAIN_ID 
} from "@/lib/contracts/constants";

interface IntegrationPromptProps {
  merchantAddress?: string | null;
  isPremium?: boolean;
}

export default function IntegrationPrompt({
  merchantAddress,
  isPremium = false,
}: IntegrationPromptProps) {
  const { address } = useAccount();
  const [copied, setCopied] = useState(false);

  const activeAddress = merchantAddress !== undefined ? merchantAddress : address;
  const isPremiumTier = isPremium;

  const promptText = useMemo(() => {
    const addressStr = activeAddress || "CONNECTING_WALLET...";
    if (isPremiumTier) {
      return `Act as an elite full-stack Web3 integration engineer. You are integrating the SubScript Decentralized Subscription Protocol into my application.

SubScript uses ZK Burner Proofs on Arc Testnet to implement secure, automated, recurring subscriptions.

To scaffold the Zero-Knowledge burner architecture, run the SubScript CLI:
npx @subscript-protocol/cli@latest init --merchant ${addressStr}

LIVE MERCHANT DEPLOYMENT DETAILS:
- Merchant Payout Wallet: "${addressStr}"
- SubScript Router Contract: "${SUBSCRIPT_ROUTER_ADDRESS}"
- USDC Contract (Native Gas Token): "${USDC_NATIVE_GAS_ADDRESS}"
- Network: Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID}, RPC: https://rpc.testnet.arc.network)

INTEGRATION WORKFLOW REQUIREMENTS:
1. FRONTEND USER FLOW (ZK Burner Method)
   - Step 1: User connects Funding Wallet and approves USDC token allowance for the router contract:
     USDC_NATIVE_GAS_ADDRESS.approve(SUBSCRIPT_ROUTER_ADDRESS, amount * 12)
   - Step 2: Generate a local cryptographically secure random 32-byte secret. Create commitment = keccak256(secret). Store the secret in the user's browser localStorage.
   - Step 3: Call depositAndCommit(commitment, amount) on the SubScript Router contract from the Funding Wallet.
   - Step 4: Construct the ZK-friendly parameter proof array: [secret, expectedPublicInputHash] where expectedPublicInputHash = keccak256(abi.encodePacked(merchant, amount, period)).
   - Step 5: Burner wallet calls verifyAndActivate(proof, nullifierHash, merchant, amount, period) on the SubScript Router.

2. WEBHOOK LOGIC & SIGNATURE VERIFICATION
   - Create a webhook receiver endpoint (e.g. POST /api/webhooks).
   - Verify the webhook signature using: HMAC-SHA256(webhook_secret_key, json_payload)

Please write clean, TypeScript-safe React components and backend routes using viem and ethers to implement this complete checkout workflow.`;
    } else {
      return `Act as an elite full-stack Web3 integration engineer. You are integrating the SubScript Decentralized Subscription Protocol into my application.

SubScript uses standard transparent on-chain subscriptions on Arc Testnet.

LIVE MERCHANT DEPLOYMENT DETAILS:
- Merchant Payout Wallet: "${addressStr}"
- SubScript Contract: "${STANDARD_CONTRACT_ADDRESS}"
- USDC Contract (Native Gas Token): "${USDC_NATIVE_GAS_ADDRESS}"
- Network: Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID}, RPC: https://rpc.testnet.arc.network)

INTEGRATION WORKFLOW REQUIREMENTS:
1. FRONTEND USER FLOW (Standard Transparent Method)
   - Step 1: User connects wallet and approves USDC token allowance for the SubScript contract:
     USDC_NATIVE_GAS_ADDRESS.approve(STANDARD_CONTRACT_ADDRESS, amount * 12)
   - Step 2: Call createSubscription(merchant, amount, periodSeconds) on the SubScript contract from the user's wallet.

2. WEBHOOK LOGIC & SIGNATURE VERIFICATION
   - Create a webhook receiver endpoint (e.g. POST /api/webhooks).
   - Verify the webhook signature using: HMAC-SHA256(webhook_secret_key, json_payload)

Please write clean, TypeScript-safe React components and backend routes using viem and ethers to implement this complete checkout workflow.`;
    }
  }, [activeAddress, isPremiumTier]);

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLoading = !activeAddress;

  return (
    <div className="w-full bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 relative overflow-hidden flex flex-col justify-between">
      <div className="absolute top-0 right-0 w-64 h-64 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-[#ccff00]/5 via-transparent to-transparent -z-10 pointer-events-none" />

      <div>
        <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
          <span>AI AGENT PROTOCOL</span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 text-[#ccff00]" /> AGENT DEVRAD
          </span>
        </div>

        <h3 className="text-2xl font-black uppercase tracking-tight text-white mb-2">
          AI Prompt Generator
        </h3>
        <p className="text-xs text-white/50 leading-relaxed font-sans mb-6">
          Generate a production-ready integration prompt for Cursor or Claude Code. Copy the output, and get instant code.
        </p>

        {isLoading ? (
          <div className="animate-pulse space-y-4 mb-6">
            <div className="h-4 bg-white/5 rounded w-1/3"></div>
            <div className="h-24 bg-white/5 rounded"></div>
          </div>
        ) : (
          <div className="relative rounded-2xl bg-black border border-white/5 p-4 mb-6">
            <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[9px] text-white/30 font-mono uppercase">
              <Terminal className="w-3 h-3" /> Preview
            </div>
            <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto pr-2">
              {promptText}
            </pre>
          </div>
        )}
      </div>

      <button
        onClick={handleCopy}
        disabled={isLoading}
        className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
          copied
            ? "bg-[#ccff00] text-black shadow-[0_0_20px_rgba(204,255,0,0.25)]"
            : "bg-white/5 hover:bg-[#ccff00]/10 border border-white/10 hover:border-[#ccff00]/30 text-white hover:text-[#ccff00]"
        }`}
      >
        {copied ? (
          <>
            <Check className="w-4 h-4" /> Prompt Copied! Paste into AI
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" /> Copy Integration Prompt
          </>
        )}
      </button>
    </div>
  );
}
