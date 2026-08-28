/**
 * Dry-run the CCTP migration against the configured database inside a transaction, verify the
 * resulting schema and constraints, then ROLLBACK.
 *
 * Postgres DDL is transactional, so the rollback fully undoes CREATE TABLE. There is no COMMIT
 * anywhere in this file and the rollback lives in a finally block, so an exception on any path still
 * leaves the database untouched. The migration only creates a new table, so it takes no locks on
 * anything that already exists.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATION = "supabase/migrations/20260828000000_create_cctp_bridge_transfers.sql";
const TABLE = "cctp_bridge_transfers";

function databaseUrl() {
    for (const file of [".env.local", ".env"]) {
        if (!fs.existsSync(file)) continue;
        const match = fs.readFileSync(file, "utf8").match(/^DATABASE_URL=(.*)$/m);
        if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
    throw new Error("No DATABASE_URL found in .env.local or .env");
}

const tableExists = async (client) =>
    (await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${TABLE}`])).rows[0].present;

/** Runs a statement expected to fail, inside a savepoint so the outer transaction survives. */
async function expectRejection(client, label, sql) {
    await client.query("SAVEPOINT probe");
    try {
        await client.query(sql);
        await client.query("ROLLBACK TO SAVEPOINT probe");
        console.log(`  FAIL  ${label} — was accepted but should have been rejected`);
        return false;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT probe");
        const reason = String(error.message).split("\n")[0];
        console.log(`  ok    ${label}  (${reason.slice(0, 72)})`);
        return true;
    }
}

async function expectAccepted(client, label, sql) {
    await client.query("SAVEPOINT probe");
    try {
        await client.query(sql);
        await client.query("ROLLBACK TO SAVEPOINT probe");
        console.log(`  ok    ${label}`);
        return true;
    } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT probe");
        console.log(`  FAIL  ${label} — ${String(error.message).split("\n")[0]}`);
        return false;
    }
}

const client = new pg.Client({ connectionString: databaseUrl(), statement_timeout: 30_000 });
let failures = 0;
let rolledBack = false;

await client.connect();
try {
    const existedBefore = await tableExists(client);
    console.log(`table ${TABLE} exists before: ${existedBefore}\n`);

    const sql = fs.readFileSync(path.join(process.cwd(), MIGRATION), "utf8");

    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");

    console.log("applying migration...");
    await client.query(sql);
    console.log("  ok    migration executed without error\n");

    /* Twice, to prove a re-run is a no-op. The build runner keys on a ledger, but a migration that
       is not idempotent breaks any manual replay. */
    console.log("re-applying to check idempotency...");
    await client.query(sql);
    console.log("  ok    second run succeeded\n");

    console.log("columns:");
    const columns = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [TABLE],
    );
    for (const c of columns.rows) {
        console.log(
            `  ${c.column_name.padEnd(22)} ${c.data_type.padEnd(26)} ${c.is_nullable === "YES" ? "null" : "NOT NULL"}`,
        );
    }

    const expectedColumns = [
        "id", "direction", "user_wallet", "recipient_address", "origin_chain_id", "origin_domain",
        "destination_chain_id", "destination_domain", "gross_amount_micros", "fee_amount_micros",
        "net_amount_micros", "fee_bps", "fee_tx_hash", "burn_tx_hash", "message_bytes", "message_hash",
        "attestation_bytes", "mint_tx_hash", "status", "attempt_count", "error_message",
        "created_at", "updated_at",
    ];
    const actual = new Set(columns.rows.map((c) => c.column_name));
    const missing = expectedColumns.filter((c) => !actual.has(c));
    console.log(missing.length === 0 ? "\n  ok    every expected column present" : `\n  FAIL  missing: ${missing}`);
    if (missing.length) failures++;

    /* The columns the app writes as null before a burn exists must actually be nullable. */
    const nullable = new Map(columns.rows.map((c) => [c.column_name, c.is_nullable === "YES"]));
    for (const col of ["burn_tx_hash", "message_bytes", "message_hash", "fee_tx_hash"]) {
        if (nullable.get(col)) console.log(`  ok    ${col} is nullable`);
        else { console.log(`  FAIL  ${col} is NOT NULL — pending_burn rows cannot be written`); failures++; }
    }

    console.log("\nconstraints:");
    const constraints = await client.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype, conname`,
        [`public.${TABLE}`],
    );
    for (const c of constraints.rows) console.log(`  ${c.contype}  ${c.conname}: ${c.def.slice(0, 96)}`);

    console.log("\nindexes:");
    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = $1 ORDER BY indexname`, [TABLE]);
    for (const i of indexes.rows) console.log(`  ${i.indexname}`);

    console.log("\nbehaviour:");
    const base = (over = {}) => {
        const row = {
            direction: "'outbound_withdrawal'",
            user_wallet: "'0xaaa'", recipient_address: "'0xbbb'",
            origin_chain_id: "'arc'", origin_domain: "26",
            destination_chain_id: "'8453'", destination_domain: "6",
            gross_amount_micros: "1000000", fee_amount_micros: "5000", net_amount_micros: "995000",
            fee_bps: "50", status: "'pending_burn'",
            ...over,
        };
        return `INSERT INTO ${TABLE} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).join(", ")})`;
    };

    if (!(await expectAccepted(client, "a balanced fee split is accepted", base()))) failures++;
    if (!(await expectRejection(client, "gross != fee + net is rejected", base({ net_amount_micros: "999999" })))) failures++;
    if (!(await expectRejection(client, "an unknown status is rejected", base({ status: "'teleporting'" })))) failures++;
    if (!(await expectRejection(client, "an unknown direction is rejected", base({ direction: "'sideways'" })))) failures++;
    if (!(await expectRejection(client, "a zero gross amount is rejected", base({ gross_amount_micros: "0", fee_amount_micros: "0", net_amount_micros: "0" })))) failures++;
    if (!(await expectAccepted(client, "a null burn_tx_hash is accepted (pending_burn)", base()))) failures++;
    if (!(await expectRejection(
        client,
        "a duplicate burn_tx_hash is rejected",
        `${base({ burn_tx_hash: "'0xdup'" })}; ${base({ burn_tx_hash: "'0xdup'" })}`,
    ))) failures++;
    if (!(await expectAccepted(
        client,
        "two null burn_tx_hash rows coexist",
        `${base()}; ${base()}`,
    ))) failures++;

    /* The keeper's hot query should hit the partial index rather than scan. */
    const plan = await client.query(
        `EXPLAIN SELECT id FROM ${TABLE}
          WHERE status IN ('pending_attestation','minting') AND burn_tx_hash IS NOT NULL
          ORDER BY created_at ASC LIMIT 10`,
    );
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join(" ");
    console.log(`\nkeeper query plan: ${planText.replace(/\s+/g, " ").slice(0, 120)}`);
} catch (error) {
    failures++;
    console.error(`\nERROR: ${error.message}`);
} finally {
    await client.query("ROLLBACK").catch(() => {});
    rolledBack = true;
    const stillThere = await tableExists(client).catch(() => "unknown");
    console.log(`\nrolled back: ${rolledBack}`);
    console.log(`table ${TABLE} exists after rollback: ${stillThere}`);
    await client.end().catch(() => {});
}

console.log(failures === 0 ? "\nRESULT: migration is valid, nothing was committed." : `\nRESULT: ${failures} problem(s) found.`);
process.exit(failures === 0 ? 0 : 1);
