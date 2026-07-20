import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
// @ts-ignore
import pg from "pg";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { supabaseDbCa } from "@/lib/supabaseCa";
import { ethers } from "ethers";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";


const { Client } = pg;
const ALGORITHM = "aes-256-gcm";

function decryptPrivateKey(encryptedText: string, secret: string): string {
    if (!secret) {
        throw new Error("WALLET_ENCRYPTION_KEY is required to decrypt legacy keys.");
    }
    const key = crypto.scryptSync(secret, "subscript:wallet:v2", 32);
    const [version, ivHex, authTagHex, encryptedHex] = encryptedText.split(":");
    if (version !== "v2" || !ivHex || !authTagHex || !encryptedHex) {
        throw new Error("Invalid encrypted format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

export interface MigrationOptions {
    isDryRun: boolean;
    dbUrl?: string;
    encryptionSecret?: string;
    apiKey?: string;
    entitySecret?: string;
    walletSetId?: string;
    blockchain?: string;
    accountType?: string;
}

export interface MigrationResult {
    success: boolean;
    migratedCount: number;
    logs: string[];
}

export async function runLegacyWalletMigration(opts: MigrationOptions): Promise<MigrationResult> {
    const logs: string[] = [];
    const log = (msg: string) => {
        logs.push(msg);
        console.log(msg);
    };

    const isDryRun = opts.isDryRun;
    const dbUrl = opts.dbUrl || process.env.DATABASE_URL;
    const encryptionSecret = opts.encryptionSecret || process.env.WALLET_ENCRYPTION_KEY;
    const apiKey = opts.apiKey || process.env.CIRCLE_API_KEY;
    const entitySecret = opts.entitySecret || process.env.CIRCLE_ENTITY_SECRET;
    const walletSetId = opts.walletSetId || process.env.CIRCLE_ARC_WALLET_SET_ID;
    const accountType = (opts.accountType || process.env.CIRCLE_WALLET_ACCOUNT_TYPE || "SCA").trim().toUpperCase();
    const blockchain = (opts.blockchain || process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET").trim().toUpperCase();

    if (!dbUrl) {
        throw new Error("Missing DATABASE_URL configuration.");
    }

    log(`=== SubScript Legacy Wallet Sweep Migration ===`);
    log(`Mode: ${isDryRun ? "DRY-RUN (Simulating changes)" : "LIVE (Performing database & on-chain changes)"}`);

    const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
    const client = new Client({
        connectionString: dbUrl,
        /* Verified TLS with the Supabase root CA — never disable verification, which would
           accept a MITM cert and expose the legacy private keys this sweep decrypts. */
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: true, ca: supabaseDbCa() } }),
    });
    await client.connect();

    let migratedCount = 0;

    try {
        const res = await client.query(
            "select id, email, wallet_address, encrypted_private_key from user_embedded_wallets where circle_wallet_id is null"
        );
        const legacyWallets = res.rows;
        log(`Found ${legacyWallets.length} legacy wallets requiring migration.`);

        if (legacyWallets.length === 0) {
            log("No legacy wallets to migrate.");
            return { success: true, migratedCount: 0, logs };
        }

        let circleClient: any = null;
        if (!isDryRun) {
            if (!apiKey || !entitySecret || !walletSetId) {
                throw new Error("Circle API configuration is incomplete for live run (need CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_ARC_WALLET_SET_ID).");
            }
            circleClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
        }

        for (const record of legacyWallets) {
            log(`\n----------------------------------------`);
            log(`Migrating wallet for: ${record.email} (${record.wallet_address})`);

            if (!record.encrypted_private_key) {
                log(`  No encrypted private key found for this wallet. Skipping.`);
                continue;
            }

            if (!encryptionSecret) {
                log(`  Skipping: WALLET_ENCRYPTION_KEY is required to decrypt legacy private key.`);
                continue;
            }

            try {
                decryptPrivateKey(record.encrypted_private_key, encryptionSecret);
                log(`  Successfully validated legacy private key decryption.`);
            } catch (e: any) {
                log(`  Failed to decrypt legacy private key: ${e.message}`);
                continue;
            }

            const refId = crypto.createHash("sha256").update(record.email).digest("hex");
            let newAddress = `0x_simulated_new_address_for_${refId.slice(0, 8)}`;
            let circleWalletId = `circle_wallet_id_${refId.slice(0, 8)}`;
            let circleUserId = `circle_user_id_${refId.slice(0, 8)}`;

            if (!isDryRun && circleClient) {
                log(`  Provisioning Circle MPC wallet...`);
                // Check circle_wallet_provisioning first for idempotency
                const provisionCheck = await client.query(
                    "select circle_wallet_id, wallet_address from circle_wallet_provisioning where ref_id = $1 limit 1",
                    [refId]
                );
                
                if (provisionCheck.rows[0]?.circle_wallet_id) {
                    circleWalletId = provisionCheck.rows[0].circle_wallet_id;
                    newAddress = provisionCheck.rows[0].wallet_address;
                    log(`  Found existing provisioned wallet in idempotency table: ${newAddress}`);
                } else {
                    const idempotencyKey = randomUUID();
                    // Save idempotency key
                    await client.query(
                        "insert into circle_wallet_provisioning (ref_id, idempotency_key) values ($1, $2) on conflict do nothing",
                        [refId, idempotencyKey]
                    );

                    const createRes = await circleClient.createWallets({
                        idempotencyKey,
                        walletSetId,
                        blockchains: [blockchain],
                        accountType,
                        count: 1,
                    });

                    const wallets = createRes.data?.wallets || [];
                    const wallet = wallets[0];
                    if (!wallet || !wallet.address || !wallet.id) {
                        throw new Error(`Circle did not return a valid wallet. Response: ${JSON.stringify(createRes)}`);
                    }

                    newAddress = wallet.address.toLowerCase();
                    circleWalletId = wallet.id;
                    circleUserId = wallet.userId || "";

                    await client.query(
                        "update circle_wallet_provisioning set circle_wallet_id = $2, wallet_address = $3, updated_at = now() where ref_id = $1",
                        [refId, circleWalletId, newAddress]
                    );
                    log(`  Created Circle wallet: ${newAddress} (ID: ${circleWalletId})`);
                }
            } else {
                log(`  [Dry-run] Would provision Circle MPC wallet.`);
            }

            log(`  New address target: ${newAddress}`);

            // Address Collision Check
            if (!isDryRun) {
                const collisionCheck = await client.query(
                    "select email from user_embedded_wallets where wallet_address = $1 limit 1",
                    [newAddress.toLowerCase()]
                );
                if (collisionCheck.rows[0] && collisionCheck.rows[0].email !== record.email) {
                    throw new Error(`Address collision detected: target address ${newAddress} is already registered to ${collisionCheck.rows[0].email}`);
                }
            }

            // On-Chain Asset Sweep
            if (!isDryRun) {
                const sweepCheck = await client.query(
                    "select sweep_status, sweep_tx_hash from circle_wallet_provisioning where ref_id = $1 limit 1",
                    [refId]
                );
                const currentSweepStatus = sweepCheck.rows[0]?.sweep_status || 'PENDING';
                if (currentSweepStatus === 'SWEEP_COMPLETED') {
                    log(`  USDC Sweep already completed in a prior run (Tx: ${sweepCheck.rows[0]?.sweep_tx_hash}). Skipping sweep.`);
                } else {
                    log(`  Starting on-chain asset sweep from ${record.wallet_address} to ${newAddress}...`);
                    const decryptedPkey = decryptPrivateKey(record.encrypted_private_key, encryptionSecret);
                    const { provider } = await getRpcProviderForWrite();
                    const eoaWallet = new ethers.Wallet(decryptedPkey, provider);
                    const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY;
                    if (!adminPrivateKey) {
                        throw new Error("ADMIN_PRIVATE_KEY or KEEPER_PRIVATE_KEY must be configured on server to perform gas top-up.");
                    }
                    const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

                    const nativeBalance = await provider.getBalance(eoaWallet.address);
                    const usdcContract: any = new ethers.Contract(
                        "0x3600000000000000000000000000000000000000",
                        [
                            "function balanceOf(address) view returns (uint256)",
                            "function transfer(address, uint256) returns (bool)"
                        ],
                        provider
                    );
                    const erc20Balance = await usdcContract.balanceOf(eoaWallet.address);
                    log(`  EOA Native balance: ${ethers.formatUnits(nativeBalance, 18)} USDC, ERC-20 USDC balance: ${ethers.formatUnits(erc20Balance, 6)} USDC`);

                    const feeData = await provider.getFeeData();
                    const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
                    const minGas = gasPrice * 100000n; // gas limit for ERC-20 transfer

                    // Gas top-up if EOA balance is too low
                    if (nativeBalance < minGas) {
                        const topUpAmount = (gasPrice * 150000n) - nativeBalance;
                        log(`  EOA gas balance too low. Topping up EOA with ${ethers.formatUnits(topUpAmount, 18)} native gas from admin...`);
                        const topUpTx = await adminWallet.sendTransaction({
                            to: eoaWallet.address,
                            value: topUpAmount
                        });
                        log(`  Top-up transaction submitted: ${topUpTx.hash}. Waiting for confirmation...`);
                        await topUpTx.wait();
                        log(`  Top-up transaction confirmed.`);
                    }

                    let sweepTxHash = "";

                    // Sweep ERC-20 USDC
                    if (erc20Balance > 0n) {
                        log(`  Sweeping ${ethers.formatUnits(erc20Balance, 6)} ERC-20 USDC to new Circle wallet ${newAddress}...`);
                        const sweepErc20Tx = await usdcContract.connect(eoaWallet).transfer(newAddress, erc20Balance);
                        log(`  ERC-20 Sweep transaction submitted: ${sweepErc20Tx.hash}. Waiting for confirmation...`);
                        await sweepErc20Tx.wait();
                        sweepTxHash = sweepErc20Tx.hash;
                        log(`  ERC-20 Sweep transaction confirmed.`);
                    }

                    // Sweep native USDC (remaining gas)
                    const remainingNative = await provider.getBalance(eoaWallet.address);
                    const nativeSweepFee = 21000n * gasPrice;
                    if (remainingNative > nativeSweepFee) {
                        const sweepNativeAmount = remainingNative - nativeSweepFee;
                        if (sweepNativeAmount > 0n) {
                            log(`  Sweeping ${ethers.formatUnits(sweepNativeAmount, 18)} native USDC...`);
                            const sweepNativeTx = await eoaWallet.sendTransaction({
                                to: newAddress,
                                value: sweepNativeAmount
                            });
                            log(`  Native Sweep transaction submitted: ${sweepNativeTx.hash}. Waiting for confirmation...`);
                            await sweepNativeTx.wait();
                            if (!sweepTxHash) sweepTxHash = sweepNativeTx.hash;
                            log(`  Native Sweep transaction confirmed.`);
                        }
                    }

                    if (!sweepTxHash) sweepTxHash = "completed_no_assets";

                    // Update checkpoint state
                    await client.query(
                        "update circle_wallet_provisioning set sweep_status = 'SWEEP_COMPLETED', sweep_tx_hash = $2, updated_at = now() where ref_id = $1",
                        [refId, sweepTxHash]
                    );
                    log(`  On-chain sweep completed and checkpoint updated.`);
                }
            } else {
                log(`  [Dry-run] Would sweep on-chain assets from EOA to new wallet and update checkpoints.`);
            }

            // Perform DB cascade updates in transaction
            if (!isDryRun) {
                log(`  Updating database tables in a single transaction...`);
                await client.query("BEGIN");
                try {
                    const oldAddr = record.wallet_address.toLowerCase();
                    const newAddr = newAddress.toLowerCase();

                    // Insert role for new address if it exists
                    const roleRes = await client.query("select role, created_at from account_roles where address = $1", [oldAddr]);
                    if (roleRes.rows[0]) {
                        const { role, created_at } = roleRes.rows[0];
                        await client.query(
                            "insert into account_roles (address, role, created_at, updated_at) values ($1, $2, $3, now()) on conflict (address) do nothing",
                            [newAddr, role, created_at]
                        );
                    }

                    // Update child tables
                    await client.query("update kyc_verifications set wallet_address = $2 where wallet_address = $1", [oldAddr, newAddr]);
                    await client.query(
                        "update user_embedded_wallets set wallet_address = $2, circle_wallet_id = $3, circle_user_id = $4, encrypted_private_key = null, provider = 'circle_google', updated_at = now() where wallet_address = $1",
                        [oldAddr, newAddr, circleWalletId, circleUserId]
                    );
                    await client.query("update address_aliases set address = $2 where address = $1", [oldAddr, newAddr]);
                    
                    // Insert customer
                    const custRes = await client.query("select * from customers where wallet_address = $1", [oldAddr]);
                    if (custRes.rows[0]) {
                        await client.query(
                            `insert into customers (wallet_address, email, profile_pic, spending_limit_daily, spending_limit_weekly, spending_limit_monthly, push_enabled, email_enabled, debit_success_enabled, expiry_warning_enabled, security_shield_enabled, security_multi_sig_enabled, created_at)
                             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (wallet_address) do nothing`,
                            [
                                newAddr, custRes.rows[0].email, custRes.rows[0].profile_pic, custRes.rows[0].spending_limit_daily, 
                                custRes.rows[0].spending_limit_weekly, custRes.rows[0].spending_limit_monthly, custRes.rows[0].push_enabled,
                                custRes.rows[0].email_enabled, custRes.rows[0].debit_success_enabled, custRes.rows[0].expiry_warning_enabled,
                                custRes.rows[0].security_shield_enabled, custRes.rows[0].security_multi_sig_enabled, custRes.rows[0].created_at
                            ]
                        );
                    }

                    await client.query("update metered_vaults set user_address = $2 where user_address = $1", [oldAddr, newAddr]);
                    await client.query("update metered_vaults set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);
                    

                    // Insert merchant
                    const merchRes = await client.query("select * from merchants where wallet_address = $1", [oldAddr]);
                    if (merchRes.rows[0]) {
                        await client.query(
                            `insert into merchants (wallet_address, tier, available_balance_usdc, reserved_balance_usdc, stripe_account_id, payout_destination_address, billing_cycle_anchor, created_at, updated_at)
                             values ($1, $2, $3, $4, $5, $6, $7, $8, now()) on conflict (wallet_address) do nothing`,
                            [
                                newAddr, merchRes.rows[0].tier, merchRes.rows[0].available_balance_usdc, merchRes.rows[0].reserved_balance_usdc,
                                merchRes.rows[0].stripe_account_id, merchRes.rows[0].payout_destination_address, merchRes.rows[0].billing_cycle_anchor, merchRes.rows[0].created_at
                            ]
                        );
                    }

                    await client.query("update payout_batches set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);
                    await client.query("update subscriptions set subscriber = $2 where subscriber = $1", [oldAddr, newAddr]);
                    await client.query("update subscriptions set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);
                    await client.query("update waitlist_leads set wallet_address = $2 where wallet_address = $1", [oldAddr, newAddr]);
                    await client.query("update api_keys set wallet_address = $2 where wallet_address = $1", [oldAddr, newAddr]);
                    await client.query("update webhook_endpoints set wallet_address = $2 where wallet_address = $1", [oldAddr, newAddr]);
                    await client.query("update sessions set wallet = $2 where wallet = $1", [oldAddr, newAddr]);

                    // Update receipts
                    await client.query("update receipts set payer_address = $2 where payer_address = $1", [oldAddr, newAddr]);
                    await client.query("update receipts set beneficiary_address = $2 where beneficiary_address = $1", [oldAddr, newAddr]);
                    await client.query("update receipts set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);

                    // Update payment links
                    await client.query("update payment_links set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);
                    await client.query("update payment_links set beneficiary_address = $2 where beneficiary_address = $1", [oldAddr, newAddr]);
                    await client.query("update payment_links set receiver_address = $2 where receiver_address = $1", [oldAddr, newAddr]);

                    // Update payment link payments
                    await client.query("update payment_link_payments set payer_address = $2 where payer_address = $1", [oldAddr, newAddr]);
                    await client.query("update payment_link_payments set beneficiary_address = $2 where beneficiary_address = $1", [oldAddr, newAddr]);
                    await client.query("update payment_link_payments set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);

                    // Add new cascade tables / columns
                    await client.query("update subscript_dms set sender_address = $2 where sender_address = $1", [oldAddr, newAddr]);
                    await client.query("update subscript_dms set receiver_address = $2 where receiver_address = $1", [oldAddr, newAddr]);
                    await client.query("update referrals set referrer_address = $2 where referrer_address = $1", [oldAddr, newAddr]);
                    await client.query("update referrals set referred_address = $2 where referred_address = $1", [oldAddr, newAddr]);
                    await client.query("update payroll_campaigns set organization_address = $2 where organization_address = $1", [oldAddr, newAddr]);
                    await client.query("update payroll_recipients set employee_wallet = $2 where employee_wallet = $1", [oldAddr, newAddr]);
                    await client.query("update vault_commit_intents set user_address = $2 where user_address = $1", [oldAddr, newAddr]);
                    await client.query("update vault_commit_intents set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);
                    await client.query("update promotion_redemptions set subscriber_address = $2 where subscriber_address = $1", [oldAddr, newAddr]);
                    await client.query("update fiat_funding_intents set wallet_address = $2 where wallet_address = $1", [oldAddr, newAddr]);
                    await client.query("update fiat_funding_intents set destination_wallet = $2 where destination_wallet = $1", [oldAddr, newAddr]);
                    await client.query("update merchant_reports set merchant_address = $2 where merchant_address = $1", [oldAddr, newAddr]);
                    await client.query("update merchant_reports set reporter_address = $2 where reporter_address = $1", [oldAddr, newAddr]);
                    await client.query("update push_subscriptions set wallet_address = $2 where wallet_address = $1", [oldAddr, newAddr]);

                    // Clean up old tables
                    await client.query("delete from merchants where wallet_address = $1", [oldAddr]);
                    await client.query("delete from customers where wallet_address = $1", [oldAddr]);
                    await client.query("delete from account_roles where address = $1", [oldAddr]);

                    await client.query("COMMIT");
                    log(`  Database updates committed successfully.`);
                    migratedCount++;
                } catch (e: any) {
                    await client.query("ROLLBACK");
                    log(`  Database update transaction failed: ${e.message}`);
                    continue;
                }
            } else {
                log(`  [Dry-run] Would execute database updates cascade.`);
                migratedCount++;
            }

            log(`Successfully migrated user wallet.`);
        }

        return { success: true, migratedCount, logs };
    } finally {
        await client.end();
    }
}
