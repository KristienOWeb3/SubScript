"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  BookOpen, 
  Code, 
  Terminal, 
  Webhook, 
  Link2, 
  Cpu, 
  ChevronRight, 
  ArrowLeft, 
  Check, 
  Copy, 
  Menu, 
  X,
  FileText,
  ShieldCheck,
  Server
} from "lucide-react";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { motion, AnimatePresence } from "framer-motion";


interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative border border-white/10 rounded-2xl overflow-hidden bg-black/60 font-mono text-xs my-4 shadow-xl">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02] text-white/50 text-[10px] uppercase font-bold tracking-wider">
        <span>{language}</span>
        <button
          onClick={handleCopy}
          className="p-1 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-all flex items-center gap-1.5"
          title="Copy Code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#00d2b4]" />
              <span className="text-[#00d2b4] text-[9px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="text-[9px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-white/85 leading-relaxed whitespace-pre scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("intro");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiLang, setApiLang] = useState<"js" | "curl" | "python">("js");
  const [webhookLang, setWebhookLang] = useState<"js" | "python">("js");

  const observer = useRef<IntersectionObserver | null>(null);

  const sections = [
    { id: "intro", title: "Introduction", icon: BookOpen },
    { id: "links", title: "Direct Payment Links", icon: Link2 },
    { id: "webhooks", title: "Webhook Integration", icon: Webhook },
    { id: "api", title: "REST API Reference", icon: Terminal },
    { id: "contracts", title: "On-Chain Contracts", icon: Cpu },
  ];

  useEffect(() => {
    // Setup intersection observer to highlight current section in navigation
    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    };

    observer.current = new IntersectionObserver(handleIntersect, {
      rootMargin: "-20% 0px -60% 0px",
      threshold: 0.1
    });

    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.current?.observe(el);
    });

    return () => observer.current?.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setActiveSection(id);
      setMobileMenuOpen(false);
    }
  };

  const jsApiCode = `// Fetch subscription details using Node.js / JavaScript
const fetchSubscription = async (subscriptionId) => {
  const apiKey = "sk_test_55f2...c8a9"; // Replace with your merchant secret key
  const response = await fetch(
    \`https://subscript.protocol/api/v1/subscriptions?id=\${subscriptionId}\`,
    {
      method: "GET",
      headers: {
        "Authorization": \`Bearer \${apiKey}\`,
        "Content-Type": "application/json"
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(\`API returned status: \${response.status}\`);
  }
  
  const data = await response.json();
  console.log("Subscription details:", data);
};`;

  const curlApiCode = `# Retrieve subscription details via cURL
curl -X GET "https://subscript.protocol/api/v1/subscriptions?id=sub_102" \\
  -H "Authorization: Bearer sk_test_your_secret_key_here" \\
  -H "Content-Type: application/json"`;

  const pythonApiCode = `# Fetch subscription details using Python
import requests

def get_subscription(subscription_id, api_key):
    url = f"https://subscript.protocol/api/v1/subscriptions?id={subscription_id}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()`;

  const jsWebhookCode = `// Webhook signature validation in Node.js / Express
const crypto = require('crypto');

app.post('/webhooks/subscript', express.raw({ type: 'application/json' }), (req, res) => {
  const signatureHeader = req.headers['x-subscript-signature'];
  const endpointSecret = process.env.SUBSCRIPT_WEBHOOK_SECRET; // e.g. whsec_...
  
  if (!signatureHeader) {
    return res.status(400).send("Missing x-subscript-signature header");
  }
  
  // Parse header structure: t=TIMESTAMP,v1=SIGNATURE
  const match = signatureHeader.match(/t=(\\d+),v1=([a-f0-9]+)/);
  if (!match) {
    return res.status(400).send("Invalid signature format");
  }
  
  const [, timestamp, signature] = match;
  
  // Verify timestamp within 5 minutes tolerance (prevent replay attacks)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return res.status(400).send("Signature expired");
  }
  
  // Compute expected HMAC SHA-256 signature
  const rawBody = req.body.toString();
  const signaturePayload = \`\${timestamp}.\${rawBody}\`;
  const computedSignature = crypto
    .createHmac('sha256', endpointSecret)
    .update(signaturePayload)
    .digest('hex');
    
  if (computedSignature !== signature) {
    return res.status(401).send("Signature verification failed");
  }
  
  // Signature is valid. Handle the event!
  const payload = JSON.parse(rawBody);
  console.log(\`Received valid event: \${payload.event}\`);
  res.json({ received: true });
});`;

  const pythonWebhookCode = `# Webhook signature validation in Python (Flask/FastAPI)
import hmac
import hashlib
import time

def verify_subscript_signature(raw_body_bytes, signature_header, secret):
    if not signature_header:
        raise ValueError("Missing signature header")
        
    parts = dict(x.split('=') for x in signature_header.split(','))
    t = parts.get('t')
    v1 = parts.get('v1')
    
    if not t or not v1:
        raise ValueError("Invalid signature format")
        
    # Prevent replay attacks
    if int(time.time()) - int(t) > 300:
        raise ValueError("Signature expired")
        
    # Re-compute HMAC
    payload = f"{t}.".encode('utf-8') + raw_body_bytes
    computed = hmac.new(
        secret.encode('utf-8'),
        payload,
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(computed, v1):
        raise ValueError("Signature mismatch")
        
    return True`;

  const solidityContractCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISubScriptRouter {
    // Structure of active subscription
    struct Subscription {
        address subscriber;
        address merchant;
        uint256 amount;
        uint256 period;
        uint256 nextPayment;
        bool isActive;
    }

    // Read details of a specific subscription
    function subscriptions(uint256 id) external view returns (
        address subscriber,
        address merchant,
        uint256 amount,
        uint256 period,
        uint256 nextPayment,
        bool isActive
    );

    // Cancel a subscription directly on-chain
    function cancelSubscription(uint256 id) external;
    
    // Deposit USDC and commit a ZK hash (Escrow routing)
    function depositAndCommit(bytes32 commitment, uint256 amount) external;
}`;

  return (
    <div className="min-h-screen bg-transparent text-white relative font-sans scrollbar-thin">
      <AnimatedGradientBg />

      {/* Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#070709]/80 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <img 
              src="/logo.png" 
              alt="SubScript" 
              className="w-7 h-7 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)]" 
            />
            <span className="text-sm font-black uppercase tracking-wider">
              SubScript <span className="text-[#00d2b4] lowercase font-serif italic font-normal">docs</span>
            </span>
          </Link>
          <span className="hidden md:inline-block w-[1px] h-4 bg-white/10" />
          <span className="hidden md:inline-block text-[10px] font-bold text-white/40 uppercase tracking-widest">
            Protocol Integration Guide
          </span>
        </div>

        <div className="flex items-center gap-4">
          <Link 
            href="/dashboard" 
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-white transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-white/70 hover:text-white bg-white/5 border border-white/5 hover:border-white/10 rounded-full transition-all"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 pt-24 pb-20 grid grid-cols-1 md:grid-cols-4 gap-8">
        
        {/* Navigation Sidebar (Desktop) */}
        <aside className="hidden md:block col-span-1 sticky top-24 self-start space-y-6">
          <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-md rounded-2xl p-5 space-y-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5 pb-2">
              Documentation Map
            </p>
            <nav className="flex flex-col gap-1">
              {sections.map((s) => {
                const Icon = s.icon;
                const isActive = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-left transition-all ${
                      isActive 
                        ? "bg-[#00d2b4]/10 text-[#00d2b4] border border-[#00d2b4]/20 shadow-[0_0_15px_rgba(0,210,180,0.1)]" 
                        : "text-white/50 hover:text-white/85 hover:bg-white/[0.02]"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? "text-[#00d2b4]" : "text-white/40"}`} />
                    {s.title}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-md rounded-2xl p-5 text-xs text-white/45 space-y-2">
            <p className="font-bold text-white uppercase tracking-wider text-[10px]">Arc Network Testnet</p>
            <p className="leading-relaxed">Chain ID: <code className="text-white font-mono bg-white/5 px-1 rounded">5042002</code></p>
            <p className="leading-relaxed">USDC Gas: <code className="text-white font-mono bg-white/5 px-1 rounded">0x4200...0006</code></p>
          </div>
        </aside>

        {/* Mobile Navigation Dropdown Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="md:hidden fixed top-16 left-0 right-0 z-40 bg-[#070709] border-b border-white/10 p-5 space-y-4 shadow-2xl"
            >
              <div className="flex flex-col gap-1.5">
                {sections.map((s) => {
                  const Icon = s.icon;
                  const isActive = activeSection === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => scrollToSection(s.id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-left transition-all ${
                        isActive 
                          ? "bg-[#00d2b4]/15 text-[#00d2b4] border border-[#00d2b4]/25" 
                          : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {s.title}
                    </button>
                  );
                })}
                <Link 
                  href="/dashboard" 
                  className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-white"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Dashboard
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Documentation Content Panel */}
        <main className="col-span-1 md:col-span-3 space-y-16">

          {/* Section: Introduction */}
          <section id="intro" className="scroll-mt-24 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-full text-[10px] font-black uppercase tracking-wider text-[#00d2b4]">
              <BookOpen className="w-3 h-3" />
              Getting Started
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Integrating SubScript Protocol
            </h1>
            <p className="text-sm text-white/70 leading-relaxed">
              SubScript is a decentralized recurring billing protocol built for EVM chains, powered natively by stablecoins.
              It allows merchants to create on-chain subscription plans, setup payment links, and charge customers periodically using direct meta-transaction signature execution.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <div className="liquid-glass border border-white/5 bg-black/20 p-5 rounded-2xl space-y-3">
                <span className="p-2 bg-[#00d2b4]/10 rounded-xl inline-block">
                  <Link2 className="w-5 h-5 text-[#00d2b4]" />
                </span>
                <h3 className="font-bold text-white text-sm uppercase tracking-wider">No-Code Integration</h3>
                <p className="text-xs text-white/50 leading-relaxed">
                  Use generated hosted Payment Links and share them on social platforms, emails, or embedded QR codes. No backend programming required.
                </p>
              </div>
              <div className="liquid-glass border border-white/5 bg-black/20 p-5 rounded-2xl space-y-3">
                <span className="p-2 bg-purple-500/10 rounded-xl inline-block">
                  <Webhook className="w-5 h-5 text-purple-400" />
                </span>
                <h3 className="font-bold text-white text-sm uppercase tracking-wider">Low-Code Backend</h3>
                <p className="text-xs text-white/50 leading-relaxed">
                  Leverage REST APIs to fetch subscription states on demand and setup webhook listeners with cryptographic signature checks to automate provisioning.
                </p>
              </div>
            </div>
          </section>

          <hr className="border-white/5" />

          {/* Section: Direct Payment Links */}
          <section id="links" className="scroll-mt-24 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-full text-[10px] font-black uppercase tracking-wider text-[#00d2b4]">
              <Link2 className="w-3 h-3" />
              No-Code Links
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              Direct Payment Links
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              Payment links are the fastest way to accept stablecoin subscriptions. You can generate them directly from your merchant dashboard dashboard without writing a single line of code.
            </p>
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-4">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#ccff00]" />
                How it works
              </h3>
              <ul className="text-xs text-white/60 space-y-3 pl-4 list-decimal leading-relaxed">
                <li>Create a subscription tier on the merchant dashboard (e.g. Premium Plan for 10 USDC / month).</li>
                <li>Copy the unique generated Link (e.g. <code className="text-white bg-white/5 px-1 py-0.5 rounded font-mono">/pay/link_uuid</code>).</li>
                <li>Direct your users to this link. SubScript handles wallet connection, USDC approval, and subscription creation.</li>
                <li>Upon completion, the user is redirected back to your app with a success receipt, and a webhook notification is instantly dispatched.</li>
              </ul>
            </div>
          </section>

          <hr className="border-white/5" />

          {/* Section: Webhook Integration */}
          <section id="webhooks" className="scroll-mt-24 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-[10px] font-black uppercase tracking-wider text-purple-400">
              <Webhook className="w-3 h-3" />
              Event Dispatcher
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              Webhook Integration
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              Webhooks notify your backend database immediately when events happen on-chain, such as subscription creation or monthly charge events.
              This allows you to automate user provisioning (unlocking access, updating account status) without manual polling.
            </p>

            <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 rounded-2xl p-5 space-y-2">
              <h4 className="text-xs font-bold text-[#ccff00] uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                Webhook Signature Security
              </h4>
              <p className="text-xs text-white/75 leading-relaxed">
                SubScript signs all webhook payloads using a Stripe-compatible header: <code className="text-white font-mono bg-black/40 px-1 py-0.5 rounded">x-subscript-signature</code>.
                You <strong>must</strong> verify the cryptographic HMAC signature to verify that the request came from SubScript and was not intercepted.
              </p>
            </div>

            {/* Language Switcher for Webhooks */}
            <div className="space-y-4 pt-4">
              <div className="flex gap-2 border-b border-white/5 pb-2">
                <button
                  onClick={() => setWebhookLang("js")}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    webhookLang === "js" ? "bg-[#00d2b4] text-black" : "text-white/50 hover:text-white"
                  }`}
                >
                  Node.js (Express)
                </button>
                <button
                  onClick={() => setWebhookLang("python")}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    webhookLang === "python" ? "bg-[#00d2b4] text-black" : "text-white/50 hover:text-white"
                  }`}
                >
                  Python (Flask)
                </button>
              </div>

              {webhookLang === "js" ? (
                <CodeBlock code={jsWebhookCode} language="javascript" />
              ) : (
                <CodeBlock code={pythonWebhookCode} language="python" />
              )}
            </div>
          </section>

          <hr className="border-white/5" />

          {/* Section: REST API Reference */}
          <section id="api" className="scroll-mt-24 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-full text-[10px] font-black uppercase tracking-wider text-[#00d2b4]">
              <Terminal className="w-3 h-3" />
              Developer API
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              REST API Reference
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              Query SubScript programmatically using your merchant API keys. Make authorized HTTPS requests to fetch payment records or verify active subscriptions on demand.
            </p>

            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-3 text-left">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Server className="w-4 h-4 text-[#00d2b4]" />
                Authorization Header
              </h3>
              <p className="text-xs text-white/60 leading-relaxed">
                Include your API key as a Bearer token in the request headers:
              </p>
              <code className="block p-3 bg-black/40 border border-white/10 rounded-xl text-[11px] font-mono text-white/90">
                Authorization: Bearer sk_test_your_secret_key_here
              </code>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-green-500/10 border border-green-500/25 rounded text-[10px] font-bold text-green-400 font-mono">
                  GET
                </span>
                <code className="text-xs font-mono text-white/90 font-bold">
                  /api/v1/subscriptions?id=&#123;subId&#125;
                </code>
              </div>
              <p className="text-xs text-white/60 pl-2 border-l border-white/10 text-left">
                Retrieves the status, amount, billing period, and subscriber address for a given subscription ID.
              </p>

              {/* Language Switcher for REST API */}
              <div className="pt-2">
                <div className="flex gap-2 border-b border-white/5 pb-2">
                  <button
                    onClick={() => setApiLang("js")}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      apiLang === "js" ? "bg-[#00d2b4] text-black" : "text-white/50 hover:text-white"
                    }`}
                  >
                    Node.js
                  </button>
                  <button
                    onClick={() => setApiLang("curl")}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      apiLang === "curl" ? "bg-[#00d2b4] text-black" : "text-white/50 hover:text-white"
                    }`}
                  >
                    cURL
                  </button>
                  <button
                    onClick={() => setApiLang("python")}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      apiLang === "python" ? "bg-[#00d2b4] text-black" : "text-white/50 hover:text-white"
                    }`}
                  >
                    Python
                  </button>
                </div>

                {apiLang === "js" && <CodeBlock code={jsApiCode} language="javascript" />}
                {apiLang === "curl" && <CodeBlock code={curlApiCode} language="bash" />}
                {apiLang === "python" && <CodeBlock code={pythonApiCode} language="python" />}
              </div>
            </div>
          </section>

          <hr className="border-white/5" />

          {/* Section: On-Chain Smart Contracts */}
          <section id="contracts" className="scroll-mt-24 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-full text-[10px] font-black uppercase tracking-wider text-[#00d2b4]">
              <Cpu className="w-3 h-3" />
              On-Chain Solidity
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              On-Chain Contract Integration
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              If your application relies wholly on smart contract components (e.g. DAO voting, decentralized protocols), you can query or manipulate subscription details directly by calling the SubScript solidity router contracts deployed on-chain.
            </p>
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-3 text-xs leading-relaxed text-left">
              <p className="font-bold text-white uppercase tracking-wider text-[10px] text-[#00d2b4]">
                Solidity Contract Interfaces
              </p>
              <p className="text-white/50">
                You can instantiate the router ABI directly to read active states or cancel subscriptions via contract-to-contract calls.
              </p>
              <CodeBlock code={solidityContractCode} language="solidity" />
            </div>
          </section>

        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#070709] py-12 px-6 text-center text-xs text-white/40">
        <p className="mb-2">© 2026 SubScript Protocol. All rights reserved.</p>
        <p>Built for EVM chains on the Arc Network Testnet.</p>
      </footer>
    </div>
  );
}
