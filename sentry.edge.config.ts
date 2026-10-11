import * as Sentry from "@sentry/nextjs";
import { redactFinancialCredentials } from "./src/lib/telemetryPrivacy";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  beforeSend: redactFinancialCredentials,
  beforeSendTransaction: redactFinancialCredentials,
});
