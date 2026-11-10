// Bound both response headers and body consumption: stalled admin reads must release
// loading states so the operator can retry. Never retry mutations automatically.
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Admin data took too long to load. Check your connection and use Refresh to retry."));
    }, 20_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const body = await response.text();
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
