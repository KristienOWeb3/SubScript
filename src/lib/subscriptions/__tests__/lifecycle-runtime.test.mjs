import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resumeBridgeTerms } from "../resumeBridge.ts";
import { preservesScheduledEntitlement } from "../entitlement.ts";

function load(file, stubs) {
    const compiled = ts.transpileModule(readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: (id) => {
        if (!(id in stubs)) throw new Error(`Missing test dependency ${id}`);
        return stubs[id];
    }, console, Date, BigInt, URL }, { filename: file });
    return exports;
}

const month = 30n * 86400n;
const paidThrough = () => BigInt(Math.floor(Date.now() / 1000)) + 86400n;
function routeStubs() {
    const calls = { mirror: [], creates: [], updates: [], sponsorship: 0 };
    const sub = { subscriber: "0xsubscriber", merchant: "0xmerchant", amount: 10000000n,
        period: month, nextPayment: BigInt(Math.floor(Date.now() / 1000)) - 86400n, isActive: true };
    const row = { subscriptionId: 1n, contractAddress: "0xcontract", merchantAddress: sub.merchant,
        subscriber: sub.subscriber, kind: "CUSTOMER", status: "ACTIVE", cancelAtPeriodEnd: true,
        amountCapUsdc: "10000000", billingIntervalSeconds: month, plan: null };
    const noop = async () => {};
    const stubs = {
        "next/server": { after: () => {}, NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
        "@/lib/auth": { getSessionWallet: async () => sub.subscriber },
        "@/lib/auth/walletCustody": { getWalletCustody: async () => ({}), isCustodialWallet: () => true },
        "@/lib/contracts/constants": { STANDARD_CONTRACT_ADDRESS: "0xcontract" },
        "@/lib/accounts/roles": { requireAccountRole: async () => ({ ok: true }) },
        "@/utils/security": { sanitizeInput: (x) => x },
        "@/lib/auth/financialAuthorizationContext": { assertAuthorizedFinancialRecord: () => {} },
        "@/lib/auth/financialPinPolicy": { financialPinContext: noop },
        "@/lib/auth/transactionPin": { withTransactionPin: (_, handler) => handler },
        "@/lib/prisma": { prisma: { subscription: {
            findUnique: async () => row,
            update: async (input) => { calls.updates.push(input); return row; },
        } } },
        "@/lib/network/registry": { assertFinancialNetworkReady: () => {} },
        "@/lib/subscriptions/onchain": {
            getSubscriptionOnChain: async () => sub,
            getSubscriptionPaidThrough: async () => paidThrough(),
            cancelFromEmbedded: async () => "0xrevoke",
            supportsDeferredSubscriptions: async () => true,
            horizonAllowance: (amount) => amount * 12n,
            subscribeFromEmbedded: async (...args) => { calls.creates.push(args); return { txHash: "0xcreated", subId: "2" }; },
        },
        "@/lib/sponsor/sponsorship": { requireSponsoredGas: async () => { calls.sponsorship++; } },
        "@/lib/subscriptions/mirror": {
            mirrorSubscriptionCancelAtPeriodEnd: async (x) => { calls.mirror.push(x); return true; },
            mirrorSubscriptionCanceled: noop,
            mirrorSubscriptionCreated: async (x) => { calls.mirror.push(x); },
        },
        "@/lib/subscriptions/contractBinding": { subscriptionKey: (id) => ({ id }), activeSubscriptionContract: () => "0xcontract" },
        "@/lib/subscriptions/resumeBridge": { resumeBridgeTerms },
        "@/lib/dms/lifecycle": { sendReactivatedDm: noop, sendWinbackOfferDm: noop },
        "@/lib/subscriptions/webhookDelivery": { dispatchDurableSubscriptionWebhook: noop },
        "@/lib/webhooks": { subscriptionWebhookData: (x) => x },
        "@/lib/payments/reconciliationEvents": { recordPaymentReconciliationRequired: noop },
        "@/lib/custody": { deterministicIdempotencyKey: (x) => x },
        "@/lib/accountHalt": { haltGuard: async () => null },
        "@/lib/payments/email": { triggerExitSurvey: noop },
        "@/lib/dms/notifications": { createDmAndNotify: noop },
        "@/lib/subscriptions/promotions": { findWinbackPromotion: async () => null },
        "@/lib/email/templates/subscriptionLifecycle": {},
    };
    return { stubs, calls, sub, row };
}
const request = () => ({ headers: {}, json: async () => ({ subscriptionId: "1" }) });

test("actual cancel handler preserves renewed paid access despite the old epoch being past", async () => {
    const { stubs, calls } = routeStubs();
    const result = await load("src/app/api/user/subscription/cancel/route.ts", stubs).POST(request());
    assert.equal(result.status, 200);
    assert.equal(result.body.cancelAtPeriodEnd, true);
    assert.equal(calls.mirror[0].nextPaymentSeconds, paidThrough());
    assert.equal(calls.mirror[0].revocationPending, false);
});
test("confirmed browser revocation can finalize cancellation without trying server custody", async () => {
    const { stubs, calls, sub } = routeStubs();
    sub.isActive = false;
    const result = await load("src/app/api/user/subscription/cancel/route.ts", stubs).POST(request());
    assert.equal(result.status, 200);
    assert.equal(result.body.revoked, true);
    assert.equal(result.body.revocationPending, false);
    assert.equal(calls.sponsorship, 0);
});
test("actual resume handler uses the plan cadence with a separate confirmed first-charge date", async () => {
    const { stubs, calls, sub } = routeStubs();
    sub.isActive = false;
    const result = await load("src/app/api/user/subscription/resume/route.ts", stubs).POST(request());
    assert.equal(result.status, 200);
    assert.equal(calls.creates[0][3], month);
    assert.equal(calls.creates[0][5], null);
    assert.equal(calls.creates[0][6].firstPaymentSeconds, paidThrough());
    assert.equal(calls.mirror[0].periodSeconds, month);
    assert.equal(result.body.chargedNow, "0");
});
test("legacy deployment capability cannot silently fall back to an unsafe bridge", async () => {
    const { stubs, calls, sub } = routeStubs();
    sub.isActive = false;
    stubs["@/lib/subscriptions/onchain"].supportsDeferredSubscriptions = async () => false;
    const result = await load("src/app/api/user/subscription/resume/route.ts", stubs).POST(request());
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "DEFERRED_RENEWAL_DEPLOYMENT_REQUIRED");
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.sponsorship, 0);
});
test("browser resume requests the same paid-through and cadence without server sponsorship", async () => {
    const { stubs, calls, sub } = routeStubs();
    sub.isActive = false;
    stubs["@/lib/auth/walletCustody"].isCustodialWallet = () => false;
    const result = await load("src/app/api/user/subscription/resume/route.ts", stubs).POST(request());
    assert.equal(result.status, 409);
    assert.equal(result.body.requiresWalletResume, true);
    assert.equal(BigInt(result.body.periodSeconds), month);
    assert.equal(BigInt(result.body.firstPaymentSeconds), paidThrough());
    assert.equal(calls.sponsorship, 0);
    assert.equal(calls.creates.length, 0);
});
test("a verified browser resume is mirrored without custody execution", async () => {
    const { stubs, calls, sub } = routeStubs();
    sub.isActive = false;
    stubs["@/lib/auth/walletCustody"].isCustodialWallet = () => false;
    stubs["@/lib/subscriptions/onchain"].verifyExternalDeferredSubscriptionTx = async (input) => {
        assert.equal(input.firstPaymentSeconds, paidThrough());
        return { txHash: input.txHash, subId: "2" };
    };
    const result = await load("src/app/api/user/subscription/resume/route.ts", stubs).POST({
        headers: {}, json: async () => ({ subscriptionId: "1", txHash: `0x${"ab".repeat(32)}` }),
    });
    assert.equal(result.status, 200);
    assert.equal(calls.sponsorship, 0);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.mirror[0].periodSeconds, month);
});
test("actual healer preserves scheduled access and emits cancellation only after expiry", async () => {
    for (const future of [true, false]) {
        const writes = [], events = [];
        const row = { subscription_id: 1, merchant_address: "0xmerchant", status: "ACTIVE",
            cancel_at_period_end: true, next_billing_date: new Date(Date.now() + (future ? 1 : -1) * 86400000).toISOString() };
        let read = 0;
        function query() {
            let writing = false;
            const q = {};
            for (const method of ["select", "eq", "in", "order", "limit", "gte"]) q[method] = () => q;
            q.update = (x) => { writing = true; writes.push(x); return q; };
            q.then = (resolve, reject) => Promise.resolve({ data: !writing && read++ === 0 ? [row] : [], error: null }).then(resolve, reject);
            return q;
        }
        class Contract { async subscriptions() { return ["0xsubscriber", "0xmerchant", 10000000n, month, 1n, false]; } }
        const stubs = {
            ethers: { ethers: { Contract, ZeroAddress: "0xzero" } },
            "@/lib/payments/rpc": { executeWithRpcFallback: async (fn) => ({ result: await fn({}) }) },
            "@/lib/contracts/constants": { STANDARD_CONTRACT_ADDRESS: "0xcontract" },
            "@/lib/subscriptions/onchain": {}, "@/lib/sponsor/sponsorship": {},
            "@/lib/subscriptions/webhookDelivery": { dispatchDurableSubscriptionWebhook: async (_, event) => events.push(event) },
            "@/lib/webhooks": { subscriptionWebhookData: (x) => x },
            "@/lib/dms/notifications": {},
            "@/lib/subscriptions/contractBinding": { activeSubscriptionContract: () => "0xcontract" },
            "./entitlement": { preservesScheduledEntitlement },
        };
        await load("src/lib/subscriptions/driftHealer.ts", stubs).healSubscriptionDrift({ from: query });
        assert.equal(writes.some((w) => w.status === "CANCELED"), !future);
        assert.equal(events.length, future ? 0 : 1);
    }
});
