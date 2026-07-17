import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("the router lets merchants withdraw any positive balance, with the 1% fee preserved", () => {
    const router = source("contracts/SubScriptRouter.sol");
    assert.doesNotMatch(router, /Minimum withdrawal is 1 USDC/);
    assert.match(router, /require\(balance > 0, "No balance to withdraw"\)/);
    assert.match(router, /uint256 fee = balance \/ 100;/);
    const tests = source("test/SubScriptRouter.t.sol");
    assert.match(tests, /testDustBalanceIsWithdrawable/);
    assert.match(tests, /testMicroDustWithdrawsWithZeroFee/);
    assert.match(tests, /testDustWithdrawTo/);
});

test("withdrawal audits are confirmed by canonical events, never by transaction target", () => {
    const audit = source("src/app/api/premium/audit-withdrawal/route.ts");
    assert.match(audit, /event Withdraw\(address indexed merchant, uint256 amount\)/);
    assert.match(audit, /event PayoutDelivered\(address indexed merchant, address indexed destination, uint256 netAmount, uint256 fee\)/);
    assert.match(audit, /decodeWithdrawalEvents\(receipt, wallet\)/);
    /* Only router-emitted logs count, and both events must name THIS merchant. */
    assert.match(audit, /log\.address\.toLowerCase\(\) !== SUBSCRIPT_ROUTER_ADDRESS\.toLowerCase\(\)/);
    assert.match(audit, /missing_withdrawal_event/);
    assert.match(audit, /withdrawAmount !== payout\.netAmount \+ payout\.fee/);
    /* Request-body amount/destination are overridden by decoded event data. */
    assert.match(audit, /auditedDestination = decoded\.destination/);
    assert.match(audit, /auditedAmount = decoded\.grossAmount\.toString\(\)/);
    assert.doesNotMatch(audit, /Number\(decoded\.grossAmount\)/);
    assert.doesNotMatch(audit, /targetContract === SUBSCRIPT_ROUTER_ADDRESS\.toLowerCase\(\)[\s\S]{0,80}status = "CONFIRMED"/);
});

test("webhook deliveries classify failures and dead-letter on exhaustion or permanent 4xx", () => {
    const outbox = source("src/lib/webhookOutbox.ts");
    assert.match(outbox, /function isTransientWebhookStatus\(status: number\)/);
    assert.match(outbox, /status === 408 \|\| status === 429 \|\| status >= 500 \|\| status <= 0/);
    assert.match(outbox, /ProtocolConfig\.WEBHOOK_MAX_RETRIES/);
    assert.match(outbox, /const exhausted = !success && attempts >= maxRetries/);
    assert.match(outbox, /permanent \|\| exhausted \? "DEAD_LETTER"/);
    assert.match(outbox, /\[ALERT\] \[webhook-outbox\] DEAD_LETTER/);
    /* Merchant-visible manual replay exists. */
    const replay = source("src/app/api/webhooks/events/replay/route.ts");
    assert.match(replay, /sendWebhookRequest/);
});

test("webhook dispatch pins the vetted IP — DNS cannot rebind between validation and send", () => {
    const urls = source("src/lib/webhookUrls.ts");
    const webhooks = source("src/lib/webhooks.ts");
    /* Validation still rejects localhost/private/metadata ranges and returns vetted addresses. */
    assert.match(urls, /cannot target localhost or private network addresses/);
    assert.match(urls, /cannot resolve to a private or reserved network address/);
    assert.match(urls, /addresses: addresses\.map\(\(\{ address, family \}\) => \(\{ address, family \}\)\)/);
    /* Dispatch dials the pinned address; TLS still verifies the URL hostname. */
    assert.match(webhooks, /const pinned = urlValidation\.addresses\[0\]/);
    assert.match(webhooks, /callback\(null, pinned\.address, pinned\.family\)/);
    assert.match(webhooks, /dispatcher: pinnedDispatcher/);
    assert.match(webhooks, /redirect: "manual"/);
});

