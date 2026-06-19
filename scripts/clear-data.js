const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const MOCK_DB_FILE = path.join(process.cwd(), 'prisma_mock_db.json');

async function main() {
  console.log(" Wiping local mock database...");
  try {
    if (fs.existsSync(MOCK_DB_FILE)) {
      const initial = {
        accountRoles: [],
        otpCodes: [],
        userEmbeddedWallets: [],
        merchants: [],
        customers: []
      };
      fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      console.log("✅ Local mock database wiped successfully.");
    } else {
      console.log("No local mock database file found.");
    }
  } catch (err) {
    console.error("❌ Failed to wipe local mock database:", err);
  }

  console.log("\nConnecting to remote database...");
  const prisma = new PrismaClient();
  try {
    // Attempt a quick connection test query
    await prisma.$queryRaw`SELECT NOW()`;
    console.log("✅ Connected to database. Deleting records in dependency-order...");

    // Order matters due to foreign key constraints
    const tables = [
      'payrollRecipient',
      'payrollCampaign',
      'merchantEmailTemplate',
      'receipt',
      'userEmbeddedWallet',
      'subscriptDm',
      'accountRole',
      'addressAlias',
      'webhookDelivery',
      'webhookEvent',
      'webhookEndpoint',
      'apiKey',
      'waitlistLead',
      'payoutBatchItem',
      'payoutBatchChunk',
      'payoutBatch',
      'paymentSession',
      'subscription',
      'paymentLinkPayment',
      'paymentLink',
      'session',
      'idempotencyKey',
      'ledgerEntry',
      'eventLog',
      'systemSnapshot',
      'transactionVerification',
      'auditEvent',
      'customer',
      'merchant'
    ];

    for (const table of tables) {
      if (prisma[table]) {
        try {
          const { count } = await prisma[table].deleteMany({});
          console.log(`  - Deleted ${count} records from ${table}`);
        } catch (tableErr) {
          console.warn(`  ⚠️ Could not clear table ${table}: ${tableErr.message}`);
        }
      }
    }
    console.log("✅ Database tables wiped successfully.");
  } catch (err) {
    console.warn("\n⚠️ Remote database is paused or unreachable. Wiped local mock data, but skipping remote wipe.");
    console.warn(`Details: ${err.message}`);
    console.warn("\nOnce the Supabase database is unpaused in your dashboard, run this script again to clear remote data.");
  } finally {
    await prisma.$disconnect();
  }
}

main();
