/* Server-side subscription actions on the standard contract, executed from the user's
   embedded wallet through the custody provider (legacy AES key or Circle MPC).
   createSubscription takes the first payment immediately (so the user must approve
   USDC first), mirroring the vault-commit approve+act pattern. */
import { ethers } from "ethers";
import { resolveArcRpcUrl } from "@/lib/network/registry";
import { getWalletCustody, cancelSubscriptionIdempotencyKey } from "@/lib/custody";
import { ensureUsdcAllowance } from "@/lib/vault/onchain";
import { STANDARD_CONTRACT_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { readSubscriptionPaidThrough } from "./entitlement";

const SUB_ABI = [
    "function createSubscription(address merchant, uint256 amount, uint256 period) returns (uint256)",
    "function createSubscriptionWithIntroductoryTerms(address merchant, uint256 amount, uint256 period, uint256 introductoryAmount, uint256 introductoryCycles) returns (uint256)",
    "function createSubscriptionWithDeferredFirstPayment(address merchant, uint256 amount, uint256 period, uint256 firstPayment) returns (uint256)",
    "function supportsDeferredSubscriptions() pure returns (bool)",
    "function supportsReplaceSubscriptions() pure returns (bool)",
    "function replaceSubscription(uint256 oldSubId, uint256 newAmount, uint256 newPeriod, uint256 chargeNow, uint256 firstPaymentAt, uint256 introCycles) returns (uint256)",
    "event SubscriptionReplaced(uint256 indexed oldSubId, uint256 indexed newSubId, uint256 chargeNow, uint256 firstPaymentAt)",
    "function paidThrough(uint256) view returns (uint256)",
    "function executionBitmaps(uint256,uint256) view returns (uint256)",
    "function cancelSubscription(uint256 subId)",
    "function modifySubscription(uint256 subId, uint256 newAmount, uint256 newPeriod)",
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive, address settlementToken, address paymentToken)",
    /* Public id counter. findActiveOnChainSubscriptionId enumerates the id space with this rather
       than querying SubscriptionCreated logs, which Arc's RPC rejects beyond a ~10k block span. */
    "function nextSubscriptionId() view returns (uint256)",
    "function introductoryTerms(uint256) view returns (uint256 amount, uint256 cycles)",
    "function chargeAmountFor(uint256 subId, uint256 sequenceId) view returns (uint256)",
    "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)",
];

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
];

function readProvider() {
    return new ethers.JsonRpcProvider(resolveArcRpcUrl(), undefined, { staticNetwork: true });
}

export type OnChainSubscription = {
    subscriber: string;
    merchant: string;
    amount: bigint;
    period: bigint;
    nextPayment: bigint;
    isActive: boolean;
};

/* Every read and write below takes an optional contract so a subscription minted by an older PSA
   (see legacySubscriptionContracts) is serviced on the contract that holds it. Omitted, it is the
   active deployment. */
export async function getSubscriptionOnChain(
    subId: string | bigint,
    contractAddress: string = STANDARD_CONTRACT_ADDRESS,
): Promise<OnChainSubscription | null> {
    try {
        const c = new ethers.Contract(contractAddress, SUB_ABI, readProvider());
        const s = await c.subscriptions(BigInt(subId));
        if (String(s.subscriber ?? s[0]).toLowerCase() === ethers.ZeroAddress) return null;
        return {
            subscriber: String(s.subscriber ?? s[0]).toLowerCase(),
            merchant: String(s.merchant ?? s[1]).toLowerCase(),
            amount: BigInt(s.amount ?? s[2]),
            period: BigInt(s.period ?? s[3]),
            nextPayment: BigInt(s.nextPayment ?? s[4]),
            isActive: Boolean(s.isActive ?? s[5]),
        };
    } catch {
        return null;
    }
}

export async function getSubscriptionPaidThrough(
    subId: string | bigint,
    terms: OnChainSubscription,
    contractAddress: string = STANDARD_CONTRACT_ADDRESS,
): Promise<bigint> {
    const c = new ethers.Contract(contractAddress, SUB_ABI, readProvider());
    return readSubscriptionPaidThrough(c as unknown as Parameters<typeof readSubscriptionPaidThrough>[0],
        BigInt(subId), terms, BigInt(Math.floor(Date.now() / 1000)));
}

