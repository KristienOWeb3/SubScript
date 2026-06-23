"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Code,
  Copy,
  FileText,
  Globe,
  HelpCircle,
  KeyRound,
  Link2,
  Menu,
  MessageSquare,
  QrCode,
  ReceiptText,
  Server,
  ShieldCheck,
  Terminal,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { getDashboardUrl } from "@/utils/navigation";

type Section = {
  id: string;
  title: string;
  icon: typeof BookOpen;
};

const sections: Section[] = [
  { id: "overview", title: "Overview", icon: BookOpen },
  { id: "protocol", title: "Protocol brief", icon: ShieldCheck },
  { id: "paths", title: "Choose a path", icon: Zap },
  { id: "upa", title: "UPA model", icon: ShieldCheck },
  { id: "nocode", title: "No-code links", icon: Link2 },
  { id: "vibecoder", title: "Vibecoder prompt", icon: MessageSquare },
  { id: "developer", title: "Developer API", icon: Server },
  { id: "usage", title: "Usage billing", icon: Terminal },
  { id: "webhooks", title: "Webhooks", icon: Webhook },
  { id: "receipts", title: "Receipts", icon: ReceiptText },
  { id: "contracts", title: "On-chain", icon: Code },
  { id: "faq", title: "FAQ", icon: HelpCircle },
];

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-white/10 bg-black/60 text-xs shadow-xl">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-[#ccff00]" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 leading-relaxed text-white/85">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const checkoutIntentCode = `// Merchant backend: create a Checkout Intent with SubScript
const response = await fetch("https://www.subscriptonarc.com/api/intent", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_test_your_subscript_secret_key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    title: "Premium Plan",
    amountUsdc: "15000000",
    description: "Monthly access for user_123",
    externalReference: "user_123",
    idempotencyKey: "intent_abc123",
    sandbox: true
  })
});

const payload = await response.json();

if (!response.ok) {
  if (payload.error === "merchant_payout_wallet_missing") {
    throw new Error(payload.message);
  }
  throw new Error(payload.error || "SubScript checkout creation failed");
}

const checkoutUrl = payload.intent.checkoutUrl;
const intentId = payload.intent.id;
const receiptToken = payload.intent.receiptToken;`;

const frontendEmbedCode = `// Frontend: send the customer to hosted checkout
export function UpgradeButton({ checkoutUrl }) {
  return (
    <a href={checkoutUrl} className="subscript-button">
      Pay with SubScript
    </a>
  );
}`;

const webhookCode = `import crypto from "crypto";

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-subscript-signature");
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;

  if (!secret || !signature) {
    return Response.json({ error: "Missing webhook configuration or signature" }, { status: 400 });
  }

  const [timestampPart, digestPart] = signature.split(",");
  const timestamp = timestampPart.replace("t=", "");
  const digest = digestPart.replace("v1=", "");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  const received = Buffer.from(digest, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event === "payment.success") {
    // Use event.id for idempotency, then fulfill by intent_id.
    await unlockPlanForUser(event.data.intent_id);
  }

  return Response.json({ received: true });
}`;

const vibePrompt = `You are integrating SubScript into my app.

Goal:
- Add a "Pay with SubScript" button to my pricing page.
- My backend should create a Checkout Intent for the logged-in user.
- Store intent_id in my database beside the user's account.
- Store intent_id and receiptToken in my database beside the user's account or order.
- Redirect the user to the SubScript checkoutUrl.
- Add a webhook route that verifies x-subscript-signature.
- When payment.success arrives, look up data.intent_id and unlock the plan.

Use:
- Amount: 15 USDC
- Product: Premium Plan
- Webhook path: /api/subscript-webhook
- Env vars: SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET

