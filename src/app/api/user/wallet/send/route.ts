import { NextResponse, after } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { getWalletCustody, deterministicIdempotencyKey } from "@/lib/custody";
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
        if (recipients.length === 0 || recipients.length > MAX_BATCH_RECIPIENTS) {
            return NextResponse.json(
                { error: `Provide between 1 and ${MAX_BATCH_RECIPIENTS} recipients` },
                { status: 400 },
            );
        }

        /* A delegated (sub-user) caller spends the *parent's* USDC, because the parent is the one
           who committed the funds — so the funding wallet, the custody that signs, and the
           self-send guard below all key off `fundingWallet`, never off the caller's own address.
           Root callers resolve to themselves and behave exactly as before. */
        const authority = await resolveSpendingAuthority(normalizedSender);
        const fundingWallet = authority.fundingWallet;
        try {
            /* This route is a user-wallet outflow. For delegated sends the parent funding wallet
               is the account whose funds leave the chain, so the hold is keyed to that wallet. */
            await assertWithdrawalAllowed(fundingWallet, "USER");
            /* The account holder's own brake, checked on the same wallet and for the same reason:
               the funding account is the one whose money leaves. A delegated send is covered twice
               over, because resolveSpendingAuthority above already refuses a halted parent — this
               is the gate that runs before any gas is reserved. */
            await assertAccountNotHalted(fundingWallet);
        } catch (holdError) {
            if (holdError instanceof WithdrawalHeldError) {
                return NextResponse.json({ error: holdError.message }, { status: holdError.status });
            }
            if (holdError instanceof AccountHaltError) {
                return NextResponse.json({ error: holdError.message }, { status: holdError.status });
            }
            throw holdError;
        }

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

        /* Block check: prevent transfers to or from any blocked accounts */
        for (const recipient of parsedRecipients) {
            await assertNotBlocked(fundingWallet, recipient.receiver, "sending funds");
        }

        // Spending limit enforcement (Finding 54)
        /* Keyed to the funding wallet: these are the limits the *owner of the money* set on their
           own outflow, so a delegated send must respect the parent's ceiling rather than the
           sub-user's. They are time-windowed and self-imposed; the commit cap reserved below is
           parent-imposed and cumulative. Both apply. */
        const spendingCustomer = await prisma.customer.findFirst({
            where: { walletAddress: fundingWallet },
            select: { spendingLimitDaily: true, spendingLimitWeekly: true, spendingLimitMonthly: true },
        });
        if (spendingCustomer) {
            const totalAmount = totalAmountMicros;
            if (spendingCustomer.spendingLimitDaily !== null && totalAmount > spendingCustomer.spendingLimitDaily) {
                return NextResponse.json({
                    error: "Transfer exceeds your daily spending limit.",
                    code: "SPENDING_LIMIT_EXCEEDED"
                }, { status: 403 });
            }
            if (spendingCustomer.spendingLimitWeekly !== null && totalAmount > spendingCustomer.spendingLimitWeekly) {
                return NextResponse.json({
                    error: "Transfer exceeds your weekly spending limit.",
                    code: "SPENDING_LIMIT_EXCEEDED"
                }, { status: 403 });
            }
            if (spendingCustomer.spendingLimitMonthly !== null && totalAmount > spendingCustomer.spendingLimitMonthly) {
                return NextResponse.json({
                    error: "Transfer exceeds your monthly spending limit.",
                    code: "SPENDING_LIMIT_EXCEEDED"
                }, { status: 403 });
            }
        }

        /* Reserve the delegation budget BEFORE anything moves. A cap checked after the transfer is
           not a cap, and recordSubUserSpend's conditional UPDATE is what serialises concurrent
           sub-user spends — two requests that each fit under the limit alone cannot both win.
           Whatever does not settle is released in the failure path below. */
        let reservedMicros = BigInt(0);
        if (authority.delegated) {
            const reservation = await recordSubUserSpend(authority.commitId, totalAmountMicros);
            if (!reservation.allowed) {
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

        /* Custody, key lookup and signing all follow the funding wallet: a delegated send is
           signed by the parent, whose USDC is actually moving. */
        const walletRecord = await withPgClient(async (client) => {
            const result = await client.query(
                `select encrypted_private_key, circle_wallet_id, provider
                   from user_embedded_wallets
                  where wallet_address = $1
                  limit 1`,
                [fundingWallet]
            );
            return result.rows[0] as EmbeddedWalletRecord | undefined;
        });

        if (!walletRecord?.encrypted_private_key && !walletRecord?.circle_wallet_id) {
            /* Nothing moved, so hand the whole reservation back — otherwise a parent with a
               browser-only wallet would burn a sub-user's allowance on every failed attempt. */
            if (authority.delegated && reservedMicros > BigInt(0)) {
                await releaseSubUserSpend(authority.commitId, reservedMicros);
                strandedReservation = null;
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
        let failure: { index: number; receiverAddress: string; amountUsdc: string; error: string } | null = null;
        /* Tracked per settled transfer rather than derived from `failure.index`, so the release
           below reflects what actually left the wallet even if the loop exits some other way. */
        let settledMicros = BigInt(0);
        for (let i = 0; i < parsedRecipients.length; i++) {
            const item = parsedRecipients[i];
            try {
                const { txHash } = await custody.executeContract({
                    contractAddress: USDC_NATIVE_GAS_ADDRESS,
                    abi: USDC_ERC20_ABI,
                    functionName: "transfer",
                    args: [item.receiver, item.amountMicros],
                    idempotencyKey: deterministicIdempotencyKey(
                        `wallet-send:${normalizedSender}:${requestId}:${item.receiver}:${item.amountMicros.toString()}`
                    ),
                });
                settledMicros += item.amountMicros;
                txs.push({
                    receiverAddress: item.receiver,
                    amountUsdc: formatAmount(item.amountMicros),
                    txHash,
                });
                settledForReceipts.push({ receiver: item.receiver, amountMicros: item.amountMicros, txHash });
            } catch (err: any) {
                failure = {
                    index: i,
                    receiverAddress: item.receiver,
                    amountUsdc: formatAmount(item.amountMicros),
                    error: err?.message || "Transfer failed",
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
            const unspent = reservedMicros - settledMicros;
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

        /*
         * Receipts for whatever actually settled, to both sides, whether the batch finished or
         * stopped early. Wallet-to-wallet sends were the last settlement path that mailed nobody:
         * the email audit's finding 2 named "peer-to-peer transfers" but pointed at the payment-link
         * worker, and P2P payment links were already covered there — this route is the real gap.
         *
         * Keyed per transaction, so retrying only the remaining recipients after a partial batch
         * never re-mails one that already settled. In after() because a transfer is irreversible
         * once mined and nothing about email may touch that path.
         */
        if (settledForReceipts.length > 0) {
            after(async () => {
                const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
                const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
                const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

                for (const settled of settledForReceipts) {
                    if (supabase) {
                        await bindTxToReceipt(supabase, {
                            txHash: settled.txHash,
                            payerAddress: normalizedSender,
                            merchantAddress: settled.receiver,
                            amountUsdc: settled.amountMicros,
                            title: "Wallet Transfer",
                        }).catch((err) => console.error("Failed to bind transfer receipt:", err));
                    }
                    await sendSettlementReceipts({
                        kind: "wallet_transfer",
                        amountUsdc: settled.amountMicros,
                        txHash: settled.txHash,
                        payerAddress: normalizedSender,
                        payeeAddress: settled.receiver,
                    });
                }
            });
        }

        if (failure) {
            const sent = txs.length;
            const total = parsedRecipients.length;
            return NextResponse.json({
                success: false,
                partial: sent > 0,
                transfers: txs,
                failedRecipient: failure,
                error: sent > 0
                    ? `Sent ${sent} of ${total} transfers, then recipient ${failure.index + 1} failed: ${failure.error}. The ${sent} completed transfer(s) were already settled on-chain — do not resend them; retry only the remaining recipients.`
                    : `Transfer to recipient ${failure.index + 1} failed: ${failure.error}`,
            }, { status: sent > 0 ? 207 : 400 });
        }

        return NextResponse.json({
            success: true,
            transfers: txs,
        }, { status: 200 });
    } catch (error: any) {
        /* A throw after the reservation but before the release path ran (a custody lookup that
           failed, for example) leaves budget stranded — the reservation debited the cap but nothing
           settled on-chain. Release exactly that amount; do not log the release failure itself into
           the catch's own error, since it is secondary and would only hide the original throw. */
        if (strandedReservation) {
            try {
                await releaseSubUserSpend(strandedReservation.commitId, strandedReservation.micros);
            } catch (releaseError) {
                console.error(
                    `Failed to release ${strandedReservation.micros} stranded micros for commit ${strandedReservation.commitId}:`,
                    releaseError,
                );
            }
        }
        console.error("Embedded wallet send failed:", error);
        if (error instanceof CommitAccessError) {
        if (error instanceof WithdrawalHeldError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        return NextResponse.json({ error: error.message || "Failed to send USDC" }, { status: 500 });
    }
}
