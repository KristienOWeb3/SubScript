import { test } from "node:test";
import assert from "node:assert/strict";
import { adminWalletAllowlist, isRootAdmin } from "../allowlist.js";

test("adminWalletAllowlist is empty when neither admin env var is set", () => {
  const origAddrs = process.env.ADMIN_WALLET_ADDRESSES;
  const origAddr = process.env.ADMIN_WALLET_ADDRESS;
  try {
    delete process.env.ADMIN_WALLET_ADDRESSES;
    delete process.env.ADMIN_WALLET_ADDRESS;

    // Unset must fail closed: no wallet is root, so a deploy that forgets the
    // variable locks the console instead of handing it to a hardcoded address.
    const set = adminWalletAllowlist();
    assert.equal(set.size, 0);

    const previouslyHardcoded = "0x497b0e2c08fb93464354e7023f040e088b169a3f";
    assert.equal(set.has(previouslyHardcoded), false);
    assert.equal(isRootAdmin(previouslyHardcoded), false);
    assert.equal(isRootAdmin(previouslyHardcoded.toUpperCase()), false);
    assert.equal(isRootAdmin("0x1111111111111111111111111111111111111111"), false);
  } finally {
    if (origAddrs !== undefined) process.env.ADMIN_WALLET_ADDRESSES = origAddrs;
    else delete process.env.ADMIN_WALLET_ADDRESSES;
    if (origAddr !== undefined) process.env.ADMIN_WALLET_ADDRESS = origAddr;
    else delete process.env.ADMIN_WALLET_ADDRESS;
  }
});

test("adminWalletAllowlist falls back to the singular ADMIN_WALLET_ADDRESS", () => {
  const origAddrs = process.env.ADMIN_WALLET_ADDRESSES;
  const origAddr = process.env.ADMIN_WALLET_ADDRESS;
  try {
    delete process.env.ADMIN_WALLET_ADDRESSES;
    process.env.ADMIN_WALLET_ADDRESS = "0x3333333333333333333333333333333333333333";

    const set = adminWalletAllowlist();
    assert.equal(set.size, 1);
    assert.equal(isRootAdmin("0x3333333333333333333333333333333333333333"), true);
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
