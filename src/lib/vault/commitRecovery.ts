import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { getDevWalletsClient } from "@/lib/circle/devWallets";
import { SUBSCRIPT_VAULT_ADDRESS, SUBSCRIPT_VAULT_CHAIN_ID, ARC_MAINNET_CHAIN_ID } from "@/lib/contracts/constants";
import { readProvider, syncVaultMirror, submitVaultApproval, submitVaultCommit } from "./onchain";
import { confirmSettlementReceiptJob, recordSettlementReceiptSubmission, inspectSettlementReceipt } from "@/lib/payments/settlementReceiptRecovery";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";

export const COMMIT_ENVIRONMENT = SUBSCRIPT_VAULT_CHAIN_ID === ARC_MAINNET_CHAIN_ID ? "LIVE" : "TEST";
const committedEvent = new ethers.Interface([
    "event Committed(address indexed user,address indexed merchant,uint256 amount,uint256 balance,uint256 owedCleared,bool active)",
    "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
]);

/** Bounds observation, never cancels or reclassifies an accepted financial operation. */
export async function observeWithin<T>(work: Promise<T>, milliseconds: number): Promise<T | undefined> {
    let timer: NodeJS.Timeout | number | undefined;
    try {
        return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(resolve, milliseconds); })]);
    } finally { if (timer) clearTimeout(timer as any); }
}

export function isCurrentCommitNetwork(intent: { environment: string; chainId: bigint | null; contractAddress: string | null }) {
    return intent.environment === COMMIT_ENVIRONMENT && intent.chainId === BigInt(SUBSCRIPT_VAULT_CHAIN_ID)
        && intent.contractAddress === SUBSCRIPT_VAULT_ADDRESS.toLowerCase();
}

/** The exact vault event and USDC leg must agree; an outer SCA receipt is insufficient. */
export function inspectVaultCommit(intent: { userAddress: string; merchantAddress: string; amountUsdc: { toString(): string }; contractAddress: string | null }, receipt: Parameters<typeof inspectSettlementReceipt>[1]) {
    const transfer = inspectSettlementReceipt({ kind: "vault_topup", funding_wallet: intent.userAddress,
        payee_address: intent.merchantAddress, amount_usdc: intent.amountUsdc.toString(), contract_address: intent.contractAddress! }, receipt);
    if (transfer.state !== "confirmed") return transfer.state;
    for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== intent.contractAddress) continue;
        try {
            const event = committedEvent.parseLog({ topics: [...log.topics], data: log.data });
            if (event?.name === "Committed" && String(event.args.user).toLowerCase() === intent.userAddress
                && String(event.args.merchant).toLowerCase() === intent.merchantAddress
                && BigInt(event.args.amount) === BigInt(intent.amountUsdc.toString())) return "confirmed";
        } catch { /* Other vault events cannot prove this commit. */ }
    }
    return "pending";
}

async function ownedTransaction(providerId: string, wallet: string) {
    const owner = await pgMaybeOne<{ circle_wallet_id: string }>(
        "select circle_wallet_id from user_embedded_wallets where wallet_address=$1", [wallet]);
    const transaction = (await getDevWalletsClient().getTransaction({ id: providerId, signal: AbortSignal.timeout(3000) })).data?.transaction;
    if (!owner || !transaction || transaction.walletId !== owner.circle_wallet_id) throw new Error("COMMIT_PROVIDER_OWNER_UNVERIFIED");
    return transaction;
}

async function persistAcceptance(requestId: string, phase: "approval" | "commit", providerId: string) {
    const column = phase === "approval" ? "approval_provider_id" : "commit_provider_id";
    const timestamp = phase === "approval" ? "approval_submitted_at" : "submitted_at";
    // Column names are fixed above, never supplied by the caller.
    const rows = await pgQuery(`update vault_commit_intents set ${column}=$2,${timestamp}=coalesce(${timestamp},now()),updated_at=now()
        where request_id=$1 and status='PENDING' and (${column} is null or ${column}=$2) returning request_id`, [requestId, providerId]);
    if (!rows.length) {
        const intent = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
        if (!intent || (phase === "approval" ? intent.approvalProviderId : intent.commitProviderId) !== providerId) {
            throw new Error("COMMIT_ACCEPTANCE_IDENTITY_CONFLICT");
        }
    }
}

