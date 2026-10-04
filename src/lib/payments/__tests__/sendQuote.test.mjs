import test from "node:test";
import assert from "node:assert/strict";
import { createSendQuote, quoteEmbeddedArcReceipt, nativeGasToMicros, usdcToMicros, microsToUsdc, maxSendAmount } from "../sendQuote.ts";

test("Arc Max leaves room for the additional server fee and delivers the full send amount", () => {
  const balance = usdcToMicros("100");
  const fee = usdcToMicros("0.125");
  const result = quoteEmbeddedArcReceipt(microsToUsdc(balance - fee), { amountUsdc: "0.125", charged: true });
  assert.equal(result.amountUsdc, "99.875");
  assert.equal(result.recipientUsdc, "99.875");
  assert.equal(result.totalDebitUsdc, "100");
  assert.equal(result.estimated, false);
});

test("an unrecovered Arc fee is not falsely included in the sent receipt", () => {
  const result = quoteEmbeddedArcReceipt("25", { amountUsdc: "0.125", charged: false, unrecovered: true });
  assert.equal(result.feeUsdc, "0");
  assert.equal(result.totalDebitUsdc, "25");
  assert.throws(() => quoteEmbeddedArcReceipt("25"), /missing/);
});

test("cross-chain fee comes from the gross amount, and native wallet gas is separate", () => {
  const result = createSendQuote({amountUsdc:"100",feeUsdc:"0.5",feeTreatment:"deducted",feeLabel:"Bridge fee",arrival:"About 15 minutes",estimated:false,nativeGasUsdc:"0.003"});
  assert.equal(result.recipientUsdc, "99.5");
  assert.equal(result.totalDebitUsdc, "100.003");
});

test("USDC micros retain six-digit precision and reject silent truncation", () => {
  assert.equal(usdcToMicros("0.000001"), 1n);
  assert.equal(microsToUsdc(usdcToMicros("9007199254.123456")), "9007199254.123456");
  assert.throws(() => usdcToMicros("1.0000009"), /six decimal/);
  assert.throws(() => usdcToMicros("1e3"), /six decimal/);
});

test("Arc native gas converts from 18 decimals and rounds Max reserves upward", () => {
  assert.equal(nativeGasToMicros(65_000n, 30_000_000_000n), 1950n);
  assert.equal(nativeGasToMicros(1n, 1n), 1n);
  assert.equal(nativeGasToMicros(0n, 1n), 0n);
});

test("Max reserves wallet gas without deducting an included bridge fee twice", () => {
  const bridge = createSendQuote({amountUsdc:"100",feeUsdc:"0.5",feeTreatment:"deducted",feeLabel:"Bridge fee",arrival:"About 15 minutes",estimated:true,nativeGasUsdc:"0.003001"});
  assert.equal(maxSendAmount("100", bridge), "99.996999");
  const arc = createSendQuote({amountUsdc:"100",feeUsdc:"0.125",feeTreatment:"additional",feeLabel:"Network fee",arrival:"On confirmation",estimated:true});
  assert.equal(maxSendAmount("100", arc), "99.875");
  assert.equal(maxSendAmount("0.000001", arc), "0");
});
