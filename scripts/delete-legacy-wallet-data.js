#!/usr/bin/env node

/*
 * Legacy EOA wallet history cleanup.
 *
 * After the custody cutover to Circle developer-controlled MPC wallets, users whose
 * previous user-controlled EOA wallets were never migrated (user_embedded_wallets rows
 * with circle_wallet_id IS NULL) could still see their old transaction / vault / receipt
 * history. This script deletes that history in a foreign-key-safe order:
 *
 *   1. transaction_verifications  (rows tied to the doomed receipts' tx hashes)
 *   2. receipts                   (payer_address OR beneficiary_address is a legacy wallet)
 *   3. metered_vaults             (user_address is a legacy wallet)
 *   4. subscript_dms              (sender_address OR receiver_address is a legacy wallet)
 *
 * The user_embedded_wallets rows themselves are NOT touched — wallet provisioning and
 * migration is handled by scripts/migrate-legacy-wallets.mjs.
 *
 * Usage:
 *   node --env-file=.env.local scripts/delete-legacy-wallet-data.js            (dry run)
 *   node --env-file=.env.local scripts/delete-legacy-wallet-data.js --execute  (delete)
 *
 * Dry run prints what WOULD be deleted and exits without modifying anything.
 */

const { createClient } = require("@supabase/supabase-js");

const EXECUTE = process.argv.includes("--execute");
const CHUNK = 100;

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !serviceKey) {
        console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).");
        process.exit(1);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    console.log(`Mode: ${EXECUTE ? "EXECUTE (rows will be deleted)" : "DRY RUN (no changes)"}\n`);

    /* 1. Identify legacy wallets: embedded wallets never migrated to Circle custody. */
    const { data: legacyRows, error: legacyErr } = await supabase
        .from("user_embedded_wallets")
        .select("wallet_address, provider")
        .is("circle_wallet_id", null);
    if (legacyErr) {
        console.error("Failed to query user_embedded_wallets:", legacyErr.message);
        process.exit(1);
    }

    /* Externally-controlled wallets are the user's own — never wipe their history. */
    const legacyAddresses = (legacyRows || [])
        .filter((r) => r.provider !== "external_wallet")
        .map((r) => String(r.wallet_address).toLowerCase());

    console.log(`Legacy custodial EOA wallets found: ${legacyAddresses.length}`);
    if (legacyAddresses.length === 0) {
        console.log("Nothing to clean. Verification: 0 legacy wallet records remain active.");
        process.exit(0);
    }
    for (const addr of legacyAddresses) console.log(`  - ${addr}`);
    console.log("");

    let totalDeleted = 0;

    /* Collect rows matching an address across chunks for a given table/column pair. */
    async function selectMatching(table, column, select) {
        const rows = [];
        for (const addrs of chunk(legacyAddresses, CHUNK)) {
            const { data, error } = await supabase.from(table).select(select).in(column, addrs);
            if (error) throw new Error(`${table}.${column} query failed: ${error.message}`);
            rows.push(...(data || []));
        }
        return rows;
    }

    async function deleteByKey(table, keyColumn, keys) {
        if (keys.length === 0) return 0;
        if (!EXECUTE) return keys.length;
        let deleted = 0;
        for (const keyChunk of chunk(keys, CHUNK)) {
            const { error, count } = await supabase
                .from(table)
                .delete({ count: "exact" })
                .in(keyColumn, keyChunk);
            if (error) throw new Error(`${table} delete failed: ${error.message}`);
            deleted += count ?? keyChunk.length;
        }
        return deleted;
    }

    /* 2. Receipts where the legacy wallet is payer or beneficiary. */
    const payerReceipts = await selectMatching("receipts", "payer_address", "receipt_id, tx_hash");
    const beneficiaryReceipts = await selectMatching("receipts", "beneficiary_address", "receipt_id, tx_hash");
    const receiptIds = [...new Set([...payerReceipts, ...beneficiaryReceipts].map((r) => r.receipt_id))];
    const receiptTxHashes = [...new Set([...payerReceipts, ...beneficiaryReceipts].map((r) => r.tx_hash).filter(Boolean))];

    /* 3. Delete children before parents. */
    const verificationsDeleted = await deleteByKey("transaction_verifications", "tx_hash", receiptTxHashes);
    console.log(`transaction_verifications: ${verificationsDeleted} row(s) ${EXECUTE ? "deleted" : "would be deleted"}`);
    totalDeleted += verificationsDeleted;

    const receiptsDeleted = await deleteByKey("receipts", "receipt_id", receiptIds);
    console.log(`receipts:                  ${receiptsDeleted} row(s) ${EXECUTE ? "deleted" : "would be deleted"}`);
    totalDeleted += receiptsDeleted;

    /* 4. Metered vault commit history for legacy wallets. */
    const vaults = await selectMatching("metered_vaults", "user_address", "id");
    const vaultsDeleted = await deleteByKey("metered_vaults", "id", vaults.map((v) => v.id));
    console.log(`metered_vaults:            ${vaultsDeleted} row(s) ${EXECUTE ? "deleted" : "would be deleted"}`);
    totalDeleted += vaultsDeleted;

    /* 5. DM history (payment receipts / billing notices) involving legacy wallets. */
    const sentDms = await selectMatching("subscript_dms", "sender_address", "id");
    const receivedDms = await selectMatching("subscript_dms", "receiver_address", "id");
    const dmIds = [...new Set([...sentDms, ...receivedDms].map((d) => d.id))];
    const dmsDeleted = await deleteByKey("subscript_dms", "id", dmIds);
    console.log(`subscript_dms:             ${dmsDeleted} row(s) ${EXECUTE ? "deleted" : "would be deleted"}`);
    totalDeleted += dmsDeleted;

    /* 6. Verification pass: after an execute run, every count above must now be zero. */
    if (EXECUTE) {
        const remainingReceipts =
            (await selectMatching("receipts", "payer_address", "receipt_id")).length +
            (await selectMatching("receipts", "beneficiary_address", "receipt_id")).length;
        const remainingVaults = (await selectMatching("metered_vaults", "user_address", "id")).length;
        const remainingDms =
            (await selectMatching("subscript_dms", "sender_address", "id")).length +
            (await selectMatching("subscript_dms", "receiver_address", "id")).length;
        const remaining = remainingReceipts + remainingVaults + remainingDms;
        console.log(`\nVerification: ${remaining} legacy wallet record(s) remain active.`);
        if (remaining > 0) process.exit(1);
    }

    console.log(`\nDone. ${totalDeleted} row(s) ${EXECUTE ? "deleted" : "would be deleted"} across all tables.`);
    if (!EXECUTE) {
        console.log("Re-run with --execute to apply.");
    }
}

main().catch((err) => {
    console.error("Cleanup failed:", err.message || err);
    process.exit(1);
});
