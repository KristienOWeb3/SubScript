/* Failure-injection tests for the subscription lifecycle dead ends (payments hardening, phase 3).
 *
 * Each route runs for real, transpiled and loaded with stubbed dependencies, and a failure is
 * injected at the boundary that used to strand the subscriber:
 *   - a user-fixable subscribe failure must not block the next try (item 2)
 *   - a PAST_DUE row the chain shows inactive must not block subscribing (item 3)
 *   - the on-chain duplicate scan must refuse when it can't prove "none" (item 4)
 *   - a failed resume mirror write must leave a reconciliation event (item 5)
 *   - the resume quick path must hold the revocation lease before clearing flags (item 6)
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as subscribeAttempts from "../subscribeAttempts.ts";
import { resumeBridgeTerms } from "../resumeBridge.ts";
import { looksLikeDeferredResume, promotionForRecoveredSubscription } from "../deferredResume.ts";

const { classifySubscribeFailure, nextSubscribeAttemptKey } = subscribeAttempts;

function load(file, stubs) {
    const compiled = ts.transpileModule(readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: (id) => {
        if (!(id in stubs)) throw new Error(`Missing test dependency ${id}`);
        return stubs[id];
    }, console: { ...console, error: () => {}, warn: () => {} }, Date, BigInt, URL, Number, String, Math, JSON, Promise, Error, setTimeout }, { filename: file });
    return exports;
}

const CONTRACT = "0x00000000000000000000000000000000000c0de1";
const SUBSCRIBER = "0x000000000000000000000000000000000000beef";
const MERCHANT = "0x000000000000000000000000000000000000ca11";
const month = 30n * 86400n;
const noop = async () => {};
const cryptoStub = { ...nodeCrypto, default: nodeCrypto };

/* ------------------------------------------------------------------ item 2: classification */

test("only definitive contract or provider rejections are terminal", () => {
    assert.equal(classifySubscribeFailure(new Error("execution reverted: InvalidPeriod()")), "TERMINAL");
    assert.equal(classifySubscribeFailure(new Error("DuplicateActiveSubscription(4)")), "TERMINAL");
    assert.equal(classifySubscribeFailure(new Error("400 API parameter invalid")), "TERMINAL");
});

test("user-fixable and not-created failures are retryable, never terminal", () => {
    for (const message of [
        "ERC20InsufficientBalance(0xbeef, 0, 10000000)",
        "transfer amount exceeds balance",
        "Insufficient funds for the first payment",
        "Transaction reached terminal state FAILED",
        "execution reverted",
    ]) {
        assert.equal(classifySubscribeFailure(new Error(message)), "RETRYABLE", message);
    }
    const sponsorRefusal = Object.assign(new Error("Daily gas budget reached"), { name: "SponsoredGasError", kind: "definitive" });
    assert.equal(classifySubscribeFailure(sponsorRefusal), "RETRYABLE");
});

test("anything that might have reached the provider keeps its key", () => {
    for (const message of ["request timeout", "socket hang up", "502 Bad Gateway", "ETIMEDOUT", "something nobody anticipated"]) {
        assert.equal(classifySubscribeFailure(new Error(message)), "UNKNOWN", message);
    }
    const ambiguousSponsor = Object.assign(new Error("still confirming"), { name: "SponsoredGasError", kind: "ambiguous" });
    assert.equal(classifySubscribeFailure(ambiguousSponsor), "UNKNOWN");
});

test("a retryable failure mints a fresh nonce key; anything else reuses the attempt", () => {
    const base = "subscribe-plan:a:b:plan:generation:1";
    assert.deepEqual(nextSubscribeAttemptKey(base, []), { reuse: null, idempotencyKey: base });

    const failedOnce = [{ idempotencyKey: base, status: "FAILED_RETRYABLE", createdAt: new Date(1000) }];
    assert.equal(nextSubscribeAttemptKey(base, failedOnce).idempotencyKey, `${base}:attempt:2`);

    const failedTwice = [
        { idempotencyKey: `${base}:attempt:2`, status: "FAILED_RETRYABLE", createdAt: new Date(2000) },
        ...failedOnce,
    ];
    assert.equal(nextSubscribeAttemptKey(base, failedTwice).idempotencyKey, `${base}:attempt:3`);

    const inFlight = [{ idempotencyKey: `${base}:attempt:2`, status: "SUBMISSION_UNKNOWN", createdAt: new Date(3000) }, ...failedOnce];
    const decision = nextSubscribeAttemptKey(base, inFlight);
    assert.equal(decision.idempotencyKey, null);
    assert.equal(decision.reuse.idempotencyKey, `${base}:attempt:2`);
});

