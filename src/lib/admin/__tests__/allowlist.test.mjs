import { test } from "node:test";
import assert from "node:assert/strict";
import { adminWalletAllowlist, isRootAdmin } from "../allowlist.js";

test("adminWalletAllowlist includes default admin wallet fallback", () => {
  const origAddrs = process.env.ADMIN_WALLET_ADDRESSES;
  const origAddr = process.env.ADMIN_WALLET_ADDRESS;
  try {
    delete process.env.ADMIN_WALLET_ADDRESSES;
    delete process.env.ADMIN_WALLET_ADDRESS;

    const defaultWallet = "0x497b0e2c08fb93464354e7023f040e088b169a3f";
    const set = adminWalletAllowlist();
    assert.equal(set.has(defaultWallet), true);
    assert.equal(isRootAdmin(defaultWallet), true);
    assert.equal(isRootAdmin(defaultWallet.toUpperCase()), true);
  } finally {
    if (origAddrs !== undefined) process.env.ADMIN_WALLET_ADDRESSES = origAddrs;
    else delete process.env.ADMIN_WALLET_ADDRESSES;
    if (origAddr !== undefined) process.env.ADMIN_WALLET_ADDRESS = origAddr;
    else delete process.env.ADMIN_WALLET_ADDRESS;
  }
});

test("adminWalletAllowlist respects ADMIN_WALLET_ADDRESSES env var", () => {
  const origAddrs = process.env.ADMIN_WALLET_ADDRESSES;
  try {
    process.env.ADMIN_WALLET_ADDRESSES = "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222";
    const set = adminWalletAllowlist();
    assert.equal(set.has("0x1111111111111111111111111111111111111111"), true);
    assert.equal(set.has("0x2222222222222222222222222222222222222222"), true);
    assert.equal(isRootAdmin("0x1111111111111111111111111111111111111111"), true);
  } finally {
    if (origAddrs !== undefined) process.env.ADMIN_WALLET_ADDRESSES = origAddrs;
    else delete process.env.ADMIN_WALLET_ADDRESSES;
  }
});

test("isRootAdmin returns false for non-admin wallet", () => {
  assert.equal(isRootAdmin("0x0000000000000000000000000000000000000001"), false);
  assert.equal(isRootAdmin(null), false);
  assert.equal(isRootAdmin(undefined), false);
});