export async function supportsDeferredSubscriptions(): Promise<boolean> {
    const c = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, readProvider());
    try {
        return Boolean(await c.supportsDeferredSubscriptions());
    } catch (error) {
        if ((error as { code?: string })?.code === "CALL_EXCEPTION") return false;
        throw error;
    }
}

/* PSA v3 capability: atomic cancel-and-create for plan changes. Older deployments revert on the
   probe, which reads as "not supported" so callers can fail closed. */
export async function supportsReplaceSubscriptions(): Promise<boolean> {
    const c = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, readProvider());
    try {
        return Boolean(await c.supportsReplaceSubscriptions());
    } catch (error) {
        if ((error as { code?: string })?.code === "CALL_EXCEPTION") return false;
        throw error;
    }
}

/**
 * Cash the chain charged (or will charge) for one billing sequence: the introductory amount while
 * a promotion lasts (sequence 0 is the signup payment), the regular amount after. Deployments that
 * predate chargeAmountFor had no introductory pricing, so they fall back to the flat amount. Any
 * other read failure throws, because guessing a paid value would misprice credit.
 */
export async function readChargeAmountFor(
    subId: string | bigint,
    sequence: bigint,
    fallbackAmount: bigint,
    contractAddress: string = STANDARD_CONTRACT_ADDRESS,
): Promise<bigint> {
    const c = new ethers.Contract(contractAddress, SUB_ABI, readProvider());
    try {
        return BigInt(await c.chargeAmountFor(BigInt(subId), sequence));
    } catch (error) {
        if ((error as { code?: string })?.code !== "CALL_EXCEPTION") throw error;
        return fallbackAmount;
    }
}

export type ReplaceTerms = {
    newAmount: bigint;
    newPeriod: bigint;
    /** > 0 charges now (upgrade). 0 defers the first charge to firstPaymentAt (downgrade). */
    chargeNow: bigint;
    firstPaymentAt: bigint;
    introCycles: bigint;
};

/** Contract arguments for a replace, shared by the custodial signer and the external-wallet path. */
export function replaceSubscriptionArgs(oldSubId: string | bigint, terms: ReplaceTerms) {
    return [BigInt(oldSubId), terms.newAmount, terms.newPeriod, terms.chargeNow, terms.firstPaymentAt, terms.introCycles] as const;
}

function replacedSubIdFrom(receipt: ethers.TransactionReceipt | null, oldSubId: string | bigint): string | null {
    const iface = new ethers.Interface(SUB_ABI);
    for (const log of receipt?.logs || []) {
        try {
            if (log.address.toLowerCase() !== STANDARD_CONTRACT_ADDRESS.toLowerCase()) continue;
            const parsed = iface.parseLog(log);
            if (parsed?.name === "SubscriptionReplaced" && BigInt(parsed.args.oldSubId) === BigInt(oldSubId)) {
                return parsed.args.newSubId.toString();
            }
        } catch {
            /* not our event */
        }
    }
    return null;
}

/**
 * Atomically replace a subscription from the embedded wallet: the old authorization is cancelled
 * and the new one created in ONE transaction, so there is no window where the subscriber holds
 * neither (the cancel-then-create gap) or both.
 */
export async function replaceFromEmbedded(
    walletAddress: string,
    oldSubId: string | bigint,
    terms: ReplaceTerms,
    idempotencyKey: string,
) {
    const custody = await getWalletCustody(walletAddress);
    await ensureUsdcAllowance(custody, STANDARD_CONTRACT_ADDRESS, horizonAllowance(terms.newAmount, terms.newPeriod));
    const { txHash } = await custody.executeContract({
        contractAddress: STANDARD_CONTRACT_ADDRESS,
        abi: SUB_ABI,
        functionName: "replaceSubscription",
        args: [...replaceSubscriptionArgs(oldSubId, terms)],
        idempotencyKey,
    });
    const receipt = await fetchReceipt(txHash);
    return { txHash, subId: replacedSubIdFrom(receipt, oldSubId) };
}

/**
 * Verify an externally signed replaceSubscription. It must have succeeded, been sent by the
 * subscriber to the standard contract, called replaceSubscription with exactly the quoted terms,
 * and emitted SubscriptionReplaced for this old subscription.
 */
