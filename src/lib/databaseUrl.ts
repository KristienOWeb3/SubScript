const BUILD_TIME_DATABASE_URL = ["postgresql:", "", "postgres:postgres@localhost:5432/postgres"].join("/");

type DatabaseUrlOptions = {
    allowBuildTimeFallback?: boolean;
    forPrisma?: boolean;
};

export function normalizeDatabaseUrl(rawUrl: string | undefined | null) {
    if (!rawUrl) return rawUrl || "";
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return rawUrl;
    }
    // A configured connection is authoritative: direct uses postgres, shared pooler
    // uses role.project. Never guess a region, rewrite ports, or substitute projects.
    if (!/(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname)) return rawUrl;
    if (/^[^.]+\.[a-z0-9]+$/i.test(decodeURIComponent(parsed.username))) return rawUrl;

    const projectUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    let projectRef = "";
    if (projectUrl) {
        try {
            projectRef = new URL(projectUrl).hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] || "";
        } catch { /* Incomplete configuration must fail without exposing credentials. */ }
    }
    if (!projectRef || !parsed.username) {
        throw new Error("Supabase pooler username must include an explicit project reference (role.project).");
    }
    parsed.username = `${decodeURIComponent(parsed.username)}.${projectRef}`;
    return parsed.toString();
}

function addPrismaPoolerOptions(connectionString: string) {
    let parsed: URL;
    try {
        parsed = new URL(connectionString);
    } catch {
        return connectionString;
    }

    if (/(^|\.)pooler\.supabase\.com$/i.test(parsed.hostname)) {
        parsed.searchParams.set("pgbouncer", "true");
    }

    // Ensure connection limit and pool timeout are set to avoid connection pool exhaustion
    if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT || "15");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
        parsed.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT || "30");
    }

    return parsed.toString();
}

export function getDatabaseUrl(options: DatabaseUrlOptions = {}) {
    const connectionString =
        process.env.DATABASE_URL ||
        process.env.SUPABASE_POOLER_DATABASE_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL;

    if (!connectionString) {
        if (options.allowBuildTimeFallback) {
            return BUILD_TIME_DATABASE_URL;
        }
        throw new Error("DATABASE_URL is not configured");
    }

    const normalized = normalizeDatabaseUrl(connectionString);
    return options.forPrisma ? addPrismaPoolerOptions(normalized) : normalized;
}