/* ------------------------------------------------------------- subscribe route harness */

function subscribeHarness({ execute, pastDueRows = [], pastDueChain = null, priorAttempts = [], scan } = {}) {
    const calls = { attemptUpdates: [], attemptCreates: [], executes: 0, closes: [], webhooks: [], leaseResets: [] };
    const plan = {
        id: "11111111-1111-4111-8111-111111111111", merchantAddress: MERCHANT, name: "Pro",
        amountUsdc: 10_000_000n, periodSeconds: month, minCommitmentSeconds: 0n,
        sourceCheckoutId: null, active: true, targetSubscriber: null, updatedAt: new Date(),
    };
    const tx = {
        $queryRaw: async (strings) => strings.join("").includes("pg_try_advisory_xact_lock")
            ? [{ acquired: true }]
            : [{ generation: 0n }],
        subscription: { findFirst: async () => null },
        subscriptionAttempt: {
            findMany: async () => priorAttempts,
            create: async ({ data }) => {
                calls.attemptCreates.push(data);
                return { ...data, attemptId: `att-${calls.attemptCreates.length}`, createdAt: new Date() };
            },
        },
    };
    const prisma = {
        $transaction: async (fn) => fn(tx),
        merchantPlan: { findUnique: async () => plan, updateMany: async () => ({ count: 0 }) },
        paymentLink: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
        subscription: {
            findMany: async () => pastDueRows,
            updateMany: async (input) => { calls.closes.push(input); return { count: 1 }; },
            findFirst: async () => null,
        },
        subscriptionAttempt: {
            updateMany: async (input) => {
                if (input.data?.status === "SUBMISSION_STARTED") return { count: 1 };
                calls.leaseResets.push(input);
                return { count: 1 };
            },
            update: async (input) => { calls.attemptUpdates.push(input); return {}; },
        },
        subscriptionDm: { updateMany: async () => ({ count: 0 }) },
    };
    const stubs = {
        "@/lib/auth/financialAuthorizationContext": { assertAuthorizedFinancialRecord: () => {} },
        "@/lib/auth/financialPinPolicy": { financialPinContext: noop },
        "@/lib/auth/transactionPin": { withTransactionPin: (_, handler) => handler },
        "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
        "node:crypto": cryptoStub,
        ethers: { ethers: { isAddress: () => true } },
        "@/lib/auth": { getSessionWallet: async () => SUBSCRIBER },
        "@/lib/auth/walletCustody": { getWalletCustody: async () => ({}), isCustodialWallet: () => true },
        "@/lib/accounts/roles": { requireAccountRole: async () => ({ ok: true }) },
        "@/lib/prisma": { prisma },
        "@/utils/security": { sanitizeInput: (x) => x },
        "@/lib/contracts/constants": { PREMIUM_PAYMENT_RECIPIENT_ADDRESS: "0x0000000000000000000000000000000000000001", STANDARD_CONTRACT_ADDRESS: CONTRACT },
        "@/lib/sponsor/sponsorship": { requireSponsoredGas: noop },
        "@/lib/network/registry": { assertFinancialNetworkReady: () => {} },
        "@/lib/subscriptions/onchain": {
            subscribeFromEmbedded: async () => { calls.executes++; return execute(); },
            findActiveOnChainSubscriptionId: scan || (async () => null),
            findActiveOnChainSubscriptionIdOrNull: async () => null,
            isActiveSubscriptionScanUnavailable: (err) => err?.code === "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE",
            getSubscriptionOnChain: async () => pastDueChain,
            getSignupChargeOnChain: async () => null,
            verifyExternalSubscriptionTx: noop,
            horizonAllowance: (amount) => amount * 12n,
        },
        "@/lib/subscriptions/recoveredTerms": { recoveredPromotionTerms: async () => null },
        "@/lib/subscriptions/subscribeAttempts": subscribeAttempts,
        "@/lib/vault/onchain": { ensureUsdcAllowance: noop },
        "@/lib/subscriptions/promotions": {
            findApplicablePromotion: async () => null, claimPromotionRedemption: noop,
            releasePromotionRedemption: noop, confirmPromotionRedemption: noop, pricingPhaseFor: () => ({}),
        },
        "@/lib/custody": { deterministicIdempotencyKey: (seed) => `det:${seed}`, getWalletCustody: async () => ({}) },
        "@/lib/subscriptions/planChange": { creditBasisForRow: async () => ({ valueMicros: 0n, windowSeconds: 1n }), unusedWindowValueMicros: () => 0n },
        "@/lib/subscriptions/mirror": { mirrorSubscriptionCreated: noop },
        "@/lib/dms/system": { createSubscriptionStartedDm: noop },
        "@/lib/serverPg": { withPgClient: noop },
        "@/lib/kyc/tier": { getAccountKycTier: async () => ({ isTier1: true }) },
        "@/lib/subscriptionCheckout": { readSubscriptionCheckoutMeta: () => null, subscriptionCheckoutPeriod: () => month },
        "@/lib/subscriptions/apiSubscriptionView": { checkoutExpiresAt: () => new Date(), isCheckoutExpired: () => false },
        "@/lib/subscriptions/webhookDelivery": {
            dispatchDurableSubscriptionWebhook: async (merchant, event, data, key) => { calls.webhooks.push({ event, key }); },
        },
        "@/lib/webhooks": { subscriptionWebhookData: (x) => x },
        "@/lib/payments/reconciliationEvents": { recordPaymentReconciliationRequired: noop },
        "@/lib/subscriptions/rowContract": { resolveSubscriberRowContract: async () => null },
        "@/lib/subscriptions/contractBinding": {
            activeSubscriptionContract: () => CONTRACT,
            billableSubscriptionContracts: () => [CONTRACT],
            onActiveContract: () => ({ contractAddress: CONTRACT }),
            subscriptionKey: (id) => ({ id }),
        },
        "@/lib/accountHalt": { haltGuard: async () => null },
        "@/lib/email/settlementReceipts": { sendSettlementReceipts: noop },
    };
    const route = load("src/app/api/user/subscription/subscribe/route.ts", stubs);
    const request = { headers: {}, json: async () => ({ planId: plan.id }) };
    return { calls, post: () => route.POST(request) };
}

