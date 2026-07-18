"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
  RefreshCcw,
  Server,
  ShieldCheck,
  Terminal,
  Webhook,
  X,
  Zap,
} from "@/components/icons";
import { AnimatePresence, motion } from "framer-motion";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { getDashboardUrl } from "@/utils/navigation";

type Section = {
  id: string;
  title: string;
  icon: typeof BookOpen;
  group: "Essentials" | "Platform" | "Build" | "Reference";
};

const sections: Section[] = [
  { id: "overview", title: "Start here", icon: BookOpen, group: "Essentials" },
  { id: "quickstart", title: "5-minute quickstart", icon: Zap, group: "Essentials" },
  { id: "concepts", title: "Core concepts", icon: KeyRound, group: "Essentials" },
  { id: "protocol", title: "Protocol brief", icon: FileText, group: "Platform" },
  { id: "paths", title: "Choose a path", icon: Globe, group: "Platform" },
  { id: "upa", title: "UPA model", icon: ShieldCheck, group: "Platform" },
  { id: "nocode", title: "No-code links", icon: Link2, group: "Platform" },
  { id: "vibecoder", title: "AI integration prompt", icon: MessageSquare, group: "Platform" },
  { id: "developer", title: "API reference", icon: Server, group: "Build" },
  { id: "subscriptions", title: "Subscriptions", icon: RefreshCcw, group: "Build" },
  { id: "usage", title: "Usage billing", icon: Terminal, group: "Build" },
  { id: "webhooks", title: "Webhooks", icon: Webhook, group: "Build" },
  { id: "testing", title: "Test & debug", icon: Terminal, group: "Build" },
  { id: "errors", title: "Errors", icon: ShieldCheck, group: "Reference" },
  { id: "receipts", title: "Receipts", icon: ReceiptText, group: "Reference" },
  { id: "contracts", title: "On-chain", icon: Code, group: "Reference" },
  { id: "faq", title: "FAQ", icon: HelpCircle, group: "Reference" },
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
      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-[#00d2b4]" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 leading-relaxed text-white/85">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const quickstartCurl = `curl --request POST \\
  --url https://www.subscriptonarc.com/api/intent \\
  --header "Authorization: Bearer sk_test_your_secret_key" \\
  --header "Content-Type: application/json" \\
  --data '{
    "title": "Premium Plan",
    "description": "Monthly access",
    "amountUsdcMicros": "15000000",
    "externalReference": "user_123",
    "idempotencyKey": "checkout_user_123_premium_v1",
    "sandbox": true,
    "successUrl": "https://yourapp.com/billing/success",
    "cancelUrl": "https://yourapp.com/pricing"
  }'`;

const intentResponseCode = `{
  "success": true,
  "sandbox": true,
  "intent": {
    "id": "clx_intent_123",
    "checkoutSessionId": "clx_intent_123",
    "title": "Premium Plan",
    "amountUsdcMicros": "15000000",
    "status": "PENDING",
    "receiptToken": "rcpt-7e10c918a3aa672eb783f1b965914b12",
    "checkoutUrl": "https://www.subscriptonarc.com/pay/clx_intent_123",
    "chainId": 5042002,
    "usdcAddress": "0x3600000000000000000000000000000000000000"
  }
}`;

const intentStatusCode = `// Poll when you need a synchronous status check.
// Webhooks remain the source of truth for fulfillment.
const status = await fetch("https://www.subscriptonarc.com/api/intent/clx_intent_123");
const { intent } = await status.json();

if (intent.status === "PAID") {
  // Safe to reconcile dashboards or support views.
  // Fulfillment should still be idempotent and webhook-driven.
}`;

const checkoutIntentCode = `// Run this on your server — never in a browser component.
const response = await fetch("https://www.subscriptonarc.com/api/intent", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Premium Plan",
    amountUsdcMicros: "15000000", // 15 USDC; always an integer string
    description: "Monthly access for user_123",
    externalReference: "user_123",
    idempotencyKey: "checkout_user_123_premium_v1",
    sandbox: true,
    successUrl: "https://yourapp.com/billing/success",
    cancelUrl: "https://yourapp.com/pricing",
  }),
});

const payload = await response.json();

if (!response.ok) {
  console.error("SubScript request failed", {
    code: payload.code,
    requestId: payload.request_id,
  });
  throw new Error(payload.message || "SubScript checkout creation failed");
}

// Persist all three beside your own order/user before redirecting.
const checkoutUrl = payload.intent.checkoutUrl;
const intentId = payload.intent.id;
const receiptToken = payload.intent.receiptToken;`;

const frontendEmbedCode = `// Frontend: open hosted checkout in a new tab so your app keeps its state.
// After settlement, checkout routes the payer back to your successUrl with
// ?subscript_status=success&subscript_checkout_id=...&subscript_receipt_id=...&subscript_tx_hash=...
// (treat those as navigation hints only — confirm payment via webhook or the intent status API).
export function UpgradeButton({ checkoutUrl }) {
  return (
    <a href={checkoutUrl} target="_blank" rel="noopener" className="subscript-button">
      Pay with SubScript
    </a>
  );
}`;

const subscriptionCode = `const response = await fetch("https://www.subscriptonarc.com/api/v1/subscriptions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Kris's Script Pro",
    amountUsdcMicros: "7000000",
    interval: "weekly",
    externalReference: "user_123:pro_weekly",
    idempotencyKey: "sub_user_123_pro_weekly",
    sandbox: true,
  }),
});

const { subscription } = await response.json();

// Redirect to hosted checkout. It becomes active after the customer
// authorizes the bounded recurring payment on-chain.
return redirect(subscription.checkoutUrl);`;

const subscriptionResponseCode = `{
  "success": true,
  "sandbox": true,
  "subscription": {
    "id": "sub_7f9c5f1e-4a1f-4b4f-bbc1-761b34c0eebb",
    "object": "subscription",
    "status": "incomplete",
    "merchantAddress": "0xMerchant...",
    "subscriber": null,
    "amountUsdcMicros": "7000000",
    "amountUsdc": "7",
    "intervalSeconds": 604800,
    "intervalCount": 1,
    "interval": "weekly",
    "checkoutUrl": "https://www.subscriptonarc.com/pay/7f9c5f1e-4a1f-4b4f-bbc1-761b34c0eebb"
  }
}`;

const webhookCode = `import crypto from "crypto";

export async function POST(req) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-subscript-signature");
  const secret = process.env.SUBSCRIPT_WEBHOOK_SECRET;

  if (!secret || !signatureHeader) {
    return Response.json({ error: "Missing webhook configuration or signature" }, { status: 400 });
  }

  const match = signatureHeader.match(/^t=(\\d+),v1=([a-f0-9]{64})$/);
  if (!match) {
    return Response.json({ error: "Malformed signature" }, { status: 401 });
  }

  const timestamp = Number(match[1]);
  const digest = match[2];
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    return Response.json({ error: "Expired signature" }, { status: 401 });
  }

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

  // Insert event.id into a UNIQUE column before fulfilling.
  // If it already exists, return 200 without running fulfillment again.
  const inserted = await claimWebhookEvent(event.id);
  if (!inserted) return Response.json({ received: true, duplicate: true });

  if (event.type === "payment.succeeded") {
    await unlockPlanForUser(event.data.intent_id);
  }

  return Response.json({ received: true });
}`;

const webhookPayloadCode = `{
  "id": "evt_payment_abc123",
  "type": "payment.succeeded",
  "created": 1783080000,
  "data": {
    "intent_id": "clx_intent_123",
    "merchant_reference": "user_123",
    "amount": "15",
    "amount_usdc_micros": "15000000",
    "currency": "USDC",
    "receipt_id": "rcpt-7e10c918a3aa672eb783f1b965914b12",
    "transaction_hash": "0x...",
    "chain_id": 5042002,
    "usdc_address": "0x3600000000000000000000000000000000000000"
  }
}`;

const vibePrompt = `You are integrating SubScript into my app.

Goal:
- Add a "Pay with SubScript" button to my pricing page.
- My backend should create a Checkout Intent for the logged-in user.
- Store intent_id in my database beside the user's account.
- Store intent_id, externalReference, and receiptToken beside the user's account or order before redirecting.
- Redirect the user to the SubScript checkoutUrl.
- Add a webhook route that reads the raw body, verifies the timestamped x-subscript-signature, and atomically claims event.id.
- When payment.succeeded arrives (check event.type), look up data.intent_id and unlock the plan.

Use:
- Amount: 15 USDC
- Product: Premium Plan
- Webhook path: /api/subscript-webhook
- Env vars: SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET

Important:
- Do not ask the merchant to know the payer wallet.
- Use intent_id as the source of truth.
- Send amountUsdcMicros as an integer string ("15000000" = 15 USDC).
- Use one stable idempotencyKey per logical checkout and reuse it only for retries.
- Never fulfill from the success redirect; fulfill only from the verified webhook.
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

const meteredUsageCode = `// Merchant backend: check readiness, then ALWAYS call report-usage BEFORE
// you serve the unit of work. report-usage both ACCRUES the charge and tells
// you whether access is allowed — treat any non-200 as "do not serve".
// The customer commits to your vault once; you never collect per call.

const statusRes = await fetch(
  "https://www.subscriptonarc.com/api/user/vault/status?userAddress=0xCustomerWallet...",
  { headers: { Authorization: \`Bearer \${process.env.SUBSCRIPT_SECRET_KEY}\` } }
);
const status = await statusRes.json();

if (!status.active) {
  return showCommitPrompt(status.onboarding?.dashboardUrl);
}

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
  const body = await res.json();
  // Two "do not serve" cases:
  //  - VAULT_INACTIVE:    owes a balance or dropped below your required commit.
  //  - COMMIT_EXHAUSTED:  this charge would exceed their remaining escrow. The
  //    whole request is rejected — nothing accrues, so a customer can never be
  //    charged past what they committed. body.remainingUsdc tells you what's
  //    left; you may retry with a smaller unit (<= remainingUsdc) if that fits.
  return denySession(body); // ask them to re-commit (or serve a smaller unit)
}

const usage = await res.json();
// 200 == accrued and within escrow — safe to serve.
// usage.active === true, usage.accruedUsageUsdc grows over the 30-day cycle.
grantSession();

// You don't collect per call. At cycle end SubScript's keeper draws the accrued
// total from the customer's escrow; you withdraw it with merchantClaim
// (Merchant dashboard -> Vault, or POST /api/merchant/vault/claim).`;

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const navigationLock = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const desktopContent = window.matchMedia("(min-width: 768px)").matches
      ? contentRef.current
      : null;
    observer.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !navigationLock.current) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { root: desktopContent, rootMargin: "-8% 0px -72% 0px", threshold: 0.1 },
    );

    sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.current?.observe(el);
    });

    return () => {
      observer.current?.disconnect();
      if (navigationLock.current) clearTimeout(navigationLock.current);
    };
  }, []);

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    const content = contentRef.current;
    if (target && content && window.matchMedia("(min-width: 768px)").matches) {
      const top = target.getBoundingClientRect().top
        - content.getBoundingClientRect().top
        + content.scrollTop
        - 24;
      content.scrollTop = Math.max(0, top);
    } else {
      target?.scrollIntoView({ behavior: "smooth" });
    }
    setActiveSection(id);
    if (navigationLock.current) clearTimeout(navigationLock.current);
    navigationLock.current = setTimeout(() => {
      navigationLock.current = null;
    }, 1200);
    setMobileMenuOpen(false);
  };

  return (
    <div className="relative min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white md:h-screen md:overflow-hidden">
      <AnimatedGradientBg />

      <div className="relative z-10 md:h-full">
        <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-[#070709]/85 px-6 py-4 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div className="flex items-center gap-5">
              <Link href="/" className="flex items-center gap-2.5">
                <Image src="/logo.png" alt="SubScript" width={28} height={28} className="h-7 w-7 object-contain drop-shadow-[0_0_8px_rgba(0,210,180,0.4)]" priority />
                <span className="text-sm font-semibold uppercase tracking-wider">
                  SubScript <span className="font-serif font-normal italic lowercase text-[#00d2b4]">docs</span>
                </span>
              </Link>
              <span className="hidden h-4 w-px bg-white/10 md:block" />
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 md:block">
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
              className="fixed left-0 right-0 top-16 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain border-b border-white/10 bg-[#070709] p-5 shadow-2xl md:hidden"
            >
              <nav className="flex flex-col gap-1">
                {sections.map((section, index) => {
                  const Icon = section.icon;
                  return (
                    <div key={section.id}>
                      {(index === 0 || sections[index - 1].group !== section.group) && (
                        <p className={`mb-1 px-4 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 ${index === 0 ? "mt-0" : "mt-4"}`}>
                          {section.group}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-xs font-bold uppercase tracking-wider transition ${
                          activeSection === section.id ? "bg-[#00d2b4]/15 text-[#00d2b4]" : "text-white/60 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {section.title}
                      </button>
                    </div>
                  );
                })}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 pb-20 pt-24 md:h-full md:grid-cols-4 md:grid-rows-[minmax(0,1fr)] md:pb-0 md:pt-20">
          <aside className="col-span-1 hidden min-h-0 self-stretch overflow-y-auto overscroll-contain pb-8 pr-2 md:block">
            <div className="liquid-glass rounded-2xl border border-white/5 bg-black/40 p-5 backdrop-blur-md">
              <p className="mb-3 border-b border-white/5 pb-3 text-[9px] font-semibold uppercase tracking-widest text-white/30">
                Documentation map
              </p>
              <nav className="flex flex-col gap-1">
                {sections.map((section, index) => {
                  const Icon = section.icon;
                  const active = activeSection === section.id;
                  return (
                    <div key={section.id}>
                      {(index === 0 || sections[index - 1].group !== section.group) && (
                        <p className={`mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25 ${index === 0 ? "mt-0" : "mt-4"}`}>
                          {section.group}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider transition ${
                          active ? "border border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4]" : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {section.title}
                      </button>
                    </div>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main
            ref={contentRef}
            className="col-span-1 min-h-0 space-y-16 md:col-span-3 md:overflow-y-auto md:overscroll-contain md:pb-20 md:pr-3"
          >
            <section id="overview" className="scroll-mt-24 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#00d2b4]/20 bg-[#00d2b4]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#00d2b4]">
                <BookOpen className="h-3 w-3" />
                Start here
              </div>
              <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
                From API key to verified USDC payment.
              </h1>
              <p className="max-w-3xl text-sm leading-relaxed text-white/70">
                Create a Checkout Intent from your backend, redirect the payer to SubScript, and fulfill your order from a signed webhook. This guide starts with a working sandbox request, then explains every identifier, security boundary, and production decision.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => scrollToSection("quickstart")}
                  className="inline-flex items-center gap-2 rounded-full bg-[#00d2b4] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[#04110f] transition hover:bg-[#42e7cd]"
                >
                  Start quickstart
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection("developer")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10"
                >
                  API reference
                  <Code className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  ["5 minutes", "First sandbox Checkout Intent"],
                  ["OpenAPI + llms.txt", "Machine-readable specs for humans and agents"],
                  ["Self-testable", "CLI trigger, local listener, and sandbox test clocks"],
                ].map(([label, text]) => (
                  <div key={label} className="liquid-glass rounded-2xl border border-white/5 bg-black/25 p-5">
                    <p className="text-2xl font-bold text-[#00d2b4]">{label}</p>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ["OpenAPI", "/openapi.json"],
                  ["LLM index", "/llms.txt"],
                  ["Full agent context", "/llms-full.txt"],
                ].map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    className="rounded-2xl border border-white/5 bg-black/30 p-4 text-xs transition hover:border-[#00d2b4]/35 hover:bg-[#00d2b4]/10"
                  >
                    <span className="block font-semibold text-white">{label}</span>
                    <span className="mt-1 block font-mono text-[#00d2b4]">{href}</span>
                  </a>
                ))}
              </div>
            </section>

            <section id="quickstart" className="scroll-mt-24 space-y-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">
                  First successful integration
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Create a hosted checkout in five minutes</h2>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
                  Your backend creates an intent, your frontend redirects to its hosted checkout URL, and your webhook fulfills the order after SubScript verifies the Arc settlement. You never need to map a payer wallet to your user.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[
                  ["1", "Get a test key", "Open Dashboard → Developers → API keys and create an sk_test_ key."],
                  ["2", "Keep it server-side", "Save it as SUBSCRIPT_SECRET_KEY. Never prefix it with NEXT_PUBLIC_."],
                  ["3", "Choose your order ID", "Use your user, order, or invoice ID as externalReference so fulfillment maps cleanly."],
                ].map(([number, title, text]) => (
                  <div key={number} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#00d2b4]/15 text-xs font-bold text-[#00d2b4]">
                      {number}
                    </div>
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                  </div>
                ))}
              </div>

              <CodeBlock
                code={`# .env.local — server only
SUBSCRIPT_SECRET_KEY=sk_test_your_secret_key
SUBSCRIPT_WEBHOOK_SECRET=whsec_your_endpoint_secret`}
                language="dotenv"
              />

              <div>
                <h3 className="text-sm font-semibold text-white">1. Create the Checkout Intent</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/60">
                  This request is safely retryable because the idempotency key is stable for this logical checkout.
                </p>
              </div>
              <CodeBlock code={quickstartCurl} language="bash" />

              <div>
                <h3 className="text-sm font-semibold text-white">2. Store the response, then redirect</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/60">
                  Persist <span className="font-mono text-white/85">intent.id</span>, your <span className="font-mono text-white/85">externalReference</span>, and <span className="font-mono text-white/85">receiptToken</span> before sending the browser to <span className="font-mono text-white/85">checkoutUrl</span>.
                </p>
              </div>
              <CodeBlock code={intentResponseCode} language="json" />

              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-5 text-xs leading-relaxed text-amber-50/85">
                <span className="font-bold text-amber-100">Fulfillment rule:</span> never unlock from the success redirect alone. Redirects are user-controlled navigation. Unlock only after a valid, idempotently processed <span className="font-mono">payment.succeeded</span> webhook.
              </div>
            </section>

            <section id="concepts" className="scroll-mt-24 space-y-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">
                  Mental model
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Four identifiers, one predictable lifecycle</h2>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
                  Most integration mistakes come from treating identifiers as interchangeable. Give each one a single job and persist the relationship in your database.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  ["intent.id", "SubScript's checkout identifier", "Use this to correlate checkout, webhook, receipt, and support requests."],
                  ["externalReference", "Your identifier", "Set this to your user ID, order ID, or invoice ID. It returns as merchant_reference."],
                  ["receiptToken", "Human-readable proof handle", "Links the hosted checkout to its Arc memo receipt without exposing raw chain complexity."],
                  ["event.id", "Webhook delivery identifier", "Store it under a UNIQUE constraint before fulfillment so retries cannot duplicate work."],
                ].map(([name, title, text]) => (
                  <div key={name} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <p className="font-mono text-xs font-bold text-[#00d2b4]">{name}</p>
                    <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30 p-5">
                <div className="flex min-w-[680px] items-center justify-between gap-3 text-center">
                  {[
                    ["1", "Create intent", "PENDING"],
                    ["2", "Redirect payer", "Hosted checkout"],
                    ["3", "Verify settlement", "Arc USDC"],
                    ["4", "Receive webhook", "payment.succeeded"],
                    ["5", "Fulfill once", "Your database"],
                  ].map(([number, title, detail], index) => (
                    <div key={title} className="flex flex-1 items-center gap-3">
                      <div className="min-w-0 flex-1 rounded-xl border border-white/5 bg-white/[0.03] p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[#00d2b4]">Step {number}</p>
                        <p className="mt-1 text-xs font-semibold text-white">{title}</p>
                        <p className="mt-1 text-[10px] text-white/40">{detail}</p>
                      </div>
                      {index < 4 && <ArrowRight className="h-4 w-4 shrink-0 text-white/25" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-5 text-xs leading-relaxed text-white/70">
                <span className="font-bold text-cyan-100">Money units:</span> <span className="font-mono">amountUsdcMicros</span> is always a positive integer string in six-decimal micro-USDC. <span className="font-mono">&quot;15000000&quot;</span> means 15 USDC; <span className="font-mono">&quot;1&quot;</span> means 0.000001 USDC. Never send floats.
              </div>
            </section>

            <section id="protocol" className="scroll-mt-24 space-y-6">
              <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.06] p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                      Protocol brief
                    </p>
                    <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
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
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/15 hover:text-white"
                  >
                    Open brief
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </section>

            <section id="paths" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Choose your integration path</h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[
                  ["No-code merchant", "Create a payment link in the merchant dashboard, copy the URL or QR code, and paste it into your product, Notion page, Linktree, or checkout screen.", Link2],
                  ["Vibecoder", "Paste the prompt below into your coding agent. It tells the agent to create Checkout Intents, store intent IDs, redirect users, and verify webhooks.", MessageSquare],
                  ["Backend developer", "Use the REST API to create Checkout Intents and a signed webhook route to fulfill purchases in your own database.", Server],
                  ["Protocol team", "Use Viem/Ethers to route USDC transfers through SubScript contracts and Arc memo payloads directly.", Code],
                ].map(([title, text, Icon]) => (
                  <div key={String(title)} className="rounded-3xl border border-white/5 bg-black/30 p-6">
                    <Icon className="mb-4 h-6 w-6 text-[#00d2b4]" />
                    <h3 className="text-sm font-semibold text-white">{title as string}</h3>
                    <p className="mt-3 text-xs leading-relaxed text-white/55">{text as string}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="upa" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Unified Payment Authorization model</h2>
              <p className="text-sm leading-relaxed text-white/70">
                SubScript's Unified Payment Authorization model gives one-time payments, subscriptions, usage events, invoices, and AI-native transactions the same operational shape: a merchant creates a structured authorization, the payer approves a bounded USDC action, SubScript records the receipt, and signed webhooks tell the merchant what to unlock.
              </p>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[
                  ["Consumer control", "Users authorize bounded payment flows and can avoid unwanted recurring charges, hidden card fees, overdraft-style penalties, and opaque dispute trails.", ShieldCheck],
                  ["Merchant certainty", "Merchants receive intent IDs, webhook events, retry-aware billing state, payment links, and audit-friendly Arc receipt records instead of raw wallet guesswork.", KeyRound],
                  ["Protocol coverage", "Current platform surfaces include Checkout Intents, payment links, metered vaults, signed webhooks, receipts, DNS-style aliases, premium privacy flows, retries, reconciliation, and keeper-triggered renewals.", Globe],
                ].map(([title, text, Icon]) => (
                  <div key={String(title)} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <Icon className="mb-3 h-5 w-5 text-[#00d2b4]" />
                    <h3 className="text-xs font-semibold text-white">{title as string}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text as string}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                Circle developer-controlled custody, direct fiat-to-USDC onramps, dedicated invoice terms, sponsor workflows, service lock windows, minimum commitment periods, configurable dunning schedules, and fully decentralized Chainlink Automation are protocol targets documented in the feature brief. Google social sign-in is paused until Circle identity is verified server-side. The current app already provides the integration primitives those features build on: intents, subscriptions, retries, keeper routes, webhooks, receipts, and merchant dashboards.
              </div>
            </section>

            <section id="nocode" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">No-code setup: payment links and QR checkout</h2>
              <ol className="space-y-3 text-sm leading-relaxed text-white/70">
                <li>1. Sign up as a merchant and open the SubScript merchant dashboard.</li>
                <li>2. Create a payment link with amount, title, description, and optional customer reference.</li>
                <li>3. Copy the hosted checkout URL or QR code.</li>
                <li>4. Put the URL behind your pricing button, invoice, Discord message, or email campaign.</li>
                <li>5. When the payer completes checkout, SubScript records the payment, creates a receipt, and can notify your backend through webhooks.</li>
              </ol>
              <div className="rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/10 p-5 text-xs leading-relaxed text-white/75">
                Best for creators, small SaaS teams, vibe-built products, and early pilots that need payments live before a full backend integration exists.
              </div>
            </section>

            <section id="vibecoder" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Vibecoder prompt</h2>
              <p className="text-sm leading-relaxed text-white/70">
                If you are building with an AI coding agent, paste this directly into it. The important thing is that your app stores the SubScript `intent_id` beside your own user record and waits for the signed webhook before unlocking access.
              </p>
              <CodeBlock code={vibePrompt} language="prompt" />
            </section>

            <section id="developer" className="scroll-mt-24 space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">
                    REST API reference
                  </p>
                  <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Create a Checkout Intent</h2>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="rounded-md bg-[#00d2b4]/15 px-2 py-1 font-bold text-[#00d2b4]">POST</span>
                  <span className="text-white/70">/api/intent</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  ["Base URL", "https://www.subscriptonarc.com"],
                  ["Authentication", "Authorization: Bearer sk_test_…"],
                  ["Content type", "application/json"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-white/5 bg-black/30 p-4">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/35">{label}</p>
                    <p className="mt-2 break-all font-mono text-[11px] text-white/80">{value}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="border-b border-white/5 bg-white/[0.03] text-[9px] uppercase tracking-widest text-white/40">
                    <tr>
                      <th className="px-4 py-3">Field</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Required</th>
                      <th className="px-4 py-3">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-white/65">
                    {[
                      ["title", "string", "Yes", "Short product or plan name shown at checkout."],
                      ["amountUsdcMicros", "integer string", "Yes", "Canonical six-decimal amount. \"15000000\" = 15 USDC."],
                      ["externalReference", "string ≤ 256", "Recommended", "Your user, order, or invoice ID. Returned in the webhook."],
                      ["idempotencyKey", "string", "Recommended", "Stable key for one logical checkout. Reuse it only when retrying that checkout."],
                      ["description", "string", "No", "Customer-facing context for the payment."],
                      ["sandbox", "boolean", "No", "Credential-owned test mode. sk_test_ keys set this true and settle valueless USDC on Arc Testnet."],
                      ["successUrl", "HTTPS URL", "No", "Where checkout sends the payer after success. Not proof of payment."],
                      ["cancelUrl", "HTTPS URL", "No", "Where checkout sends the payer after cancellation."],
                      ["expiresAt", "ISO date or Unix time", "No", "When the hosted checkout should stop accepting payment."],
                      ["maxUses", "integer 1–10000", "No", "Maximum successful uses for a reusable link."],
                    ].map(([field, type, required, meaning]) => (
                      <tr key={field}>
                        <td className="px-4 py-3 font-mono font-semibold text-[#00d2b4]">{field}</td>
                        <td className="px-4 py-3 font-mono text-white/55">{type}</td>
                        <td className="px-4 py-3">{required}</td>
                        <td className="px-4 py-3 leading-relaxed">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <CodeBlock code={checkoutIntentCode} language="javascript" />
              <CodeBlock code={frontendEmbedCode} language="tsx" />
              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                <p className="font-bold text-white/85">Status polling</p>
                <p className="mt-2">
                  Use <span className="font-mono">GET /api/intent/:id</span> for support tools, dashboards, and agent-driven test loops. The legacy query form <span className="font-mono">GET /api/intent/status?id=...</span> remains supported. Anonymous calls return aggregate status only; pass your <span className="font-mono">Authorization: Bearer sk_...</span> key (or call from a signed-in dashboard session) to also receive <span className="font-mono">latestPayment</span> — payer identity and transaction proof are visible only to the merchant who owns the checkout. Fulfillment should still happen from the signed webhook.
                </p>
              </div>
              <CodeBlock code={intentStatusCode} language="javascript" />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["201", "Created", "A new intent was created."],
                  ["200", "Replay", "The same idempotency key returned its existing intent."],
                  ["4xx", "Fix request", "Use code for branching and message for display."],
                  ["5xx", "Retry safely", "Reuse the same idempotency key and log request_id."],
                ].map(([status, title, text]) => (
                  <div key={status} className="rounded-xl border border-white/5 bg-black/30 p-4">
                    <p className="font-mono text-sm font-bold text-[#00d2b4]">{status}</p>
                    <p className="mt-2 text-xs font-semibold text-white">{title}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/45">{text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="subscriptions" className="scroll-mt-24 space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">
                    Fixed-schedule recurring billing
                  </p>
                  <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Create weekly, monthly, or custom subscriptions</h2>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="rounded-md bg-[#00d2b4]/15 px-2 py-1 font-bold text-[#00d2b4]">POST</span>
                  <span className="text-white/70">/api/v1/subscriptions</span>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-white/70">
                SubScript supports fixed-schedule subscription checkouts today. Create a subscription from your backend, redirect the customer to the hosted checkout, and listen for subscription lifecycle webhooks. Metered vaults are a separate usage-based product, not a workaround for subscriptions.
              </p>

              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="border-b border-white/5 bg-white/[0.03] text-[9px] uppercase tracking-widest text-white/40">
                    <tr>
                      <th className="px-4 py-3">Field</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Required</th>
                      <th className="px-4 py-3">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-white/65">
                    {[
                      ["amountUsdcMicros", "integer string", "Yes, unless planId", "Recurring charge amount in micro-USDC."],
                      ["planId", "string", "Optional", "Use a saved merchant plan for amount and interval."],
                      ["interval", "daily | weekly | monthly | yearly", "Yes, unless planId or intervalSeconds", "Named fixed schedule."],
                      ["intervalSeconds", "integer", "Optional", "Custom schedule in seconds."],
                      ["intervalCount", "integer", "Optional", "Multiplier for the interval; defaults to 1."],
                      ["subscriber", "0x address", "Optional", "Preselect the expected subscriber wallet."],
                      ["externalReference", "string ≤ 256", "Recommended", "Your user, account, or entitlement reference."],
                      ["idempotencyKey", "string", "Recommended", "Stable key for one logical subscription checkout."],
                    ].map(([field, type, required, meaning]) => (
                      <tr key={field}>
                        <td className="px-4 py-3 font-mono font-semibold text-[#00d2b4]">{field}</td>
                        <td className="px-4 py-3 font-mono text-white/55">{type}</td>
                        <td className="px-4 py-3">{required}</td>
                        <td className="px-4 py-3 leading-relaxed">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <CodeBlock code={subscriptionCode} language="javascript" />
              <CodeBlock code={subscriptionResponseCode} language="json" />

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[
                  ["incomplete", "Created but not authorized yet. Redirect the customer to checkoutUrl."],
                  ["active", "The customer authorized the recurring payment on-chain. Fulfill from the signed webhook."],
                  ["canceled", "Unaccepted checkout sessions can be withdrawn by the merchant; active authorizations are customer-controlled."],
                ].map(([status, text]) => (
                  <div key={status} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <p className="font-mono text-sm font-bold text-[#00d2b4]">{status}</p>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/10 p-5 text-xs leading-relaxed text-white/75">
                Webhook events: <span className="font-mono">subscription.created</span>, <span className="font-mono">subscription.updated</span>, <span className="font-mono">subscription.renewed</span>, <span className="font-mono">subscription.payment_failed</span>, and <span className="font-mono">subscription.canceled</span>. The CLI can send signed local samples with <span className="font-mono">npx @subscriptonarc/cli trigger subscription.renewed --url http://localhost:3000/api/webhooks/subscript</span>.
              </div>
            </section>

            <section id="usage" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Pay-per-use billing with commit vaults</h2>
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
                    <Icon className="mb-3 h-5 w-5 text-[#00d2b4]" />
                    <h3 className="text-xs font-semibold text-white">{title as string}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text as string}</p>
                  </div>
                ))}
              </div>
              <h3 className="text-sm font-semibold text-white pt-2">How a developer integrates pay-per-session</h3>
              <ol className="space-y-2 text-xs leading-relaxed text-white/65 list-decimal pl-5">
                <li><span className="font-bold text-white/85">Set your commit.</span> In Merchant dashboard → Vault (or <span className="font-mono">POST /api/merchant/vault/commit-config</span>) set the USDC a customer must escrow to use your service.</li>
                <li><span className="font-bold text-white/85">Customer commits once.</span> They open <span className="font-mono">/dashboard/user?tab=commit</span>, choose your merchant address, and escrow at least the commit from their SubScript wallet. The vault goes <span className="text-emerald-300 font-bold">active</span> and your service is unlocked for the 30-day cycle.</li>
                <li><span className="font-bold text-white/85">Check readiness.</span> Call <span className="font-mono">GET /api/user/vault/status?userAddress=0x...</span> with your secret key before rendering a metered session. It returns <span className="font-mono">NO_VAULT</span>, <span className="font-mono">VAULT_INACTIVE</span>, or <span className="font-mono">VAULT_ACTIVE</span>, plus a dashboard URL to show the customer when they need to commit.</li>
                <li><span className="font-bold text-white/85">Report before you serve.</span> Call <span className="font-mono">POST /api/user/vault/report-usage</span> with your secret key <span className="font-bold text-white/85">before rendering each unit</span>, and serve only on a <span className="font-mono">200</span>. A <span className="font-mono">402</span> means do not serve: either the vault is inactive (<span className="font-mono">VAULT_INACTIVE</span>) or the charge would exceed the remaining escrow (<span className="font-mono">COMMIT_EXHAUSTED</span>). Reporting after you serve risks eating the last unit's cost yourself.</li>
                <li><span className="font-bold text-white/85">Get paid at cycle end.</span> SubScript's keeper draws the accrued total from escrow; you withdraw with <span className="font-mono">merchantClaim</span>. A report that would exceed escrow is rejected outright and the response's <span className="font-mono">remainingUsdc</span> shows what's left, so the customer can never be charged past what they committed — and funds are never pulled from their main wallet.</li>
              </ol>
              <CodeBlock code={meteredUsageCode} language="javascript" />
              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                Keep <span className="font-mono">SUBSCRIPT_SECRET_KEY</span> server-side only. Usage accrues off-chain during the cycle and settles on-chain at cycle end; the customer's escrow guarantees you payment up to the committed amount. Direct bank-transfer fiat-to-USDC funding remains provider/compliance-scoped until a live onramp is wired.
              </div>
            </section>

            <section id="webhooks" className="scroll-mt-24 space-y-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">
                  Trusted fulfillment
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Verify the webhook, then fulfill exactly once</h2>
              </div>
              <p className="text-sm leading-relaxed text-white/70">
                A redirect says where the browser went. A signed webhook says what settled. Read the raw request bytes, verify the timestamped HMAC, claim the event ID atomically, and only then update your order or entitlement.
              </p>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                {[
                  ["1", "Read raw body", "Parsing and re-serializing JSON changes the signed bytes."],
                  ["2", "Check ±5 minutes", "Reject stale timestamps before computing trust."],
                  ["3", "Verify HMAC", "Sign timestamp + period + exact raw body with SHA-256."],
                  ["4", "Claim event.id", "A UNIQUE insert makes retries safe under concurrency."],
                ].map(([number, title, text]) => (
                  <div key={number} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#00d2b4]">Step {number}</p>
                    <p className="mt-2 text-xs font-semibold text-white">{title}</p>
                    <p className="mt-2 text-[10px] leading-relaxed text-white/45">{text}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/10 p-5 text-xs leading-relaxed text-white/75">
                Canonical event: <span className="font-mono">type: &quot;payment.succeeded&quot;</span>. Use <span className="font-mono">data.intent_id</span> to find the SubScript checkout and <span className="font-mono">data.merchant_reference</span> to find your own user or order. The legacy <span className="font-mono">event: &quot;payment.success&quot;</span> alias is present only for compatibility.
              </div>

              <CodeBlock code={webhookPayloadCode} language="json" />

              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-xs leading-relaxed text-white/75">
                Keep <span className="font-mono">SUBSCRIPT_SECRET_KEY</span> and <span className="font-mono">SUBSCRIPT_WEBHOOK_SECRET</span> server-side only. Never expose either value in React props, mobile clients, public repositories, browser bundles, logs, or screenshots.
              </div>
              <CodeBlock code={webhookCode} language="javascript" />

              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                <p className="font-bold text-white/85">Delivery behavior</p>
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  <li>Return any <span className="font-mono">2xx</span> only after the event is durably claimed.</li>
                  <li>SubScript retries timeouts, <span className="font-mono">408</span>, <span className="font-mono">429</span>, and <span className="font-mono">5xx</span> responses.</li>
                  <li>Your handler must return <span className="font-mono">200</span> for an already-processed <span className="font-mono">event.id</span>.</li>
                  <li>Do slow email, analytics, or provisioning work after the durable claim, preferably through your own queue.</li>
                </ul>
              </div>
            </section>

            <section id="testing" className="scroll-mt-24 space-y-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00d2b4]">
                  Ship with confidence
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">Test, observe, and go live deliberately</h2>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">
                  Build the complete test flow before swapping credentials. Test and live modes use the same API shape, so your code should change configuration—not logic.
                </p>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="border-b border-white/5 bg-white/[0.03] text-[9px] uppercase tracking-widest text-white/40">
                    <tr>
                      <th className="px-4 py-3">Mode</th>
                      <th className="px-4 py-3">Credential</th>
                      <th className="px-4 py-3">Behavior</th>
                      <th className="px-4 py-3">Use it for</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-white/65">
                    <tr>
                      <td className="px-4 py-3 font-semibold text-[#00d2b4]">Arc Testnet</td>
                      <td className="px-4 py-3 font-mono">sk_test_…</td>
                      <td className="px-4 py-3">Implies <span className="font-mono">sandbox: true</span> and settles valueless test USDC on Arc Testnet. The shared public demo key is simulation-only.</td>
                      <td className="px-4 py-3">Funded testnet integration, CI, and end-to-end settlement tests.</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-semibold text-white">Live</td>
                      <td className="px-4 py-3 font-mono">sk_live_…</td>
                      <td className="px-4 py-3">Requires a configured merchant payout wallet.</td>
                      <td className="px-4 py-3">Real customer settlement after launch review.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[
                  ["Local signed event", "npx @subscriptonarc/cli trigger payment.succeeded --url http://localhost:3000/api/webhooks/subscript"],
                  ["Forward real test events", "npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks/subscript"],
                  ["Simulate renewals", "POST /api/test/clocks, attach a subscription, then POST /api/test/clocks/:id/advance"],
                ].map(([title, command]) => (
                  <div key={title} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                    <p className="text-xs font-semibold text-white">{title}</p>
                    <p className="mt-3 break-words font-mono text-[10px] leading-relaxed text-[#00d2b4]">{command}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <h3 className="text-sm font-semibold text-white">Sandbox acceptance checklist</h3>
                  <ul className="mt-4 space-y-3 text-xs leading-relaxed text-white/60">
                    {[
                      "Create an intent and persist all identifiers before redirect.",
                      "Complete checkout and receive payment.succeeded.",
                      "Replay the same webhook and prove fulfillment happens once.",
                      "Retry intent creation with the same idempotencyKey and receive the same intent.",
                      "Send an invalid amount and confirm your logs capture request_id, never the secret key.",
                    ].map((item) => (
                      <li key={item} className="flex gap-3">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00d2b4]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <h3 className="text-sm font-semibold text-white">Go-live checklist</h3>
                  <ul className="mt-4 space-y-3 text-xs leading-relaxed text-white/60">
                    {[
                      "Create a separate sk_live_ key and store it only in server secrets.",
                      "Configure and verify the merchant payout destination.",
                      "Use a distinct live webhook endpoint secret.",
                      "Alert on webhook 5xx responses and aged PENDING intents.",
                      "Keep the funded Arc testnet path available for release regression tests.",
                    ].map((item) => (
                      <li key={item} className="flex gap-3">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00d2b4]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                <p className="font-bold text-white/85">Fast diagnosis</p>
                <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
                  <dt className="font-mono text-[#00d2b4]">401 unauthorized</dt>
                  <dd>Confirm the Bearer header exists and the key is active. Do not print the key while debugging.</dd>
                  <dt className="font-mono text-[#00d2b4]">400 invalid_amount</dt>
                  <dd>Send a positive integer string in micro-USDC; never send <span className="font-mono">15.00</span>.</dd>
                  <dt className="font-mono text-[#00d2b4]">409 idempotency conflict</dt>
                  <dd>The key belongs to another logical resource. Generate a new key for the new checkout.</dd>
                  <dt className="font-mono text-[#00d2b4]">merchant_payout_wallet_missing</dt>
                  <dd>Your live key is valid, but live checkout is blocked until payout setup is complete.</dd>
                  <dt className="font-mono text-[#00d2b4]">Webhook signature mismatch</dt>
                  <dd>Verify against the raw body before JSON parsing and use the endpoint&apos;s exact secret.</dd>
                </dl>
              </div>
            </section>

            <section id="errors" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Error responses</h2>
              <p className="text-sm leading-relaxed text-white/70">
                Every non-2xx response from the API carries a machine-readable envelope. Branch on `code` (stable identifier), show `message` to humans, and quote `request_id` when contacting support — server logs are indexed by it.
              </p>
              <CodeBlock
                code={`{
  "error": "Bad Request: amountUsdcMicros is required and must be a positive integer in micro-USDC",
  "code": "invalid_amount",
  "message": "Bad Request: amountUsdcMicros is required and must be a positive integer in micro-USDC (e.g. \\"15000000\\" = 15 USDC). amountUsdc is accepted as an alias with the same unit.",
  "request_id": "3f6a1f6e-9d2b-4c1a-8f7e-2b9d4c1a8f7e",
  "doc_url": "https://www.subscriptonarc.com/docs#errors"
}`}
                language="json"
              />
              <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
                <p className="font-bold text-white/85 mb-2">Common codes</p>
                <ul className="space-y-1">
                  <li><span className="font-mono text-[#00d2b4]">unauthorized</span> — missing/invalid `Authorization: Bearer sk_…` header. Keys live in Dashboard → Developers → API keys.</li>
                  <li><span className="font-mono text-[#00d2b4]">invalid_json</span> — request body is not valid JSON.</li>
                  <li><span className="font-mono text-[#00d2b4]">missing_title</span> / <span className="font-mono text-[#00d2b4]">invalid_amount</span> — validation failures return `400` with the field named in `message`.</li>
                  <li><span className="font-mono text-[#00d2b4]">merchant_payout_wallet_missing</span> — live key with no payout wallet configured; `resolution_url` points at the settings page.</li>
                  <li><span className="font-mono text-[#00d2b4]">quota_exceeded</span> — active-link tier limit reached (`403`).</li>
                  <li><span className="font-mono text-[#00d2b4]">idempotency_key_conflict</span> — the key was already used for a different resource (`409`).</li>
                  <li><span className="font-mono text-[#00d2b4]">internal_error</span> — a `500` with no internals leaked; report the `request_id`.</li>
                </ul>
              </div>
            </section>

            <section id="receipts" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Human-readable receipts with Arc memos</h2>
              <p className="text-sm leading-relaxed text-white/70">
                SubScript receipts are designed for humans, not explorers. A payer can share a URL like `www.subscriptonarc.com/receipt/rcpt-7e10c918a3aa672eb783f1b965914b12`, while SubScript indexes the Arc memo and displays amount, sender, merchant, date, note, and transaction status.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <ReceiptText className="mb-3 h-5 w-5 text-[#00d2b4]" />
                  <h3 className="text-xs font-semibold text-white">Default visibility</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">Receipt data is intended for the payer, merchant, and SubScript by default. Future invite flows can selectively disclose a receipt to another viewer.</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <ShieldCheck className="mb-3 h-5 w-5 text-[#00d2b4]" />
                  <h3 className="text-xs font-semibold text-white">Proof without confusion</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">The receipt page hides raw transaction complexity while preserving auditability through Arc memo indexing.</p>
                </div>
              </div>
            </section>

            <section id="contracts" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Advanced: Arc memo transaction payload</h2>
              <p className="text-sm leading-relaxed text-white/70">
                Merchant hosted links settle through the SubScript Router: the receipt token is passed as the router memo, and the backend verifies the matching `DepositWithMemo` event before marking the payment paid. User-created receive links settle as direct Arc USDC transfers to the requester, with the backend verifying the ERC-20 `Transfer` call and event. Cross-chain CCTP checkout is disabled for hosted payment links until Arc-side mint and memo settlement can be verified in one bound flow.
              </p>
              <CodeBlock code={viemMemoCode} language="typescript" />
            </section>

            <section id="faq" className="scroll-mt-24 space-y-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">FAQ</h2>
              {[
                ["How easy is integration?", "A no-code merchant can launch with a hosted link in minutes. A developer can add intent creation and webhook fulfillment in under an hour if their app already has user accounts."],
                ["Can I test before setting a payout wallet?", "Yes. Use a `sk_test_` key to settle valueless test USDC on Arc Testnet. The shared public demo key remains simulation-only. Live keys require a configured payout destination and return `merchant_payout_wallet_missing` if setup is incomplete."],
                ["Can SubScript handle usage-based products?", "Yes. Commit vaults let a customer escrow a merchant-set amount once; the merchant reports API calls, tokens, sessions, or per-item access via the usage API, which accrues the charges and gates access. SubScript draws the accrued total from escrow at the end of each 30-day cycle."],
                ["Can someone else sponsor a subscription?", "The protocol model supports sponsored payment relationships such as parents, employers, or teams covering costs while keeping the subscriber's usage context separate. Dedicated sponsor records, spending caps, and revocation policies are still deployment-scoped."],
                ["Can users export their wallet key?", "Legacy email wallets can be exported only after fresh OTP step-up verification. Circle developer-controlled MPC wallets do not expose a raw private key. Google sign-in is paused until its identity and custody flow is verified server-side."],
                ["How does SubScript compare to streaming payment protocols?", "SubScript uses Permit2-style bounded allowances rather than continuous locked streaming liquidity, so funds can remain liquid in the user's wallet until a billing-cycle transaction executes."],
                ["Can merchants enforce lock windows?", "The UPA model includes service lock windows, minimum commitments, and grace periods, with a ceiling of 72 hours for digital goods and 30 days for SaaS seats. These terms need explicit schema, contract enforcement, and UI disclosure before live use."],
                ["Does SubScript have smart dunning?", "The platform has retry, reconciliation, billing, and notification primitives. Configurable Day 1, Day 3, and Day 7 schedules plus email/SMS top-up reminders should be formalized before calling it fully live."],
                ["Does the merchant need to track wallets?", "No. The merchant should track Checkout Intent IDs. SubScript maps wallet payment activity to the off-chain intent and sends the signed result."],
                ["What does the user pay?", "The user pays the advertised USDC price. SubScript is designed around predictable Arc USDC gas and sponsored-fee flows so users avoid hidden card-style fees."],
                ["Why is this better than dollar cards?", "Users avoid virtual card setup fees, maintenance fees, failed transaction penalties, KYC delays for basic wallet setup, billing-address failures, and FX markup surprises."],
                ["What problem does SubScript solve?", "It prevents unwanted recurring charges, double-billing, hidden cancellation traps, overdraft-style penalties, and opaque receipt disputes by moving billing state into transparent programmable payment logic."],
                ["Does SubScript provide invoices?", "The current product supports payment links, Checkout Intents, receipt records, and external references that cover invoice-like collection. A dedicated invoice engine with custom due terms is documented as a protocol target."],
                ["Does SubScript use decentralized keepers?", "The codebase has keeper-compatible contract and API surfaces today. Full Chainlink Automation as the default execution network should be treated as a roadmap or deployment configuration item until the production keeper network is wired."],
              ].map(([question, answer]) => (
                <div key={question} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <h3 className="text-xs font-semibold text-white">{question}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">{answer}</p>
                </div>
              ))}
            </section>

            <footer className="border-t border-white/5 bg-[#070709]/70 px-6 py-12 text-center text-xs text-white/40">
              <p className="mb-2">© 2026 SubScript Protocol. All rights reserved.</p>
              <p>Built for programmable USDC payments on Arc Network.</p>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
