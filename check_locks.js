const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DIRECT_URL
});

async function checkLocks() {
    try {
        await client.connect();
        console.log("Connected");
        const res = await client.query(`SELECT pid, locktype, mode, granted FROM pg_locks WHERE locktype = 'advisory';`);
        console.log("Advisory locks:", res.rows);
        
        // Let's also check active queries
        const queries = await client.query(`SELECT pid, state, query, extract(epoch from now() - query_start) as duration FROM pg_stat_activity WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%';`);
        console.log("Active queries:", queries.rows);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.end();
    }
}

checkLocks();
