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
    <html lang="en" style={{ backgroundColor: "#060608", color: "#ffffff" }}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SubScript — Error</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              * { box-sizing: border-box; margin: 0; padding: 0; }
              @font-face { font-family: Sukar; src: url("/fonts/SukarRegular.ttf") format("truetype"); font-weight: 400; font-style: normal; font-display: swap; }
              body { background-color: #060608; color: #ffffff; font-family: Sukar, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 1.5rem; }
              .error-card { width: 100%; max-width: 32rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 1.5rem; padding: 2rem; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
              .error-icon { width: 3.5rem; height: 3.5rem; margin: 0 auto; display: flex; align-items: center; justify-content: center; border-radius: 1rem; border: 1px solid rgba(248,113,113,0.2); background: rgba(248,113,113,0.1); color: #f87171; font-size: 1.5rem; font-weight: bold; }
              .error-title { margin-top: 1.25rem; font-size: 1.5rem; font-weight: 900; letter-spacing: -0.025em; color: #ffffff; }
              .error-desc { margin-top: 0.75rem; font-size: 0.875rem; line-height: 1.6; color: rgba(255,255,255,0.6); }
              .error-digest { margin-top: 0.75rem; font-family: Sukar, sans-serif; font-size: 0.625rem; color: rgba(255,255,255,0.35); }
              .error-actions { margin-top: 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
              .btn-primary { background-color: #00d2b4; color: #000000; font-weight: 700; font-size: 0.875rem; padding: 0.75rem 1rem; border-radius: 0.75rem; border: none; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
              .btn-primary:hover { filter: brightness(1.1); }
              .btn-secondary { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); color: #ffffff; font-weight: 700; font-size: 0.875rem; padding: 0.75rem 1rem; border-radius: 0.75rem; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
              .btn-secondary:hover { background: rgba(255,255,255,0.1); }
              @media (max-width: 640px) { .error-actions { grid-template-columns: 1fr; } }
            `,
          }}
        />
      </head>
      <body>
        <main>
          <section className="error-card">
            <div className="error-icon" aria-hidden="true">!</div>
            <h1 className="error-title">We couldn&apos;t load this screen</h1>
            <p className="error-desc">Your funds and transaction state are unchanged. Retry the screen, or return to your dashboard.</p>
            {error.digest && <p className="error-digest">Support reference: {error.digest}</p>}
            <div className="error-actions">
              <button onClick={reset} className="btn-primary">Try again</button>
              <a href="/dashboard-router" className="btn-secondary">Back to dashboard</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