/** Read-only on the blockchain. Safe from authenticated GETs and independent scheduled recovery. */
export async function reconcileVaultCommitIntent(requestId: string, wallet?: string) {
    let intent = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
    if (!intent || (wallet && intent.userAddress !== wallet.toLowerCase())) return null;
    if (intent.status === "MIRRORED" || intent.status === "FAILED" || !isCurrentCommitNetwork(intent)) return intent;

    try {
        if (!intent.commitProviderId && !intent.txHash && intent.approvalProviderId && !intent.approvalConfirmedAt) {
            const approval = await ownedTransaction(intent.approvalProviderId, intent.userAddress);
            if (approval.txHash) {
                const receipt = await observeWithin(readProvider().getTransactionReceipt(approval.txHash), 3000);
                const innerReverted = receipt?.logs.some(log => {
                    try {
                        const event = committedEvent.parseLog({ topics: [...log.topics], data: log.data });
                        return event?.name === "UserOperationEvent" && String(event.args.sender).toLowerCase() === intent!.userAddress && event.args.success === false;
                    } catch { return false; }
                });
                if (receipt?.status === 0 || innerReverted) {
                    await prisma.vaultCommitIntent.updateMany({ where: { requestId, status: "PENDING", commitProviderId: null },
                        data: { status: "FAILED", lastError: "The allowance transaction reverted. No vault commit was submitted." } });
                } else if (receipt?.status === 1) {
                    // An allowance read is authoritative even for SCA inner-call failures.
                    const { readUsdcAllowance } = await import("./onchain");
                    const allowance = await observeWithin(readUsdcAllowance(intent.userAddress, intent.contractAddress!), 3000);
                    if (allowance !== undefined && allowance >= BigInt(intent.amountUsdc.toString())) {
                        await pgQuery("update vault_commit_intents set approval_confirmed_at=coalesce(approval_confirmed_at,now()),updated_at=now() where request_id=$1 and status='PENDING'", [requestId]);
                    }
                }
            } else if (["FAILED", "CANCELLED", "DENIED"].includes(String(approval.state))) {
                await prisma.vaultCommitIntent.updateMany({ where: { requestId, status: "PENDING", commitProviderId: null },
                    data: { status: "FAILED", lastError: "The allowance transaction was rejected. No vault commit was submitted." } });
            }
        }
        if (intent.commitProviderId || intent.txHash) {
            const transaction = intent.commitProviderId ? await ownedTransaction(intent.commitProviderId, intent.userAddress) : null;
            const hash = transaction?.txHash ?? intent.txHash;
            if (hash) {
                const receipt = await observeWithin(readProvider().getTransactionReceipt(hash), 3000);
                const outcome = receipt ? inspectVaultCommit(intent, receipt) : "pending";
                if (outcome === "failed") {
                    await prisma.vaultCommitIntent.updateMany({ where: { requestId, status: { in: ["PENDING", "SUBMITTED"] } },
                        data: { status: "FAILED", txHash: hash.toLowerCase(), lastError: "The vault commit reverted on chain." } });
                } else if (outcome === "confirmed") {
                    await pgQuery(`update vault_commit_intents set status='SUBMITTED',tx_hash=$2,
                        confirmed_at=coalesce(confirmed_at,now()),last_error=null,updated_at=now()
                        where request_id=$1 and status in ('PENDING','SUBMITTED')`, [requestId, hash.toLowerCase()]);
                    if (intent.receiptJobId) await confirmSettlementReceiptJob(intent.receiptJobId, hash);
                    const vault = await observeWithin(syncVaultMirror(intent.userAddress, intent.merchantAddress), 4000);
                    if (vault) {
                        await prisma.meteredVault.updateMany({ where: { userAddress: intent.userAddress, merchantAddress: intent.merchantAddress,
                            environment: intent.environment, settlementChainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID) },
                            data: { usageNotifiedBps: 0, cancelRequestedAt: null, cancelReason: null } });
                        if (vault.active) await prisma.subscriptDm.updateMany({ where: { senderAddress: intent.merchantAddress,
                            receiverAddress: intent.userAddress, messageType: { in: ["COMMIT_EXHAUSTED", "SERVICE_PAUSED"] }, status: "PENDING" }, data: { status: "DISMISSED" } });
                        await recordMerchantEvent({ merchantAddress: intent.merchantAddress, environment: COMMIT_ENVIRONMENT,
                            chainId: SUBSCRIPT_VAULT_CHAIN_ID, eventType: "vault.activated", resourceType: "vault",
                            resourceId: `${intent.userAddress}:${intent.merchantAddress}`, resourceVersion: 1,
                            data: { user_address: intent.userAddress, merchant_address: intent.merchantAddress,
                                amount_usdc_micros: intent.amountUsdc.toString(), vault_balance_usdc_micros: vault.balance.toString(), tx_hash: hash, active: vault.active },
                            correlationId: requestId, transitionKey: `vault_commit:${hash.toLowerCase()}` });
                        await pgQuery(`update vault_commit_intents set status='MIRRORED',mirrored_at=coalesce(mirrored_at,now()),updated_at=now()
                            where request_id=$1 and status='SUBMITTED'`, [requestId]);
                    }
                }
            } else if (transaction && ["FAILED", "CANCELLED", "DENIED"].includes(String(transaction.state))) {
                await prisma.vaultCommitIntent.updateMany({ where: { requestId, status: "PENDING" },
                    data: { status: "FAILED", lastError: "Circle rejected the commit before it reached chain." } });
            }
        }
    } catch (error) {
        // Observation errors never prove failure or release the durable operation identity.
        console.error("[vault-commit] reconciliation pending", requestId, error instanceof Error ? error.message : "unknown");
    }
    intent = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
    return intent;
}