test("the vault-draw keeper settles oldest-lock-first with backlog and age visibility", () => {
    const keeper = source("src/app/api/keeper/vault-draw/route.ts");
    assert.match(keeper, /orderBy: \{ lockedUntil: "asc" \}/);
    assert.match(keeper, /vault_draw_backlog/);
    assert.match(keeper, /oldest_pending_age_seconds/);
    assert.match(keeper, /within 2 days of its user-reclaim deadline/);
    assert.match(keeper, /backlog of \$\{totalDue - due\.length\} matured vaults/);
    assert.match(keeper, /pg_try_advisory_lock/);
});

test("proration prices the rate difference, not the nominal amount difference", () => {
    const onchain = source("src/lib/subscriptions/onchain.ts");
    assert.match(onchain, /oldPeriod: bigint,\s*\n\s*newPeriod: bigint,/);
    assert.match(onchain, /newAmount \* oldPeriod - oldAmount \* newPeriod/);
    assert.match(onchain, /\(remaining \* rateNumerator\) \/ \(newPeriod \* oldPeriod\)/);
    /* Prorated charges flow through the router's fee-accounted deposit, not a direct transfer. */
    const change = source("src/app/api/user/subscription/change/route.ts");
    assert.match(change, /payMerchantLinkFromEmbedded\(/);
    assert.match(change, /`sub-proration:\$\{fromSubscriptionId\}:\$\{planId\}`/);
    assert.doesNotMatch(change, /transferUsdcFromEmbedded/);
    /* Deterministic idempotency survives the mechanism change. */
    assert.match(change, /deterministicIdempotencyKey\(`sub-upgrade-proration:\$\{changeFingerprint\}`\)/);
});

test("the vault UI mirrors contract withdrawal/reclaim conditions and shows the cycle timeline", () => {
    const page = source("src/app/dashboard/user/page.tsx");
    /* Withdraw only when INACTIVE + lock elapsed (withdrawSurplus's actual guards). */
    assert.match(page, /const canWithdraw = balance > 0 && blocked && !locked;/);
    /* Reclaim only after lockedUntil + grace on a still-active vault. */
    assert.match(page, /const canReclaim = !blocked && !disputed && balance > 0 && reclaimDate !== null && now >= reclaimDate\.getTime\(\);/);
    assert.match(page, /Reclaim escrow/);
    for (const label of ["Cycle started", "Cycle matures", "Reported usage", "Max drawable", "Settlement due by", "Reclaimable from"]) {
        assert.ok(page.includes(label), `vault row shows "${label}"`);
    }
    /* The reclaim action exists in the API too. */
    const reclaimRoute = source("src/app/api/user/vault/reclaim/route.ts");
    assert.match(reclaimRoute, /reclaimAbandonedFromEmbedded/);
    assert.match(page, /\/api\/user\/vault\/reclaim/);
});

test("proratedUpgradeDelta arithmetic", async () => {
    /* Direct behavioral check with plain BigInt math extracted from the source contract. */
    const onchain = source("src/lib/subscriptions/onchain.ts");
    const fnBody = onchain.slice(onchain.indexOf("export function proratedUpgradeDelta"), onchain.indexOf("\n}", onchain.indexOf("export function proratedUpgradeDelta")) + 2);
    const fn = new Function(`${fnBody.replace("export function", "function").replace(/: bigint/g, "").replace(/BigInt\(0\)/g, "0n")}; return proratedUpgradeDelta;`)();

    const MONTH = 2_592_000n;
    const YEAR = 31_536_000n;
    /* Same period: half the period left on a 10→30 upgrade charges half the 20 delta. */
    assert.equal(fn(10_000_000n, 30_000_000n, MONTH, MONTH, MONTH, MONTH / 2n), 10_000_000n);
    /* Interval change: 10/month → 100/year is a RATE decrease — the old nominal formula would
       have charged ~90 USDC; the rate formula charges nothing. */
    assert.equal(fn(10_000_000n, 100_000_000n, MONTH, YEAR, MONTH, 0n), 0n);
    /* Interval change upward: 10/month → 300/year (25/month-equivalent) charges the rate delta. */
    const charged = fn(10_000_000n, 300_000_000n, MONTH, YEAR, MONTH, 0n);
    assert.ok(charged > 14_000_000n && charged < 15_000_000n, `rate-based charge, got ${charged}`);
    /* Lapsed period charges nothing. */
    assert.equal(fn(10_000_000n, 30_000_000n, MONTH, MONTH, MONTH, MONTH + 1n), 0n);
});
