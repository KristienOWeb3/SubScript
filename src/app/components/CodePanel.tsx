"use client";

import { useState } from "react";

/* A deliberate dark terminal object sitting on the light landing page. The window chrome (traffic
   lights + file path) reads as a real editor, so the dark surface looks intentional rather than
   like a leftover from the old dark theme. Accent is USDC blue to match the rest of the page. */
export default function CodePanel() {
    const [tab, setTab] = useState<"intent" | "webhook">("intent");

    const tabClass = (active: boolean) =>
        `px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            active ? "bg-[#2775CA] text-white shadow-sm" : "text-slate-400 hover:text-white hover:bg-white/5"
        }`;

    return (
        <div
            role="region"
            aria-label="API code integration sample"
            className="overflow-hidden rounded-2xl border border-[#0b1220]/10 bg-[#0d1526] shadow-[0_24px_60px_rgba(11,18,32,0.28)]"
        >
            {/* Window chrome: traffic lights + the file this snippet stands in for. */}
            <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                    <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                    <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                    <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                </div>
                <span className="ml-1 font-mono text-[11px] text-slate-500">
                    {tab === "intent" ? "create-intent.sh" : "webhook.http"}
                </span>
                <div role="tablist" aria-label="Integration code examples" className="ml-auto flex gap-1">
                    <button type="button" role="tab" id="tab-intent" aria-selected={tab === "intent"} aria-controls="panel-code-content" onClick={() => setTab("intent")} className={tabClass(tab === "intent")}>
                        Create intent
                    </button>
                    <button type="button" role="tab" id="tab-webhook" aria-selected={tab === "webhook"} aria-controls="panel-code-content" onClick={() => setTab("webhook")} className={tabClass(tab === "webhook")}>
                        Webhook event
                    </button>
                </div>
            </div>

            <div
                role="tabpanel"
                id="panel-code-content"
                aria-labelledby={tab === "intent" ? "tab-intent" : "tab-webhook"}
                tabIndex={0}
                className="overflow-x-auto p-5 font-mono text-[11px] leading-6 focus:outline-none focus:ring-1 focus:ring-[#2775CA]/40 sm:text-xs"
            >
                {tab === "intent" ? (
                    <pre className="text-slate-200">
{`curl -X POST https://www.subscriptonarc.com/api/intent \\
  -H "Authorization: Bearer `}<span className="text-[#facc15]">sk_live_...</span>{`" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amountUsdcMicros": `}<span className="text-[#7cc4ff]">"49000000"</span>{`,
    "reference": `}<span className="text-[#7cc4ff]">"order_8412"</span>{`,
    "successUrl": `}<span className="text-[#7cc4ff]">"https://yourapp.com/thanks"</span>{`
  }'

`}<span className="text-slate-500">{`# → 201 Created`}</span>{`
{
  "intentId": `}<span className="text-[#7cc4ff]">"int_9f3ka72m"</span>{`,
  "checkoutUrl": `}<span className="text-[#7cc4ff]">"https://www.subscriptonarc.com/pay/int_9f3ka72m"</span>{`
}`}
                    </pre>
                ) : (
                    <pre className="text-slate-200">
{`POST https://yourapp.com/webhooks/subscript
x-subscript-signature: t=1720000000,v1=`}<span className="text-[#facc15]">hmac_sha256</span>{`

{
  "type": `}<span className="text-[#7cc4ff]">"payment.succeeded"</span>{`,
  "data": {
    "intent_id": `}<span className="text-[#7cc4ff]">"int_9f3ka72m"</span>{`,
    "amount_usdc_micros": `}<span className="text-[#7cc4ff]">"49000000"</span>{`,
    "reference": `}<span className="text-[#7cc4ff]">"order_8412"</span>{`,
    "receipt_url": `}<span className="text-[#7cc4ff]">"https://www.subscriptonarc.com/receipt/rcp_x1"</span>{`
  }
}

`}<span className="text-slate-500">{`# Verify the HMAC, match intent_id, fulfill the order.`}</span>
                    </pre>
                )}
            </div>
        </div>
    );
}
