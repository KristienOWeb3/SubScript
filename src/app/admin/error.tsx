"use client";

import React, { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RefreshCw, Home } from "@/components/icons";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] Uncaught error in admin view:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f172a] p-8 shadow-2xl text-white">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-400">
          <AlertTriangle className="h-7 w-7" />
        </div>

        <h2 className="mt-5 text-xl font-black uppercase tracking-wide text-white">
          Admin Console Error
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          An unexpected error occurred while rendering the admin view. System state and records remain safe.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-[10px] text-white/40">
            Digest: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-[#2775ca] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#1d61a8]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry View
          </button>
          <a
            href="/admin"
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <Home className="h-3.5 w-3.5" />
            Reload Admin
          </a>
        </div>
      </div>
    </div>
  );
}