test("insufficient USDC marks the attempt FAILED_RETRYABLE and says so, instead of a dead end", async () => {
    const { calls, post } = subscribeHarness({
        execute: () => { throw new Error("execution reverted: ERC20InsufficientBalance(0xbeef, 0, 10000000)"); },
    });
    const result = await post();
    assert.equal(result.status, 402);
    assert.equal(result.body.code, "SUBSCRIBE_RETRYABLE");
    assert.equal(result.body.retryable, true);
    assert.match(result.body.error, /enough USDC/);
    assert.equal(calls.attemptUpdates.at(-1).data.status, "FAILED_RETRYABLE");
});

test("the retry after a retryable failure gets a new idempotency key and a new provider key", async () => {
    const base = `subscribe-plan:${SUBSCRIBER}:${MERCHANT}:11111111-1111-4111-8111-111111111111:generation:1`;
    const { calls, post } = subscribeHarness({
        priorAttempts: [{ attemptId: "att-0", idempotencyKey: base, providerIdempotencyKey: `det:${base}`, status: "FAILED_RETRYABLE", createdAt: new Date(Date.now() - 60_000) }],
        execute: () => ({ txHash: `0x${"ab".repeat(32)}`, subId: null }),
    });
    await post().catch(() => {});
    assert.equal(calls.attemptCreates.length, 1, "a fresh attempt row is created");
    assert.equal(calls.attemptCreates[0].idempotencyKey, `${base}:attempt:2`);
    assert.equal(calls.attemptCreates[0].providerIdempotencyKey, `det:${base}:attempt:2`);
    assert.notEqual(calls.attemptCreates[0].providerIdempotencyKey, `det:${base}`);
    assert.equal(calls.executes, 1);
});

test("a definitive revert is still terminal", async () => {
    const { calls, post } = subscribeHarness({ execute: () => { throw new Error("execution reverted: InvalidPeriod()"); } });
    const result = await post();
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "ATTEMPT_FAILED_TERMINAL");
    assert.equal(calls.attemptUpdates.at(-1).data.status, "FAILED_TERMINAL");
});

test("a timeout keeps the key (SUBMISSION_UNKNOWN), so a retry can't send a second charge", async () => {
    const { calls, post } = subscribeHarness({ execute: () => { throw new Error("Circle request timeout"); } });
    const result = await post();
    assert.equal(result.status, 202);
    assert.equal(result.body.code, "SUBMISSION_UNKNOWN");
    assert.equal(calls.attemptUpdates.at(-1).data.status, "SUBMISSION_UNKNOWN");
});

/* ------------------------------------------------------------------------- item 3: PAST_DUE */

