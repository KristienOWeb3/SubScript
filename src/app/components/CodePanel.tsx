"use client";

import { useState } from "react";
import { Terminal } from "@/components/icons";

export default function CodePanel() {
    const [tab, setTab] = useState<"intent" | "webhook">("intent");

    return (
        <div className="liquid-glass rounded-3xl border border-white/5 bg-black/50 overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 px-4 pt-3">
                <div className="flex gap-1">
                    <button
                        onClick={() => setTab("intent")}
                        className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors ${tab === "intent" ? "text-[#00d2b4] bg-white/[0.04] border-b-2 border-[#00d2b4]" : "text-white/40 hover:text-white/70"}`}
                    >
                        Create intent
                    </button>
                    <button
                        onClick={() => setTab("webhook")}
                        className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors ${tab === "webhook" ? "text-[#00d2b4] bg-white/[0.04] border-b-2 border-[#00d2b4]" : "text-white/40 hover:text-white/70"}`}
                    >
                        Webhook event
                    </button>
                </div>
                <Terminal className="w-4 h-4 text-white/25 mb-1" />
            </div>
            <div className="p-5 font-mono text-[11px] sm:text-xs leading-6 overflow-x-auto">
                {tab === "intent" ? (
                    <pre className="text-white/70">
{`curl -X POST https://www.subscriptonarc.com/api/intent \\
  -H "Authorization: Bearer `}<span className="text-[#d4a853]">sk_live_...</span>{`" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amountUsdcMicros": `}<span className="text-[#00d2b4]">"49000000"</span>{`,
    "reference": `}<span className="text-[#00d2b4]">"order_8412"</span>{`,
    "successUrl": `}<span className="text-[#00d2b4]">"https://yourapp.com/thanks"</span>{`
  }'

`}<span className="text-white/35">{`# → 201 Created`}</span>{`
{
  "intentId": `}<span className="text-[#00d2b4]">"int_9f3ka72m"</span>{`,
  "checkoutUrl": `}<span className="text-[#00d2b4]">"https://www.subscriptonarc.com/pay/int_9f3ka72m"</span>{`
}`}
                    </pre>
                ) : (
                    <pre className="text-white/70">
{`POST https://yourapp.com/webhooks/subscript
x-subscript-signature: t=1720000000,v1=`}<span className="text-[#d4a853]">hmac_sha256</span>{`

{
  "type": `}<span className="text-[#00d2b4]">"payment.succeeded"</span>{`,
  "data": {
    "intent_id": `}<span className="text-[#00d2b4]">"int_9f3ka72m"</span>{`,
    "amount_usdc_micros": `}<span className="text-[#00d2b4]">"49000000"</span>{`,
    "reference": `}<span className="text-[#00d2b4]">"order_8412"</span>{`,
    "receipt_url": `}<span className="text-[#00d2b4]">"https://www.subscriptonarc.com/receipt/rcp_x1"</span>{`
  }
}

`}<span className="text-white/35">{`# Verify the HMAC, match intent_id, fulfill the order.`}</span>
                    </pre>
                )}
            </div>
        </div>
    );
}
