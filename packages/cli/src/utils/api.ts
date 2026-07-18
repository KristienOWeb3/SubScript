import { ethers } from "ethers";

/* The published CLI must talk to production by default — a localhost fallback silently breaks
   every dashboard-bridge and version check for real users. Local dev overrides via env. */
const DEFAULT_API_URL = "https://www.subscriptonarc.com";

function normalizeBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "subscriptonarc.com") {
      parsed.hostname = "www.subscriptonarc.com";
    }
    return parsed.origin;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function getBaseUrl(): string {
  const override = process.env.SUBSCRIPT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (override) {
    return normalizeBaseUrl(override);
  }
  return DEFAULT_API_URL;
}

export function isTelemetryEnabled(noTelemetryFlag: boolean): boolean {
  if (process.env.SUBSCRIPT_DISABLE_TELEMETRY === "true") return false;
  if (noTelemetryFlag) return false;
  return true;
}

export async function sendTelemetry(
  eventName: string,
  data: {
    merchantId?: string;
    cliVersion: string;
    templateVersion: string;
    mode?: string;
    requestId: string;
  },
  noTelemetryFlag: boolean
) {
  if (!isTelemetryEnabled(noTelemetryFlag)) {
    return;
  }

  const url = `${getBaseUrl()}/api/cli/analytics`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventName, ...data }),
    });
    if (!res.ok) {
      // Fail silently for telemetry to not interrupt user execution
    }
  } catch {
    // Fail silently
  }
}

export async function fetchSession(token: string): Promise<any> {
  const url = `${getBaseUrl()}/api/cli/session?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errData: any = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to fetch session. Status: ${res.status}`);
  }

  return res.json();
}

export async function fetchConfigAndVerify(): Promise<any> {
  const url = `${getBaseUrl()}/api/cli/config`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errData: any = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to fetch configuration. Status: ${res.status}`);
  }

  const { config, signature } = (await res.json()) as any;

  // Signature verification (Addition 3). The server signs the config with the protocol
  // owner key (Vercel PRIVATE_KEY / CLI_CONFIG_SIGNING_KEY); this is the independent trust
  // anchor the CLI checks the recovered signer against — it must equal the on-chain contract
  // owner. Overridable via env so an owner-key rotation doesn't require rebuilding the CLI.
  const message = JSON.stringify(config);
  const recoveredAddress = ethers.verifyMessage(message, signature);
  const expectedAdminAddress =
    process.env.SUBSCRIPT_CLI_ADMIN_ADDRESS || "0x59e6970Eac4c9A44247adf975c462d17c94135ee";

  if (recoveredAddress.toLowerCase() !== expectedAdminAddress.toLowerCase()) {
    throw new Error(
      "SECURITY ALERT: Protocol configuration signature verification failed!\n" +
      "The configuration payload might have been tampered with or intercepted."
    );
  }

  return config;
}
