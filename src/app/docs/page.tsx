"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
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

type Section = {
  id: string;
  title: string;
  icon: typeof BookOpen;
};

const sections: Section[] = [
  { id: "overview", title: "Overview", icon: BookOpen },
  { id: "paths", title: "Choose a path", icon: Zap },
  { id: "nocode", title: "No-code links", icon: Link2 },
  { id: "vibecoder", title: "Vibecoder prompt", icon: MessageSquare },
  { id: "developer", title: "Developer API", icon: Server },
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
const response = await fetch("https://subscriptonarc.com/api/payment-links", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_live_your_subscript_secret_key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    amountUsdc: "15.00",
    title: "Premium Plan",
    description: "Monthly access for user_123",
    intentId: "intent_abc123",
    customerReference: "user_123",
    webhookUrl: "https://yourapp.com/api/subscript-webhook"
  })
});

const { payUrl, qrCodeUrl, receiptId } = await response.json();`;

const frontendEmbedCode = `// Frontend: send the customer to hosted checkout
export function UpgradeButton({ payUrl }) {
  return (
    <a href={payUrl} className="subscript-button">
      Pay with SubScript
    </a>
  );
}`;

const webhookCode = `import crypto from "crypto";

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-subscript-signature");
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;

  const [timestampPart, digestPart] = signature.split(",");
  const timestamp = timestampPart.replace("t=", "");
  const digest = digestPart.replace("v1=", "");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event === "payment.success") {
    await unlockPlanForUser(event.data.intent_id);
  }

  return Response.json({ received: true });
}`;

const vibePrompt = `You are integrating SubScript into my app.

Goal:
- Add a "Pay with SubScript" button to my pricing page.
- My backend should create a Checkout Intent for the logged-in user.
- Store intent_id in my database beside the user's account.
- Redirect the user to the SubScript payUrl.
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
- Keep all secret keys server-side only.`;

const viemMemoCode = `import { encodeFunctionData, parseUnits } from "viem";

const memoContract = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const receiptId = "Premium-Plan-user-123-a8f2";

const data = encodeFunctionData({
  abi: [{
    type: "function",
    name: "callWithMemo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "memo", type: "string" }
    ],
    outputs: [{ name: "result", type: "bytes" }]
  }],
  functionName: "callWithMemo",
  args: [
    SUBSCRIPT_ROUTER_ADDRESS,
    encodeFunctionData({
      abi: routerAbi,
      functionName: "depositForMerchant",
      args: [merchantAddress, parseUnits("15", 6), receiptId]
    }),
    JSON.stringify({
      receipt_id: receiptId,
      intent_id: "intent_abc123",
      merchant: "yourapp.hq",
      amount: "15000000"
    })
  ]
});

await walletClient.sendTransaction({ to: memoContract, data });`;

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
    <div className="relative min-h-screen bg-transparent text-white">
      <AnimatedGradientBg />

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
              href="/merchant"
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
              SubScript lets a platform accept recurring USDC payments without forcing users to understand wallets, gas, bridges, or raw transaction hashes. Merchants create Checkout Intents, users pay through SubScript, Arc memo receipts make the payment human-readable, and webhooks tell the merchant exactly which Web2 user to unlock.
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

          <section id="webhooks" className="scroll-mt-24 space-y-6">
            <h2 className="text-2xl font-black uppercase tracking-tight text-white">Webhook fulfillment</h2>
            <p className="text-sm leading-relaxed text-white/70">
              Webhooks close the Web2/Web3 gap. The merchant does not need the payer wallet address. The merchant only needs to trust the signed event and use the `intent_id` to unlock the right Web2 account.
            </p>
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-xs leading-relaxed text-white/75">
              Keep `SUBSCRIPT_SECRET_KEY` and `SUBSCRIPT_WEBHOOK_SECRET` server-side only. Never expose them in React, mobile clients, public repositories, or browser bundles.
            </div>
            <CodeBlock code={webhookCode} language="javascript" />
          </section>

          <section id="receipts" className="scroll-mt-24 space-y-6">
            <h2 className="text-2xl font-black uppercase tracking-tight text-white">Human-readable receipts with Arc memos</h2>
            <p className="text-sm leading-relaxed text-white/70">
              SubScript receipts are designed for humans, not explorers. A payer can share a URL like `subscriptonarc.com/receipt/Dinner-With-Alex-8f2a`, while SubScript indexes the Arc memo and displays amount, sender, merchant, date, note, and transaction status.
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
              Advanced teams can attach memo metadata to a SubScript router call through Arc's predeployed memo contract. Use this only when you are building a custom wallet, checkout, or protocol integration.
            </p>
            <CodeBlock code={viemMemoCode} language="typescript" />
          </section>

          <section id="faq" className="scroll-mt-24 space-y-6">
            <h2 className="text-2xl font-black uppercase tracking-tight text-white">FAQ</h2>
            {[
              ["How easy is integration?", "A no-code merchant can launch with a hosted link in minutes. A developer can add intent creation and webhook fulfillment in under an hour if their app already has user accounts."],
              ["Does the merchant need to track wallets?", "No. The merchant should track Checkout Intent IDs. SubScript maps wallet payment activity to the off-chain intent and sends the signed result."],
              ["What does the user pay?", "The user pays the advertised USDC price. SubScript is designed around predictable Arc USDC gas and sponsored-fee flows so users avoid hidden card-style fees."],
              ["Why is this better than dollar cards?", "Users avoid virtual card setup fees, maintenance fees, failed transaction penalties, KYC delays for basic wallet setup, billing-address failures, and FX markup surprises."],
              ["What problem does SubScript solve?", "It stops zombie subscriptions, double-billing, hidden cancellation traps, overdraft-style penalties, and opaque receipt disputes by moving billing state into transparent programmable payment logic."],
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
  );
}
