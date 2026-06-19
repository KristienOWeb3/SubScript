const KNOWN_SUPABASE_POOLER_HOSTS: Record<string, string> = {
    jkrlsjpsytzffwjpixue: "aws-1-eu-central-1.pooler.supabase.com",
};

const BUILD_TIME_DATABASE_URL = "postgresql-redacted:postgres:postgres@localhost:5432/postgres";

type DatabaseUrlOptions = {
    allowBuildTimeFallback?: boolean;
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
    let projectRef = "";
    
    if (directHostMatch) {
        projectRef = directHostMatch[1];
    } else if (parsed.hostname.includes("pooler.supabase.com")) {
        // Extract project reference from username if it exists (e.g., postgres.ref)
        const userMatch = parsed.username.match(/^postgres\.([a-z0-9]+)$/i);
        if (userMatch) {
            projectRef = userMatch[1];
        } else {
            // Attempt to retrieve from other env variables
            const sUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
            const sMatch = sUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
            if (sMatch) {
                projectRef = sMatch[1];
            } else {
                // Default fallback to the current project reference
                projectRef = "jkrlsjpsytzffwjpixue";
            }
        }
    } else {
        return rawUrl;
    }

    const poolerHost = getPoolerHost(projectRef);
    if (!poolerHost) {
        // Ensure username is correct even if we don't rewrite the host
        if (parsed.username === "postgres" && projectRef) {
            parsed.username = `postgres.${projectRef}`;
            return parsed.toString();
        }
        return rawUrl;
    }

    parsed.hostname = poolerHost;
    parsed.port = process.env.SUPABASE_POOLER_PORT || "6543";

    if (parsed.username === "postgres" || !parsed.username.includes(".")) {
        parsed.username = `postgres.${projectRef}`;
    }

    return parsed.toString();
}

export function getDatabaseUrl(options: DatabaseUrlOptions = {}) {
    const connectionString =
        process.env.SUPABASE_POOLER_DATABASE_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL ||
        process.env.DATABASE_URL;

    if (!connectionString) {
        if (options.allowBuildTimeFallback) {
            return BUILD_TIME_DATABASE_URL;
        }
        throw new Error("DATABASE_URL is not configured");
    }

    return normalizeDatabaseUrl(connectionString);
}
