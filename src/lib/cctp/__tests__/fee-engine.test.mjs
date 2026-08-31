import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateBridgeFee,
  validateBridgeRequest,
  listBridgeRoutes,
  formatFeeBps,
  formatMicros,
  MIN_BRIDGE_AMOUNT_MICROS,
  MAX_BRIDGE_AMOUNT_MICROS,
} from "../feeEngine.js";
import { CCTP_CONFIG, SOLANA_CCTP_CONFIG } from "../../contracts/constants.js";

/* These run against the testnet config, which is what CCTP_CONFIG exposes unless
   NEXT_PUBLIC_ENVIRONMENT=mainnet. Ethereum Sepolia carries the 1% L1 tier; the L2s carry 0.5%. */
const EVM_WALLET = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
const EVM_RECIPIENT = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295";

describe("CCTP bridge fee engine", () => {
  it("charges 1.0% on the Ethereum L1 tier", () => {
    const fee = calculateBridgeFee(100_000_000n, 11155111, "inbound_deposit");
    assert.equal(fee.grossMicros, 100_000_000n);
    assert.equal(fee.feeMicros, 1_000_000n);
    assert.equal(fee.netMicros, 99_000_000n);
    assert.equal(fee.feeBps, 100);
    assert.equal(fee.feePercentage, "1.0%");
    assert.equal(fee.domain, 0);
  });

  it("charges 0.5% on an L2 tier", () => {
    const fee = calculateBridgeFee(50_000_000n, 84532, "inbound_deposit");
    assert.equal(fee.feeMicros, 250_000n);
    assert.equal(fee.netMicros, 49_750_000n);
    assert.equal(fee.feeBps, 50);
    assert.equal(fee.feePercentage, "0.5%");
    assert.equal(fee.domain, 6);
  });

  /* The split is the whole point: net is what gets burned, and CCTP mints exactly what it burns, so
     gross must always equal fee + net or the destination amount is a lie. The DB enforces the same
     identity with a CHECK constraint. */
  it("always splits gross into exactly fee plus net", () => {
    for (const chainId of Object.keys(CCTP_CONFIG).map(Number)) {
      for (const amount of [10_000_000n, 10_000_001n, 33_333_333n, 999_999_999n]) {
        const fee = calculateBridgeFee(amount, chainId, "outbound_withdrawal");
        assert.equal(fee.feeMicros + fee.netMicros, fee.grossMicros, `chain ${chainId} amount ${amount}`);
        assert.ok(fee.netMicros > 0n);
        assert.ok(fee.feeMicros > 0n);
      }
    }
  });

  it("truncates the fee down, never up", () => {
    /* 1.000001 USDC at 0.5% is 5000.005 micros, which must floor to 5000. */
    const fee = calculateBridgeFee(1_000_001n, 84532, "outbound_withdrawal");
    assert.equal(fee.feeMicros, 5_000n);
    assert.equal(fee.netMicros, 995_001n);
  });

  it("rejects amounts under the minimum", () => {
    assert.throws(() => calculateBridgeFee(999_999n, 84532, "inbound_deposit"), /smallest amount/i);
    assert.throws(() => calculateBridgeFee(0n, 84532, "inbound_deposit"), /smallest amount/i);
    /* L2 minimum is 1 USDC */
    assert.equal(calculateBridgeFee(MIN_BRIDGE_AMOUNT_MICROS, 84532, "inbound_deposit").feeMicros, 5_000n);
    /* Ethereum L1 minimum is 10 USDC */
    assert.throws(() => calculateBridgeFee(9_999_999n, 11155111, "inbound_deposit"), /smallest amount/i);
    assert.equal(calculateBridgeFee(10_000_000n, 11155111, "inbound_deposit").feeMicros, 100_000n);
  });

  it("rejects amounts over the CCTP per-burn cap", () => {
    assert.throws(
      () => calculateBridgeFee(MAX_BRIDGE_AMOUNT_MICROS + 1n, 84532, "outbound_withdrawal"),
      /largest amount/i,
    );
  });

  it("rejects unsupported chains", () => {
    assert.throws(() => calculateBridgeFee(10_000_000n, 999999, "inbound_deposit"), /don't support/i);
  });

  /* Solana withdrawals need a Solana relayer signing against the MessageTransmitter program, and
     nothing here can produce one. Allowing them would burn USDC on Arc with no way to mint the other
     side, so the config keeps them off and the engine has to honour that. */
  it("refuses Solana in both directions while there is no relayer", () => {
    assert.equal(SOLANA_CCTP_CONFIG.allowWithdrawals, false);
    assert.equal(SOLANA_CCTP_CONFIG.allowDeposits, false);
    assert.throws(() => calculateBridgeFee(100_000_000n, 5, "outbound_withdrawal"), /Solana/i);
    assert.throws(() => calculateBridgeFee(100_000_000n, "solana", "inbound_deposit"), /Solana/i);
  });

  it("validates both addresses before quoting", () => {
    assert.throws(
      () =>
        validateBridgeRequest({
          direction: "outbound_withdrawal",
          targetChainIdOrDomain: 84532,
          amountMicros: 50_000_000n,
          userWallet: "not-an-address",
          recipientAddress: EVM_RECIPIENT,
        }),
      /sender wallet/i,
    );

    assert.throws(
      () =>
        validateBridgeRequest({
          direction: "outbound_withdrawal",
          targetChainIdOrDomain: 84532,
          amountMicros: 50_000_000n,
          userWallet: EVM_WALLET,
          recipientAddress: "0xnope",
        }),
      /recipient address/i,
    );

    const valid = validateBridgeRequest({
      direction: "outbound_withdrawal",
      targetChainIdOrDomain: 84532,
      amountMicros: 50_000_000n,
      userWallet: EVM_WALLET,
      recipientAddress: EVM_RECIPIENT,
    });
    assert.equal(valid.netMicros, 49_750_000n);
  });

  /* Derived, not switched on: a hardcoded `feeBps === 100 ? "1.0%" : "0.5%"` silently mislabels any
     future tier as 0.5%. */
  it("formats any tier, not just the two we ship", () => {
    assert.equal(formatFeeBps(0), "0%");
    assert.equal(formatFeeBps(25), "0.3%");
    assert.equal(formatFeeBps(50), "0.5%");
    assert.equal(formatFeeBps(100), "1.0%");
    assert.equal(formatFeeBps(250), "2.5%");
  });

  it("formats micros without floating point drift", () => {
    assert.equal(formatMicros(1_000_000n), "1.00");
    assert.equal(formatMicros(49_750_000n), "49.75");
    assert.equal(formatMicros(5_000n, 6), "0.005000");
    assert.equal(formatMicros(10_000_000_000_000n, 0), "10000000");
  });
});

describe("CCTP route listing", () => {
  it("puts Arc first, free, and always available", () => {
    const routes = listBridgeRoutes("outbound_withdrawal");
    assert.equal(routes[0].id, "arc");
    assert.equal(routes[0].feeBps, 0);
    assert.equal(routes[0].feePercentage, "0%");
    assert.equal(routes[0].available, true);
  });

  it("lists every configured chain with the fee the engine charges", () => {
    const routes = listBridgeRoutes("outbound_withdrawal");
    for (const [chainId, info] of Object.entries(CCTP_CONFIG)) {
      const route = routes.find((r) => r.id === chainId);
      assert.ok(route, `chain ${chainId} missing from the picker`);
      assert.equal(route.feeBps, info.feeBps);
      assert.equal(route.feePercentage, formatFeeBps(info.feeBps));
    }
  });

  it("orders cheaper tiers first so Ethereum is never the default pick", () => {
    const evmRoutes = listBridgeRoutes("outbound_withdrawal").filter((r) => r.id !== "arc" && r.id !== "solana");
    const fees = evmRoutes.map((r) => r.feeBps);
    assert.deepEqual(fees, [...fees].sort((a, b) => a - b));
  });

  it("shows Solana as present but unavailable rather than hiding it", () => {
    const solana = listBridgeRoutes("outbound_withdrawal").find((r) => r.id === "solana");
    assert.ok(solana);
    assert.equal(solana.available, false);
    assert.equal(solana.unavailableReason, "Coming soon");
  });

  it("verifies canonical Circle CCTP testnet contracts and domains", () => {
    // Ethereum Sepolia (Domain 0)
    assert.equal(CCTP_CONFIG[11155111]?.domain, 0);
    assert.equal(CCTP_CONFIG[11155111]?.usdc.toLowerCase(), "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238".toLowerCase());

    // Avalanche Fuji (Domain 1)
    assert.equal(CCTP_CONFIG[43113]?.domain, 1);
    assert.equal(CCTP_CONFIG[43113]?.usdc.toLowerCase(), "0x5425890298aed601595a70AB815c96711a31Bc65".toLowerCase());

    // OP Sepolia (Domain 2)
    assert.equal(CCTP_CONFIG[11155420]?.domain, 2);
    assert.equal(CCTP_CONFIG[11155420]?.usdc.toLowerCase(), "0x5fd84259d66Cd46123540766Be93DFE6D43130D7".toLowerCase());

    // Arbitrum Sepolia (Domain 3)
    assert.equal(CCTP_CONFIG[421614]?.domain, 3);
    assert.equal(CCTP_CONFIG[421614]?.usdc.toLowerCase(), "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d".toLowerCase());

    // Base Sepolia (Domain 6)
    assert.equal(CCTP_CONFIG[84532]?.domain, 6);
    assert.equal(CCTP_CONFIG[84532]?.usdc.toLowerCase(), "0x036CbD53842c5426634e7929541eC2318f3dCF7e".toLowerCase());

    // Polygon Amoy (Domain 7)
    assert.equal(CCTP_CONFIG[80002]?.domain, 7);
    assert.equal(CCTP_CONFIG[80002]?.usdc.toLowerCase(), "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582".toLowerCase());
  });
});

