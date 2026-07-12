import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("peer/merchant link classification is one shared predicate across every surface", () => {
    /* The DM confirm loop came from the DM classifier keying off the creator's account role while
       /pay keyed off link metadata: a user-request link showed "Go to DMs" but produced a
       PAYMENT_REQUEST DM, whose confirm pushed back to /pay, which re-offered "Go to DMs" forever.
       Every surface must classify from the same link metadata via isPeerRequestLink. */
    const helper = source("src/lib/paymentLinks/classification.ts");
    const dms = source("src/lib/dms/system.ts");
    const payRoute = source("src/app/api/user/payment-links/[id]/pay/route.ts");
    const verify = source("src/app/api/payment-links/verify/route.ts");

    assert.match(helper, /export function isPeerRequestLink/);

    /* The DM classifier now derives messageType from the metadata predicate, NOT the creator's
       account role (which is what diverged from /pay). */
    assert.match(dms, /isMerchantLink = !isPeerRequestLink\(link\)/);
    assert.doesNotMatch(dms, /creatorRole === "ENTERPRISE"/);
    assert.doesNotMatch(dms, /getAccountRole/);

    /* Server surfaces share the one helper rather than re-deriving the predicate. */
    assert.match(payRoute, /import \{ isPeerRequestLink \} from "@\/lib\/paymentLinks\/classification"/);
    assert.doesNotMatch(payRoute, /function isPeerRequestLink/);
    assert.match(verify, /return isPeerRequestLink\(link\)/);
});

test("hosted checkout only redirects to validated URLs stored on the payment link", () => {
    const page = source("src/app/pay/[id]/page.tsx");
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(page, /state_snapshot/);
    assert.match(page, /validateStoredReturnUrl\(returnUrls\?\.successUrl\)/);
    assert.match(page, /validateStoredReturnUrl\(returnUrls\?\.cancelUrl\)/);
    assert.doesNotMatch(page, /searchParams/);
    assert.doesNotMatch(page, /resolvedSearchParams|searchParams\.returnUrl/);
    /* The client derives its redirect targets solely from the server-validated successUrl/cancelUrl
       props (never raw request input or the unvalidated state_snapshot), then redirects to that
       validated URL. */
    assert.match(client, /merchantSuccessUrl = typeof successUrl === "string"/);
    assert.match(client, /merchantCancelUrl = typeof cancelUrl === "string"/);
    assert.match(client, /window\.location\.assign/);
    assert.doesNotMatch(client, /state_snapshot\?\.returnUrls/);
});

test("checkout success polling is bound to a settlement newer than the page baseline", () => {
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");
    const statusRoute = source("src/app/api/payment-links/[id]/status/route.ts");

    /* A link-level PAID flag is historical aggregate state. Reopening a paid/reusable link must
       never turn the current checkout green until a newer finalized settlement is observed. */
    assert.doesNotMatch(client, /data\?\.link\?\.status\s*===\s*["']PAID["']/);
    assert.match(client, /initialSettlementVersion/);
    assert.match(client, /settlementVersion !== baselineSettlementVersionRef\.current/);
    assert.match(client, /\/api\/payment-links\/\$\{linkData\.id\}\/status/);
    assert.match(statusRoute, /settlementVersion/);
    assert.match(statusRoute, /verified_tx_hash/);
    assert.match(statusRoute, /paid_at/);
});

test("checkout keeps every success path behind an actual on-chain transaction", () => {
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");
    const embeddedRoute = source("src/app/api/user/payment-links/[id]/pay/route.ts");

    assert.match(client, /writeContractAsync\([\s\S]*functionName:\s*"depositForMerchant"/);
    assert.match(client, /!data\.success \|\| !data\.txHash/);
    assert.match(client, /startVerification\(hash/);
    assert.doesNotMatch(embeddedRoute, /link\.status === "PAID"/);
    assert.match(client, /sessionStorage\.getItem/);
    assert.match(client, /sessionStorage\.setItem/);
});

test("desktop checkout exposes contained QR and browser-payment controls", () => {
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(client, /Pay in this browser/);
    assert.match(client, /paymentControlsRef/);
    assert.match(client, /size=\{320\}/);
    assert.doesNotMatch(client, /size=\{360\}/);
});

test("dashboard checkout launches do not approve before settlement and open a new tab", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");
    const handler = dashboard.slice(
        dashboard.indexOf("const handleConfirmPaymentDm"),
        dashboard.indexOf("/* Peer (user-to-user) requests", dashboard.indexOf("const handleConfirmPaymentDm")),
    );

    assert.match(handler, /window\.open/);
    assert.doesNotMatch(handler, /handleUpdateDmStatus/);
});

test("recent transaction surfaces render both local date and time", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");
    const history = source("src/app/dashboard/user/transactions/page.tsx");
    const merchant = source("src/app/dashboard/page.tsx");

    assert.match(dashboard, /new Date\(tx\.time\)\.toLocaleString/);
    assert.match(dashboard, /new Date\(tx\.createdAt\)\.toLocaleString/);
    assert.match(history, /new Date\(tx\.time\)\.toLocaleString/);
    assert.match(merchant, /new Date\(tx\.createdAt\)\.toLocaleString/);
});

test("subscription API checkouts use the recurring subscribe surface", () => {
    const route = source("src/app/api/v1/subscriptions/route.ts");

    assert.match(route, /buildSubscribeUrl\(link\.id\)/);
    assert.match(route, /buildSubscribeUrl\(existing\.id\)/);
    assert.doesNotMatch(route, /buildCheckoutUrl/);
});

test("metadata-backed subscription sessions execute createSubscription and cannot fall back to a router deposit", () => {
    const client = source("src/app/subscribe/[planId]/SubscribeClient.tsx");
    const subscribeRoute = source("src/app/api/user/subscription/subscribe/route.ts");
    const onchain = source("src/lib/subscriptions/onchain.ts");

    assert.match(client, /checkoutSessionId/);
    assert.match(subscribeRoute, /readSubscriptionCheckoutMeta/);
    assert.match(subscribeRoute, /subscriptionCheckoutPeriod/);
    assert.match(subscribeRoute, /subscribeFromEmbedded/);
    assert.match(subscribeRoute, /status:\s*"PROCESSING"/);
    assert.match(subscribeRoute, /status:\s*"PAID"/);
    assert.match(onchain, /functionName:\s*"createSubscription"/);
    assert.doesNotMatch(subscribeRoute, /depositForMerchant/);
});
