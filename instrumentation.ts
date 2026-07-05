import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    /* Surface deployment misconfigurations (e.g. legacy custody with no sponsor key) in the logs
       at boot instead of at a user's first sponsored action. Warn-only; never blocks startup. */
    const { checkRuntimeConfig } = await import("@/lib/ops/configCheck");
    checkRuntimeConfig();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