export async function verifyExternalReplaceTx(input: {
    txHash: string;
    subscriber: string;
    oldSubId: string | bigint;
    terms: ReplaceTerms;
}): Promise<{ txHash: string; subId: string }> {
    const provider = readProvider();
    const [tx, receipt] = await Promise.all([
        provider.getTransaction(input.txHash),
        provider.getTransactionReceipt(input.txHash),
    ]);
    if (!tx || !receipt) throw new Error("Plan change transaction not found on-chain yet. Try again in a few seconds.");
    if (receipt.status !== 1) throw new Error("Plan change transaction reverted on-chain.");
    if ((tx.from || "").toLowerCase() !== input.subscriber.toLowerCase()) {
        throw new Error("Transaction sender does not match your wallet.");
    }
    if (!tx.to || tx.to.toLowerCase() !== STANDARD_CONTRACT_ADDRESS.toLowerCase()) {
        throw new Error("Transaction is not a SubScript plan change.");
    }
    const parsed = new ethers.Interface(SUB_ABI).parseTransaction({ data: tx.data, value: tx.value });
    const expected = replaceSubscriptionArgs(input.oldSubId, input.terms);
    if (parsed?.name !== "replaceSubscription" || expected.some((value, i) => BigInt(parsed.args[i]) !== value)) {
        throw new Error("This transaction does not match the quoted plan change.");
    }
    const subId = replacedSubIdFrom(receipt, input.oldSubId);
    if (!subId) throw new Error("The plan change did not emit the expected replacement event.");
    return { txHash: input.txHash, subId };
}

/* Introductory terms recorded on-chain at creation (cycles = 0 => none). Used by the
   recovery paths to rebuild the subscription's promo snapshot from the authoritative
   source when the original request context is gone. Null on RPC error. */
export async function getIntroductoryTermsOnChain(
    subId: string | bigint,
    contractAddress: string = STANDARD_CONTRACT_ADDRESS,
): Promise<{ introAmountUsdc: bigint; introCycles: number } | null> {
    try {
        const c = new ethers.Contract(contractAddress, SUB_ABI, readProvider());
        const terms = await c.introductoryTerms(BigInt(subId));
        const cycles = Number(terms.cycles ?? terms[1]);
        if (!Number.isFinite(cycles) || cycles <= 0) return null;
        return { introAmountUsdc: BigInt(terms.amount ?? terms[0]), introCycles: cycles };
    } catch {
        /* Older deployed contract without introductoryTerms, or transient RPC error. */
        return null;
    }
}

/**
 * What the signup transaction charged, read back from the chain, plus whether the subscription
 * is still in that first period. For the recovery paths, whose original request (and with it
 * the applied promotion) is gone and must not be guessed.
 *
 * - amount: chargeAmountFor(subId, 0) — the PSA defines sequence 0 as the signup payment and
 *   returns the introductory amount when one applied (0 for a free trial). Contracts that
 *   predate chargeAmountFor fall back to the flat amount, which is what they charged.
 * - firstPeriod: nextPayment never moves after creation, while paid-through advances with each
 *   renewal, so the two are equal only until the first renewal settles. (A canceled subscription
 *   still answers, so a retry after a fast cancel still gets its receipt.)
 *
 * Null on any read failure: no receipt beats a receipt with a guessed amount.
 */
export async function getSignupChargeOnChain(
    subId: string | bigint,
): Promise<{ amount: bigint; firstPeriod: boolean } | null> {
    try {
        const c = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, readProvider());
        const id = BigInt(subId);
        const s = await c.subscriptions(id);
        if (String(s.subscriber ?? s[0]).toLowerCase() === ethers.ZeroAddress) return null;
        const nextPayment = BigInt(s.nextPayment ?? s[4]);
        const period = BigInt(s.period ?? s[3]);
        let amount = BigInt(s.amount ?? s[2]);
        try {
            amount = BigInt(await c.chargeAmountFor(id, 0));
        } catch (error) {
            if ((error as { code?: string })?.code !== "CALL_EXCEPTION") throw error;
        }
        /* Not c.paidThrough directly: the live mainnet PSA predates that getter and reverts on it.
           readSubscriptionPaidThrough falls back to the execution bitmap, which every deployment has. */
        const paidThrough = await readSubscriptionPaidThrough(
            c as unknown as Parameters<typeof readSubscriptionPaidThrough>[0],
            id,
            { nextPayment, period },
            BigInt(Math.floor(Date.now() / 1000)),
        );
        return { amount, firstPeriod: paidThrough === nextPayment };
    } catch {
        return null;
    }
}

