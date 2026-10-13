import test from "node:test";
import assert from "node:assert/strict";
import { createSendQuote, quoteEmbeddedArcReceipt, nativeGasToMicros, usdcToMicros, microsToUsdc, maxSendAmount } from "../sendQuote.ts";

test("Arc receipt charges the reported server fee and delivers the full send amount", () => {
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

test("Max reserves double wallet gas without deducting an included bridge fee twice", () => {
  const bridge = createSendQuote({amountUsdc:"100",feeUsdc:"0.5",feeTreatment:"deducted",feeLabel:"Bridge fee",arrival:"About 15 minutes",estimated:true,nativeGasUsdc:"0.003001"});
  assert.equal(maxSendAmount("100", bridge), "99.993998");
  const arc = createSendQuote({amountUsdc:"100",feeUsdc:"0.125",feeTreatment:"additional",feeLabel:"Network fee",arrival:"On confirmation",estimated:true});
  assert.equal(maxSendAmount("100", arc), "99.75");
  assert.equal(maxSendAmount("0.000001", arc), "0");
});

test("Max keeps its gas buffer in the wallet instead of charging it as a fee", () => {
  const input = {amountUsdc:"100",feeUsdc:"0.125",feeTreatment:"additional",feeLabel:"Network fee",arrival:"On confirmation",estimated:true};
  const quote = createSendQuote(input);
  const amount = maxSendAmount("100", quote);
  const currentCost = createSendQuote({...input,amountUsdc:amount});
  const spikedCost = createSendQuote({...input,amountUsdc:amount,feeUsdc:"0.25"});
  assert.equal(currentCost.recipientUsdc, "99.75");
  assert.equal(currentCost.feeUsdc, "0.125");
  assert.equal(currentCost.totalDebitUsdc, "99.875");
  assert.equal(spikedCost.totalDebitUsdc, "100");
});

test("Max preserves micro precision, clamps small balances and reserves nothing for sponsored gas", () => {
  const gas = createSendQuote({amountUsdc:"1",feeUsdc:"0.000001",feeTreatment:"additional",feeLabel:"Network fee",arrival:"On confirmation",estimated:true});
  assert.equal(maxSendAmount("0.000003", gas), "0.000001");
  assert.equal(maxSendAmount("0.000002", gas), "0");
  assert.equal(maxSendAmount("0", gas), "0");
  assert.equal(maxSendAmount("9007199254.123456", gas), "9007199254.123454");
  const sponsored = createSendQuote({amountUsdc:"100",feeUsdc:"0.5",feeTreatment:"deducted",feeLabel:"Platform fee",arrival:"About 15 minutes",estimated:true,gasPaidByWallet:false});
  assert.equal(maxSendAmount("100", sponsored), "100");
});
