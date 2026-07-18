import { NextResponse } from "next/server";
import { ApplicationRouteError } from "./applicationAuth";

const DEFAULT_BASE_URL = "https://www.subscriptonarc.com";
const DEFAULT_TIMEOUT_MS = 10_000;

export type SubScriptResult = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
};

function timeoutMs() {
  const configured = Number(process.env.SUBSCRIPT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.min(30_000, Math.max(1_000, Math.trunc(configured)))
    : DEFAULT_TIMEOUT_MS;
}

function configuration() {
  const secretKey = process.env.SUBSCRIPT_SECRET_KEY;
  if (!secretKey) {
    throw new ApplicationRouteError(
      500,
      "subscript_not_configured",
      "SUBSCRIPT_SECRET_KEY is not configured",
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(process.env.SUBSCRIPT_BASE_URL || DEFAULT_BASE_URL);
  } catch {
    throw new ApplicationRouteError(
      500,
      "invalid_subscript_base_url",
      "SUBSCRIPT_BASE_URL must be an absolute URL",
    );
  }
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    throw new ApplicationRouteError(
      500,
      "invalid_subscript_base_url",
      "SUBSCRIPT_BASE_URL must use HTTPS",
    );
  }
  return { baseUrl, secretKey };
}

export async function subscriptRequest(
  path: string,
  init: Omit<RequestInit, "signal"> = {},
): Promise<SubScriptResult> {
  const { baseUrl, secretKey } = configuration();
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${secretKey}`);
    response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ApplicationRouteError(
      timedOut ? 504 : 502,
      timedOut ? "subscript_timeout" : "subscript_unreachable",
      timedOut
        ? "SubScript did not respond before the request timeout"
        : "Could not reach SubScript",
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApplicationRouteError(
      502,
      "invalid_subscript_response",
      `SubScript returned a non-JSON response (HTTP ${response.status})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApplicationRouteError(
      502,
      "invalid_subscript_response",
      `SubScript returned an invalid response object (HTTP ${response.status})`,
    );
  }

  return {
    ok: response.ok,
    status: response.status,
    payload: parsed as Record<string, unknown>,
  };
}

export function applicationErrorResponse(error: unknown) {
  if (error instanceof ApplicationRouteError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("Unexpected merchant integration error", error);
  return NextResponse.json(
    { error: "Unexpected server error", code: "unexpected_server_error" },
    { status: 500 },
  );
}

export function subscriptRejectedResponse(result: SubScriptResult, fallback: string) {
  const upstreamMessage =
    typeof result.payload.error === "string" ? result.payload.error : fallback;
  const requestId =
    typeof result.payload.request_id === "string" ? result.payload.request_id : undefined;
  return NextResponse.json(
    {
      error: upstreamMessage,
      code: "subscript_rejected_request",
      upstreamStatus: result.status,
      ...(requestId ? { requestId } : {}),
    },
    { status: result.status },
  );
}
