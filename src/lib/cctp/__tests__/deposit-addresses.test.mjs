import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  deriveDepositAddress,
  isValidDerivedAddress,
} from "../depositAddresses.ts";

const TEST_RELAYER_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f24d3028c2a3b3015e";
const USER_A = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
const USER_B = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295";

describe("Deposit Address HD Derivation", () => {
  const originalRelayerKey = process.env.RELAYER_PRIVATE_KEY;
  const originalSponsorKey = process.env.SPONSOR_PRIVATE_KEY;

  beforeEach(() => {
    process.env.RELAYER_PRIVATE_KEY = TEST_RELAYER_KEY;
    delete process.env.SPONSOR_PRIVATE_KEY;
  });

  afterEach(() => {
    if (originalRelayerKey !== undefined) {
      process.env.RELAYER_PRIVATE_KEY = originalRelayerKey;
    } else {
      delete process.env.RELAYER_PRIVATE_KEY;
    }
    if (originalSponsorKey !== undefined) {
      process.env.SPONSOR_PRIVATE_KEY = originalSponsorKey;
    } else {
      delete process.env.SPONSOR_PRIVATE_KEY;
    }
  });

  it("derives a valid 42-character Ethereum address", () => {
    const address = deriveDepositAddress(USER_A);
    assert.equal(typeof address, "string");
    assert.equal(address.length, 42);
    assert.ok(/^0x[0-9a-f]{40}$/.test(address));
    assert.ok(ethers.isAddress(address));
  });

  it("is deterministic — same wallet always produces the same derived address", () => {
    const addr1 = deriveDepositAddress(USER_A);
    const addr2 = deriveDepositAddress(USER_A);
    const addr3 = deriveDepositAddress(USER_A.toLowerCase());
    const addr4 = deriveDepositAddress(USER_A.toUpperCase().replace("0X", "0x"));

    assert.equal(addr1, addr2);
    assert.equal(addr1, addr3);
    assert.equal(addr1, addr4);
  });

  it("produces distinct deposit addresses for different users", () => {
    const addrA = deriveDepositAddress(USER_A);
    const addrB = deriveDepositAddress(USER_B);

    assert.notEqual(addrA, addrB);
  });

  it("falls back to SPONSOR_PRIVATE_KEY when RELAYER_PRIVATE_KEY is not set", () => {
    delete process.env.RELAYER_PRIVATE_KEY;
    process.env.SPONSOR_PRIVATE_KEY = TEST_RELAYER_KEY;

    const addrFromSponsor = deriveDepositAddress(USER_A);

    process.env.RELAYER_PRIVATE_KEY = TEST_RELAYER_KEY;
    delete process.env.SPONSOR_PRIVATE_KEY;

    const addrFromRelayer = deriveDepositAddress(USER_A);
    assert.equal(addrFromSponsor, addrFromRelayer);
  });

  it("throws when no relayer/sponsor key is configured", () => {
    delete process.env.RELAYER_PRIVATE_KEY;
    delete process.env.SPONSOR_PRIVATE_KEY;

    assert.throws(
      () => deriveDepositAddress(USER_A),
      /No relayer key configured/i
    );
  });

  it("rejects invalid wallet address formats", () => {
    assert.throws(
      () => deriveDepositAddress("not-an-address"),
      /Invalid wallet address/i
    );
    assert.throws(
      () => deriveDepositAddress("0x123"),
      /Invalid wallet address/i
    );
  });

  it("validates derived address correctly with isValidDerivedAddress", () => {
    const derived = deriveDepositAddress(USER_A);
    assert.equal(isValidDerivedAddress(USER_A, derived), true);
    assert.equal(isValidDerivedAddress(USER_A, derived.toUpperCase()), true);
    assert.equal(isValidDerivedAddress(USER_A, USER_B), false);
    assert.equal(isValidDerivedAddress(USER_B, derived), false);
  });
});