test("a PAST_DUE row the chain shows inactive is closed, and subscribing goes ahead", async () => {
    const { calls, post } = subscribeHarness({
        pastDueRows: [{ subscriptionId: 7n, contractAddress: CONTRACT, amountCapUsdc: "10000000" }],
        pastDueChain: { subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 10_000_000n, period: month, nextPayment: 1n, isActive: false },
        execute: () => { throw new Error("request timeout"); },
    });
    await post();
    assert.equal(calls.closes.length, 1);
    assert.equal(calls.closes[0].where.contractAddress, CONTRACT);
    assert.equal(calls.closes[0].where.status, "PAST_DUE");
    assert.equal(calls.closes[0].data.status, "CANCELED");
    assert.ok(calls.webhooks.some((w) => w.key === `customer-canceled:${CONTRACT}:7:past-due-closed`));
    assert.equal(calls.executes, 1, "the new subscribe reached the chain");
});

test("PAST_DUE with an unreadable chain refuses instead of guessing", async () => {
    const { calls, post } = subscribeHarness({
        pastDueRows: [{ subscriptionId: 7n, contractAddress: CONTRACT, amountCapUsdc: "10000000" }],
        pastDueChain: null,
        execute: () => ({}),
    });
    const result = await post();
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "CHAIN_READ_FAILED");
    assert.equal(calls.closes.length, 0);
    assert.equal(calls.executes, 0);
});

/* ------------------------------------------------------------- item 4: duplicate guard fails closed */

test("the pre-charge duplicate scan refuses the charge when the chain can't be read", async () => {
    const scanError = Object.assign(new Error("Could not read subscription 9 on-chain."), { code: "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE" });
    const { calls, post } = subscribeHarness({ scan: async () => { throw scanError; }, execute: () => ({}) });
    const result = await post();
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "CHAIN_READ_FAILED");
    assert.equal(calls.executes, 0, "nothing is charged");
    assert.equal(calls.leaseResets.at(-1).data.leaseExpiresAt, null, "the lease is handed back for the retry");
});

function onchainModule() {
    class Contract {}
    return load("src/lib/subscriptions/onchain.ts", {
        ethers: { ethers: { Contract, ZeroAddress: "0x0000000000000000000000000000000000000000", Interface: class {}, JsonRpcProvider: class {} } },
        "@/lib/network/registry": { resolveArcRpcUrl: () => "http://rpc" },
        "@/lib/custody": { getWalletCustody: noop, cancelSubscriptionIdempotencyKey: () => "k" },
        "@/lib/vault/onchain": { ensureUsdcAllowance: noop },
        "@/lib/contracts/constants": { STANDARD_CONTRACT_ADDRESS: CONTRACT, USDC_NATIVE_GAS_ADDRESS: "0xusdc" },
        "./entitlement": { readSubscriptionPaidThrough: noop },
    });
}

test("findActiveOnChainSubscriptionId throws instead of returning null on an RPC error or the scan cap", async () => {
    const onchain = onchainModule();
    const live = [SUBSCRIBER, MERCHANT, 1n, month, 1n, true];
    const dead = [SUBSCRIBER, MERCHANT, 1n, month, 1n, false];

    assert.equal(await onchain.findActiveOnChainSubscriptionId(SUBSCRIBER, MERCHANT, {
        nextSubscriptionId: async () => 4n, subscriptions: async (id) => (id === 2n ? live : dead),
    }), "2");
    assert.equal(await onchain.findActiveOnChainSubscriptionId(SUBSCRIBER, MERCHANT, {
        nextSubscriptionId: async () => 4n, subscriptions: async () => dead,
    }), null, "a complete scan with no match is a real 'none'");

    await assert.rejects(onchain.findActiveOnChainSubscriptionId(SUBSCRIBER, MERCHANT, {
        nextSubscriptionId: async () => { throw new Error("rpc down"); }, subscriptions: async () => dead,
    }), (err) => err.code === "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE");
    await assert.rejects(onchain.findActiveOnChainSubscriptionId(SUBSCRIBER, MERCHANT, {
        nextSubscriptionId: async () => 4n, subscriptions: async (id) => { if (id === 2n) throw new Error("429"); return dead; },
    }), (err) => err.code === "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE", "one skipped id makes the answer unknown");
    await assert.rejects(onchain.findActiveOnChainSubscriptionId(SUBSCRIBER, MERCHANT, {
        nextSubscriptionId: async () => 1_500n, subscriptions: async () => dead,
    }), (err) => err.code === "ACTIVE_SUBSCRIPTION_SCAN_UNAVAILABLE", "hitting the cap is not 'none'");
});

