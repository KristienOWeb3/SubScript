import { test } from "node:test";
import assert from "node:assert/strict";
import { adminWalletAllowlist, isRootAdmin } from "../allowlist.js";

test("adminWalletAllowlist includes default admin wallet fallback", () => {
  const defaultWallet = "0x497b0e2c08fb93464354e7023f040e088b169a3f";
  const set = adminWalletAllowlist();
  assert.equal(set.has(defaultWallet), true);
  assert.equal(isRootAdmin(defaultWallet), true);
  assert.equal(isRootAdmin(defaultWallet.toUpperCase()), true);
});

test("isRootAdmin returns false for non-admin wallet", () => {
  assert.equal(isRootAdmin("0x0000000000000000000000000000000000000001"), false);
  assert.equal(isRootAdmin(null), false);
  assert.equal(isRootAdmin(undefined), false);
});
