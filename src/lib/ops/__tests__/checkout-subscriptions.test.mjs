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
    const page = source("src/app/pay/[id]/page.tsx");
    const settlementVersion = source("src/lib/paymentLinks/settlementVersion.ts");

    /* A link-level PAID flag is historical aggregate state. Reopening a paid/reusable link must
       never turn the current checkout green until a newer finalized settlement is observed. */
    assert.doesNotMatch(client, /data\?\.link\?\.status\s*===\s*["']PAID["']/);
    assert.match(client, /initialSettlementVersion/);
    assert.doesNotMatch(client, /settlementVersion !== baselineSettlementVersionRef\.current/);
    assert.match(client, /data\?\.attemptSettled === true/);
    assert.match(client, /\/api\/payment-links\/\$\{linkData\.id\}\/status/);
    assert.match(statusRoute, /settlementVersion/);
    assert.match(statusRoute, /attempt_payment\.id is not null as attempt_settled/);
    assert.doesNotMatch(statusRoute, /attempt_tx_hash/);
    assert.match(statusRoute, /attempt_payment\.created_at as attempt_created_at/);
    assert.doesNotMatch(statusRoute, /pl\.verified_tx_hash|pl\.paid_at/);
    assert.match(page, /isValidPaymentLinkId\(id\)/);
    assert.doesNotMatch(page, /\[0-9a-fA-F-\]\{36\}/);
    assert.match(settlementVersion, /Number\.isNaN\(parsed\.getTime\(\)\)/);
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

test("checkout requires a wallet-owned session and OTP-verified email before payment", () => {
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");
    const embeddedPay = source("src/app/api/user/payment-links/[id]/pay/route.ts");
    const subscribe = source("src/app/api/user/subscription/subscribe/route.ts");
    const verify = source("src/app/api/payment-links/verify/route.ts");
    const provenance = source("src/lib/auth/verifiedEmail.ts");

    assert.match(client, /handleAuthenticateConnectedWallet/);
    assert.match(client, /buildWalletAuthMessage/);
    assert.match(client, /Verify connected wallet/);
    assert.match(client, /A verified email and OTP confirmation are mandatory before payment/);
    assert.match(client, /payerNeedsEmail = Boolean\(canBindPayerEmail && !sessionInfo\?\.email\)/);
    assert.match(embeddedPay, /Verify an email address with OTP before paying/);
    assert.match(subscribe, /Verify an email address with OTP before subscribing/);
    assert.match(verify, /authenticated wallet does not match the payer/);
    assert.match(verify, /getVerifiedAccountEmail\(sessionWallet\)/);
    assert.match(provenance, /email_verified_at is not null/);
});

test("a payment completed from the desktop QR updates the anonymous checkout", () => {
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");
    const status = source("src/app/api/payment-links/[id]/status/route.ts");

    assert.match(client, /\(verificationStatus && !verificationError\) \? verificationPanel/);
    assert.doesNotMatch(client, /embeddedPaySession && verificationStatus && !verificationError/);
    assert.match(client, /void poll\(\)/);
    assert.match(client, /data\?\.attemptSettled === true/);
    assert.doesNotMatch(client, /data\?\.verifiedTxHash/);
    assert.match(client, /checkoutAttemptId: clientIntentId/);
    assert.match(status, /checkout_attempt_id/);
    assert.match(status, /attemptSettled: result\.attempt_settled === true/);
    assert.doesNotMatch(status, /verifiedTxHash:/);
});

test("money movement requires review and never exposes a cancel result after broadcast", () => {
    const checkout = source("src/app/pay/[id]/PublicPayClient.tsx");
    const dashboard = source("src/app/dashboard/user/page.tsx");
    const withdrawal = source("src/components/WithdrawModal.tsx");

    assert.match(checkout, /Pay \{displayMerchantName\}\?/);
    assert.match(checkout, /reviewPaymentMode/);
    assert.match(checkout, /!\(pendingVerification \|\| txHash \|\| successTxHash \|\| verificationStatus \|\| isPaying \|\| isEmbeddedPaying \|\| isVerifying\)/);
    assert.match(checkout, /We will reuse this payment until confirmation completes/);
    assert.match(checkout, /verificationStatus && !verificationError/);

    assert.match(dashboard, /Review transfer/);
    assert.match(dashboard, /waitForTransactionReceipt\(\{ hash \}\)/);
    assert.match(dashboard, /Number\(amount\) > walletBalance/);
    assert.doesNotMatch(dashboard, /will automatically bridge the remaining/);

    assert.match(withdrawal, /Review withdrawal/);
    assert.match(withdrawal, /on-chain transfer cannot be reversed/i);
    assert.match(withdrawal, /Batch payouts unavailable/);
});

test("a completed CCTP burn is resumable and cannot be presented as a fresh bridge", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");

    assert.match(dashboard, /subscript:cctp-recovery/);
    assert.match(dashboard, /localStorage\.setItem\(cctpRecoveryKey/);
    assert.match(dashboard, /Resume existing bridge/);
    assert.match(dashboard, /do not burn again/);
    assert.match(dashboard, /const bridgeableUsdc = sepoliaUsdc/);
});

test("live usage accrual is idempotent across retries", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    const route = source("src/app/api/user/vault/report-usage/route.ts");

    assert.match(dashboard, /usageInFlight\.current/);
    assert.match(dashboard, /"x-request-id": usageRequestKey\.current/);
    assert.match(route, /request\.headers\.get\("x-request-id"\)/);
    assert.match(route, /where request_id = \$1 and merchant_address = \$2 and user_address = \$3/);
    assert.match(route, /idempotency_conflict/);
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

test("subscription checkout binds OTP correctly and cannot false-succeed after broadcast", () => {
    const client = source("src/app/subscribe/[planId]/SubscribeClient.tsx");
    const dashboard = source("src/app/dashboard/user/page.tsx");
    const route = source("src/app/api/user/subscription/subscribe/route.ts");
    const onchain = source("src/lib/subscriptions/onchain.ts");
    const mirror = source("src/lib/subscriptions/mirror.ts");

    assert.match(client, /purpose: "bind_wallet_email"/);
    assert.match(dashboard, /purpose: "bind_wallet_email"/);
    assert.match(route, /EMBEDDED_WALLET_REQUIRED/);
    assert.match(route, /RECONCILIATION_PENDING/);
    assert.match(route, /if \(!subId\)/);
    assert.match(route, /status: "active"/);
    assert.match(onchain, /findActiveOnChainSubscriptionId\(walletAddress, merchant\)/);
    assert.doesNotMatch(mirror, /subscription create failed/);
});

test("subscription checkout preserves merchant terms and return flow", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const meta = source("src/lib/subscriptionCheckout.ts");
    const client = source("src/app/subscribe/[planId]/SubscribeClient.tsx");

    assert.match(api, /minCommitmentSeconds = Number\(plan\.minCommitmentSeconds/);
    assert.match(api, /successUrlResult/);
    assert.match(api, /beneficiary: beneficiaryAddress/);
    assert.match(meta, /minCommitmentSeconds/);
    assert.match(meta, /successUrl/);
    assert.match(client, /window\.location\.assign\(plan\.successUrl\)/);
    assert.match(client, /subscript_subscription_attempt/);
});
