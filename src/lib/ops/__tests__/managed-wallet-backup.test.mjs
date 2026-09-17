import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const merchantDashboard = fs.readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
const userDashboard = fs.readFileSync(path.join(root, "src/app/dashboard/user/page.tsx"), "utf8");

test("managed wallets never render export controls and assert non-extractable MPC protection", () => {
    // Neither dashboard exposes raw private key export or download actions
    assert.doesNotMatch(merchantDashboard, /Export Private Key/);
    assert.doesNotMatch(merchantDashboard, /Private-key export unavailable/);
    assert.doesNotMatch(userDashboard, /Export Private Key/);
    assert.doesNotMatch(userDashboard, /Export Not Available/);

    // Both dashboards emphasize non-custodial / non-extractable MPC security architecture
    assert.match(merchantDashboard, /Non-extractable/);
    assert.match(merchantDashboard, /MPC Security/);
    assert.match(userDashboard, /MPC Protected/);
    assert.match(userDashboard, /Zero Raw Key Exposure/);
});

