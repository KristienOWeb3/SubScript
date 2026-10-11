import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const merchantDashboard = fs.readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
const userDashboard = fs.readFileSync(path.join(root, "src/app/dashboard/user/page.tsx"), "utf8");

test("managed wallets never render export controls or misleading user security claims", () => {
    // Neither dashboard exposes raw private key export or download actions
    assert.doesNotMatch(merchantDashboard, /Export Private Key/);
    assert.doesNotMatch(merchantDashboard, /Private-key export unavailable/);
    assert.doesNotMatch(userDashboard, /Export Private Key/);
    assert.doesNotMatch(userDashboard, /Export Not Available/);

    // Merchant security information is retained; the user dashboard omits the retired block.
    assert.match(merchantDashboard, /Non-extractable/);
    assert.match(merchantDashboard, /MPC Security/);
    assert.doesNotMatch(userDashboard, /Non-Custodial Wallet Security/);
    assert.doesNotMatch(userDashboard, /MPC Protected/);
    assert.doesNotMatch(userDashboard, /Zero Raw Key Exposure/);
});