Important:
- Do not ask the merchant to know the payer wallet.
- Use intent_id as the source of truth.
- Hosted checkout is Arc-native USDC only right now; do not add Base, Solana, or CCTP checkout unless the local docs say it is live.
- Treat fiat onramps, dedicated invoices, sponsor workflows, merchant commitment windows, and Chainlink Automation as deployment-scoped unless the local app explicitly implements them.
- Keep all secret keys server-side only.`;

const viemMemoCode = `import { parseUnits } from "viem";

const receiptToken = "rcpt-7e10c918a3aa672eb783f1b965914b12";

await walletClient.writeContract({
  address: SUBSCRIPT_ROUTER_ADDRESS,
  abi: [{
    type: "function",
    name: "depositForMerchant",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
    ],
    outputs: []
  }],
  functionName: "depositForMerchant",
  args: [merchantAddress, parseUnits("15", 6), receiptToken],
});`;

const meteredUsageCode = `// Merchant backend: charge per session (or per call / token / item) and
// gate access in one request. The customer commits to your vault once;
// report-usage both ACCRUES the charge and tells you if access is allowed.

const res = await fetch("https://www.subscriptonarc.com/api/user/vault/report-usage", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`, // server-side only
  },
  body: JSON.stringify({
    userAddress: "0xCustomerWallet...",
    amountUsdc: "0.50", // price of this session / unit of work
  }),
});

if (res.status === 402) {
  // Vault inactive: the customer owes a balance or dropped below your
  // required commit. Block the session and ask them to re-commit.
  const { owedUsdc, commitUsdc } = await res.json();
  return denySession({ owedUsdc, commitUsdc });
}

const usage = await res.json();
// usage.active === true, usage.accruedUsageUsdc grows over the 30-day cycle.
grantSession();

// You don't collect per call. At cycle end SubScript's keeper draws the
// accrued total from the customer's escrow; you withdraw it with merchantClaim
// (Merchant dashboard -> Vault, or POST /api/merchant/vault/claim).`;

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-18% 0px -64% 0px", threshold: 0.1 },
    );

    sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.current?.observe(el);
    });

    return () => observer.current?.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setActiveSection(id);
    setMobileMenuOpen(false);
  };

  return (
    <main className="relative min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-transparent text-white selection:bg-[#ccff00]/30 selection:text-white">
      <AnimatedGradientBg />

      <div className="relative z-10">
        <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-[#070709]/85 px-6 py-4 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div className="flex items-center gap-5">
              <Link href="/" className="flex items-center gap-2.5">
                <img src="/logo.png" alt="SubScript" className="h-7 w-7 object-contain" />
                <span className="text-sm font-black uppercase tracking-wider">
                  SubScript <span className="font-serif font-normal italic lowercase text-[#ccff00]">docs</span>
                </span>
              </Link>
              <span className="hidden h-4 w-px bg-white/10 md:block" />
              <span className="hidden text-[10px] font-black uppercase tracking-[0.18em] text-white/35 md:block">
                Integration guide
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={getDashboardUrl("ENTERPRISE", "/merchant")}
                className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10 sm:flex"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => setMobileMenuOpen((open) => !open)}
                className="rounded-full border border-white/5 bg-white/5 p-2 text-white/70 transition hover:text-white md:hidden"
                aria-label="Toggle documentation navigation"
              >
                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </header>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              className="fixed left-0 right-0 top-16 z-40 border-b border-white/10 bg-[#070709] p-5 shadow-2xl md:hidden"
            >
              <nav className="flex flex-col gap-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-xs font-bold uppercase tracking-wider transition ${
                        activeSection === section.id ? "bg-[#ccff00]/15 text-[#ccff00]" : "text-white/60 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {section.title}
                    </button>
                  );
                })}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 pb-20 pt-24 md:grid-cols-4">
          <aside className="sticky top-24 col-span-1 hidden self-start md:block">
            <div className="liquid-glass rounded-2xl border border-white/5 bg-black/40 p-5 backdrop-blur-md">
              <p className="mb-3 border-b border-white/5 pb-3 text-[9px] font-black uppercase tracking-widest text-white/30">
                Documentation map
              </p>
              <nav className="flex flex-col gap-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const active = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider transition ${
                        active ? "border border-[#ccff00]/20 bg-[#ccff00]/10 text-[#ccff00]" : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {section.title}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main className="col-span-1 space-y-16 md:col-span-3">
            <section id="overview" className="scroll-mt-24 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#ccff00]/20 bg-[#ccff00]/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#ccff00]">
                <BookOpen className="h-3 w-3" />
                Start here
              </div>
              <h1 className="max-w-3xl text-4xl font-black uppercase tracking-tight text-white sm:text-5xl">
                The easiest way to add programmable USDC subscriptions.
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-white/70">
                SubScript lets a platform accept programmable USDC payments without forcing users to understand wallets, gas, bridges, dollar cards, or raw transaction hashes. Merchants create Checkout Intents, users pay through SubScript, Arc memo receipts make the payment human-readable, and webhooks tell the merchant exactly which Web2 user or order to unlock.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  ["10 minutes", "Hosted payment links for no-code teams"],
                  ["30 minutes", "Backend Checkout Intent plus webhook"],
                  ["Advanced", "Direct Arc memo and router integration"],
                ].map(([label, text]) => (
                  <div key={label} className="liquid-glass rounded-2xl border border-white/5 bg-black/25 p-5">
                    <p className="text-2xl font-black text-[#ccff00]">{label}</p>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="protocol" className="scroll-mt-24 space-y-6">
              <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.06] p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">
                      Protocol brief
                    </p>
                    <h2 className="mt-3 text-2xl font-black uppercase tracking-tight text-white">
                      UPA, live primitives, and deployment-scoped targets
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
                      The protocol brief translates the updated feature document into the platform boundary:
                      what is live today, what problem each flow solves, and what should remain caveated until
                      production deployment settings prove it.
                    </p>
                  </div>
                  <Link
                    href="/protocol"
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-xs font-black uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/15 hover:text-white"
                  >
                    Open brief
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </section>

            <section id="paths" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Choose your integration path</h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[
                  ["No-code merchant", "Create a payment link in the merchant dashboard, copy the URL or QR code, and paste it into your product, Notion page, Linktree, or checkout screen.", Link2],
                  ["Vibecoder", "Paste the prompt below into your coding agent. It tells the agent to create Checkout Intents, store intent IDs, redirect users, and verify webhooks.", MessageSquare],
                  ["Backend developer", "Use the REST API to create Checkout Intents and a signed webhook route to fulfill purchases in your own database.", Server],
                  ["Protocol team", "Use Viem/Ethers to route USDC transfers through SubScript contracts and Arc memo payloads directly.", Code],
                ].map(([title, text, Icon]) => (
                  <div key={String(title)} className="rounded-3xl border border-white/5 bg-black/30 p-6">
                    <Icon className="mb-4 h-6 w-6 text-[#ccff00]" />
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">{title as string}</h3>
                    <p className="mt-3 text-xs leading-relaxed text-white/55">{text as string}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="upa" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Unified Payment Authorization model</h2>
              <p className="text-sm leading-relaxed text-white/70">
                SubScript's Unified Payment Authorization model gives one-time payments, subscriptions, usage events, invoices, and AI-native transactions the same operational shape: a merchant creates a structured authorization, the payer approves a bounded USDC action, SubScript records the receipt, and signed webhooks tell the merchant what to unlock.
              </p>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[
                  ["Consumer control", "Users authorize bounded payment flows and can avoid zombie subscriptions, hidden card fees, overdraft-style penalties, and opaque dispute trails.", ShieldCheck],
                  ["Merchant certainty", "Merchants receive intent IDs, webhook events, retry-aware billing state, payment links, and audit-friendly Arc receipt records instead of raw wallet guesswork.", KeyRound],
                  ["Protocol coverage", "Current platform surfaces include Checkout Intents, payment links, metered vaults, signed webhooks, receipts, DNS-style aliases, premium privacy flows, retries, reconciliation, and keeper-triggered renewals.", Globe],
                ].map(([title, text, Icon]) => (
                  <div key={String(title)} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <Icon className="mb-3 h-5 w-5 text-[#ccff00]" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">{title as string}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text as string}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                Encrypted private-key export, direct fiat-to-USDC onramps, dedicated invoice terms, sponsor workflows, service lock windows, minimum commitment periods, configurable dunning schedules, and fully decentralized Chainlink Automation are protocol targets documented in the feature brief. The current app already provides the integration primitives those features build on: intents, subscriptions, retries, keeper routes, webhooks, receipts, and merchant dashboards.
              </div>
            </section>

            <section id="nocode" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">No-code setup: payment links and QR checkout</h2>
              <ol className="space-y-3 text-sm leading-relaxed text-white/70">
                <li>1. Sign up as a merchant and open the SubScript merchant dashboard.</li>
                <li>2. Create a payment link with amount, title, description, and optional customer reference.</li>
                <li>3. Copy the hosted checkout URL or QR code.</li>
                <li>4. Put the URL behind your pricing button, invoice, Discord message, or email campaign.</li>
                <li>5. When the payer completes checkout, SubScript records the payment, creates a receipt, and can notify your backend through webhooks.</li>
              </ol>
              <div className="rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/10 p-5 text-xs leading-relaxed text-white/75">
                Best for creators, small SaaS teams, vibe-built products, and early pilots that need payments live before a full backend integration exists.
              </div>
            </section>

            <section id="vibecoder" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Vibecoder prompt</h2>
              <p className="text-sm leading-relaxed text-white/70">
                If you are building with an AI coding agent, paste this directly into it. The important thing is that your app stores the SubScript `intent_id` beside your own user record and waits for the signed webhook before unlocking access.
              </p>
              <CodeBlock code={vibePrompt} language="prompt" />
            </section>

            <section id="developer" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Developer flow: Checkout Intent lifecycle</h2>
              <div className="rounded-3xl border border-white/5 bg-black/30 p-6">
                <ol className="space-y-3 text-sm leading-relaxed text-white/70">
                  <li>1. Your user clicks upgrade inside your app.</li>
                  <li>2. Your backend creates `intent_abc123` and associates it with your user ID.</li>
                  <li>3. Your backend asks SubScript for a hosted pay URL tagged with that intent.</li>
                  <li>4. SubScript checkout handles wallet connection, Google wallet onboarding, USDC approval, Arc payment execution, and receipt creation.</li>
                  <li>5. Your webhook receives `payment.success` with the same `intent_id` and unlocks the user.</li>
                </ol>
              </div>
              <CodeBlock code={checkoutIntentCode} language="javascript" />
              <CodeBlock code={frontendEmbedCode} language="tsx" />
            </section>

            <section id="usage" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Pay-per-use billing with commit vaults</h2>
              <p className="text-sm leading-relaxed text-white/70">
                For metered products that do not fit fixed monthly plans, SubScript uses on-chain <span className="font-bold text-white/90">commit vaults</span>. You set a commit amount; the customer escrows it once; their service stays active for the cycle while you report usage. Funds are guaranteed up to the committed balance — you are not chasing per-call card charges.
              </p>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[
                  ["API & AI tokens", "Bill API calls, model tokens, or agent runs as they happen instead of forcing every customer into a static tier.", Terminal],
                  ["Per-session access", "Charge per session, render, or job — gate each one on the vault status in a single request.", Server],
                  ["Pay-per-view items", "Settle small purchases for articles, clips, data exports, or premium actions without an all-access plan.", FileText],
                ].map(([title, text, Icon]) => (
                  <div key={String(title)} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <Icon className="mb-3 h-5 w-5 text-[#ccff00]" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">{title as string}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text as string}</p>
                  </div>
                ))}
              </div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white pt-2">How a developer integrates pay-per-session</h3>
              <ol className="space-y-2 text-xs leading-relaxed text-white/65 list-decimal pl-5">
                <li><span className="font-bold text-white/85">Set your commit.</span> In Merchant dashboard → Vault (or <span className="font-mono">POST /api/merchant/vault/commit-config</span>) set the USDC a customer must escrow to use your service.</li>
                <li><span className="font-bold text-white/85">Customer commits once.</span> They escrow ≥ the commit from their SubScript wallet; the vault goes <span className="text-emerald-300 font-bold">active</span> and your service is unlocked for the 30-day cycle.</li>
                <li><span className="font-bold text-white/85">Report each session.</span> Call <span className="font-mono">POST /api/user/vault/report-usage</span> with your secret key at session start. It accrues the charge and returns the vault status — a <span className="font-mono">402</span> means the customer must re-commit, so gate access on the response.</li>
                <li><span className="font-bold text-white/85">Get paid at cycle end.</span> SubScript's keeper draws the accrued total from escrow; you withdraw with <span className="font-mono">merchantClaim</span>. If usage exceeded the commit, the overage is recorded as owed and the service pauses until the customer re-commits — funds are never pulled from their main wallet.</li>
              </ol>
              <CodeBlock code={meteredUsageCode} language="javascript" />
              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                Keep <span className="font-mono">SUBSCRIPT_SECRET_KEY</span> server-side only. Usage accrues off-chain during the cycle and settles on-chain at cycle end; the customer's escrow guarantees you payment up to the committed amount. Direct bank-transfer fiat-to-USDC funding remains provider/compliance-scoped until a live onramp is wired.
              </div>
            </section>

            <section id="webhooks" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Webhook fulfillment</h2>
              <p className="text-sm leading-relaxed text-white/70">
                Webhooks close the Web2/Web3 gap. The merchant does not need the payer wallet address. The merchant only needs to trust the signed event and use the `intent_id` to unlock the right Web2 account.
              </p>
              <div className="rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/10 p-5 text-xs leading-relaxed text-white/75">
                Canonical successful checkout event: `payment.success`. Payloads also include `type: "payment.succeeded"` for teams that prefer Stripe-style naming. Use `data.intent_id` or `data.checkout_session_id` as the fulfillment key.
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-xs leading-relaxed text-white/75">
                Keep `SUBSCRIPT_SECRET_KEY` and `SUBSCRIPT_WEBHOOK_SECRET` server-side only. Never expose them in React, mobile clients, public repositories, or browser bundles.
              </div>
              <CodeBlock code={webhookCode} language="javascript" />
            </section>

            <section id="receipts" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Human-readable receipts with Arc memos</h2>
              <p className="text-sm leading-relaxed text-white/70">
                SubScript receipts are designed for humans, not explorers. A payer can share a URL like `www.subscriptonarc.com/receipt/rcpt-7e10c918a3aa672eb783f1b965914b12`, while SubScript indexes the Arc memo and displays amount, sender, merchant, date, note, and transaction status.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <ReceiptText className="mb-3 h-5 w-5 text-[#ccff00]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">Default visibility</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">Receipt data is intended for the payer, merchant, and SubScript by default. Future invite flows can selectively disclose a receipt to another viewer.</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <ShieldCheck className="mb-3 h-5 w-5 text-[#ccff00]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">Proof without confusion</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">The receipt page hides raw transaction complexity while preserving auditability through Arc memo indexing.</p>
                </div>
              </div>
            </section>

            <section id="contracts" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">Advanced: Arc memo transaction payload</h2>
              <p className="text-sm leading-relaxed text-white/70">
                Merchant hosted links settle through the SubScript Router: the receipt token is passed as the router memo, and the backend verifies the matching `DepositWithMemo` event before marking the payment paid. User-created receive links settle as direct Arc USDC transfers to the requester, with the backend verifying the ERC-20 `Transfer` call and event. Cross-chain CCTP checkout is disabled for hosted payment links until Arc-side mint and memo settlement can be verified in one bound flow.
              </p>
              <CodeBlock code={viemMemoCode} language="typescript" />
            </section>

            <section id="faq" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white">FAQ</h2>
              {[
                ["How easy is integration?", "A no-code merchant can launch with a hosted link in minutes. A developer can add intent creation and webhook fulfillment in under an hour if their app already has user accounts."],
                ["Can I test before setting a payout wallet?", "Yes. Use a `sk_test_` key or send `sandbox: true` while developing. Live keys require a configured payout destination and return `merchant_payout_wallet_missing` if setup is incomplete."],
                ["Can SubScript handle usage-based products?", "Yes. Commit vaults let a customer escrow a merchant-set amount once; the merchant reports API calls, tokens, sessions, or per-item access via the usage API, which accrues the charges and gates access. SubScript draws the accrued total from escrow at the end of each 30-day cycle."],
                ["Can someone else sponsor a subscription?", "The protocol model supports sponsored payment relationships such as parents, employers, or teams covering costs while keeping the subscriber's usage context separate. Dedicated sponsor records, spending caps, and revocation policies are still deployment-scoped."],
                ["Does SubScript require users to export their wallet key?", "The product target is to require a secure encrypted private-key export after Google wallet provisioning so users can recover wallet access independently. The app should not claim the onboarding is fully non-custodial permanent until that backup step is enforced."],
                ["How does SubScript compare to streaming payment protocols?", "SubScript uses Permit2-style bounded allowances rather than continuous locked streaming liquidity, so funds can remain liquid in the user's wallet until a billing-cycle transaction executes."],
                ["Can merchants enforce lock windows?", "The UPA model includes service lock windows, minimum commitments, and grace periods, with a ceiling of 72 hours for digital goods and 30 days for SaaS seats. These terms need explicit schema, contract enforcement, and UI disclosure before live use."],
                ["Does SubScript have smart dunning?", "The platform has retry, reconciliation, billing, and notification primitives. Configurable Day 1, Day 3, and Day 7 schedules plus email/SMS top-up reminders should be formalized before calling it fully live."],
                ["Does the merchant need to track wallets?", "No. The merchant should track Checkout Intent IDs. SubScript maps wallet payment activity to the off-chain intent and sends the signed result."],
                ["What does the user pay?", "The user pays the advertised USDC price. SubScript is designed around predictable Arc USDC gas and sponsored-fee flows so users avoid hidden card-style fees."],
                ["Why is this better than dollar cards?", "Users avoid virtual card setup fees, maintenance fees, failed transaction penalties, KYC delays for basic wallet setup, billing-address failures, and FX markup surprises."],
                ["What problem does SubScript solve?", "It stops zombie subscriptions, double-billing, hidden cancellation traps, overdraft-style penalties, and opaque receipt disputes by moving billing state into transparent programmable payment logic."],
                ["Does SubScript provide invoices?", "The current product supports payment links, Checkout Intents, receipt records, and external references that cover invoice-like collection. A dedicated invoice engine with custom due terms is documented as a protocol target."],
                ["Does SubScript use decentralized keepers?", "The codebase has keeper-compatible contract and API surfaces today. Full Chainlink Automation as the default execution network should be treated as a roadmap or deployment configuration item until the production keeper network is wired."],
              ].map(([question, answer]) => (
                <div key={question} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">{question}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">{answer}</p>
                </div>
              ))}
            </section>
          </main>
        </div>

        <footer className="border-t border-white/5 bg-[#070709] px-6 py-12 text-center text-xs text-white/40">
          <p className="mb-2">© 2026 SubScript Protocol. All rights reserved.</p>
          <p>Built for programmable USDC payments on Arc Network.</p>
        </footer>
      </div>
    </main>
  );
}
