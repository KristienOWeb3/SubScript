import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (file) => fs.readFileSync(path.resolve(file), "utf8");

test("dashboard modal rendering disables full-screen opacity and backdrop-filter flashes", () => {
  const css = source("src/app/globals.css");

  assert.match(css, /\.dashboard-modal-overlay\s*\{[\s\S]*?opacity:\s*1\s*!important/);
  assert.match(css, /\.dashboard-modal-overlay\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important/);
  assert.match(css, /\.dashboard-modal-surface\s*\{[\s\S]*?filter:\s*none\s*!important/);

  for (const file of [
    "src/components/DepositModal.tsx",
    "src/components/SendSingleModal.tsx",
    "src/components/dashboard/DmInviteManagerModal.tsx",
    "src/components/dashboard/DmRequestsModal.tsx",
    "src/components/dashboard/BlockedUsersModal.tsx",
    "src/components/dashboard/MerchantReceiveModal.tsx",
    "src/components/ConfirmModal.tsx",
    "src/components/support/SupportChatModal.tsx",
    "src/app/dashboard/page.tsx",
    "src/app/dashboard/user/page.tsx",
  ]) {
    assert.match(source(file), /dashboard-modal-overlay/, `${file} must use the stable modal overlay`);
  }
});

test("the batch-routing Single Send affordance opens the single-send modal", () => {
  const user = source("src/app/dashboard/user/page.tsx");

  assert.match(
    user,
    /use\s*<button[\s\S]{0,500}onClick=\{\(\)\s*=>\s*setSendSingleModalOpen\(true\)\}[\s\S]{0,500}>Single Send<\/button>/,
  );
});