/* ------------------------------------------------------------------- resume route harness */

const paidThrough = () => BigInt(Math.floor(Date.now() / 1000)) + 86400n;

function resumeHarness({ chainReads, claimRows = [{ subscription_id: 1n }], clearRows = [{ subscription_id: 1n }], mirror } = {}) {
    const calls = { updates: [], creates: [], recon: [], sql: [], webhooks: [] };
    const row = { subscriptionId: 1n, contractAddress: CONTRACT, merchantAddress: MERCHANT, subscriber: SUBSCRIBER,
        kind: "CUSTOMER", status: "ACTIVE", cancelAtPeriodEnd: true, amountCapUsdc: "10000000",
        billingIntervalSeconds: month, minCommitmentUntil: null, externalReference: null, sourceCheckoutId: null,
        beneficiaryAddress: null, planId: null };
    let read = 0;
    const sqlKind = (strings) => {
        const text = strings.join("?");
        if (text.includes("cancel_at_period_end = false")) return "clear";
        if (text.includes("revocation_lease_expires_at IS NULL OR")) return "claim";
        return "release";
    };
    const prisma = {
        subscription: {
            findUnique: async () => row,
            update: async (input) => { calls.updates.push(input); return row; },
        },
        $queryRaw: async (strings, ...values) => {
            const kind = sqlKind(strings);
            calls.sql.push({ kind, values });
            return kind === "claim" ? claimRows : clearRows;
        },
        $executeRaw: (strings, ...values) => { calls.sql.push({ kind: sqlKind(strings), values }); return Promise.resolve(1); },
    };
    const stubs = {
        "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
        "node:crypto": cryptoStub,
        "@/lib/auth": { getSessionWallet: async () => SUBSCRIBER },
        "@/lib/auth/walletCustody": { getWalletCustody: async () => ({}), isCustodialWallet: () => true },
        "@/lib/contracts/constants": { STANDARD_CONTRACT_ADDRESS: CONTRACT },
        "@/lib/accounts/roles": { requireAccountRole: async () => ({ ok: true }) },
        "@/utils/security": { sanitizeInput: (x) => x },
        "@/lib/auth/financialAuthorizationContext": { assertAuthorizedFinancialRecord: () => {} },
        "@/lib/auth/financialPinPolicy": { financialPinContext: noop },
        "@/lib/auth/transactionPin": { withTransactionPin: (_, handler) => handler },
        "@/lib/prisma": { prisma },
        "@/lib/network/registry": { assertFinancialNetworkReady: () => {} },
        "@/lib/subscriptions/onchain": {
            getSubscriptionOnChain: async () => {
                const isActive = chainReads[Math.min(read, chainReads.length - 1)];
                read++;
                return { subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 10_000_000n, period: month, nextPayment: 1n, isActive };
            },
            getSubscriptionPaidThrough: async () => paidThrough(),
            supportsDeferredSubscriptions: async () => true,
            horizonAllowance: (amount) => amount * 12n,
            subscribeFromEmbedded: async (...args) => { calls.creates.push(args); return { txHash: `0x${"cd".repeat(32)}`, subId: "2" }; },
            verifyExternalDeferredSubscriptionTx: noop,
        },
        "@/lib/sponsor/sponsorship": { requireSponsoredGas: noop },
        "@/lib/subscriptions/planChange": { creditBasisForRow: async () => ({ valueMicros: 0n, windowSeconds: 1n }), unusedWindowValueMicros: () => 0n },
        "@/lib/subscriptions/mirror": { mirrorSubscriptionCreated: mirror || noop },
        "@/lib/subscriptions/rowContract": { resolveSubscriberRowContract: async () => null },
        "@/lib/subscriptions/contractBinding": { subscriptionKey: (id) => ({ id }), activeSubscriptionContract: () => CONTRACT, billableSubscriptionContracts: () => [CONTRACT] },
        "@/lib/subscriptions/resumeBridge": { resumeBridgeTerms },
        "@/lib/dms/lifecycle": { sendReactivatedDm: noop },
        "@/lib/subscriptions/webhookDelivery": {
            dispatchDurableSubscriptionWebhook: async (merchant, event, data, key) => { calls.webhooks.push({ event, key }); },
        },
        "@/lib/webhooks": { subscriptionWebhookData: (x) => x },
        "@/lib/payments/reconciliationEvents": { recordPaymentReconciliationRequired: async (event) => { calls.recon.push(event); } },
        "@/lib/custody": { deterministicIdempotencyKey: (x) => x },
        "@/lib/accountHalt": { haltGuard: async () => null },
    };
    const route = load("src/app/api/user/subscription/resume/route.ts", stubs);
    return { calls, post: () => route.POST({ headers: {}, json: async () => ({ subscriptionId: "1" }) }) };
}

