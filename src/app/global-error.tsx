"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-[#060608] text-white">
        <main className="flex min-h-screen items-center justify-center px-5 py-10">
          <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10 text-2xl" aria-hidden="true">!</div>
            <h1 className="mt-5 text-2xl font-black tracking-tight">We couldn&apos;t load this screen</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/60">Your funds and transaction state are unchanged. Retry the screen, or return to your dashboard.</p>
            {error.digest && <p className="mt-3 font-mono text-[10px] text-white/35">Support reference: {error.digest}</p>}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button onClick={reset} className="rounded-xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00d2b4] focus-visible:ring-offset-2 focus-visible:ring-offset-black">Try again</button>
              <a href="/dashboard-router" className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Back to dashboard</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
