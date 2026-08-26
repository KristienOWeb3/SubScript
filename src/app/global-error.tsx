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
    <html lang="en" style={{ backgroundColor: "#FFFFF0", color: "#082824" }}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SubScript — Error</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              * { box-sizing: border-box; margin: 0; padding: 0; }
              @font-face { font-family: Sukar; src: url("/fonts/SukarRegular.ttf") format("truetype"); font-weight: 400; font-style: normal; font-display: swap; }
              body { background-color: #FFFFF0; color: #082824; font-family: Sukar, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 1.5rem; }
              .error-card { width: 100%; max-width: 28rem; background: #D4E3E8; border: 1px solid rgba(0,0,0,0.08); border-radius: 1.75rem; padding: 2rem; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); }
              .error-icon { width: 3.5rem; height: 3.5rem; margin: 0 auto; display: flex; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid rgba(220,38,38,0.2); background: rgba(220,38,38,0.1); color: #dc2626; font-size: 1.5rem; font-weight: bold; }
              .error-title { margin-top: 1.25rem; font-size: 1.5rem; font-weight: 900; letter-spacing: -0.025em; color: #082824; }
              .error-desc { margin-top: 0.75rem; font-size: 0.875rem; line-height: 1.6; color: rgba(8,40,36,0.75); }
              .error-digest { margin-top: 0.75rem; font-family: Sukar, sans-serif; font-size: 0.625rem; color: rgba(0,0,0,0.4); }
              .error-actions { margin-top: 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
              .btn-primary { background-color: #000000; color: #ffffff; font-weight: 700; font-size: 0.75rem; padding: 0.75rem 1.25rem; border-radius: 9999px; border: none; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
              .btn-primary:hover { background-color: rgba(0,0,0,0.85); }
              .btn-secondary { background: #A3C8D9; border: 1px solid rgba(39,117,202,0.3); color: #082824; font-weight: 700; font-size: 0.75rem; padding: 0.75rem 1.25rem; border-radius: 9999px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
              .btn-secondary:hover { background: #92bbcd; }
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
              <a href="/dashboard" className="btn-secondary">Dashboard</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
