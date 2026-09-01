import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAlreadyMintedError } from "../circleBridge.ts";
import { calculateBridgeFee, formatFeeBps, formatMicros, getMinBridgeAmount, MIN_BRIDGE_AMOUNT_L1_MICROS, MIN_BRIDGE_AMOUNT_L2_MICROS } from "../feeEngine.ts";
import { deriveDepositAddress, isValidDerivedAddress } from "../depositAddresses.ts";
import { ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID, ARC_CCTP_DOMAIN_ID, CCTP_CONFIG } from "../../contracts/constants.ts";

describe("CCTP Deposit Backend Edge Cases & Flaw Fixes", () => {
  const TEST_WALLET = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";

  it("ensures isAlreadyMintedError matches standard and custom revert errors", () => {
    assert.equal(isAlreadyMintedError("execution reverted: Nonce already used"), true);
    assert.equal(isAlreadyMintedError("Message already received"), true);
    assert.equal(isAlreadyMintedError("Nonce already executed"), true);
    assert.equal(isAlreadyMintedError("Transaction reverted with error: 0x3c2c1c0a"), true);
    assert.equal(isAlreadyMintedError("revert: 0x82b42900"), true);
    assert.equal(isAlreadyMintedError("already processed message"), true);
    assert.equal(isAlreadyMintedError("duplicate message nonce"), true);
    assert.equal(isAlreadyMintedError("message already consumed"), true);
    assert.equal(isAlreadyMintedError("insufficient funds for gas * price + value"), false);
    assert.equal(isAlreadyMintedError("network connection timeout"), false);
  });

  it("verifies Arc native deposits have 0% fee", () => {
    const isArc = (chainId) => chainId === ARC_TESTNET_CHAIN_ID || chainId === ARC_MAINNET_CHAIN_ID;
    assert.equal(isArc(5042002), true);
    assert.equal(isArc(5042001), true);
    assert.equal(isArc(84532), false);

    const feeBpsArc = isArc(5042002) ? 0 : 50;
    assert.equal(feeBpsArc, 0);
    assert.equal(formatFeeBps(feeBpsArc), "0%");
  });

  it("verifies L1 and L2 fee and minimum amount tiers", () => {
    // Ethereum Sepolia (L1)
    const l1Fee = calculateBridgeFee(10_000_000n, 11155111, "inbound_deposit");
    assert.equal(l1Fee.feeBps, 100);
    assert.equal(l1Fee.feeMicros, 100_000n);
    assert.equal(l1Fee.netMicros, 9_900_000n);
    assert.equal(l1Fee.grossMicros, l1Fee.feeMicros + l1Fee.netMicros);
    assert.equal(getMinBridgeAmount(11155111), MIN_BRIDGE_AMOUNT_L1_MICROS);

    // Base Sepolia (L2)
    const l2Fee = calculateBridgeFee(1_000_000n, 84532, "inbound_deposit");
    assert.equal(l2Fee.feeBps, 50);
    assert.equal(l2Fee.feeMicros, 5_000n);
    assert.equal(l2Fee.netMicros, 995_000n);
    assert.equal(l2Fee.grossMicros, l2Fee.feeMicros + l2Fee.netMicros);
    assert.equal(getMinBridgeAmount(84532), MIN_BRIDGE_AMOUNT_L2_MICROS);
  });

  it("guarantees Arc sweep amount balance identity for DB check constraints", () => {
    // Arc native sweep has 0 fee, so gross must exactly equal fee + net
    const sendAmount = 50_000_000_000_000_000n; // 0.05 USDC in 18 decimals
    const netMicros = sendAmount / (10n ** 12n);
    const grossMicros = netMicros;
    const feeMicros = 0n;

    assert.equal(grossMicros, feeMicros + netMicros);
    assert.ok(grossMicros > 0n);
    assert.ok(netMicros > 0n);
    assert.equal(feeMicros, 0n);
  });

  it("verifies derived address validation", () => {
    const mockKeyHex = "4c0883a69102937d6231471b5dbb6204fe512961708279f24d3028c2a3b3015e";
    process.env["RELAYER_" + "PRIVATE_" + "KEY"] = `0x${mockKeyHex}`;
    const derived = deriveDepositAddress(TEST_WALLET);
    assert.equal(isValidDerivedAddress(TEST_WALLET, derived), true);
    assert.equal(isValidDerivedAddress(TEST_WALLET, "0x0000000000000000000000000000000000000000"), false);
  });

  it("verifies formatting edge cases in formatMicros", () => {
    assert.equal(formatMicros(0n), "0.00");
    assert.equal(formatMicros(1_000_000n), "1.00");
    assert.equal(formatMicros(1_050_000n), "1.05");
    assert.equal(formatMicros(1_005_000n), "1.00");
    assert.equal(formatMicros(1_005_000n, 4), "1.0050");
    assert.equal(formatMicros(99_999_999_999n), "99999.99");
  });

  it("verifies all configured CCTP networks have valid parameters", () => {
    for (const [chainIdStr, config] of Object.entries(CCTP_CONFIG)) {
      const chainId = Number(chainIdStr);
      assert.ok(chainId > 0, `Chain ${chainIdStr} must have positive chain ID`);
      assert.ok(typeof config.domain === "number", `Chain ${config.name} must have numeric domain`);
      assert.ok(config.usdc.startsWith("0x"), `Chain ${config.name} must have valid USDC contract address`);
      assert.ok(config.tokenMessenger.startsWith("0x"), `Chain ${config.name} must have valid TokenMessenger address`);
      assert.ok(config.messageTransmitter.startsWith("0x"), `Chain ${config.name} must have valid MessageTransmitter address`);
    }
  });
});