/* ------------------------------------------------------------- item 5: resume mirror failure */

test("a failed resume mirror write records a reconciliation event instead of a bare 500", async () => {
    const { calls, post } = resumeHarness({
        chainReads: [false],
        mirror: async () => { throw new Error("connection terminated"); },
    });
    const result = await post();
    assert.equal(result.status, 202);
    assert.equal(result.body.code, "RECONCILIATION_PENDING");
    assert.equal(calls.creates.length, 1);
    assert.equal(calls.recon.length, 1);
    const [event] = calls.recon;
    assert.equal(event.kind, "SUBSCRIPTION_RESUME_MIRROR");
    assert.equal(event.context.subscriptionId, "2");
    assert.equal(event.context.previousSubscriptionId, "1");
    assert.equal(event.context.amountUsdc, "10000000");
    assert.match(event.dedupeKey, new RegExp(CONTRACT));
    assert.equal(calls.updates.length, 0, "the old row stays until the new one is mirrored");
    assert.equal(calls.webhooks.length, 0, "no reactivation is announced for an unmirrored resume");
});

/* ------------------------------------------------------------------ item 6: resume race */

test("the resume quick path refuses while the revocation worker holds the lease", async () => {
    const { calls, post } = resumeHarness({ chainReads: [true], claimRows: [] });
    const result = await post();
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "REVOCATION_IN_PROGRESS");
    assert.ok(!calls.sql.some((q) => q.kind === "clear"), "flags are never cleared without the lease");
    assert.equal(calls.updates.length, 0);
});

test("the quick path clears flags only under its own lease, after re-reading the chain", async () => {
    const { calls, post } = resumeHarness({ chainReads: [true, true] });
    const result = await post();
    assert.equal(result.status, 200);
    assert.equal(result.body.reauthorized, false);
    const kinds = calls.sql.map((q) => q.kind);
    assert.deepEqual(kinds, ["claim", "clear"]);
    const claimId = calls.sql[0].values[0];
    assert.ok(calls.sql[1].values.includes(claimId), "the clear is conditioned on the claim it took");
    assert.ok(calls.webhooks.some((w) => w.key === `customer-reactivated:${CONTRACT}:1`));
});

test("if the worker revoked it before the lease, resume re-authorizes instead of reporting a dead sub as live", async () => {
    const { calls, post } = resumeHarness({ chainReads: [true, false] });
    const result = await post();
    assert.equal(result.status, 200);
    assert.equal(result.body.reauthorized, true);
    assert.deepEqual(calls.sql.map((q) => q.kind), ["claim", "release"]);
    assert.equal(calls.creates.length, 1);
});

test("a lease lost between claim and clear is reported, not silently treated as resumed", async () => {
    const { calls, post } = resumeHarness({ chainReads: [true, true], clearRows: [] });
    const result = await post();
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "REVOCATION_IN_PROGRESS");
    assert.equal(calls.webhooks.length, 0);
});

/* ------------------------------------------------------------- item 10: resume vs promotion */

test("a recovered resume bridge is not stored as a $0 promotion; a real free trial still is", () => {
    const nextPayment = 1_800_000_000n;
    const bridge = { introAmountUsdc: 0n, introCycles: 1 };
    assert.equal(looksLikeDeferredResume({ intro: bridge, onChainNextPaymentSeconds: nextPayment, priorPaidThroughSeconds: [nextPayment] }), true);
    assert.equal(promotionForRecoveredSubscription({ intro: bridge, onChainNextPaymentSeconds: nextPayment, priorPaidThroughSeconds: [nextPayment + 30n] }), null);
    assert.deepEqual(promotionForRecoveredSubscription({ intro: bridge, onChainNextPaymentSeconds: nextPayment, priorPaidThroughSeconds: [nextPayment - 86_400n] }), bridge);
    const discount = { introAmountUsdc: 5_000_000n, introCycles: 3 };
    assert.deepEqual(promotionForRecoveredSubscription({ intro: discount, onChainNextPaymentSeconds: nextPayment, priorPaidThroughSeconds: [nextPayment] }), discount);
});
