import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MIN_BRIDGE_AMOUNT_MICROS, MIN_BRIDGE_AMOUNT_L1_MICROS, MIN_BRIDGE_AMOUNT_L2_MICROS, getMinBridgeAmount } from "../feeEngine.ts";
import { ARC_CCTP_DOMAIN_ID, CCTP_CONFIG } from "../../contracts/constants.ts";

describe("CCTP Auto-Bridge Configurations", () => {
  it("enforces a minimum bridge amount of 10 USDC on Ethereum L1 and 1 USDC on L2s", () => {
    assert.equal(MIN_BRIDGE_AMOUNT_L1_MICROS, 10_000_000n);
    assert.equal(MIN_BRIDGE_AMOUNT_L2_MICROS, 1_000_000n);
    assert.equal(getMinBridgeAmount(11155111), 10_000_000n);
    assert.equal(getMinBridgeAmount(84532), 1_000_000n);
    assert.equal(getMinBridgeAmount(421614), 1_000_000n);
  });

  it("configures Arc domain correctly as domain 26", () => {
    assert.equal(ARC_CCTP_DOMAIN_ID, 26);
  });

  it("ensures all supported EVM chains allow inbound deposits with valid configs", () => {
    for (const [chainIdStr, info] of Object.entries(CCTP_CONFIG)) {
      const chainId = Number(chainIdStr);
      assert.ok(chainId > 0, `Valid chainId for ${info.name}`);
      assert.equal(info.allowDeposits, true, `Chain ${info.name} should allow deposits`);
      assert.ok(info.tokenMessenger.startsWith("0x"), `TokenMessenger address on ${info.name}`);
      assert.ok(info.messageTransmitter.startsWith("0x"), `MessageTransmitter address on ${info.name}`);
      assert.ok(info.usdc.startsWith("0x"), `USDC address on ${info.name}`);
      assert.ok(typeof info.domain === "number", `Domain number on ${info.name}`);
      assert.ok(info.feeBps >= 0, `Valid feeBps on ${info.name}`);
    }
  });

  it("exports scanDerivedDepositAddresses from crossChainScanner", async () => {
    const { scanDerivedDepositAddresses } = await import("../crossChainScanner.ts");
    assert.equal(typeof scanDerivedDepositAddresses, "function");
  });

  it("exports sweepAndBridge from autoBridge", async () => {
    const { sweepAndBridge } = await import("../autoBridge.ts");
    assert.equal(typeof sweepAndBridge, "function");
  });
});
