import { http } from "viem";

/* Arc's public RPC rate-limits per RPC *call* — roughly one per second per IP — answering the rest
   with HTTP 429 and a JSON-RPC body of `{ code: -32011, message: "request limit reached" }`. It
   counts the calls inside a JSON-RPC batch individually too, so batching buys nothing. Any surface
   that reads more than one thing at a time therefore collides with itself.

   viem's own retry can't cover this: shouldRetry() keys off the JSON-RPC code whenever the body
   carries one, and -32011 is not in its retryable set, so the HTTP 429 never reaches its status
   check and `retryCount` is ignored. Retrying underneath viem, at the fetch layer, sidesteps that.
   A 429 means the call was rejected rather than executed, so this is safe for writes as well. */
export const rateLimitRetryFetch: typeof fetch = async (input, init) => {
    let delay = 250;
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(input, init);
        if (response.status !== 429 || attempt >= 5) return response;
        const retryAfterMs = Number(response.headers.get("retry-after")) * 1000;
        await new Promise((resolve) =>
            setTimeout(resolve, retryAfterMs > 0 ? Math.min(retryAfterMs, 8_000) : delay),
        );
        delay *= 2;
    }
};

/**
 * The only transport that should be used to reach Arc — `http()` on its own drops reads on the
 * floor under the limiter above.
 *
 * This lives outside lib/wagmi because the wagmi config is not the only thing that talks to Arc:
 * the dashboards, header, deposit modal and checkout each build their own createPublicClient, and
 * fixing only the wagmi transport left every one of them still failing. A merchant's tier read is
 * downstream of four such calls, so the 429s logged them out of their own paid features.
 *
 * Omit `url` to use the chain's default RPC (what createPublicClient does with a bare `http()`).
 */
export const arcHttp = (url?: string) => http(url, { fetchFn: rateLimitRetryFetch, timeout: 20_000 });