/* Belt-and-suspenders for the double-subscribe guard. The DB advisory-lock + mirror check in
   the subscribe route only sees subscriptions we ourselves mirrored; a sub that exists on-chain
   but was never mirrored (e.g. legacy, or a failed mirror write) would slip past it. This scans
   the chain directly and returns the id of the first still-active one.

   Fails CLOSED. It used to return null on any RPC error or when it hit the scan cap, and null
   reads as "no active subscription" — so a flaky RPC was exactly the moment the guard waved a
   second paid subscription through. It now throws ActiveSubscriptionScanUnavailableError
   whenever it cannot prove the answer. Callers that only use it to recover a missing id (and
   treat "none" as "keep reconciling") catch that error and carry on; the pre-charge guard in
   the subscribe route lets it refuse the charge. */
export class ActiveSubscriptionScanUnavailableError extends Error {
    readonly code = "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE";
    constructor(message: string) {
        super(message);
        this.name = "ActiveSubscriptionScanUnavailableError";
    }
}

export function isActiveSubscriptionScanUnavailable(error: unknown): error is ActiveSubscriptionScanUnavailableError {
    return (error as { code?: string } | null)?.code === "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE";
}

/* Recovery-path wrapper: "couldn't tell" collapses to "not found yet", which those paths already
   handle by staying in RECONCILIATION_PENDING. Never use this as a guard before a charge. */
export async function findActiveOnChainSubscriptionIdOrNull(
    subscriber: string,
    merchant: string,
): Promise<string | null> {
    try {
        return await findActiveOnChainSubscriptionId(subscriber, merchant);
    } catch (err) {
        if (isActiveSubscriptionScanUnavailable(err)) return null;
        throw err;
    }
}

/* How many ids to walk back from the head of the counter before giving up.
   The PSA is redeployed rather than upgraded, so each deployment's id space starts at 1 and stays
   small. The cap only exists so a mature deployment cannot turn this into an unbounded scan; when it
   is hit the miss is logged rather than passed off as "no subscription". */
const MAX_SUBSCRIPTION_ID_SCAN = 1_000;

/**
 * The subscriber's currently-active subscription id with `merchant`, or null.
 *
 * Walks the id counter downwards instead of querying logs. The log-based version asked for
 * `SubscriptionCreated` over block 0 -> latest, which Arc's RPC refuses outright:
 *
 *   request exceeded max allowed range: query exceeds max block range 100000
 *
 * and the catch below turned that into a silent `null`, so both recovery paths built on this never
 * worked — `subscribeFromEmbedded`'s subId fallback for when receipt logs lag, and the mirror
 * self-heal in /api/user/subscriptions. Chunking the range is not a fix either: the real ceiling
 * measured against Arc is under 90k blocks with ~10k reliable, and the chain is already past block
 * 58,000,000, so covering any useful history costs hundreds of requests and trips rate limits.
 *
 * `nextSubscriptionId` is public, so the id space is directly enumerable and `subscriptions(id)` is a
 * plain view call — no block ranges, no log limits, and cheap at these id counts. Descending because
 * a subscriber who has resubscribed has older ids for the same pair that are now inactive; the newest
 * live one is the answer, and stopping there avoids reading the dead ones at all.
 */
