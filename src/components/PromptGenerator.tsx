"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Terminal, Sparkles } from "lucide-react";
import { useAccount } from "wagmi";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

export default function PromptGenerator() {
  const { address: web3Address } = useAccount();
  const [activeMerchantAddress, setActiveMerchantAddress] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [price, setPrice] = useState("10");
  const [period, setPeriod] = useState("2592000"); /* 30 days in seconds */
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchSessionAndTier = async () => {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data.loggedIn && data.wallet) {
          setActiveMerchantAddress(data.wallet);
          const tierRes = await fetch(`/api/merchant/tier?address=${data.wallet}`);
          const tierData = await tierRes.json();
          setIsPremium(tierData.tier >= 1);
        } else if (web3Address) {
          setActiveMerchantAddress(web3Address);
          const tierRes = await fetch(`/api/merchant/tier?address=${web3Address}`);
          const tierData = await tierRes.json();
          setIsPremium(tierData.tier >= 1);
        } else {
          setActiveMerchantAddress(null);
          setIsPremium(false);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchSessionAndTier();
  }, [web3Address]);

  const generatePrompt = () => {
    const displayAddress = activeMerchantAddress || "CONNECTING_WALLET...";
    
    if (!isPremium) {
      return `Act as an expert Web3 Next.js developer. I want to integrate SubScript, a decentralized recurring payment protocol on the Arc Network, into my app.

Here is my specific deployment data:
- MERCHANT_ADDRESS = "${displayAddress}"
- PRICE_PER_PERIOD = ${price} USDC (6 decimals)
- PAYMENT_PERIOD_SECONDS = ${period}
- SUBSCRIPT_CONTRACT = "0x38594705B7feE26B5E05a04069695A907b725b9f" (STANDARD_CONTRACT_ADDRESS)
- USDC_ADDRESS = "${USDC_NATIVE_GAS_ADDRESS}"
- Routing Metadata: { "routing": "traceable" }

Please write the Wagmi/Viem React hooks and components to implement the standard transparent subscription flow:
1. Approve USDC allowance for the contract: USDC_ADDRESS.approve(SUBSCRIPT_CONTRACT, totalPeriodAmount).
2. Call createSubscription(MERCHANT_ADDRESS, amount, PAYMENT_PERIOD_SECONDS) from the user's wallet.

Also include:
- A backend route to query/verify subscription status from the SubScript REST API: GET /api/v1/subscriptions?id=sub_... (passing 'Authorization: Bearer sk_test_...' in the headers).
- A webhook handler verifying signature header 'x-subscript-signature' computed as HMAC-SHA256(webhook_secret, payload).

Ensure the UI looks premium with glassmorphism and Tailwind CSS, and handle all states (pending, success, error) gracefully.`.trim();
    } else {
      return `Act as an expert Web3 Next.js developer. I want to integrate SubScript, a decentralized recurring payment protocol on the Arc Network, into my app.

Here is my specific deployment data:
- MERCHANT_ADDRESS = "${displayAddress}"
- PRICE_PER_PERIOD = ${price} USDC (6 decimals)
- PAYMENT_PERIOD_SECONDS = ${period}
- SUBSCRIPT_ROUTER = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29"
- USDC_ADDRESS = "${USDC_NATIVE_GAS_ADDRESS}"
- Routing Metadata: { "routing": "private" }

Since I am a Premium Merchant, we will use the Private Routing subscription flow. Run the following CLI command to automatically scaffold the Privacy-Enhanced Routing components and cryptographical dependencies:
npx @subscript-protocol/cli@latest init --merchant ${displayAddress}

Please write the integration wrappers and pages for the generated paywall:
1. Integrate the scaffolded SubScriptPaywall component into the checkout page.
2. Route users to the checkout wrapper with plan parameters.

Also include:
- A backend route to query/verify subscription status from the SubScript REST API: GET /api/v1/subscriptions?id=sub_... (passing 'Authorization: Bearer sk_test_...' in the headers).
- A webhook handler verifying signature header 'x-subscript-signature' computed as HMAC-SHA256(webhook_secret, payload).

Ensure the UI looks premium with glassmorphism and Tailwind CSS, and handle all states (pending, success, error) gracefully.`.trim();
    }
  };

  const handleCopy = () => {
    if (!activeMerchantAddress) {
      alert("Please enter or connect your Merchant Wallet Address first!");
      return;
    }
    navigator.clipboard.writeText(generatePrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:border-[#ccff00]/30 hover:shadow-[0_0_35px_rgba(204,255,0,0.03)] relative overflow-hidden flex flex-col justify-between">
      {/* Background radial highlight */}
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
          Generate a production-ready integration prompt for Cursor or Claude Code. Type your treasury address and price, copy the output, and get instant code.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="space-y-1.5 md:col-span-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Merchant Wallet / Treasury Address
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={activeMerchantAddress || ""}
              onChange={(e) => setActiveMerchantAddress(e.target.value)}
              className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-[#ccff00]/40 transition-colors font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Payment Flow Mode
            </label>
            <select
              value={isPremium ? "private" : "standard"}
              onChange={(e) => setIsPremium(e.target.value === "private")}
              className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white/80 focus:outline-none focus:border-[#ccff00]/40 transition-colors font-mono"
            >
              <option value="standard" className="bg-[#0a0a0c]">Traceable (Standard)</option>
              <option value="private" className="bg-[#0a0a0c]">Private Routing (Premium)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                Rate (USDC)
              </label>
              <input
                type="number"
                placeholder="10"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-[#ccff00]/40 transition-colors font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                Billing Cycle
              </label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white/80 focus:outline-none focus:border-[#ccff00]/40 transition-colors font-mono"
              >
                <option value="2592000" className="bg-[#0a0a0c]">Monthly (30d)</option>
                <option value="604800" className="bg-[#0a0a0c]">Weekly (7d)</option>
                <option value="86400" className="bg-[#0a0a0c]">Daily (24h)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Configuration Status Card */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 mb-6 text-center">
          <p className="text-xs text-white/60">
            Prompt configurations compiled successfully. Ready to copy for your AI coding assistant.
          </p>
        </div>
      </div>

      <button
        onClick={handleCopy}
        className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
          copied
            ? "bg-[#ccff00] text-black shadow-[0_0_20px_rgba(204,255,0,0.25)]"
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
