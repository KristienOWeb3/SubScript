import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("financial step-up tokens are live-session and exact-operation bound", async () => {
    const helper = await source("src/lib/auth/stepUp.ts");

    assert.match(helper, /getVerifiedSessionToken\(input\.headers\)/);
    assert.match(helper, /sessionDigest\(session\.token\)/);
    assert.match(helper, /audience: STEP_UP_AUDIENCE/);
    assert.match(helper, /subject: wallet/);
    assert.match(helper, /bindingsMatch\(payload\.binding, binding\)/);
    assert.match(helper, /payload\.authenticatedAt/);
    assert.match(helper, /ageMs >= 0 && ageMs <= maxAgeMs/);
});

test("withdrawTo only accepts owned destinations without exact step-up authorization", async () => {
    const route = await source("src/app/api/execute-tx/route.ts");

    assert.match(route, /typeof withdrawTarget === "string" && isAddress\(withdrawTarget\)/);
    assert.match(route, /select\("payout_destination"\)/);
    assert.match(route, /normalizedTarget === wallet\.toLowerCase\(\)/);
    assert.match(route, /normalizedTarget === registeredPayout/);
    assert.match(route, /binding: \{ action: "withdrawTo", recipient: normalizedTarget \}/);
    assert.ok(
        route.indexOf("authorizeFinancialStepUp") < route.indexOf('functionName = "withdrawTo"'),
        "step-up must be checked before custody is configured to submit withdrawTo",
    );
});

test("payroll permit amount is recomputed from the same recipient items callers submit", async () => {
    const [route, payroll] = await Promise.all([
        source("src/app/api/merchant/payroll/permit-sign/route.ts"),
        source("src/app/dashboard/payroll/PayrollContent.tsx"),
    ]);

    assert.match(route, /getVerifiedSessionToken\(request\.headers\)/);
    assert.match(route, /const recipients = body\?\.recipients/);
    assert.match(route, /totalAmount \+= amount/);
    assert.match(route, /body\.totalAmountUsdc !== totalAmount\.toString\(\)/);
    assert.match(route, /binding: \{ action: "payrollPermit", amount: totalAmount\.toString\(\) \}/);
    assert.match(route, /custody\.address\.toLowerCase\(\) !== merchant/);
    assert.ok(
        route.indexOf("totalAmount += amount") < route.indexOf("usdc.allowance"),
        "the exact total must be established before any approval is written",
    );

    assert.match(payroll, /recipients: canonicalRecipients/);
    assert.match(payroll, /recipients: campaign\.recipients\.map/);
});

test("OTP send and verify use shared counters and wallet-bound step-up challenges", async () => {
    const [send, verify] = await Promise.all([
        source("src/app/api/auth/otp/send/route.ts"),
        source("src/app/api/auth/otp/verify/route.ts"),
    ]);

    for (const route of [send, verify]) {
        assert.match(route, /consumeDistributedRateLimit/);
        assert.doesNotMatch(route, /checkProviderRateLimit/);
        assert.match(route, /scope: "otp-[a-z]+-ip"/);
        assert.match(route, /scope: "otp-[a-z]+-email"/);
    }
    assert.match(send, /purpose === "financial_step_up"/);
    assert.match(send, /emailBinding\.walletAddress\.toLowerCase\(\) !== bindingWallet/);
    assert.match(verify, /wallet_address is not distinct from \$3/);
    assert.match(verify, /createFinancialStepUpToken\(activeSession, stepUpBinding\)/);
});