export async function findActiveOnChainSubscriptionId(
    subscriber: string,
    merchant: string,
    contract: { nextSubscriptionId(): Promise<unknown>; subscriptions(id: bigint): Promise<any> } =
        new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, readProvider()) as any,
): Promise<string | null> {
    const sub = subscriber.toLowerCase();
    const merch = merchant.toLowerCase();

    let highest: bigint;
    try {
        highest = BigInt(await contract.nextSubscriptionId() as bigint) - BigInt(1);
    } catch (err) {
        console.error("[onchain] active-sub scan failed:", err instanceof Error ? err.message : err);
        throw new ActiveSubscriptionScanUnavailableError("Could not read the subscription counter on-chain.");
    }
    const floor = highest > BigInt(MAX_SUBSCRIPTION_ID_SCAN)
        ? highest - BigInt(MAX_SUBSCRIPTION_ID_SCAN) + BigInt(1)
        : BigInt(1);

    for (let id = highest; id >= floor; id--) {
        let s: any;
        try {
            s = await contract.subscriptions(id);
        } catch (err) {
            /* A skipped id could be the live one, so one failed read makes the whole answer unknown. */
            console.error(`[onchain] active-sub scan failed at id ${id}:`, err instanceof Error ? err.message : err);
            throw new ActiveSubscriptionScanUnavailableError(`Could not read subscription ${id} on-chain.`);
        }
        if (
            Boolean(s[5])
            && String(s[0]).toLowerCase() === sub
            && String(s[1]).toLowerCase() === merch
        ) {
            return id.toString();
        }
    }

    if (floor > BigInt(1)) {
        /* Ids below the floor were never read. A live subscription could be among them, so this is
           "don't know", not "none". */
        console.warn(
            `[onchain] active-sub scan stopped at id ${floor} of ${highest} without a match for `
            + `${sub}/${merch} — raise MAX_SUBSCRIPTION_ID_SCAN if this deployment has outgrown it.`,
        );
        throw new ActiveSubscriptionScanUnavailableError(
            `Scanned ${MAX_SUBSCRIPTION_ID_SCAN} subscription ids without reaching the start of the contract.`,
        );
    }
    return null;
}

/* How many billing cycles of allowance to authorize up front. createSubscription only
   needs one period for the first charge, but the keeper debits each cycle against this
   same allowance (see cron/billing), so approving one period means the sub dies after
   one cycle. Approve ~1 year of cycles so recurring billing keeps working. */
export function horizonAllowance(amount: bigint, period: bigint): bigint {
    const seconds = Number(period);
    const cyclesPerYear = Number.isFinite(seconds) && seconds > 0
        ? Math.max(1, Math.round((365.25 * 24 * 60 * 60) / seconds))
        : 1;
    return amount * BigInt(cyclesPerYear);
}

/* The custody provider has already waited for the transaction to confirm, so the receipt
   is normally available on the first read — the retries only cover read-endpoint lag. */
async function fetchReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
    const provider = readProvider();
    for (let attempt = 0; attempt < 30; attempt++) {
        const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
        if (receipt) return receipt;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
}

/* createSubscription takes the first payment immediately, so a retry after a timed-out response
   must not double-submit. The caller passes an idempotencyKey scoped to the logical attempt (the
   single-use checkout session, or the client's reusable request id) — NEVER derived from just the
   subscriber+merchant relationship, since a user who cancels and later re-subscribes is a
   legitimately distinct create and a relationship key would make Circle return the old
   (cancelled) transaction. The subscribe route's DB advisory-lock + on-chain active-sub scan
   guard against duplicate active subs on top of this. */
