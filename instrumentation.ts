import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    /* Surface deployment misconfigurations (e.g. legacy custody with no sponsor key) in the logs
       at boot instead of at a user's first sponsored action. Warn-only; guarded so a future check
       that throws can never block startup. */
    try {
      const { checkRuntimeConfig } = await import("@/lib/ops/configCheck");
      checkRuntimeConfig();
    } catch (err) {
      console.error("[config-check] failed to run:", err);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
