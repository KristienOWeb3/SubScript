/* Script to execute database migration for merchant confidentiality columns */

const { Client } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  await client.connect();
  console.log("Connected to database. Running migration...");
  await client.query(`
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shielded_payouts_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS view_key_hash TEXT DEFAULT NULL;
  `);
  console.log("Migration executed successfully!");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
