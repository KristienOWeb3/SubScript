/*
 * Client-side address -> ".sub" alias resolution, so the UI can show a human DNS name instead of a
 * raw wallet address. GET /api/merchant/alias?address=… is public (auth is only the no-param
 * fallback). Anonymous aliases are treated as "no alias" so we never expose a name the user hid.
 * Results are cached per address for the page session (aliases change at most once/30 days).
 */

const aliasCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function shortAddress(address: string | null | undefined): string {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function resolveAliasForAddress(address: string | null | undefined): Promise<string | null> {
    if (!address) return null;
    const key = address.toLowerCase();
    if (aliasCache.has(key)) return aliasCache.get(key) ?? null;
    if (inflight.has(key)) return inflight.get(key)!;

    const promise = (async () => {
        try {
            const res = await fetch(`/api/merchant/alias?address=${encodeURIComponent(key)}`);
            const data = await res.json().catch(() => null);
            const alias = data?.success && data.alias && !data.is_anonymous ? String(data.alias) : null;
            aliasCache.set(key, alias);
            return alias;
        } catch {
            return null;
        } finally {
            inflight.delete(key);
        }
    })();
    inflight.set(key, promise);
    return promise;
}
