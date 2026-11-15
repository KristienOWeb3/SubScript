/*
 * Orphaned checkout payment sweeper.
 *
 * Hosted checkout learns a transaction hash only when the payer's browser (or the custodial pay
 * route) calls /api/payment-links/verify. When that call never lands, the money has moved but
 * nothing on the server knows about it. That happens when:
 *   - the session expired
 *   - the per-IP rate limit was hit
 *   - the tab closed
 *   - the wallet threw after broadcasting
 *
 * This sweeper closes that gap from the chain side. It walks the SubScript Router's
 * DepositWithMemo logs forward from a persisted cursor. For each memo that is the receipt id of a
 * merchant checkout attempt with no bound transaction, it claims the settlement exactly as /verify
 * would. The durable verification job that claim queues is then settled by the reconcile drain.
 *
 * Why it is safe:
 *   - The memo is the attempt's unique receipt id, and the worker re-checks payer, merchant, amount
 *     and memo against the attempt's snapshots before anything settles.
 *   - claim_payment_link_settlement_durable late-binds RELEASED attempts (migration
 *     20261114170000), so a hold that was reaped while the payment was in flight still settles.
 *   - Every step is idempotent on the transaction hash. Overlapping keeper runs, or the payer's
 *     own late /verify call, converge on the same settlement.
 *
 * Peer requests are not swept. They settle as a plain USDC transfer with no memo, so a transfer
 * cannot be tied to an attempt from chain data alone.
 */

import { ROUTER_DEPOSIT_INTERFACE, isReceiptId } from "@/lib/arc/memo";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";
import { ProtocolConfig } from "./config";
import { executeWithRpcFallback } from "./rpc";

export const ORPHAN_SWEEPER_SCANNER = "orphaned-checkout-payments";
/* Arc RPC getLogs refuses ranges of 10k blocks or more. */
export const ORPHAN_SWEEP_CHUNK_BLOCKS = 9_000;
/* Bounds one keeper run. A long outage is caught up over consecutive runs, never skipped. */
export const ORPHAN_SWEEP_MAX_CHUNKS = 8;

export type OrphanedDeposit = {
    txHash: string;
    blockNumber: number;
    payer: string;
    merchant: string;
    amount: bigint;
    receiptId: string;
};

export type OrphanAttempt = {
    attempt_id: string;
    payment_link_id: string;
    payer_address: string;
    receipt_id: string;
    merchant_address_snapshot: string;
    amount_usdc_snapshot: number | string;
    settlement_chain_id: number | string;
    link_kind: string;
    status: string;
    tx_hash: string | null;
};

export type OrphanSweepResult = {
    fromBlock: number | null;
    toBlock: number | null;
    depositsSeen: number;
    recovered: string[];
    skipped: { receiptId: string; txHash: string; reason: string }[];
    errors: string[];
};

/*
 * Pure matching rule, exported for tests. A deposit recovers an attempt only when every bound
 * field agrees. Anything else is reported, never settled. The worker would reject it as a
 * PermanentVerificationError anyway, and claiming it would retake capacity for nothing.
 */
export function matchOrphanedDeposit(
    deposit: OrphanedDeposit,
    attempt: OrphanAttempt | undefined,
    chainId: number,
): { ok: true } | { ok: false; reason: string } {
    if (!attempt) return { ok: false, reason: "no attempt for receipt" };
    if (attempt.tx_hash) return { ok: false, reason: "attempt already bound" };
    if (attempt.link_kind !== "MERCHANT") return { ok: false, reason: "not a merchant checkout" };
    if (attempt.status !== "RESERVED" && attempt.status !== "RELEASED") {
        return { ok: false, reason: `attempt is ${attempt.status}` };
    }
    if (Number(attempt.settlement_chain_id) !== chainId) return { ok: false, reason: "chain mismatch" };
    if (attempt.payer_address.toLowerCase() !== deposit.payer.toLowerCase()) {
        return { ok: false, reason: "payer mismatch" };
    }
    if (attempt.merchant_address_snapshot.toLowerCase() !== deposit.merchant.toLowerCase()) {
        return { ok: false, reason: "merchant mismatch" };
    }
    if (BigInt(attempt.amount_usdc_snapshot) !== deposit.amount) return { ok: false, reason: "amount mismatch" };
    return { ok: true };
}

async function readCursor(supabase: any): Promise<number | null> {
    const { data, error } = await supabase
        .from("chain_scan_cursors")
        .select("last_block, chain_id")
        .eq("scanner", ORPHAN_SWEEPER_SCANNER)
        .maybeSingle();
    if (error) throw new Error(`Failed to read sweeper cursor: ${error.message}`);
    /* A cursor from another chain (testnet to mainnet cutover) is meaningless here. */
    if (!data || Number(data.chain_id) !== ProtocolConfig.CHAIN_ID) return null;
    return Number(data.last_block);
}

