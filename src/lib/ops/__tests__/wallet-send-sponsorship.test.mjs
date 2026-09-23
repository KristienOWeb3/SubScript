import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("wallet sends are user-paid: sender charged the Arc network fee, never sponsored", () => {
    const route = source("src/app/api/user/wallet/send/route.ts");
    const sponsor = source("src/lib/sponsor/sponsorship.ts");

    /* USER→USER sends must never draw on the merchant-commerce sponsorship budget. */
    assert.doesNotMatch(route, /await requireSponsoredGas/);
    assert.doesNotMatch(route, /import \{ requireSponsoredGas \}/);
    assert.doesNotMatch(route, /action: "wallet_send"/);
    assert.doesNotMatch(sponsor, /\| "wallet_send"/);

    /* Fee-recovery: estimate up front, guard that the balance covers amount + fee, and recover the
       fee after the transfers settle. The transfer itself is marked user-paid. */
    assert.match(route, /estimateArcNetworkFeeMicros\(parsedRecipients\.length\)/);
    assert.match(route, /INSUFFICIENT_BALANCE_FOR_FEE/);
    assert.match(route, /gasPayer: "wallet"/);

    const loopAt = route.indexOf("for (let i = 0; i < parsedRecipients.length; i++)");
    const transferAt = route.indexOf("await custody.executeContract", loopAt);
    const chargeAt = route.indexOf("await chargeNetworkFee(", transferAt);
    /* Fee is charged only after the transfer loop has run (never for a send that didn't happen). */
    assert.ok(loopAt !== -1 && transferAt > loopAt && chargeAt > transferAt);
});

test("wallet send route maps CirclePaymasterPolicyError to CIRCLE_PAYMASTER_POLICY_REQUIRED with 503", () => {
    const route = source("src/app/api/user/wallet/send/route.ts");
    assert.match(route, /CirclePaymasterPolicyError/);
    assert.match(route, /code: isPaymasterError \? "CIRCLE_PAYMASTER_POLICY_REQUIRED"/);
    assert.match(route, /isPaymasterError \? 503 : 400/);
    assert.match(route, /if \(error instanceof CirclePaymasterPolicyError\)/);
});
