const KNOWN_SUPABASE_POOLER_HOSTS: Record<string, string> = {
    jkrlsjpsytzffwjpixue: "aws-1-eu-central-1.pooler.supabase.com",
};

function getPoolerHost(projectRef: string) {
    return process.env.SUPABASE_POOLER_HOST || KNOWN_SUPABASE_POOLER_HOSTS[projectRef] || null;
}

export function normalizeDatabaseUrl(rawUrl: string | undefined | null) {
    if (!rawUrl) return rawUrl || "";

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return rawUrl;
    }

    const directHostMatch = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!directHostMatch) {
        return rawUrl;
    }

    const projectRef = directHostMatch[1];
    const poolerHost = getPoolerHost(projectRef);
    if (!poolerHost) {
        return rawUrl;
    }

    parsed.hostname = poolerHost;
    parsed.port = process.env.SUPABASE_POOLER_PORT || "6543";

    if (parsed.username === "postgres") {
        parsed.username = `postgres.${projectRef}`;
    }

    return parsed.toString();
}

export function getDatabaseUrl() {
    const connectionString =
        process.env.SUPABASE_POOLER_DATABASE_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL ||
        process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }

    return normalizeDatabaseUrl(connectionString);
}
