"use client";

import { useState } from "react";
import { Check, Copy } from "@/components/icons";

/* The one genuinely interactive leaf in the docs tree. Keeping the client boundary here means
   every section page can stay a server component and ship no JS of its own. */
export default function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-[#0b1220]/10 bg-[#0d1526] text-xs shadow-[0_16px_40px_rgba(11,18,32,0.18)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-[#5aa2e8]" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
