import { getDatabaseUrl } from "./databaseUrl";
import { supabaseDbCa } from "./supabaseCa";

/** Shared node-postgres settings for raw queries and the Prisma driver adapter. */
export function getDatabaseConnectionConfig(options: { allowBuildTimeFallback?: boolean; forPrisma?: boolean } = {}) {
    let parsed: URL;
    const connectionString = getDatabaseUrl(options);
    try {
        parsed = new URL(connectionString);
    } catch {
        throw new Error("Database connection URL is invalid");
    }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Unsupported database connection protocol");
    // pg lets these query parameters override the URI authority. Reject ambiguity
    // before deciding which project and TLS trust policy the connection uses.
    for (const key of ["host", "hostaddr", "user", "username", "password", "port", "database", "dbname"]) {
        if (parsed.searchParams.has(key)) throw new Error("Database connection authority must be configured in the URL authority, not query parameters");
    }
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
    const isSupabase = /^db\.[a-z0-9]+\.supabase\.co$/i.test(hostname)
        || /(^|\.)pooler\.supabase\.com$/i.test(hostname);
    const configuredMax = Number(parsed.searchParams.get("connection_limit") || process.env.PRISMA_CONNECTION_LIMIT || "10");
    const max = Number.isInteger(configuredMax) && configuredMax > 0 && configuredMax <= 20 ? configuredMax : 10;
    // pg's URL parser replaces the supplied ssl object when any of these appear.
    // Remote databases always verify both the certificate chain and hostname.
    if (!isLocal) {
        for (const key of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) parsed.searchParams.delete(key);
    }
    for (const key of ["connect_timeout", "connectionTimeoutMillis", "statement_timeout", "query_timeout"]) parsed.searchParams.delete(key);
    return {
        connectionString: parsed.toString(),
        max,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 20_000,
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: true, ...(isSupabase ? { ca: supabaseDbCa() } : {}) } }),
    };
}
