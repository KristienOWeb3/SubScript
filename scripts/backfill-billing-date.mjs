#!/usr/bin/env node



import { pgQuery } from "../src/lib/serverPg.ts";
import { encryptWebhookSecret } from "../src/lib/webhooks.ts";
import { executeWithRpcFallback } from "../src/lib/payments/rpc.ts";
import { ethers } from "ethers";

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)"
];

async function main() {
    console.log("--- STARTING PREMIUM BILLING DATE BACKFILL ---");
    try {
        const standardContractAddress = process.env.STANDARD_CONTRACT_ADDRESS || "0x5111DB56a085a4f8A5909F9389A36Db2E4b54B48";
        
        console.log(`Using Standard Contract: ${standardContractAddress}`);

        const subscriptions = await pgQuery(
            "SELECT subscription_id, kind, status FROM subscriptions"
        );

        console.log(`Found ${subscriptions.length} subscriptions in database.`);

        let billingUpdated = 0;
        for (const sub of subscriptions) {
            const subId = sub.subscription_id.toString();
            try {
                const { result: subOnChain } = await executeWithRpcFallback(async (provider) => {
                    const contract = new ethers.Contract(standardContractAddress, STANDARD_ABI, provider);
                    return await contract.subscriptions(subId);
                });
                const nextPayment = BigInt(subOnChain[4]);
                const period = BigInt(subOnChain[3]);

                if (nextPayment > 0n) {
                    const nextBillingDate = new Date(Number(nextPayment) * 1000);
                    const lastSettlementTimestamp = new Date(Number(nextPayment - period) * 1000);

                    await pgQuery(
                        "UPDATE subscriptions SET next_billing_date = $1, last_settlement_timestamp = $2, updated_at = now() WHERE subscription_id = $3",
                        [nextBillingDate.toISOString(), lastSettlementTimestamp.toISOString(), sub.subscription_id]
                    );

                    console.log(`Updated subscription ${subId}: next_billing_date = ${nextBillingDate.toISOString()}, last_settlement_timestamp = ${lastSettlementTimestamp.toISOString()}`);
                    billingUpdated++;
                } else {
                    console.log(`Subscription ${subId} nextPayment is 0 on-chain, skipping.`);
                }
            } catch (err) {
                console.error(`Failed to backfill subscription ${subId}:`, err);
            }
        }
        console.log(`Billing date backfill completed. Updated ${billingUpdated} subscriptions.`);

        console.log("\n--- STARTING WEBHOOK SECRET RE-ENCRYPTION ---");
        const endpoints = await pgQuery(
            "SELECT id, wallet_address, secret, ciphertext FROM webhook_endpoints WHERE deleted_at IS NULL"
        );

        console.log(`Found ${endpoints.length} active webhook endpoints.`);

        let encryptedCount = 0;
        for (const ep of endpoints) {
            if (ep.ciphertext) {
                console.log(`Endpoint ${ep.id} is already encrypted, skipping.`);
                continue;
            }
            if (!ep.secret) {
                console.log(`Endpoint ${ep.id} has no secret, skipping.`);
                continue;
            }

            try {
                const encryption = encryptWebhookSecret(ep.secret, ep.id, ep.wallet_address);
                await pgQuery(
                    `UPDATE webhook_endpoints 
                     SET ciphertext = $1, nonce = $2, authentication_tag = $3, key_version = $4, encryption_algorithm = $5
                     WHERE id = $6`,
                    [
                        encryption.ciphertext,
                        encryption.nonce,
                        encryption.authenticationTag,
                        encryption.keyVersion,
                        encryption.encryptionAlgorithm,
                        ep.id
                    ]
                );
                console.log(`Encrypted secret for endpoint ${ep.id}`);
                encryptedCount++;
            } catch (err) {
                console.error(`Failed to encrypt secret for endpoint ${ep.id}:`, err);
            }
        }
        console.log(`Webhook re-encryption completed. Encrypted ${encryptedCount} endpoints.`);

        process.exit(0);
    } catch (e) {
        console.error("Backfill script failed with critical error:", e);
        process.exit(1);
    }
}

main();