export async function subscribeFromEmbedded(
    walletAddress: string,
    merchant: string,
    amount: bigint,
    period: bigint,
    idempotencyKey?: string,
    /* Introductory terms the subscriber is authorizing alongside the regular price.
       `introAmountUsdc` (0 = free trial) applies for `introCycles` billing sequences,
       then `amount` applies forever — both enforced by the contract per sequence. */
    introTerms?: { introAmountUsdc: bigint; introCycles: number } | null,
    options?: {
        /* Period to size the USDC allowance against, when it differs from the authorization's own
           period. A resume bridge's period is only the time left on an already-paid period, so
           sizing off it would scale cycles-per-year up and approve a far larger ceiling than the
           subscription will ever draw. Pass the plan's period instead. */
        allowancePeriodSeconds?: bigint;
        firstPaymentSeconds?: bigint;
    },
) {
    if (options?.firstPaymentSeconds && !await supportsDeferredSubscriptions()) {
        throw new Error("The active subscription contract needs the deferred-renewal deployment before resume is available.");
    }
    const custody = await getWalletCustody(walletAddress);
    /* Allowance is sized on the REGULAR amount: intro charges are strictly lower, and the
       keeper needs headroom for full-price renewals after the promotion ends. */
    await ensureUsdcAllowance(
        custody,
        STANDARD_CONTRACT_ADDRESS,
        horizonAllowance(amount, options?.allowancePeriodSeconds ?? period),
    );
    const { txHash } = await custody.executeContract({
        contractAddress: STANDARD_CONTRACT_ADDRESS,
        abi: SUB_ABI,
        functionName: options?.firstPaymentSeconds ? "createSubscriptionWithDeferredFirstPayment"
            : introTerms ? "createSubscriptionWithIntroductoryTerms" : "createSubscription",
        args: options?.firstPaymentSeconds
            ? [merchant.toLowerCase(), amount, period, options.firstPaymentSeconds]
            : introTerms
            ? [merchant.toLowerCase(), amount, period, introTerms.introAmountUsdc, BigInt(introTerms.introCycles)]
            : [merchant.toLowerCase(), amount, period],
        ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    /* Recover the new subId from the SubscriptionCreated event in the receipt. */
    const receipt = await fetchReceipt(txHash);
    const iface = new ethers.Interface(SUB_ABI);
    let subId: string | null = null;
    for (const log of receipt?.logs || []) {
        try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "SubscriptionCreated") {
                subId = parsed.args.subId.toString();
                break;
            }
        } catch {
            /* not our event */
        }
    }
    if (!subId) {
        /* Some RPC providers lag on receipt logs even after Circle reports confirmation. Recover
           from the indexed on-chain event before returning; a missing id must never be presented
           as a completed subscription because the mirror and merchant fulfillment need it. */
        for (let attempt = 0; attempt < 5 && !subId; attempt++) {
            subId = await findActiveOnChainSubscriptionIdOrNull(walletAddress, merchant);
            if (!subId) await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    return { txHash, subId };
}

/**
 * Verify an externally-signed createSubscription tx (external/connected wallet path). Confirms the
 * tx succeeded, was sent by `subscriber`, targeted the standard contract, and emitted a
 * SubscriptionCreated event whose subscriber/merchant/amount/period match the plan. Returns the
 * on-chain subId so the caller can mirror it. Throws a user-facing error otherwise.
 */
export async function verifyExternalSubscriptionTx(input: {
    txHash: string;
    subscriber: string;
    merchant: string;
    amount: bigint;
    period: bigint;
}): Promise<{ txHash: string; subId: string }> {
    const provider = readProvider();
    const [tx, receipt] = await Promise.all([
        provider.getTransaction(input.txHash),
        provider.getTransactionReceipt(input.txHash),
    ]);
    if (!tx || !receipt) {
        throw new Error("Subscription transaction not found on-chain yet. Try again in a few seconds.");
    }
    if (receipt.status !== 1) {
        throw new Error("Subscription transaction reverted on-chain.");
    }
    if ((tx.from || "").toLowerCase() !== input.subscriber.toLowerCase()) {
        throw new Error("Transaction sender does not match your wallet.");
    }
    if (!tx.to || tx.to.toLowerCase() !== STANDARD_CONTRACT_ADDRESS.toLowerCase()) {
        throw new Error("Transaction is not a SubScript subscription.");
    }

    const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, SUB_ABI, provider);
    for (const log of receipt.logs) {
        try {
            if (log.address.toLowerCase() !== STANDARD_CONTRACT_ADDRESS.toLowerCase()) continue;
            const parsed = contract.interface.parseLog(log);
            if (
                parsed?.name === "SubscriptionCreated"
                && String(parsed.args.subscriber).toLowerCase() === input.subscriber.toLowerCase()
                && String(parsed.args.merchant).toLowerCase() === input.merchant.toLowerCase()
                && BigInt(parsed.args.amount) === input.amount
                && BigInt(parsed.args.period) === input.period
            ) {
                return { txHash: input.txHash, subId: parsed.args.subId.toString() };
            }
        } catch {
            /* not our event */
        }
    }
    throw new Error("This transaction does not match the selected plan (merchant, amount, or period differ).");
}

export async function verifyExternalDeferredSubscriptionTx(input: {
    txHash: string; subscriber: string; merchant: string; amount: bigint; period: bigint;
    firstPaymentSeconds: bigint;
}): Promise<{ txHash: string; subId: string }> {
    const verified = await verifyExternalSubscriptionTx(input);
    const provider = readProvider();
    const tx = await provider.getTransaction(input.txHash);
    const iface = new ethers.Interface(SUB_ABI);
    const parsed = tx ? iface.parseTransaction({ data: tx.data, value: tx.value }) : null;
    if (parsed?.name !== "createSubscriptionWithDeferredFirstPayment"
        || BigInt(parsed.args[3]) !== input.firstPaymentSeconds) {
        throw new Error("The resume transaction does not match the authorized first-charge date.");
    }
    const created = await getSubscriptionOnChain(verified.subId);
    if (!created?.isActive || created.nextPayment !== input.firstPaymentSeconds) {
        throw new Error("The resumed authorization is inactive or its first-charge date does not match.");
    }
    return verified;
}

export async function cancelFromEmbedded(
    walletAddress: string,
    subId: string | bigint,
    contractAddress: string = STANDARD_CONTRACT_ADDRESS,
) {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress,
        abi: SUB_ABI,
        functionName: "cancelSubscription",
        args: [BigInt(subId)],
        /* Idempotent by subId: cancelling the same sub twice is a no-op, so a retried cancel
           after a timed-out response must not submit a second transaction. Shared with the
           execute-tx cancel path via the custody helper so both derive the identical key. */
        idempotencyKey: cancelSubscriptionIdempotencyKey(contractAddress, subId),
    });
    return txHash;
}

