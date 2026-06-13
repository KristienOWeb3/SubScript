/* Secure administrative endpoint to execute SQL queries on the remote Supabase database from the Vercel cloud environment */
import { NextResponse } from "next/server";
/* @ts-ignore */
import { Client } from "pg";

export async function POST(request: Request) {
    let maskedConnectionString = "unknown";
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET || "default_keeper_secret_temp_123";

        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || !body.sql) {
            return NextResponse.json({ error: "Missing SQL query in request body" }, { status: 400 });
        }

        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            return NextResponse.json({ error: "DATABASE_URL environment variable is not configured" }, { status: 500 });
        }

        maskedConnectionString = connectionString.replace(/:[^:@]+@/, ":***@");
        
        const client = new Client({
            connectionString,
            connectionTimeoutMillis: 10000
        });

        await client.connect();
        
        const result = await client.query(body.sql);
        await client.end();

        return NextResponse.json({ 
            success: true, 
            databaseUrl: maskedConnectionString,
            command: result.command,
            rowCount: result.rowCount,
            rows: result.rows
        }, { status: 200 });

    } catch (error: any) {
        console.error("Migration execution failed:", error);
        return NextResponse.json({ 
            success: false, 
            databaseUrl: maskedConnectionString,
            error: error.message || "Internal Server Error" 
        }, { status: 500 });
    }
}
