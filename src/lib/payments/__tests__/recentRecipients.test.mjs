import assert from "node:assert/strict";
import test from "node:test";
import { recentRecipients } from "../recentRecipients.ts";

const address = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
test("recent aliases and their wallet resolve to a single real recipient", () => {
  const result = recentRecipients("arc", [
    { dnsName: "@Nora.sub", counterpartyAddress: address, recipientChain: "arc" },
    { counterpartyAddress: address.toLowerCase(), recipientChain: "arc" },
    { dnsName: "nora.sub", recipientChain: "arc" },
  ], [{ id: "older", chain: "arc", type: "wallet", target: address, label: address }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].target, "nora.sub");
});

test("new users get an empty history and other network/incoming recipients stay out", () => {
  assert.deepEqual(recentRecipients("arc", [], []), []);
  assert.deepEqual(recentRecipients("arc", [
    { incoming: true, counterpartyAddress: address, recipientChain: "arc" },
    { counterpartyAddress: address, recipientChain: "8453" },
  ], []), []);
  assert.equal(recentRecipients("base", [{ counterpartyAddress: address, recipientChain: "8453" }], []).length, 1);
});

test("case-sensitive Solana identities are not merged; truncated targets are excluded", () => {
  const stored = ["AbCd", "abcd", "Ab…Cd"].map((target, index) => ({ id: String(index), chain: "solana", type: "wallet", target, label: target }));
  assert.deepEqual(recentRecipients("solana", [], stored).map(item => item.target), ["AbCd", "abcd"]);
});

test("DNS spelling and suffix casing deduplicate without address metadata", () => {
  const stored = ["@Nora.SUB", "nora.sub"].map((target, index) => ({ id: String(index), chain: "arc", type: "dns", target, label: target }));
  assert.equal(recentRecipients("arc", [], stored).length, 1);
});
