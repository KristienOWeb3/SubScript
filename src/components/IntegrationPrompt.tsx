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
  const [isPremiumState, setIsPremiumState] = useState(isPremium);

  const activeAddress = merchantAddress !== undefined ? merchantAddress : address;

  const promptText = useMemo(() => {
    const addressStr = activeAddress || "CONNECTING_WALLET...";
    if (isPremiumState) {
      return `Act as an elite full-stack Web3 integration engineer. You are integrating the SubScript Decentralized Subscription Protocol into my application.

SubScript uses Arc USDC routing, Checkout Intent IDs, and privacy-aware receipt controls to implement secure, automated, recurring subscriptions.

LIVE MERCHANT DEPLOYMENT DETAILS:
- Merchant Payout Wallet: "${addressStr}"
- SubScript Router Contract: "${SUBSCRIPT_ROUTER_ADDRESS}"
- USDC Contract (Native Gas Token): "${USDC_NATIVE_GAS_ADDRESS}"
- Network: Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID}, RPC: https://rpc.testnet.arc.network)
- Routing Metadata: { "routing": "private" }

To implement this project, follow this sequential 7-mission roadmap. Each mission must be completed completely with no TODOs or mock interfaces.

---

MISSION 1 — DATABASE SCHEMA & RELATIONS
Responsibilities:
- Create normalized PostgreSQL schemas (via Prisma) for: users, wallets, subscriptions, entitlements, subscription_events, payment_events, webhook_events, and audit_logs.
- Implement relational constraints, foreign keys, and indexes supporting lookups (entitlement, subscription, wallet) and webhook idempotency.
- Enforce unique constraints on webhook events (e.g., event hash/provider ID + destination endpoint) for DB-level deduplication.
- Design database queries to be row-locking compatible.

MISSION 2 — ENTITLEMENT ENGINE & REDIS CACHE
Responsibilities:
- Implement resolveAccess(), grantEntitlement(), and revokeEntitlement() with row-level locks on writes.
- Cache entitlement results in Redis (TTL = 300 seconds), evicting cached records on grant or revoke.
- CRITICAL: Entitlements must never rely on background cleanup jobs. resolveAccess() must treat expired records (validUntil <= now()) as revoked even if the database status remains ACTIVE.
- Derive entitlement duration strictly from database plan definitions (never accept duration from caller inputs).

MISSION 3 — SERVER RELAYER ENGINE
Responsibilities:
- Implement burner activation relay flow using viem on the server to execute verifyAndActivate().
- Server signs activation transaction; frontend burner wallet never funds gas.
- CRITICAL: Relayer state must survive process restarts. The nonce source of truth must not be in-memory. Persist nonce coordination using Redis or database locking.
- Manage tx propagation, handling RPC failures, dropped transactions, replacements (gas speed-up), and chain reorgs.

MISSION 4 — DETERMINISTIC CRYPTOGRAPHY & FRONTEND HOOKS
Responsibilities:
- Implement useSubscriptCheckout() to create or consume Checkout Intents, approve the SubScript router, execute the payment, verify the receipt, and handle webhook fulfillment.
- Derive AES key from deterministic EIP-191 signature. Encrypt secret, store ciphertext only.
- CRITICAL: The signature itself must never be stored. Only derived key material or ciphertext metadata may persist.
- Implement wallet reconnect, multi-device, and browser refresh recovery.

MISSION 5 — IDEMPOTENT WEBHOOK PROCESSOR
Responsibilities:
- Create a POST /api/webhooks route to ingest webhook events.
- Verify HMAC-SHA256 signature using the configured webhook_secret_key. Reject invalid signatures.
- Process subscription events: activated, payment.succeeded, payment.failed, cancelled, expired, updating entitlements.
- CRITICAL: A database unique constraint is required for idempotency. Application-level deduplication (e.g. cache lookups) alone is insufficient.

MISSION 6 — MIDDLEWARE & ACCESS CONTROL
Responsibilities:
- Protect all premium routes using Next.js middleware by evaluating entitlement status (Redis first, DB second).
- CRITICAL: Middleware must not instantiate PrismaClient or open TCP database connections directly. Middleware may only use Redis, an HTTP API route, or an Edge-compatible database endpoint.

MISSION 7 — SYSTEM INTEGRATION VERIFICATION
Responsibilities:
- Write comprehensive integration tests to verify: subscription activation, entitlement creation, relayer execution, webhook replay resistance, entitlement expiration, middleware route protection, cache invalidation, and multi-device recovery.
- Implement concurrency tests, replay attack tests, and relayer nonce collision tests.`;
    } else {
      return `Act as an elite full-stack Web3 integration engineer. You are integrating the SubScript Decentralized Subscription Protocol into my application.

SubScript uses standard transparent on-chain subscriptions on Arc Testnet.

LIVE MERCHANT DEPLOYMENT DETAILS:
- Merchant Payout Wallet: "${addressStr}"
- SubScript Contract: "${STANDARD_CONTRACT_ADDRESS}"
- USDC Contract (Native Gas Token): "${USDC_NATIVE_GAS_ADDRESS}"
- Network: Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID}, RPC: https://rpc.testnet.arc.network)
- Routing Metadata: { "routing": "traceable" }

To implement this project, follow this sequential 6-mission roadmap. Each mission must be completed completely with no TODOs or mock interfaces.

---

MISSION 1 — DATABASE SCHEMA & RELATIONS
Responsibilities:
- Create normalized PostgreSQL schemas (via Prisma) for: users, wallets, subscriptions, entitlements, subscription_events, payment_events, webhook_events, and audit_logs.
- Implement relational constraints, foreign keys, and indexes supporting lookups (entitlement, subscription, wallet) and webhook idempotency.
- Enforce unique constraints on webhook events (e.g., event hash/provider ID + destination endpoint) for DB-level deduplication.
- Design database queries to be row-locking compatible.

MISSION 2 — ENTITLEMENT ENGINE & REDIS CACHE
Responsibilities:
- Implement resolveAccess(), grantEntitlement(), and revokeEntitlement() with row-level locks on writes.
- Cache entitlement results in Redis (TTL = 300 seconds), evicting cached records on grant or revoke.
- CRITICAL: Entitlements must never rely on background cleanup jobs. resolveAccess() must treat expired records (validUntil <= now()) as revoked even if the database status remains ACTIVE.
- Derive entitlement duration strictly from database plan definitions (never accept duration from caller inputs).

MISSION 3 — FRONTEND CHECKOUT HOOK
Responsibilities:
- Implement a React hook useSubscriptCheckout() using viem.
- Handle standard transparent checkout flow:
  1. Approve USDC allowance for the contract: approve(STANDARD_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS * 12).
  2. Call createSubscription(merchant, amount, periodSeconds) from user's connected wallet.
- Display transaction states (approving, executing, success, error) with clean, minimal text/loaders.

MISSION 4 — IDEMPOTENT WEBHOOK PROCESSOR
Responsibilities:
- Create a POST /api/webhooks route to ingest webhook events.
- Verify HMAC-SHA256 signature using the configured webhook_secret_key. Reject invalid signatures.
- Process subscription events: activated, payment.succeeded, payment.failed, cancelled, expired, updating entitlements.
- CRITICAL: A database unique constraint is required for idempotency. Application-level deduplication (e.g. cache lookups) alone is insufficient.

MISSION 5 — MIDDLEWARE & ACCESS CONTROL
Responsibilities:
- Protect all premium routes using Next.js middleware by evaluating entitlement status (Redis first, DB second).
- CRITICAL: Middleware must not instantiate PrismaClient or open TCP database connections directly. Middleware may only use Redis, an HTTP API route, or an Edge-compatible database endpoint.

MISSION 6 — SYSTEM INTEGRATION VERIFICATION
Responsibilities:
- Write comprehensive integration tests to verify: subscription activation, entitlement creation, webhook replay resistance, passive entitlement expiration, middleware route protection, and cache invalidation.
- Implement concurrency tests and replay attack verification.`;
    }
  }, [activeAddress, isPremiumState]);

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
          <div className="space-y-4 mb-6">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                Payment Flow Mode
              </label>
              <select
                value={isPremiumState ? "private" : "standard"}
                onChange={(e) => setIsPremiumState(e.target.value === "private")}
                className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white/80 focus:outline-none focus:border-[#ccff00]/40 transition-colors font-mono"
              >
                <option value="standard" className="bg-[#0a0a0c]">Traceable (Standard)</option>
                <option value="private" className="bg-[#0a0a0c]">Private Routing (Premium)</option>
              </select>
            </div>

            {/* Configuration Status Card */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-5 text-center">
              <p className="text-xs text-white/60 leading-relaxed">
                Prompt configurations compiled successfully. Ready to copy for your AI coding assistant.
              </p>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleCopy}
        disabled={isLoading}
        className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
          copied
            ? "bg-[#ccff00] text-[#111111] shadow-[0_0_20px_rgba(204,255,0,0.25)]"
            : "bg-white/5 hover:bg-[#ccff00]/10 border border-white/10 hover:border-[#ccff00]/30 text-white hover:text-[#ccff00]"
        }`}
      >
        {copied ? (
          <>
            <Check className="w-4 h-4" /> ✓ Prompt Copied
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" /> Copy Payment Prompt
          </>
        )}
      </button>
    </div>
  );
}
