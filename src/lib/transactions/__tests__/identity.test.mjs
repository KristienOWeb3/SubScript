import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTransactionDirection,
  getRecognizedAccountName,
  normalizeEvmAddress,
} from "../identity.ts";

const viewer = "0xAa000000000000000000000000000000000000Bb";
const peer = "0xCc000000000000000000000000000000000000Dd";

test("normalizes valid EVM addresses case-insensitively and rejects malformed values", () => {
  assert.equal(normalizeEvmAddress(`  ${viewer}  `), viewer.toLowerCase());
  assert.equal(normalizeEvmAddress("0x1234"), null);
  assert.equal(normalizeEvmAddress("not-an-address"), null);
});

test("classifies incoming and outgoing directions from validated addresses", () => {
  assert.equal(classifyTransactionDirection({ authenticatedAddress: viewer.toLowerCase(), fromAddress: peer, toAddress: viewer }), "incoming");
  assert.equal(classifyTransactionDirection({ authenticatedAddress: viewer.toUpperCase().replace("0X", "0x"), fromAddress: viewer, toAddress: peer }), "outgoing");
  assert.equal(classifyTransactionDirection({ authenticatedAddress: "broken", fromAddress: peer, toAddress: viewer }), null);
  assert.equal(classifyTransactionDirection({ authenticatedAddress: "broken", fallback: "incoming" }), "incoming");
});

test("recognizes real account identities without inventing identities for wallets or placeholders", () => {
  assert.equal(getRecognizedAccountName("@alice", null), "alice");
  assert.equal(getRecognizedAccountName(null, peer), null);
  assert.equal(getRecognizedAccountName(null, "Recipient"), null);
});

