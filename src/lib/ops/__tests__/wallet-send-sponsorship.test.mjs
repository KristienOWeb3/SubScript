import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("wallet sends enforce sponsorship before every irreversible transfer", () => {
    const route = source("src/app/api/user/wallet/send/route.ts");
    const sponsor = source("src/lib/sponsor/sponsorship.ts");

    assert.match(sponsor, /\| "wallet_send"/);
    assert.match(route, /import \{ requireSponsoredGas \} from "@\/lib\/sponsor\/sponsorship"/);
    assert.match(route, /action: "wallet_send"/);

    const loopAt = route.indexOf("for (let i = 0; i < parsedRecipients.length; i++)");
    const sponsorAt = route.indexOf("await requireSponsoredGas", loopAt);
    const transferAt = route.indexOf("await custody.executeContract", loopAt);
    assert.ok(loopAt !== -1 && loopAt < sponsorAt && sponsorAt < transferAt);
    assert.match(route, /requestKey: `wallet-send:\$\{normalizedSender\}:\$\{requestId\}:\$\{item\.receiver\}:\$\{item\.amountMicros\.toString\(\)\}`/);
});

test("wallet send route maps CirclePaymasterPolicyError to CIRCLE_PAYMASTER_POLICY_REQUIRED with 503", () => {
    const route = source("src/app/api/user/wallet/send/route.ts");
    assert.match(route, /CirclePaymasterPolicyError/);
    assert.match(route, /code: isPaymasterError \? "CIRCLE_PAYMASTER_POLICY_REQUIRED"/);
    assert.match(route, /isPaymasterError \? 503 : 400/);
    assert.match(route, /if \(error instanceof CirclePaymasterPolicyError\)/);
});

