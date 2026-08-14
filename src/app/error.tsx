"use client";

import React, { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "@/components/icons";

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
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400">
          <AlertTriangle className="h-7 w-7" />
        </div>

        <h1 className="mt-5 text-2xl font-black tracking-tight text-white">
          We couldn&apos;t load this screen
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Your funds and transaction state are unchanged. Retry the screen, or return to your dashboard.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-[10px] text-white/35">
            Support reference: {error.digest}
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={reset}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#00d2b4] px-4 py-3 text-xs font-bold uppercase tracking-wider text-black transition hover:brightness-110"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
          <Link
            href="/dashboard-router"
            className="flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10"
          >
            Dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