/**
 * Change a subscription's amount/period in place (contract `modifySubscription`). This takes
 * NO payment — the current period stays as already paid; the next on-chain renewal bills the
 * new amount. We also raise the USDC allowance to cover the new annual horizon so recurring
 * billing keeps succeeding at the higher amount.
 */
export async function modifyFromEmbedded(
    walletAddress: string,
    subId: string | bigint,
    newAmount: bigint,
    newPeriod: bigint,
    idempotencyKey?: string,
) {
    const custody = await getWalletCustody(walletAddress);
    await ensureUsdcAllowance(custody, STANDARD_CONTRACT_ADDRESS, horizonAllowance(newAmount, newPeriod));
    const { txHash } = await custody.executeContract({
        contractAddress: STANDARD_CONTRACT_ADDRESS,
        abi: SUB_ABI,
        functionName: "modifySubscription",
        args: [BigInt(subId), newAmount, newPeriod],
        ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return txHash;
}

/** Direct USDC transfer from the embedded wallet to a recipient — used to charge the
    prorated difference when a user upgrades immediately. Pass a deterministic idempotencyKey
    to make the charge safe against retries/concurrent requests: the custody provider returns the
    original transaction instead of moving funds a second time. */
export async function transferUsdcFromEmbedded(walletAddress: string, to: string, amountMicros: bigint, idempotencyKey?: string) {
    const custody = await getWalletCustody(walletAddress);
    const { txHash } = await custody.executeContract({
        contractAddress: USDC_NATIVE_GAS_ADDRESS,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [to.toLowerCase(), amountMicros],
        ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return txHash;
}

/**
 * Prorated upgrade charge for the remainder of the current period, computed on the
 * RECURRING RATE difference so interval changes price correctly:
 *   delta = remaining * (newAmount/newPeriod - oldAmount/oldPeriod)
 * A nominal newAmount - oldAmount is wrong the moment periods differ (e.g. 10 USDC/month
 * → 100 USDC/year is a rate DECREASE, not a 90 USDC charge). Integer math throughout;
 * remaining time is clamped to the old period. Returns 0n for rate downgrades/equal rates
 * or once the period has lapsed.
 */
export function proratedUpgradeDelta(
    oldAmount: bigint,
    newAmount: bigint,
    oldPeriod: bigint,
    newPeriod: bigint,
    nextPayment: bigint,
    nowSeconds: bigint,
): bigint {
    if (oldPeriod <= BigInt(0) || newPeriod <= BigInt(0)) return BigInt(0);
    let remaining = nextPayment - nowSeconds;
    if (remaining <= BigInt(0)) return BigInt(0);
    if (remaining > oldPeriod) remaining = oldPeriod;
    const rateNumerator = newAmount * oldPeriod - oldAmount * newPeriod;
    if (rateNumerator <= BigInt(0)) return BigInt(0);
    return (remaining * rateNumerator) / (newPeriod * oldPeriod);
}