/** Only called within a newly authorized POST. GET/cron never submit financial operations. */
export async function advanceAuthorizedVaultCommit(requestId: string) {
    let intent = await reconcileVaultCommitIntent(requestId);
    if (!intent || !isCurrentCommitNetwork(intent)) throw new Error("COMMIT_NETWORK_PROVENANCE_REQUIRED");
    if (intent.status !== "PENDING" || intent.commitProviderId) return intent;
    if (!intent.approvalProviderId) {
        const approval = await submitVaultApproval(intent.userAddress, BigInt(intent.amountUsdc.toString()), intent.custodyIdempotencyKey,
            id => persistAcceptance(requestId, "approval", id));
        if (approval) {
            if (!approval.circleTxId) throw new Error("COMMIT_APPROVAL_ID_MISSING");
            await persistAcceptance(requestId, "approval", approval.circleTxId);
            // A short observation window covers fast approvals without spending the route's
            // entire lifetime. Delayed approvals require explicit same-id PIN continuation.
            intent = await reconcileVaultCommitIntent(requestId);
            if (!intent?.approvalConfirmedAt || intent.status !== "PENDING") return intent;
        }
    } else if (!intent.approvalConfirmedAt) {
        return intent;
    }
    await pgQuery("update vault_commit_intents set submission_started_at=coalesce(submission_started_at,now()),updated_at=now() where request_id=$1 and status='PENDING'", [requestId]);
    const submitted = await submitVaultCommit(intent.userAddress, intent.merchantAddress, BigInt(intent.amountUsdc.toString()), intent.custodyIdempotencyKey,
        async id => {
            await persistAcceptance(requestId, "commit", id);
            if (intent!.receiptJobId) await recordSettlementReceiptSubmission(intent!.receiptJobId, id);
        });
    if (!submitted.circleTxId) throw new Error("COMMIT_PROVIDER_ID_MISSING");
    await persistAcceptance(requestId, "commit", submitted.circleTxId);
    if (intent.receiptJobId) await recordSettlementReceiptSubmission(intent.receiptJobId, submitted.circleTxId);
    return reconcileVaultCommitIntent(requestId);
}

export async function recoverVaultCommitIntents(limit = 5) {
    const intents = await prisma.vaultCommitIntent.findMany({ where: { environment: COMMIT_ENVIRONMENT,
        chainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID), contractAddress: SUBSCRIPT_VAULT_ADDRESS.toLowerCase(),
        status: { in: ["PENDING", "SUBMITTED"] }, OR: [{ commitProviderId: { not: null } }, { txHash: { not: null } }, { approvalProviderId: { not: null } }] },
        orderBy: { updatedAt: "asc" }, take: Math.min(Math.max(limit, 1), 5), select: { requestId: true } });
    let observed = 0;
    const deadline = Date.now() + 15_000;
    for (const intent of intents) {
        if (Date.now() >= deadline) break;
        await reconcileVaultCommitIntent(intent.requestId);
        observed++;
    }
    return { observed };
}

export function commitIntentOutcome(intent: NonNullable<Awaited<ReturnType<typeof reconcileVaultCommitIntent>>>) {
    return { exists: true, requestId: intent.requestId, status: intent.status, txHash: intent.txHash,
        merchantAddress: intent.merchantAddress, amountUsdc: intent.amountUsdc.toString(), lastError: intent.lastError,
        pending: intent.status === "PENDING", syncPending: intent.status === "SUBMITTED",
        resumeRequired: intent.status === "PENDING" && !intent.commitProviderId && !!intent.approvalConfirmedAt };
}
