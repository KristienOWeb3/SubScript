const { Pool } = require("pg") as any;
import { getDatabaseUrl } from "@/lib/databaseUrl";
import { supabaseDbCa } from "@/lib/supabaseCa";

type PgClient = any;

const globalForPg = globalThis as typeof globalThis & { __subscriptPgPool?: any };

function getPool() {
    if (!globalForPg.__subscriptPgPool) {
        const connectionString = getDatabaseUrl();
        const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
        globalForPg.__subscriptPgPool = new Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 10_000,
            /* Verified TLS with the Supabase root supplied explicitly — Node's trust store does
               not include it, and disabling verification instead would accept a MITM. */
            ...(isLocal ? {} : { ssl: { rejectUnauthorized: true, ca: supabaseDbCa() } }),
        });
    }
    return globalForPg.__subscriptPgPool;
}

export async function withPgClient<T>(callback: (client: PgClient) => Promise<T>) {
    const client = await getPool().connect();
    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

export async function pgQuery<T = any>(sql: string, params: any[] = []) {
    return withPgClient(async (client) => {
        const result = await client.query(sql, params);
        return result.rows as T[];
    });
}

export async function pgMaybeOne<T = any>(sql: string, params: any[] = []) {
    const rows = await pgQuery<T>(sql, params);
    return rows[0] || null;
}
