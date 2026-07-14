import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

test("customer checkout renders merchant names without wallet-address affordances", async () => {
    const [checkout, checkoutPage, subscribe, subscribePage] = await Promise.all([
        source("src/app/pay/[id]/PublicPayClient.tsx"),
        source("src/app/pay/[id]/page.tsx"),
        source("src/app/subscribe/[planId]/SubscribeClient.tsx"),
        source("src/app/subscribe/[planId]/page.tsx"),
    ]);

    assert.match(checkout, /Pay \{displayMerchantName\}\?/);
    assert.match(checkout, /merchantDisplayName\(linkData\?\.merchant_display_name\)/);
    assert.doesNotMatch(checkout, /\{linkData\?\.merchant_address\}/);
    assert.doesNotMatch(checkout, /arcscan\.app\/.*\$\{.*tx/i);
    assert.match(checkout, /if \(pendingVerification\) \{\s*retryPendingVerification\(\)/);
    assert.match(checkout, /pendingVerification[\s\S]*Continue verification/);

    assert.match(checkoutPage, /merchant_display_name: merchantDisplayName\(alias\?\.alias\)/);
    assert.doesNotMatch(checkoutPage, /merchant_address\.slice/);
    assert.doesNotMatch(subscribe, /Merchant wallet/i);
    assert.doesNotMatch(subscribe, /\{plan\.merchantAddress\}/);
    assert.match(subscribePage, /merchantDisplayName\(plan\.merchant_alias\)/);
});

test("receipts and customer activity keep proof inside SubScript", async () => {
    const [receipt, dashboard, transactions] = await Promise.all([
        source("src/app/receipt/[receiptId]/ReceiptClient.tsx"),
        source("src/app/dashboard/user/page.tsx"),
        source("src/app/dashboard/user/transactions/page.tsx"),
    ]);

    for (const customerSurface of [receipt, dashboard, transactions]) {
        assert.doesNotMatch(customerSurface, /(?:explorer\.testnet\.arc\.network|testnet\.arcscan\.app)\/tx\//i);
    }
    assert.doesNotMatch(dashboard, /Merchant wallet address/i);
    assert.doesNotMatch(dashboard, /placeholder="merchant\.sub or 0x\.\.\."/i);
    assert.match(
        dashboard,
        /fetch\(`\/api\/merchant\/alias\?alias=\$\{encodeURIComponent\(merchantAddress\)\}`\)/,
    );
    assert.doesNotMatch(
        dashboard,
        /if \(!merchantAddress\.startsWith\("0x"\)\) \{\s*const resolved = await resolveRecipient/,
    );
});

test("identity components never expose an address fallback or tooltip", async () => {
    const [identity, display] = await Promise.all([
        source("src/components/Identity.tsx"),
        source("src/lib/identityDisplay.ts"),
    ]);

    assert.match(identity, /accountDisplayName\(alias/);
    assert.doesNotMatch(identity, /shortAddress/);
    assert.doesNotMatch(identity, /title=\{address/);
    assert.match(display, /sub\|hq\|biz/i);
    assert.match(display, /SubScript merchant/);
    assert.match(display, /SubScript account/);
});

test("customer APIs use neutral names instead of raw-address fallbacks", async () => {
    const [subscriptions, vaults, dms] = await Promise.all([
        source("src/app/api/user/subscriptions/route.ts"),
        source("src/app/api/user/vault/config/route.ts"),
        source("src/app/api/user/dms/route.ts"),
    ]);

    assert.match(subscriptions, /merchantName: merchantDisplayName\(aliasInfo\?\.alias\)/);
    assert.match(vaults, /merchantName: merchantDisplayName/);
    assert.match(dms, /senderName:[\s\S]*merchantDisplayName/);
    assert.doesNotMatch(subscriptions, /merchantName:[^\n]*sub\.merchantAddress/);
    assert.doesNotMatch(vaults, /merchantName:[^\n]*\|\| v\.merchantAddress/);
});
