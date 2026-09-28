import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

function loadHistoryGrouping() {
  const src = source("src/lib/transactions/arcNetworkFeeHistory.ts");
  const compiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const context = vm.createContext({ BigInt, Map, Set, Array });
  vm.runInContext(`(function (module, exports) { ${compiled}\n })`, context)(mod, mod.exports);
  return mod.exports;
}

const wallet = "0x" + "11".repeat(20);
const recipient = "0x" + "22".repeat(20);
const treasury = "0x59e6970eac4c9a44247adf975c462d17c94135ee";
const primaryHash = "0x" + "aa".repeat(32);
const feeHash = "0x" + "bb".repeat(32);

test("typed Arc fee is nested under its parent even when both display as $0.01", () => {
  const { groupArcNetworkFeeTransfers } = loadHistoryGrouping();
  const grouped = groupArcNetworkFeeTransfers([
    {
      txHash: primaryHash,
      fromAddress: wallet,
      toAddress: recipient,
      amountUsdc: "10000",
      timestamp: 1_000,
      blockNumber: 10,
      incoming: false,
      direction: "outbound_send",
    },
    {
      txHash: feeHash,
      fromAddress: wallet,
      toAddress: treasury,
      amountUsdc: "10000",
      timestamp: 2_000,
      blockNumber: 11,
      incoming: false,
      direction: "outbound_send",
      transactionType: "ARC_NETWORK_FEE",
      networkFee: {
        type: "ARC_NETWORK_FEE",
        amountMicros: "10000",
        txHash: feeHash,
        charged: true,
        unrecovered: false,
        parentTransactionHashes: [primaryHash],
      },
    },
  ], treasury);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].txHash, primaryHash);
  assert.equal(grouped[0].networkFee.amountMicros, "10000");
  assert.equal(grouped[0].networkFee.txHash, feeHash);
});

test("ambiguous historical treasury transfers stay separate and are not falsely grouped", () => {
  const { groupArcNetworkFeeTransfers } = loadHistoryGrouping();
  const candidate = {
    txHash: feeHash,
    fromAddress: wallet,
    toAddress: treasury,
    amountUsdc: "0.002",
    timestamp: 3_000,
    blockNumber: 12,
    incoming: false,
    direction: "outbound_send",
  };
  const grouped = groupArcNetworkFeeTransfers([
    { ...candidate, txHash: primaryHash, toAddress: recipient, timestamp: 1_000, blockNumber: 10 },
    { ...candidate, txHash: "0x" + "cc".repeat(32), toAddress: "0x" + "33".repeat(20), timestamp: 2_000, blockNumber: 11 },
    candidate,
  ], treasury);

  assert.equal(grouped.length, 3);
  assert.equal(grouped[2].historyLabel, "Transfer to SubScript treasury");
  assert.equal(grouped[2].networkFee, undefined);
});

test("send response preserves legacy field and reports charged versus unrecovered explicitly", () => {
  const route = source("src/app/api/user/wallet/send/route.ts");
  assert.match(route, /type: "ARC_NETWORK_FEE"/);
  assert.match(route, /amountMicros: result\.feeMicros\.toString\(\)/);
  assert.match(route, /txHash: result\.feeTxHash \|\| null/);
  assert.match(route, /charged: result\.charged/);
  assert.match(route, /unrecovered: Boolean\(result\.unrecovered\)/);
  assert.match(route, /recipientRole: "GAS_FEE_TREASURY"/);
  assert.match(route, /networkFeeUsdc: networkFee\.amountUsdc/);
  assert.match(route, /parentTransactionHashes: txs\.map/);
});

test("fee accounting is server-only, unique, and separate from receipts and revenue", () => {
  const migration = source("supabase/migrations/20260927120000_arc_network_fee_recoveries.sql");
  const helper = source("src/lib/sponsor/userPaidTransfer.ts");
  const send = source("src/app/api/user/wallet/send/route.ts");
  assert.match(migration, /transaction_type TEXT NOT NULL DEFAULT 'ARC_NETWORK_FEE'/);
  assert.match(migration, /UNIQUE \(request_key\)/);
  assert.match(migration, /UNIQUE \(fee_tx_hash\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL .* anon, authenticated/);
  assert.match(helper, /arcNetworkFeeRecovery\.upsert/);
  assert.match(helper, /findUnique\([\s\S]*requestKey/);
  assert.match(helper, /deterministicIdempotencyKey\(`\$\{requestKey\}:gasfee`\)/);
  assert.match(send, /bindTxToReceipt\(supabase, \{[\s\S]*txHash: settled\.txHash/);
  assert.doesNotMatch(send, /txHash: networkFee(?:Result)?\.feeTxHash/);
});

test("history formatting preserves the 0.002 USDC fee floor", () => {
  const deposits = source("src/lib/deposits/arcDeposits.ts");
  const history = source("src/app/dashboard/user/transactions/page.tsx");
  assert.match(deposits, /replace\(\/0\+\$\/, ""\)\.padEnd\(2, "0"\)/);
  assert.match(history, /maximumFractionDigits: 6/);
  assert.doesNotMatch(history, /Sent to 0x59e6\.\.\.35ee/);
});
