/* IP ban enforcement bridge.
 *
 * Middleware already blocks requests whose IP has a `ban:<ip>` key in Redis (it sets that
 * key itself when a client trips the rate limiter). The admin console writes durable rows
 * to banned_ips, which middleware cannot read — the edge runtime has no Postgres. This
 * module keeps the two in step so an admin-issued ban actually blocks traffic.
 *
 * Note the TTL difference: rate-limit bans use setex(3600) because they are automatic and
 * should lapse on their own. Admin bans are deliberate and set NO expiry, so they outlive
 * the hour and survive until an admin lifts them.
 */

function redisConfig(): { url: string; token: string } | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return { url, token };
}

async function client() {
    const config = redisConfig();
    if (!config) return null;
    const { Redis } = await import("@upstash/redis");
    return new Redis(config);
}

export async function setIpBanInRedis(ip: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const redis = await client();
        if (!redis) return { ok: false, error: "Redis is not configured" };
        await redis.set(`ban:${ip}`, "admin");
        return { ok: true };
    } catch (error: any) {
        console.error("[admin] failed to set IP ban in Redis:", error);
        return { ok: false, error: error?.message || "Redis write failed" };
    }
}

export async function clearIpBanInRedis(ip: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const redis = await client();
        if (!redis) return { ok: false, error: "Redis is not configured" };
        await redis.del(`ban:${ip}`);
        return { ok: true };
    } catch (error: any) {
        console.error("[admin] failed to clear IP ban in Redis:", error);
        return { ok: false, error: error?.message || "Redis delete failed" };
    }
}
