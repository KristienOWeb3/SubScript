const { Client } = require("pg") as any;
import { getDatabaseUrl } from "@/lib/databaseUrl";

type PgClient = any;

export async function withPgClient<T>(callback: (client: PgClient) => Promise<T>) {
    const client = new Client({
        connectionString: getDatabaseUrl(),
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    try {
        return await callback(client);
    } finally {
        await client.end();
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
