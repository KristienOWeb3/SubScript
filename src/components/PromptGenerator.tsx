"use client";

import { useState } from "react";
import { Copy, Check, Terminal, Sparkles } from "lucide-react";

export default function PromptGenerator() {
  const [merchantAddress, setMerchantAddress] = useState("");
  const [price, setPrice] = useState("10");
  const [period, setPeriod] = useState("2592000"); // 30 days in seconds
  const [copied, setCopied] = useState(false);

  const generatePrompt = () => {
    return `Act as an expert Web3 Next.js developer. I want to integrate SubScript, a decentralized recurring payment protocol on the Arc Network, into my app.

Here is my specific deployment data:
- MERCHANT_ADDRESS = "${merchantAddress || "[INSERT YOUR WALLET ADDRESS]"}"
- PRICE_PER_PERIOD = ${price} USDC (6 decimals)
- PAYMENT_PERIOD_SECONDS = ${period} // ${parseInt(period) === 2592000 ? "30 days" : period === "86400" ? "1 day" : period === "604800" ? "7 days" : "custom"}
- SUBSCRIPT_ROUTER = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29"
- USDC_ADDRESS = "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc"

Please write the Wagmi/Viem React hooks and components to implement the ZK Burner subscription flow:
1. Approve USDC allowance for the router: USDC_ADDRESS.approve(SUBSCRIPT_ROUTER, totalPeriodAmount).
2. Generate a random 32-byte secret locally in browser. Compute commitment = keccak256(secret).
3. Call depositAndCommit(commitment, periodAmount) from the funding wallet.
4. Generate the parameter proof array [secret, expectedPublicInputHash] where expectedPublicInputHash = keccak256(abi.encodePacked(merchant, amount, period)).
5. Switch to a burner wallet and call verifyAndActivate(proof, nullifierHash, merchant, amount, period) on the SubScript router.

Also include:
- A backend route to query/verify subscription status from the SubScript REST API: GET /api/v1/subscriptions?id=sub_... (passing 'Authorization: Bearer sk_test_...' in the headers).
- A webhook handler verifying signature header 'x-subscript-signature' computed as HMAC-SHA256(webhook_secret, payload).

Ensure the UI looks premium with glassmorphism and Tailwind CSS, and handle all states (pending, success, error) gracefully.`.trim();
  };

  const handleCopy = () => {
    if (!merchantAddress) {
      alert("Please enter your Merchant Wallet Address first!");
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Merchant Wallet / Treasury Address
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={merchantAddress}
              onChange={(e) => setMerchantAddress(e.target.value)}
              className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-[#ccff00]/40 transition-colors font-mono"
            />
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

        {/* Live Prompt Preview */}
        <div className="relative rounded-2xl bg-black border border-white/5 p-4 mb-6">
          <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[9px] text-white/30 font-mono uppercase">
            <Terminal className="w-3 h-3" /> Preview
          </div>
          <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto pr-2">
            {generatePrompt()}
          </pre>
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