async function writeCursor(supabase: any, lastBlock: number) {
    const { error } = await supabase.from("chain_scan_cursors").upsert({
        scanner: ORPHAN_SWEEPER_SCANNER,
        chain_id: ProtocolConfig.CHAIN_ID,
        last_block: lastBlock,
        updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to advance sweeper cursor: ${error.message}`);
}

async function fetchDeposits(fromBlock: number, toBlock: number): Promise<OrphanedDeposit[]> {
    const { result: logs } = await executeWithRpcFallback((provider) => provider.getLogs({
        address: SUBSCRIPT_ROUTER_ADDRESS,
        fromBlock,
        toBlock,
        topics: [ROUTER_DEPOSIT_INTERFACE.getEvent("DepositWithMemo")!.topicHash],
    }));
    const deposits: OrphanedDeposit[] = [];
    for (const log of logs) {
        try {
            const parsed = ROUTER_DEPOSIT_INTERFACE.parseLog({ topics: log.topics as string[], data: log.data });
            if (!parsed || parsed.name !== "DepositWithMemo") continue;
            const memo = parsed.args.memo;
            if (!isReceiptId(memo)) continue;
            deposits.push({
                txHash: log.transactionHash.toLowerCase(),
                blockNumber: log.blockNumber,
                payer: String(parsed.args.payer).toLowerCase(),
                merchant: String(parsed.args.merchant).toLowerCase(),
                amount: BigInt(parsed.args.amount),
                receiptId: memo,
            });
        } catch {
            /* Not a deposit we can read. Nothing to recover from it. */
        }
    }
    return deposits;
}

async function recoverDeposit(supabase: any, deposit: OrphanedDeposit, attempt: OrphanAttempt) {
    const { data, error } = await supabase.rpc("claim_payment_link_settlement_durable", {
        p_execution_key: `verify-payment-link:${deposit.txHash}`,
        p_tx_hash: deposit.txHash,
        p_chain_id: ProtocolConfig.CHAIN_ID,
        p_payment_link_id: attempt.payment_link_id,
        p_payer_address: deposit.payer,
        p_receipt_id: attempt.receipt_id,
        p_expires_at: new Date(Date.now() + ProtocolConfig.IDEMPOTENCY_TTL * 1000).toISOString(),
        p_create_ledger: true,
        p_checkout_attempt_id: attempt.attempt_id,
        p_request_origin: null,
    });
    if (error) throw new Error(error.message);
    const outcome = data?.outcome;
    if (outcome !== "CLAIMED" && outcome !== "IN_PROGRESS" && outcome !== "COMPLETED") {
        throw new Error(`claim refused: ${outcome ?? "no outcome"}`);
    }
    /* The claim queued a durable verification job. The reconcile route drains jobs right after
       this sweep, so settlement is not run inline here: a worker pass polls for up to ~75s per
       hash and would eat the cron's time budget on a batch of recoveries. */
}

export async function sweepOrphanedCheckoutPayments(supabase: any): Promise<OrphanSweepResult> {
    const result: OrphanSweepResult = {
        fromBlock: null,
        toBlock: null,
        depositsSeen: 0,
        recovered: [],
        skipped: [],
        errors: [],
    };

    const { result: latest } = await executeWithRpcFallback((provider) => provider.getBlockNumber());
    /* Stay behind the head by the confirmation depth so a reorged deposit is never claimed. */
    const safeHead = latest - ProtocolConfig.MIN_CONFIRMATIONS;
    if (safeHead <= 0) return result;

    const cursor = await readCursor(supabase);
    let from = cursor === null ? Math.max(0, safeHead - ORPHAN_SWEEP_CHUNK_BLOCKS) : cursor + 1;
    if (from > safeHead) return result;
    result.fromBlock = from;

    for (let chunk = 0; chunk < ORPHAN_SWEEP_MAX_CHUNKS && from <= safeHead; chunk++) {
        const to = Math.min(from + ORPHAN_SWEEP_CHUNK_BLOCKS - 1, safeHead);
        const deposits = await fetchDeposits(from, to);
        result.depositsSeen += deposits.length;

        if (deposits.length > 0) {
            const { data: attempts, error } = await supabase
                .from("payment_link_checkout_attempts")
                .select("attempt_id, payment_link_id, payer_address, receipt_id, merchant_address_snapshot, amount_usdc_snapshot, settlement_chain_id, link_kind, status, tx_hash")
                .in("receipt_id", deposits.map((deposit) => deposit.receiptId));
            if (error) throw new Error(`Failed to read checkout attempts: ${error.message}`);
            const byReceipt = new Map<string, OrphanAttempt>(
                ((attempts || []) as OrphanAttempt[]).map((attempt) => [attempt.receipt_id, attempt]),
            );

            for (const deposit of deposits) {
                const attempt = byReceipt.get(deposit.receiptId);
                const match = matchOrphanedDeposit(deposit, attempt, ProtocolConfig.CHAIN_ID);
                if (!match.ok) {
                    /* "Already bound" is the normal case: /verify did its job. Only report the rest. */
                    if (match.reason !== "attempt already bound" && match.reason !== "no attempt for receipt") {
                        result.skipped.push({ receiptId: deposit.receiptId, txHash: deposit.txHash, reason: match.reason });
                    }
                    continue;
                }
                try {
                    await recoverDeposit(supabase, deposit, attempt!);
                    result.recovered.push(deposit.txHash);
                    console.warn(`[orphan-sweeper] Recovered unverified checkout payment ${deposit.txHash} (${deposit.receiptId})`);
                } catch (recoverError) {
                    const message = recoverError instanceof Error ? recoverError.message : String(recoverError);
                    /* A deterministic refusal will refuse again next run, so it must not pin the
                       cursor. It is reported for an operator instead. Only transient failures
                       (database or RPC) hold the cursor back for a retry. */
                    if (message.startsWith("claim refused")) {
                        result.skipped.push({ receiptId: deposit.receiptId, txHash: deposit.txHash, reason: message });
                    } else {
                        result.errors.push(`${deposit.txHash}: ${message}`);
                    }
                }
            }
        }

        /* Advance only past a fully processed chunk. A failed recovery is retried next run, so
           the cursor stays put when this chunk had errors. */
        if (result.errors.length > 0) break;
        await writeCursor(supabase, to);
        result.toBlock = to;
        from = to + 1;
    }

    return result;
}
