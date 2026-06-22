import { ethers } from "ethers";

const DEFAULT_API_URL = "https://jkrlsjpsytzffwjpixue.supabase.co"; // REST URL fallback
const LOCAL_API_URL = "http://localhost:3000";

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
  // If we are developing locally or running in local dev server environment
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  }
  return LOCAL_API_URL;
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

  // Signature verification (Addition 3)
  const message = JSON.stringify(config);
  const recoveredAddress = ethers.verifyMessage(message, signature);
  const expectedAdminAddress = "0x49315D8b3282812B92f454d45Cf041920a403492";

  if (recoveredAddress.toLowerCase() !== expectedAdminAddress.toLowerCase()) {
    throw new Error(
      "SECURITY ALERT: Protocol configuration signature verification failed!\n" +
      "The configuration payload might have been tampered with or intercepted."
    );
  }

  return config;
}
