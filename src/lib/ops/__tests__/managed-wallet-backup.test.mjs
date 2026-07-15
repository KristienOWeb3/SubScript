import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const merchantDashboard = fs.readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
const userDashboard = fs.readFileSync(path.join(root, "src/app/dashboard/user/page.tsx"), "utf8");

test("managed wallets never render a dead backup/export card on either dashboard", () => {
    assert.match(userDashboard, /userSettings\?\.walletBackup\?\.available\s*&&/);
    assert.match(merchantDashboard, /userSettings\.walletBackup\?\.available\s*&&/);
    assert.doesNotMatch(merchantDashboard, /Private-key export unavailable/);
    assert.doesNotMatch(userDashboard, /Export Not Available/);
});
