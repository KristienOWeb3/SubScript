import crypto from "node:crypto";

const SESSION_COOKIE = "example_app_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;

export type ApplicationUser = {
  id: string;
  walletAddress: string | null;
  role: "user" | "admin";
};

type SignedSession = ApplicationUser & { expiresAt: number };

export class ApplicationRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sessionSecret() {
  const secret = process.env.EXAMPLE_APP_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApplicationRouteError(
      500,
      "application_auth_not_configured",
      "EXAMPLE_APP_SESSION_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function encodeSignedJson(value: object) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function decodeSignedJson(token: string): unknown {
  if (token.length > 4096) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(encoded))) return null;

  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isApplicationUser(value: unknown): value is SignedSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SignedSession>;
  return (
    typeof candidate.id === "string" &&
    SAFE_ID_PATTERN.test(candidate.id) &&
    (candidate.walletAddress === null ||
      (typeof candidate.walletAddress === "string" && WALLET_PATTERN.test(candidate.walletAddress))) &&
    (candidate.role === "user" || candidate.role === "admin") &&
    typeof candidate.expiresAt === "number" &&
    Number.isSafeInteger(candidate.expiresAt)
  );
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredOrigin) {
    throw new ApplicationRouteError(
      500,
      "application_origin_not_configured",
      "NEXT_PUBLIC_APP_URL is not configured",
    );
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(configuredOrigin).origin;
  } catch {
    throw new ApplicationRouteError(
      500,
      "invalid_application_origin",
      "NEXT_PUBLIC_APP_URL must be an absolute URL",
    );
  }
  if (origin !== expectedOrigin) {
    throw new ApplicationRouteError(403, "invalid_origin", "Cross-origin mutation rejected");
  }
}

export function requireApplicationUser(
  request: Request,
  options: { admin?: boolean; mutation?: boolean } = {},
) {
  if (options.mutation) assertSameOrigin(request);

  const token = cookieValue(request, SESSION_COOKIE);
  const session = token ? decodeSignedJson(token) : null;
  if (!isApplicationUser(session) || session.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new ApplicationRouteError(401, "application_auth_required", "Sign in to your application");
  }
  if (options.admin && session.role !== "admin") {
    throw new ApplicationRouteError(403, "application_admin_required", "Application admin access required");
  }

  return {
    id: session.id,
    walletAddress: session.walletAddress?.toLowerCase() || null,
    role: session.role,
  } satisfies ApplicationUser;
}

export function createApplicationSessionCookie(
  user: ApplicationUser,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
) {
  if (
    !SAFE_ID_PATTERN.test(user.id) ||
    (user.walletAddress !== null && !WALLET_PATTERN.test(user.walletAddress))
  ) {
    throw new Error("Invalid application user");
  }
  if (
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds < 60 ||
    maxAgeSeconds > 60 * 60 * 24 * 30
  ) {
    throw new Error("Application session lifetime must be between 60 seconds and 30 days");
  }

  const token = encodeSignedJson({
    ...user,
    walletAddress: user.walletAddress?.toLowerCase() || null,
    expiresAt: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function createIntentStatusToken(intentId: string, userId: string) {
  return encodeSignedJson({
    intentId,
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
  });
}

export function assertIntentStatusOwnership(token: string | null, intentId: string, userId: string) {
  const value = token ? decodeSignedJson(token) : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationRouteError(403, "intent_access_denied", "Invalid checkout status token");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.intentId !== intentId ||
    candidate.userId !== userId ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new ApplicationRouteError(403, "intent_access_denied", "Checkout status access denied");
  }
}
