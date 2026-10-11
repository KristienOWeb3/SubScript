const { Pool } = require("pg") as any;
import { getDatabaseConnectionConfig } from "@/lib/databaseConnection";

type PgClient = any;

const globalForPg = globalThis as typeof globalThis & { __subscriptPgPool?: any };

function getPool() {
    if (!globalForPg.__subscriptPgPool) {
        globalForPg.__subscriptPgPool = new Pool(getDatabaseConnectionConfig());
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
