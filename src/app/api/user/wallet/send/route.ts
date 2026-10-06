import { NextResponse, after } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { getWalletCustody, getCircleTransactionStatus, deterministicIdempotencyKey, CirclePaymasterPolicyError } from "@/lib/custody";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { withPgClient } from "@/lib/serverPg";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { prisma } from "@/lib/prisma";
import {
    CommitAccessError,
    recordSubUserSpend,
    releaseSubUserSpend,
    resolveSpendingAuthority,
} from "@/lib/commitId";
import { sanitizeInput } from "@/utils/security";
import { assertWithdrawalAllowed, WithdrawalHeldError } from "@/lib/admin/withdrawalHolds";
import { assertAccountNotHalted, AccountHaltError } from "@/lib/accountHalt";
import { assertNotBlocked } from "@/lib/dms/blocks";
import { createClient } from "@supabase/supabase-js";
import { bindTxToReceipt } from "@/lib/receipts/binding";
import { MAX_BATCH_RECIPIENTS } from "@/lib/payments/batchLimits";
import { sendSettlementReceipts } from "@/lib/email/settlementReceipts";
import {
    checkAndReserveSpendingLimit,
    finalizeSpendingLimitOperation,
    releaseSpendingLimitOperation,
    retainSubmittedSpendingLimitOperation,
    bindSubmittedSpendingLimitOperation,
} from "@/lib/spendingLimits";
import {
    estimateArcNetworkFeeMicros,
    chargeNetworkFee,
    type ChargeNetworkFeeResult,
} from "@/lib/sponsor/userPaidTransfer";
import { readUsdcBalance, embeddedTransferReverted } from "@/lib/vault/onchain";

export const maxDuration = 120;

type SendRecipient = {
    receiverAddress: string;
    amountUsdc: unknown;
};

type EmbeddedWalletRecord = {
    encrypted_private_key: string | null;
    circle_wallet_id: string | null;
    provider: string | null;
};

