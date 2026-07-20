import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ethers } from "ethers";
import { CONFIDENTIAL_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { CONFIDENTIAL_CONTRACT_ABI } from "@/lib/contracts/abis";
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { buildPermitSingle } from "@/lib/payroll/permit2";
import { revokePayrollAuthority } from "@/lib/payroll/authority";
import crypto from "crypto";

export const maxDuration = 300;

/* USDC address and Permit2 address constants */
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/* ABI for ERC20 USDC token. `transfer` is required by the distribution-failure refund path
   (usdcContract.transfer back to the org); without it the refund call throws at runtime. */
const ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transfer(address to, uint256 amount) external returns (bool)"
];

/* ABI for Permit2 allowance contract */
const PERMIT2_ABI = [
    "function allowance(address user, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
    "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes calldata signature) external",
    "function transferFrom(address from, address to, uint160 amount, address token) external"
];

function isAuthorized(request: Request) {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));
    
    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

export async function POST(request: Request) {
    const requestId = crypto.randomUUID();
    
    try {
        if (!process.env.KEEPER_SECRET && !process.env.CRON_SECRET) {
            return NextResponse.json(
                { error: "Configuration Error: KEEPER_SECRET or CRON_SECRET must be configured" },
                { status: 500 }
            );
        }
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        /* 2. Load admin private key and verify */
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json(
                { error: "Configuration Error: Keeper private key missing on server" },
                { status: 500 }
            );
        }

        /* Retry failed on-chain revocations durably before processing new paydays. */
        const pendingRevocations = await prisma.payrollCampaign.findMany({
            where: { status: "PAUSED", lastExecutionStatus: "AUTHORITY_REVOKE_REQUIRED" },
            take: 25,
        });
        for (const pending of pendingRevocations) {
            try {
                const revocationTxHash = await revokePayrollAuthority(pending.organizationAddress, pending.id);
                await prisma.payrollCampaign.update({
                    where: { id: pending.id },
                    data: {
                        permit2Signature: null, permit2Nonce: null, permit2Deadline: null, permit2Expiration: null,
                        lastExecutionStatus: "AUTHORITY_REVOKED", lastExecutionTxHash: revocationTxHash, lastExecutionError: null,
                    },
                });
            } catch (revocationError: any) {
                await prisma.payrollCampaign.update({
                    where: { id: pending.id },
                    data: { lastExecutionError: String(revocationError?.message || "Payroll authority revocation failed").slice(0, 4000) },
                });
            }
        }

        /* 3. Query all ACTIVE campaigns whose paydays are due (nextPayday <= NOW) */
        const now = new Date();
        const campaigns = await prisma.payrollCampaign.findMany({
            where: {
                status: "ACTIVE",
                nextPayday: {
                    lte: now
                }
            },
            include: {
                recipients: true
            },
            orderBy: { nextPayday: 'asc' },
            take: 5,
        });

        const executionResults: any[] = [];

        /* 4. Process each campaign */
        for (const campaign of campaigns) {
            let recoveryPending = false;
            try {
                const orgAddress = campaign.organizationAddress.toLowerCase();

                /* Verify organization's premium status in database */
                const merchant = await prisma.merchant.findUnique({
                    where: { walletAddress: orgAddress }
                });

                /* merchants.tier is the canonical text column ("FREE" | "PREMIUM") since migration
                   20260611; the legacy numeric "1" value was migrated to "PREMIUM" in 20260619. */
                const isPremium = merchant?.tier === "PREMIUM";

                if (!isPremium) {
                    /* Organization is not premium, skip execution and pause the campaign */
                    const revocationTxHash = await revokePayrollAuthority(orgAddress, campaign.id);
                    await prisma.payrollCampaign.update({
                        where: { id: campaign.id },
                        data: {
                            status: "PAUSED",
                            permit2Signature: null,
                            permit2Nonce: null,
                            permit2Deadline: null,
                            permit2Expiration: null,
                            lastExecutionStatus: "AUTHORITY_REVOKED",
                            lastExecutionTxHash: revocationTxHash,
                        }
                    });

                    /* Write audit event */
                    await prisma.auditEvent.create({
                        data: {
                            actor: "KEEPER_CRON",
                            action: "PAYROLL_CAMPAIGN_PAUSED_NON_PREMIUM",
                            resourceType: "PAYROLL_CAMPAIGN",
                            resourceId: campaign.id,
                            metadata: {
                                error: "Organization does not hold premium tier",
                                organization: orgAddress
                            }
                        }
                    });

                    executionResults.push({
                        campaignId: campaign.id,
                        status: "FAILED",
                        reason: "Organization does not hold premium tier. Campaign paused."
                    });
                    continue;
                }

                if (campaign.recipients.length === 0) {
                    executionResults.push({
                        campaignId: campaign.id,
                        status: "SKIPPED",
                        reason: "No recipients registered in this campaign."
                    });
                    continue;
                }

                /* Atomically lease this payday without advancing it. Advancing before money moves
                   makes a failed or ambiguous payout disappear from the due queue. */
                const nextPaydayDate = new Date(Date.now() + campaign.frequencyDays * 24 * 60 * 60 * 1000);
                const campaignClaimId = crypto.randomUUID();
                const recoveringThisPayday = campaign.lastExecutionPayday?.getTime() === campaign.nextPayday.getTime()
                    && ["PULL_SUBMITTED", "FUNDS_PULLED", "PAYOUT_SUBMITTED"].includes(campaign.lastExecutionStatus || "");
                const claim = await prisma.$queryRaw<Array<{ id: string }>>`
                    UPDATE public.payroll_campaigns
                       SET processing_claim_id = ${campaignClaimId}::uuid,
                           processing_started_at = now()
                     WHERE id = ${campaign.id}::uuid
                       AND status = 'ACTIVE'
                       AND next_payday = ${campaign.nextPayday}
                       AND (
                           processing_claim_id IS NULL
                           OR processing_started_at < now() - interval '30 minutes'
                       )
                    RETURNING id
                `;
                if (claim.length === 0) {
                    executionResults.push({
                        campaignId: campaign.id,
                        status: "SKIPPED",
                        reason: "Payday already claimed by another payroll run."
                    });
                    continue;
                }
                if (!recoveringThisPayday) {
                    await prisma.$executeRaw`
                        UPDATE public.payroll_campaigns
                           SET last_execution_payday = ${campaign.nextPayday},
                               last_pull_tx_hash = NULL,
                               last_payout_tx_hash = NULL,
                               last_execution_tx_hash = NULL,
                               last_execution_status = 'CLAIMED',
                               last_execution_error = NULL
                         WHERE id = ${campaign.id}::uuid
                           AND processing_claim_id = ${campaignClaimId}::uuid
                    `;
                }

                /* Calculate total payroll amount in micro-USDC (6 decimals) */
                let totalPayrollAmount = BigInt(0);
                const recipientAddresses: string[] = [];
                const recipientAmounts: bigint[] = [];

                for (const recipient of campaign.recipients) {
                    totalPayrollAmount += recipient.salaryAmountUsdc;
                    recipientAddresses.push(recipient.employeeWallet);
                    recipientAmounts.push(recipient.salaryAmountUsdc);
                }

                const { provider, rpcEndpoint } = await getRpcProviderForWrite();
                const wallet = new ethers.Wallet(adminPrivateKey, provider);
                const keeperAddress = wallet.address;

                const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet);
                const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
                const confidentialContract = new ethers.Contract(
                    CONFIDENTIAL_CONTRACT_ADDRESS,
                    CONFIDENTIAL_CONTRACT_ABI,
                    wallet
                );

                /* Recover an execution whose RPC wait timed out. The persisted hash is
                   authoritative: pending work is never re-submitted, a successful pull
                   skips transferFrom, and a successful payout advances the schedule once. */
                let fundsAlreadyPulled = recoveringThisPayday && campaign.lastExecutionStatus === "FUNDS_PULLED";
                if (recoveringThisPayday && campaign.lastExecutionStatus === "PULL_SUBMITTED" && campaign.lastPullTxHash) {
                    const pullReceipt = await provider.getTransactionReceipt(campaign.lastPullTxHash);
                    if (!pullReceipt) {
                        await prisma.$executeRaw`
                            UPDATE public.payroll_campaigns
                               SET processing_started_at = now(), last_execution_error = 'Pull transaction is still pending'
                             WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                        `;
                        executionResults.push({ campaignId: campaign.id, status: "PENDING", txHash: campaign.lastPullTxHash });
                        continue;
                    }
                    if (pullReceipt.status === 1) {
                        fundsAlreadyPulled = true;
                        await prisma.$executeRaw`
                            UPDATE public.payroll_campaigns SET last_execution_status = 'FUNDS_PULLED'
                             WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                        `;
                    }
                }
                if (recoveringThisPayday && campaign.lastExecutionStatus === "PAYOUT_SUBMITTED" && campaign.lastPayoutTxHash) {
                    const payoutReceipt = await provider.getTransactionReceipt(campaign.lastPayoutTxHash);
                    if (!payoutReceipt) {
                        await prisma.$executeRaw`
                            UPDATE public.payroll_campaigns
                               SET processing_started_at = now(), last_execution_error = 'Payout transaction is still pending'
                             WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                        `;
                        executionResults.push({ campaignId: campaign.id, status: "PENDING", txHash: campaign.lastPayoutTxHash });
                        continue;
                    }
                    if (payoutReceipt.status === 1) {
                        await prisma.$executeRaw`
                            UPDATE public.payroll_campaigns
                               SET next_payday = ${nextPaydayDate}, processing_claim_id = NULL,
                                   processing_started_at = NULL, permit2_signature = NULL,
                                   permit2_nonce = NULL, permit2_deadline = NULL, permit2_expiration = NULL,
                                   last_execution_tx_hash = ${campaign.lastPayoutTxHash},
                                   last_execution_status = 'SUCCEEDED', last_execution_error = NULL
                             WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                        `;
                        executionResults.push({ campaignId: campaign.id, status: "SUCCESS", txHash: campaign.lastPayoutTxHash, recovered: true });
                        continue;
                    }
                    /* A mined revert proves no distribution occurred. The previously pulled
                       payroll remains in the keeper and can be returned without double-spend. */
                    const refundTx = await usdcContract.transfer(orgAddress, totalPayrollAmount);
                    await refundTx.wait();
                    await prisma.$executeRaw`
                        UPDATE public.payroll_campaigns
                           SET status = 'PAUSED', processing_claim_id = NULL, processing_started_at = NULL,
                               last_execution_status = 'PAYOUT_REVERTED_REFUNDED',
                               last_execution_tx_hash = ${refundTx.hash},
                               last_execution_error = 'Recovered reverted payout and refunded organization'
                         WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                    `;
                    executionResults.push({ campaignId: campaign.id, status: "FAILED", refunded: true, txHash: refundTx.hash });
                    continue;
                }

                /* Step A: Check existing Permit2 allowance for the Keeper from the organization */
                const allowanceResult = fundsAlreadyPulled ? null : await permit2Contract.allowance(
                    orgAddress,
                    USDC_ADDRESS,
                    keeperAddress
                );

                const existingAllowanceAmount = allowanceResult ? BigInt(allowanceResult.amount.toString()) : totalPayrollAmount;
                const existingAllowanceExpiration = allowanceResult ? Number(allowanceResult.expiration) : Number.MAX_SAFE_INTEGER;
                const currentTimestamp = Math.floor(Date.now() / 1000);

                if (
                    existingAllowanceAmount < totalPayrollAmount ||
                    existingAllowanceExpiration < currentTimestamp
                ) {
                    /* Allowance is insufficient or expired. Submit the signed Permit2 authorization,
                       rebuilt from the shared module so it is byte-identical to what the merchant
                       signed (exact payday total + bounded expiration), using the persisted
                       on-chain nonce. Any drift would make the signature fail to verify. */
                    if (!campaign.permit2Signature || !campaign.permit2Expiration || !campaign.permit2Deadline) {
                        throw new Error("Insufficient Permit2 allowance and no permit2Signature is saved.");
                    }

                    const permitSingleStruct = buildPermitSingle(
                        USDC_ADDRESS,
                        keeperAddress,
                        campaign.permit2Nonce ?? 0,
                        totalPayrollAmount,
                        BigInt(Math.floor(campaign.permit2Expiration.getTime() / 1000)),
                        BigInt(Math.floor(campaign.permit2Deadline.getTime() / 1000)),
                    );

                    const permitTx = await permit2Contract.permit(
                        orgAddress,
                        permitSingleStruct,
                        campaign.permit2Signature
                    );
                    await permitTx.wait();
                }

                /* Step B: Pull USDC tokens from organization into Keeper wallet */
                if (!fundsAlreadyPulled) {
                    const transferTx = await permit2Contract.transferFrom(
                        orgAddress,
                        keeperAddress,
                        totalPayrollAmount,
                        USDC_ADDRESS
                    );
                    await prisma.$executeRaw`
                        UPDATE public.payroll_campaigns
                           SET last_pull_tx_hash = ${transferTx.hash}, last_execution_status = 'PULL_SUBMITTED'
                         WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                    `;
                    recoveryPending = true;
                    const pullReceipt = await transferTx.wait();
                    if (pullReceipt.status !== 1) throw new Error("Payroll pull transaction reverted.");
                    recoveryPending = false;
                    await prisma.$executeRaw`
                        UPDATE public.payroll_campaigns SET last_execution_status = 'FUNDS_PULLED'
                         WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                    `;
                }

                /* From here the org's full payroll is sitting in the keeper wallet. If the approval
                   or the batch distribution then fails, we MUST return those funds to the org —
                   otherwise a failed distribution strands the org's money in the keeper EOA (the
                   campaign is paused and the payday already advanced, so nothing retries it). Refund
                   on any post-pull failure, then rethrow so the outer handler still pauses + audits. */
                let batchTx: any;
                try {
                    /* Step C: Check and approve USDC allowance for Confidential contract if needed */
                    const contractAllowance = await usdcContract.allowance(
                        keeperAddress,
                        CONFIDENTIAL_CONTRACT_ADDRESS
                    );

                    /* Exact-match, not >=: a legacy MaxUint256 (or any larger) grant must be
                       downgraded to this payday's bounded amount, not left standing. Re-approving
                       to the exact total keeps the keeper's spend authority scoped per payout. */
                    if (BigInt(contractAllowance.toString()) !== totalPayrollAmount) {
                        const approveTx = await usdcContract.approve(
                            CONFIDENTIAL_CONTRACT_ADDRESS,
                            totalPayrollAmount
                        );
                        await approveTx.wait();
                    }

                    batchTx = await confidentialContract.executeBatchPayout(
                        recipientAddresses,
                        recipientAmounts,
                        campaign.isShielded,
                        ethers.ZeroHash
                    );

                    await prisma.$executeRaw`
                        UPDATE public.payroll_campaigns
                           SET last_payout_tx_hash = ${batchTx.hash}, last_execution_status = 'PAYOUT_SUBMITTED'
                         WHERE id = ${campaign.id}::uuid AND processing_claim_id = ${campaignClaimId}::uuid
                    `;
                    recoveryPending = true;

                    const receipt = await batchTx.wait();
                    if (receipt.status !== 1) {
                        throw new Error("On-chain batch payout transaction execution reverted.");
                    }
                    recoveryPending = false;
                } catch (distributionErr: any) {
                    /* A thrown wait() does NOT prove the payout failed: ethers v6 also throws on
                       TIMEOUT and TRANSACTION_REPLACED, where the batch may actually have settled or
                       still be pending. Refunding blindly could double-spend. So resolve the payout's
                       real on-chain state first and refund ONLY when we can confirm it did not move
                       funds (never submitted, or mined-and-reverted). */
                    const submittedHash: string | undefined =
                        batchTx?.hash || distributionErr?.replacement?.hash || distributionErr?.receipt?.hash;
                    let payoutSucceeded = false;
                    let payoutDefinitelyFailed = false;
                    if (!submittedHash) {
                        /* Failed before any payout tx was broadcast (e.g. the approve step) → the
                           pulled funds are still in the keeper, safe to refund. */
                        payoutDefinitelyFailed = true;
                    } else {
                        try {
                            const finalReceipt = await provider.getTransactionReceipt(submittedHash);
                            if (finalReceipt?.status === 1) payoutSucceeded = true;
                            else if (finalReceipt && finalReceipt.status === 0) payoutDefinitelyFailed = true;
                            /* finalReceipt == null → still pending/unknown → leave both false (ambiguous). */
                        } catch { /* provider read failed → treat as ambiguous */ }
                    }

                    if (payoutSucceeded) {
                        recoveryPending = false;
                        console.error(`[payroll-cron] campaign ${campaign.id} payout reported an error but settled on-chain (${submittedHash}); NOT refunding.`);
                    } else if (!payoutDefinitelyFailed) {
                        /* Unresolved (timeout/pending): refunding risks double-spending. Flag for a human. */
                        console.error(`[payroll-cron] CRITICAL: campaign ${campaign.id} payout is UNRESOLVED (${submittedHash || "no hash"}); NOT refunding to avoid double-spend. Manual review required.`);
                        await prisma.auditEvent.create({
                            data: {
                                actor: "KEEPER_CRON",
                                action: "PAYROLL_CAMPAIGN_PAYOUT_UNRESOLVED",
                                resourceType: "PAYROLL_CAMPAIGN",
                                resourceId: campaign.id,
                                metadata: {
                                    amountUsdc: totalPayrollAmount.toString(),
                                    organization: orgAddress,
                                    keeper: keeperAddress,
                                    payoutTxHash: submittedHash || null,
                                    distributionError: distributionErr?.message || "unknown",
                                },
                            },
                        }).catch(() => { /* audit is best-effort */ });
                        throw distributionErr;
                    } else {
                        recoveryPending = false;
                        /* Confirmed the payout did not move funds → the org's payroll is still in the
                           keeper, so return it. */
                        try {
                            const refundTx = await usdcContract.transfer(orgAddress, totalPayrollAmount);
                            await refundTx.wait();
                            console.error(`[payroll-cron] distribution failed for campaign ${campaign.id}; refunded ${totalPayrollAmount} USDC to org ${orgAddress}: ${refundTx.hash}`);
                            await prisma.auditEvent.create({
                                data: {
                                    actor: "KEEPER_CRON", action: "PAYROLL_CAMPAIGN_REFUNDED",
                                    resourceType: "PAYROLL_CAMPAIGN", resourceId: campaign.id,
                                    metadata: { refundedUsdc: totalPayrollAmount.toString(), organization: orgAddress, refundTxHash: refundTx.hash, reason: distributionErr?.message || "distribution failed" },
                                },
                            }).catch(() => { /* audit is best-effort */ });
                        } catch (refundErr: any) {
                            console.error(`[payroll-cron] CRITICAL: distribution AND refund failed for campaign ${campaign.id}; ${totalPayrollAmount} USDC stranded in keeper ${keeperAddress}:`, refundErr);
                            await prisma.auditEvent.create({
                                data: {
                                    actor: "KEEPER_CRON", action: "PAYROLL_CAMPAIGN_FUNDS_STRANDED",
                                    resourceType: "PAYROLL_CAMPAIGN", resourceId: campaign.id,
                                    metadata: { strandedUsdc: totalPayrollAmount.toString(), organization: orgAddress, keeper: keeperAddress, distributionError: distributionErr?.message || "unknown", refundError: refundErr?.message || "unknown" },
                                },
                            }).catch(() => { /* audit is best-effort */ });
                        }
                        throw distributionErr;
                    }
                }
                console.log(`[payroll-cron] submitted campaign ${campaign.id} through ${rpcEndpoint}: ${batchTx.hash}`);

                const txHash = batchTx.hash as string;

                /* Advance only after confirmed payout, release the lease, and consume the bounded
                   one-payday authorization. The next cycle requires a fresh merchant signature. */
                await prisma.$executeRaw`
                    UPDATE public.payroll_campaigns
                       SET next_payday = ${nextPaydayDate},
                           processing_claim_id = NULL,
                           processing_started_at = NULL,
                           permit2_signature = NULL,
                           permit2_nonce = NULL,
                           permit2_deadline = NULL,
                           permit2_expiration = NULL,
                           status = 'PAUSED',
                           last_execution_tx_hash = ${txHash},
                           last_execution_status = 'AWAITING_REAUTHORIZATION',
                           last_execution_error = NULL
                     WHERE id = ${campaign.id}::uuid
                       AND processing_claim_id = ${campaignClaimId}::uuid
                `;

                /* Write successful audit event */
                await prisma.auditEvent.create({
                    data: {
                        actor: "KEEPER_CRON",
                        action: "PAYROLL_CAMPAIGN_EXECUTED",
                        resourceType: "PAYROLL_CAMPAIGN",
                        resourceId: campaign.id,
                        metadata: {
                            txHash,
                            totalAmountUsdc: totalPayrollAmount.toString(),
                            recipientCount: recipientAddresses.length
                        }
                    }
                });

                executionResults.push({
                    campaignId: campaign.id,
                    status: "SUCCESS",
                    txHash,
                    totalAmountUsdc: totalPayrollAmount.toString()
                });

            } catch (campaignErr: any) {
                console.error(`[Payroll Cron] Failed to execute campaign ${campaign.id}:`, campaignErr);

                if (recoveryPending) {
                    /* The tx may still settle. Preserve the lease + stage/hash and let a
                       later run reconcile it instead of submitting another transfer. */
                    await prisma.$executeRaw`
                        UPDATE public.payroll_campaigns
                           SET processing_started_at = now(),
                               last_execution_error = left(${campaignErr.message || "Ambiguous transaction result"}, 4000)
                         WHERE id = ${campaign.id}::uuid
                    `;
                    executionResults.push({
                        campaignId: campaign.id,
                        status: "PENDING_RECONCILIATION",
                        reason: campaignErr.message || "Transaction result is ambiguous",
                    });
                    continue;
                }

                /* Pause the campaign on error to prevent infinite failing loops */
                let revocationTxHash: string | null = null;
                let revocationFailure: string | null = null;
                try {
                    revocationTxHash = await revokePayrollAuthority(campaign.organizationAddress, campaign.id);
                } catch (revocationErr: any) {
                    revocationFailure = String(revocationErr?.message || "Payroll authority revocation failed").slice(0, 4000);
                }
                await prisma.payrollCampaign.update({
                    where: { id: campaign.id },
                    data: {
                        status: "PAUSED",
                        permit2Signature: revocationFailure ? undefined : null,
                        permit2Nonce: revocationFailure ? undefined : null,
                        permit2Deadline: revocationFailure ? undefined : null,
                        permit2Expiration: revocationFailure ? undefined : null,
                    }
                });
                await prisma.$executeRaw`
                    UPDATE public.payroll_campaigns
                       SET processing_claim_id = NULL,
                           processing_started_at = NULL,
                           last_execution_status = ${revocationFailure ? "AUTHORITY_REVOKE_REQUIRED" : "FAILED_REVOKED"},
                           last_execution_tx_hash = COALESCE(${revocationTxHash}, last_execution_tx_hash),
                           last_execution_error = left(${revocationFailure || campaignErr.message || "Unknown execution error"}, 4000)
                     WHERE id = ${campaign.id}::uuid
                `;

                await prisma.auditEvent.create({
                    data: {
                        actor: "KEEPER_CRON",
                        action: "PAYROLL_CAMPAIGN_FAILED",
                        resourceType: "PAYROLL_CAMPAIGN",
                        resourceId: campaign.id,
                        metadata: {
                            error: campaignErr.message || "Unknown execution error"
                        }
                    }
                });

                executionResults.push({
                    campaignId: campaign.id,
                    status: "FAILED",
                    reason: campaignErr.message || "Unknown execution error"
                });
            }
        }

        return NextResponse.json({
            success: true,
            processed: executionResults.length,
            results: executionResults
        }, { status: 200 });

    } catch (err: any) {
        console.error("Cron payroll engine error:", err);
        return NextResponse.json(
            { error: err.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    return POST(request);
}
