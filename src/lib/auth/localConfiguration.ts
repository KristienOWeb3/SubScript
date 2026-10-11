import { getDatabaseConnectionConfig } from "@/lib/databaseConnection";

/** Report local setup failures before account lookups can resemble missing accounts. */
export function localAuthenticationConfigurationError(): Response | null {
    if (process.env.NODE_ENV !== "development") return null;

    let error: string | null = null;
    if (!process.env.JWT_SECRET?.trim()) {
        error = "Local sign-in requires JWT_SECRET in .env.local. Configure it and restart the local server.";
    } else {
        try {
            getDatabaseConnectionConfig();
        } catch {
            error = "Local sign-in requires a valid DATABASE_URL in .env.local. Restore the intended Supabase project's connection URL and restart the local server.";
        }
    }

    return error ? Response.json({ error }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
    }) : null;
}