function formatAmount(amountMicros: bigint) {
    const microsPerUsdc = BigInt(1_000_000);
    const whole = amountMicros / microsPerUsdc;
    const fraction = (amountMicros % microsPerUsdc).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

function serializeNetworkFee(result: ChargeNetworkFeeResult) {
    return {
        type: "ARC_NETWORK_FEE" as const,
        amountUsdc: formatAmount(result.feeMicros),
        amountMicros: result.feeMicros.toString(),
        txHash: result.feeTxHash || null,
        charged: result.charged,
        unrecovered: Boolean(result.unrecovered),
        recipientRole: "GAS_FEE_TREASURY" as const,
    };
}

function normalizeRecipients(body: any): SendRecipient[] {
    if (Array.isArray(body?.recipients)) {
        return body.recipients.map((item: any) => ({
            receiverAddress: item?.receiverAddress || item?.address,
            amountUsdc: item?.amountUsdc || item?.amount,
        }));
    }

    return [{
        receiverAddress: body?.receiverAddress,
        amountUsdc: body?.amountUsdc,
    }];
}

export async function POST(request: Request) {
    /* Hoisted above the try so the catch can hand back allowance that was reserved and then
       stranded by a throw between the debit and the transfer loop (a custody lookup that fails,
       for instance). Cleared once the in-band release path has settled the accounting. */
    let strandedReservation: { commitId: string; micros: bigint } | null = null;
    let spendingOperationId: string | null = null;
    let submissionMayHaveMovedFunds = false;
    let reusedSpendingOperation = false;

    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const requestId = request.headers.get("x-request-id");
        if (!requestId) {
            return NextResponse.json({ error: "x-request-id header is required for financial operations." }, { status: 400 });
        }

        const normalizedSender = wallet.toLowerCase();
        const recipients = normalizeRecipients(body);
        // Batch acceptance must not let the first confirmed leg stand in for the entire batch.
        let earlySubmission = Boolean(body?.earlySubmission) && recipients.length === 1;
        if (recipients.length === 0 || recipients.length > MAX_BATCH_RECIPIENTS) {
            return NextResponse.json(
                { error: `Provide between 1 and ${MAX_BATCH_RECIPIENTS} recipients` },
                { status: 400 },
            );
        }

        const requestStart = performance.now();
        const preflightStart = performance.now();

        /* A delegated (sub-user) caller spends the *parent's* USDC, because the parent is the one
           who committed the funds — so the funding wallet, the custody that signs, and the
           self-send guard below all key off `fundingWallet`, never off the caller's own address.
           Root callers resolve to themselves and behave exactly as before. */
        const authority = await resolveSpendingAuthority(normalizedSender);
        const fundingWallet = authority.fundingWallet;
        // The asynchronous operation ledger tracks the funding wallet's KYC reservation,
        // not the delegated allowance. Preserve synchronous accounting for delegated sends.
        if (authority.delegated) earlySubmission = false;

        const parsedRecipients = recipients.map((item, index) => {
            if (!item.receiverAddress || !ethers.isAddress(item.receiverAddress)) {
                throw new Error(`Recipient ${index + 1} has an invalid address`);
            }
            const receiver = item.receiverAddress.toLowerCase();
            /* Compared against the funding wallet, not the caller: for a delegated send the
               money leaves the parent's address, so that is the only self-transfer that is a
               no-op. A sub-user paying out to their own wallet is a legitimate draw against
               their allowance and stays capped like any other spend. */
            if (receiver === fundingWallet) {
                throw new Error(
                    authority.delegated
                        ? "You cannot send USDC back to the wallet funding your allowance."
                        : "You cannot send USDC to your own connected wallet."
                );
            }
            const amountMicros = parseUsdcToMicros(item.amountUsdc);
            if (amountMicros <= BigInt(0)) {
                throw new Error(`Recipient ${index + 1} has an invalid amount`);
            }
            return {
                receiver,
                amountMicros,
            };
        });

        const totalAmountMicros = parsedRecipients.reduce(
            (sum, r) => sum + r.amountMicros, BigInt(0)
        );

        /* Selective parallelization of independent preflight checks:
           1. Withdrawal hold check for funding wallet
           2. Account halt check for funding wallet
           3. Recipient block list checks
           4. Arc network fee estimation
           5. On-chain USDC balance query
           6. Embedded wallet record lookup in PostgreSQL
        */
        const [
            withdrawalAllowedResult,
            accountHaltedResult,
            blockedCheckResult,
            feeEstimate,
            onChainBalance,
            walletRecord,
        ] = await Promise.all([
            assertWithdrawalAllowed(fundingWallet, "USER").then(() => null).catch((err) => err),
            assertAccountNotHalted(fundingWallet).then(() => null).catch((err) => err),
            Promise.all(parsedRecipients.map((recipient) => assertNotBlocked(fundingWallet, recipient.receiver, "sending funds"))).then(() => null).catch((err) => err),
            estimateArcNetworkFeeMicros(parsedRecipients.length),
            readUsdcBalance(fundingWallet).catch(() => null),
            withPgClient(async (client) => {
                const result = await client.query(
                    `select encrypted_private_key, circle_wallet_id, provider
                       from user_embedded_wallets
                      where wallet_address = $1
                      limit 1`,
                    [fundingWallet]
                );
                return result.rows[0] as EmbeddedWalletRecord | undefined;
            }),
        ]);

        if (withdrawalAllowedResult) {
            if (withdrawalAllowedResult instanceof WithdrawalHeldError) {
                return NextResponse.json({ error: withdrawalAllowedResult.message }, { status: withdrawalAllowedResult.status });
            }
            throw withdrawalAllowedResult;
        }
        if (accountHaltedResult) {
            if (accountHaltedResult instanceof AccountHaltError) {
                return NextResponse.json({ error: accountHaltedResult.message }, { status: accountHaltedResult.status });
            }
            throw accountHaltedResult;
        }
        if (blockedCheckResult) {
            throw blockedCheckResult;
        }

        /* USER→USER sends are user-paid on Arc: estimate the network fee and require the wallet to
           hold the full amount PLUS that fee, so the recipient always receives the exact amount and
           the fee-recovery transfer after the loop cannot fail for lack of funds. No gas sponsorship
           is requested here — this outflow must never draw on the merchant-commerce budget. */
        if (onChainBalance !== null && onChainBalance < totalAmountMicros + feeEstimate.feeMicros) {
            const balStr = formatAmount(onChainBalance);
            const errorMsg = onChainBalance <= totalAmountMicros
                ? `You have just $${balStr}, send all-gas or top up your balance.`
                : `Insufficient balance. You have just $${balStr}, send all-gas or top up your balance.`;
            return NextResponse.json({
                error: errorMsg,
                code: "INSUFFICIENT_BALANCE_FOR_FEE",
            }, { status: 422 });
        }
        const preflightDurationMs = Math.round(performance.now() - preflightStart);

        const reservationStart = performance.now();
        // Tier-based cumulative spending limit enforcement
        /* Keyed to the funding wallet: limits are strictly derived from the account's KYC Tier.
           Cumulative outflows across rolling 24h, 7d, and 30d windows are checked and reserved
           atomically inside a PostgreSQL advisory-locked transaction. */
        spendingOperationId = null;
        const spendingReservation = await checkAndReserveSpendingLimit(
            fundingWallet,
            totalAmountMicros,
            parsedRecipients.length > 1 ? "BATCH_SEND" : "DIRECT_SEND",
            earlySubmission ? deterministicIdempotencyKey(
                `wallet-send:${normalizedSender}:${requestId}:${parsedRecipients[0].receiver}:${parsedRecipients[0].amountMicros.toString()}`
            ) : undefined,
        );
        if (!spendingReservation.allowed) {
            return NextResponse.json({
                error: spendingReservation.reason,
                code: spendingReservation.code || "SPENDING_LIMIT_EXCEEDED",
                tier: spendingReservation.tier,
                tierLabel: spendingReservation.tierLabel,
                limitPeriod: spendingReservation.limitPeriod,
                currentSpentUsdc: spendingReservation.currentSpentUsdc,
                limitUsdc: spendingReservation.limitUsdc,
                remainingUsdc: spendingReservation.remainingUsdc,
            }, { status: 403 });
        }
        spendingOperationId = spendingReservation.operationId || null;
        reusedSpendingOperation = Boolean(earlySubmission && spendingReservation.reused);
        // A replay may follow an accepted request. Local pre-submission failures on this
        // attempt cannot prove that the original attempt did not move funds.
        if (reusedSpendingOperation) submissionMayHaveMovedFunds = true;

        /* Reserve the delegation budget BEFORE anything moves. A cap checked after the transfer is
           not a cap, and recordSubUserSpend's conditional UPDATE is what serialises concurrent
           sub-user spends — two requests that each fit under the limit alone cannot both win.
           Whatever does not settle is released in the failure path below. */
        let reservedMicros = BigInt(0);
        if (authority.delegated) {
            const reservation = await recordSubUserSpend(authority.commitId, totalAmountMicros);
            if (!reservation.allowed) {
                /* The account-tier reservation is acquired first because it serializes all
                   outflows from the funding wallet. If the narrower delegated allowance then
                   rejects the request, nothing can settle and that first reservation must be
                   released immediately instead of consuming headroom for its 15-minute TTL. */
                if (spendingOperationId) {
                    await releaseSpendingLimitOperation(spendingOperationId);
                    spendingOperationId = null;
                }
                return NextResponse.json({
                    error: reservation.reason,
                    code: "COMMIT_LIMIT_EXCEEDED",
                    remainingUsdc: reservation.remainingUsdc === null
                        ? null
                        : formatAmount(reservation.remainingUsdc),
                }, { status: 403 });
            }
            reservedMicros = totalAmountMicros;
            strandedReservation = { commitId: authority.commitId, micros: reservedMicros };
        }
        const reservationDurationMs = Math.round(performance.now() - reservationStart);

        if (!walletRecord?.encrypted_private_key && !walletRecord?.circle_wallet_id) {
            /* Nothing moved, so hand the whole reservation back — otherwise a parent with a
               browser-only wallet would burn a sub-user's allowance on every failed attempt. */
            if (authority.delegated && reservedMicros > BigInt(0)) {
                await releaseSubUserSpend(authority.commitId, reservedMicros);
                strandedReservation = null;
            }
            if (spendingOperationId && !submissionMayHaveMovedFunds) {
                await releaseSpendingLimitOperation(spendingOperationId).catch(() => {});
                spendingOperationId = null;
            }
            return NextResponse.json({
                error: authority.delegated
                    ? "The wallet funding this allowance has no server-held key, so it cannot sign this transfer."
                    : "This action needs a browser wallet signature. Generated email wallets can send from here only when their server-held key exists.",
            }, { status: 409 });
        }

        // Execution goes through the custody provider (legacy AES key or Circle MPC), which
        // waits for each transfer to confirm and throws on revert.
        const custody = await getWalletCustody(fundingWallet);
        if (earlySubmission && spendingOperationId) {
            await retainSubmittedSpendingLimitOperation(spendingOperationId);
        }
        const txs: { receiverAddress: string; amountUsdc: string; txHash: string }[] = [];
        /* Kept beside `txs` rather than folded into it: `txs` is the response body, and a receipt
           needs the raw micros that formatAmount() has already rounded for display. */
        const settledForReceipts: Array<{ receiver: string; amountMicros: bigint; txHash: string }> = [];

        /* Transfers move funds, so each recipient gets a deterministic Circle idempotency key
           scoped to (request, recipient, amount). A client that reuses its x-request-id on
           retry dedupes at Circle instead of paying the same recipient twice. The index is
           intentionally excluded so that partial-batch retries (where indices shift) still
           dedupe correctly for already-settled recipients. */

        /* Transfers settle one-by-one and are irreversible once mined. If a later one fails we must
           NOT report a blanket failure — that hides the transfers already sent and invites a retry
           that double-pays them. Stop at the first failure and return exactly what settled. */
        let failure: { index: number; receiverAddress: string; amountUsdc: string; error: string; code?: string } | null = null;
        /* Tracked per settled transfer rather than derived from `failure.index`, so the release
           below reflects what actually left the wallet even if the loop exits some other way. */
        let settledMicros = BigInt(0);
        let totalSubmissionMs = 0;
        let totalConfirmationMs = 0;
        const circleTxIds: string[] = [];
        for (let i = 0; i < parsedRecipients.length; i++) {
            const item = parsedRecipients[i];
            try {
                if (earlySubmission) submissionMayHaveMovedFunds = true;
                /* USER→USER transfer: the sender pays Arc network gas via fee-recovery after the
                   batch settles. No requireSponsoredGas — this must never consume the merchant-
                   commerce sponsorship budget. gasPayer:"wallet" marks the call user-paid. */
                const execResult = await custody.executeContract({
                    contractAddress: USDC_NATIVE_GAS_ADDRESS,
                    abi: USDC_ERC20_ABI,
                    functionName: "transfer",
                    args: [item.receiver, item.amountMicros],
                    idempotencyKey: deterministicIdempotencyKey(
                        `wallet-send:${normalizedSender}:${requestId}:${item.receiver}:${item.amountMicros.toString()}`
                    ),
                    gasPayer: "wallet",
                    waitForConfirmation: !earlySubmission,
                });
                const { txHash } = execResult;
                if (earlySubmission && spendingOperationId && execResult.circleTxId) {
                    await bindSubmittedSpendingLimitOperation(spendingOperationId, execResult.circleTxId)
                        .catch((err) => console.error("Failed to bind submitted spending reservation:", err));
                }
                if (execResult.circleTxId) circleTxIds.push(execResult.circleTxId);
                if (execResult.submissionDurationMs) totalSubmissionMs += execResult.submissionDurationMs;
                if (execResult.confirmationDurationMs) totalConfirmationMs += execResult.confirmationDurationMs;

                /* An embedded (Circle SCA / ERC-4337) wallet mines its userOp inside an outer
                   transaction that reports success even when the inner USDC transfer reverts, so a
                   txHash on its own does not prove the recipient was credited. This throws only on
                   positive evidence of an inner revert; any ambiguity (plain EOA send, RPC hiccup)
                   falls through so a real transfer is never dropped. See embeddedTransferReverted. */
                if (txHash && await embeddedTransferReverted(txHash, fundingWallet)) {
                    throw new Error("The transfer was mined but its USDC transfer reverted on Arc, so the recipient was not credited. Please try again.");
                }
                settledMicros += item.amountMicros;
                txs.push({
                    receiverAddress: item.receiver,
                    amountUsdc: formatAmount(item.amountMicros),
                    txHash: txHash || "",
                });
                settledForReceipts.push({ receiver: item.receiver, amountMicros: item.amountMicros, txHash: txHash || "" });
            } catch (err: any) {
                // Circle rejects a missing paymaster policy before accepting a transaction.
                if (earlySubmission && !reusedSpendingOperation && err instanceof CirclePaymasterPolicyError) submissionMayHaveMovedFunds = false;
                failure = {
                    index: i,
                    receiverAddress: item.receiver,
                    amountUsdc: formatAmount(item.amountMicros),
                    error: earlySubmission && submissionMayHaveMovedFunds
                        ? "The submission outcome is uncertain. Your spending reservation is retained; do not resend until this operation is reconciled."
                        : err?.message || "Transfer failed",
                    code: err instanceof CirclePaymasterPolicyError ? err.code : undefined,
                };
                break;
            }
        }

        /* Give back exactly the budget that did not become an on-chain transfer. On a partial
           batch the settled prefix stays debited — that money is gone and the ledger must say so —
           while the untouched tail is released so a retry of the remaining recipients is not
           charged against the cap twice. A release failure must not mask a successful send, so it
           is logged rather than thrown: the ledger over-counts (fails safe, toward less spending)
           and the parent can re-cap. */
        if (authority.delegated) {
            const unspent = earlySubmission && submissionMayHaveMovedFunds ? 0n : reservedMicros - settledMicros;
            if (unspent > BigInt(0)) {
                try {
                    await releaseSubUserSpend(authority.commitId, unspent);
                } catch (releaseError) {
                    console.error(
                        `Failed to release ${unspent} unspent micros for commit ${authority.commitId}:`,
                        releaseError,
                    );
                }
            }
            /* The loop ran to completion, so the ledger now matches what settled either way.
               Anything the catch might otherwise release would double-credit the cap. */
            strandedReservation = null;
        }

        // Finalize or release spending limit reservation based on settled amount (only if not earlySubmission)
        if (spendingOperationId && (!earlySubmission || !submissionMayHaveMovedFunds)) {
            if (settledMicros > BigInt(0)) {
                await finalizeSpendingLimitOperation(spendingOperationId, settledMicros).catch((err) => {
                    console.error("Failed to finalize spending limit operation:", err);
                });
            } else {
                await releaseSpendingLimitOperation(spendingOperationId).catch((err) => {
                    console.error("Failed to release spending limit operation:", err);
                });
            }
            spendingOperationId = null;
        }

        /* Recover the Arc network fee from the sender for what actually settled — but AFTER the
           response returns (see the after() block below). It is pure post-settlement reconciliation
           (idempotent by request key, logged-never-thrown, and the sends are already irreversible),
           and waiting for its on-chain confirmation was a SECOND confirmation that doubled the time
           the user sat on the sending screen. We report the fee here as a pending estimate and charge
           it in the background. */
        let feeToChargeMicros = BigInt(0);
        if (txs.length > 0) {
            /* A partial batch is re-estimated for exactly the settled primary legs. Cap it at the
               full pre-confirmation quote so changing RPC conditions can never increase the charge
               after the user confirmed. */
            const applicableFeeMicros = txs.length === parsedRecipients.length
                ? feeEstimate.feeMicros
                : (await estimateArcNetworkFeeMicros(txs.length)).feeMicros;
            feeToChargeMicros = applicableFeeMicros > feeEstimate.feeMicros
                ? feeEstimate.feeMicros
                : applicableFeeMicros;
        }
        /* charged:false — the debit lands in after(); the client shows this as an estimate. */
        const networkFee = serializeNetworkFee({ charged: false, feeMicros: feeToChargeMicros });

        /*
         * Receipts for whatever actually settled, to both sides, whether the batch finished or
         * stopped early. In after() because a transfer is irreversible once mined and nothing about
         * email may touch that path.
         */
        if (settledForReceipts.length > 0 || (earlySubmission && circleTxIds.length > 0)) {
            after(async () => {
                let confirmedTxHash: string | undefined;
                if (earlySubmission && circleTxIds[0]) {
                    try {
                        const { getDevWalletsClient } = await import("@/lib/circle/devWallets");
                        const client = getDevWalletsClient();
                        const confirmed = await client.getTransaction({
                            id: circleTxIds[0],
                            waitForState: "CONFIRMED",
                            pollingInterval: 500,
                            signal: AbortSignal.timeout(110_000),
                        });
                        const status = await getCircleTransactionStatus(circleTxIds[0], fundingWallet);
                        if (status.status === "failed") {
                            if (spendingOperationId) await releaseSpendingLimitOperation(spendingOperationId).catch(console.error);
                            if (authority.delegated) await releaseSubUserSpend(authority.commitId, reservedMicros).catch(console.error);
                            return; // A reverted inner transfer must never charge a fee or receive a success receipt.
                        }
                        if (status.status !== "confirmed") return; // Unknown is still reserved, never a failure.
                        confirmedTxHash = status.txHash || confirmed?.data?.transaction?.txHash;
                    } catch (confirmErr) {
                        console.error("[WalletSend] Background confirmation error:", confirmErr);
                        // The SDK may reject either on a timeout or a terminal state; only live
                        // positive failure evidence permits releasing an accepted operation.
                        const status = await getCircleTransactionStatus(circleTxIds[0], fundingWallet);
                        if (status.status === "failed") {
                            if (spendingOperationId) await releaseSpendingLimitOperation(spendingOperationId).catch(console.error);
                            if (authority.delegated) await releaseSubUserSpend(authority.commitId, reservedMicros).catch(console.error);
                            return;
                        }
                        if (status.status !== "confirmed") return;
                        confirmedTxHash = status.txHash;
                    }
                }

                if (earlySubmission && spendingOperationId) {
                    if (confirmedTxHash) {
                        // getCircleTransactionStatus already verified the actual USDC leg.
                        await finalizeSpendingLimitOperation(spendingOperationId, settledMicros).catch(console.error);
                    } else return;
                    spendingOperationId = null;
                }

                /* Deferred fee recovery: idempotent by request key and never user-facing,
                   so it settles after the response instead of making the sender wait on a second
                   on-chain confirmation. Logged, never thrown — the primary sends are irreversible. */
                if (confirmedTxHash && txs[0] && !txs[0].txHash) {
                    txs[0].txHash = confirmedTxHash;
                }
                if (feeToChargeMicros > BigInt(0) && (!earlySubmission || confirmedTxHash)) {
                    await chargeNetworkFee({
                        wallet: fundingWallet,
                        feeMicros: feeToChargeMicros,
                        requestKey: `wallet-send-fee:${normalizedSender}:${requestId}`,
                        parentTransactionHashes: txs.map((tx) => tx.txHash).filter(Boolean),
                    }).catch((err) => console.error("Deferred Arc network fee recovery failed:", err));
                }
                const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
                const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
                const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

                const receiptsToBind = confirmedTxHash
                    ? [{ receiver: parsedRecipients[0].receiver, amountMicros: parsedRecipients[0].amountMicros, txHash: confirmedTxHash }]
                    : settledForReceipts.filter((s) => Boolean(s.txHash));

                for (const settled of receiptsToBind) {
                    if (supabase) {
                        await bindTxToReceipt(supabase, {
                            txHash: settled.txHash,
                            payerAddress: normalizedSender,
                            merchantAddress: settled.receiver,
                            amountUsdc: settled.amountMicros,
                            title: "Wallet Transfer",
                            sourceType: "WALLET_TRANSFER",
                        }).catch((err) => console.error("Failed to bind transfer receipt:", err));
                    }
                    await sendSettlementReceipts({
                        kind: "wallet_transfer",
                        amountUsdc: settled.amountMicros,
                        txHash: settled.txHash,
                        payerAddress: normalizedSender,
                        payeeAddress: settled.receiver,
                    }).catch((err) => console.error("Failed to send settlement receipts:", err));
                }
            });
        }

        const totalDurationMs = Math.round(performance.now() - requestStart);
        console.info(
            `[WalletSendTiming] sender=${normalizedSender} preflight=${preflightDurationMs}ms ` +
            `reservation=${reservationDurationMs}ms submission=${totalSubmissionMs}ms ` +
            `confirmation=${totalConfirmationMs}ms total=${totalDurationMs}ms`
        );

        if (failure) {
            const sent = txs.length;
            const total = parsedRecipients.length;
            const isPaymasterError = failure.code === "CIRCLE_PAYMASTER_POLICY_REQUIRED"
                || failure.error.includes("CIRCLE_PAYMASTER_POLICY_REQUIRED")
                || failure.error.includes("Circle Gas Station")
                || failure.error.includes("gas sponsorship");
            return NextResponse.json({
                success: false,
                status: earlySubmission && submissionMayHaveMovedFunds ? "pending" : "failed",
                partial: sent > 0,
                transfers: txs,
                networkFee,
                /* Backward-compatible amount field; new consumers must inspect charged/unrecovered. */
                networkFeeUsdc: networkFee.amountUsdc,
                failedRecipient: failure,
                code: isPaymasterError ? "CIRCLE_PAYMASTER_POLICY_REQUIRED" : failure.code,
                operationId: spendingOperationId || requestId,
                circleTxIds,
                timings: {
                    preflightMs: preflightDurationMs,
                    reservationMs: reservationDurationMs,
                    submissionMs: totalSubmissionMs,
                    confirmationMs: totalConfirmationMs,
                    totalMs: totalDurationMs,
                },
                error: earlySubmission && submissionMayHaveMovedFunds
                    ? failure.error
                    : sent > 0
                        ? `Sent ${sent} of ${total} transfers, then recipient ${failure.index + 1} failed: ${failure.error}. The ${sent} completed transfer(s) were already settled on-chain — do not resend them; retry only the remaining recipients.`
                        : `Transfer to recipient ${failure.index + 1} failed: ${failure.error}`,
            }, { status: sent > 0 ? 207 : (isPaymasterError ? 503 : 400) });
        }

        return NextResponse.json({
            success: true,
            accepted: true,
            status: earlySubmission ? "pending" : "confirmed",
            transfers: txs,
            networkFee,
            /* Backward-compatible amount field; new consumers must inspect charged/unrecovered. */
            networkFeeUsdc: networkFee.amountUsdc,
            operationId: spendingOperationId || requestId,
            circleTxId: circleTxIds[0] || null,
            circleTxIds,
            timings: {
                preflightMs: preflightDurationMs,
                reservationMs: reservationDurationMs,
                submissionMs: totalSubmissionMs,
                confirmationMs: totalConfirmationMs,
                totalMs: totalDurationMs,
            },
        }, { status: 200 });
    } catch (error: any) {
        /* A throw after the reservation but before the release path ran (a custody lookup that
           failed, for example) leaves budget stranded — the reservation debited the cap but nothing
           settled on-chain. Release exactly that amount; do not log the release failure itself into
           the catch's own error, since it is secondary and would only hide the original throw. */
        if (strandedReservation && !submissionMayHaveMovedFunds) {
            try {
                await releaseSubUserSpend(strandedReservation.commitId, strandedReservation.micros);
            } catch (releaseError) {
                console.error(
                    `Failed to release ${strandedReservation.micros} stranded micros for commit ${strandedReservation.commitId}:`,
                    releaseError,
                );
            }
        }
        if (spendingOperationId && !submissionMayHaveMovedFunds) {
            try {
                await releaseSpendingLimitOperation(spendingOperationId);
            } catch (releaseError) {
                console.error("Failed to release stranded spending limit operation:", releaseError);
            }
        }
        console.error("Embedded wallet send failed:", error);
        if (error instanceof WithdrawalHeldError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        if (error instanceof AccountHaltError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        if (error instanceof CirclePaymasterPolicyError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
        }
        return NextResponse.json({ error: error.message || "Failed to send USDC" }, { status: 500 });
    }
}
