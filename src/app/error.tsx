"use client";

import React, { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { AlertTriangle, RefreshCw, SquaresFour } from "@/components/icons";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] Root page error caught:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FFFFF0] px-6 py-10 text-[#082824]">
      <section className="w-full max-w-md rounded-[28px] border border-black/10 bg-[#D4E3E8] p-8 text-center shadow-lg">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-600 shadow-sm">
          <AlertTriangle className="h-7 w-7" />
        </div>

        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-[#082824]">
          We couldn&apos;t load this screen
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#082824]/75">
          Your funds and transaction state are unchanged. Retry the screen, or return to your dashboard.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-[10px] text-black/40">
            Support reference: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#000000] px-6 py-3 text-xs font-bold text-white shadow-sm transition hover:bg-black/85 active:scale-[0.98]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Try again</span>
          </button>
          <Link
            href="/dashboard-router"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#A3C8D9] border border-[#2775CA]/30 px-6 py-3 text-xs font-bold text-[#082824] shadow-sm transition hover:bg-[#92bbcd] active:scale-[0.98]"
          >
            <SquaresFour className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
