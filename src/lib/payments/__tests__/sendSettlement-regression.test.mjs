import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { ethers } from "ethers";

const sender = "0x1111111111111111111111111111111111111111";
const receiver = "0x2222222222222222222222222222222222222222";
const receiver2 = "0x4444444444444444444444444444444444444444";
const token = "0x3600000000000000000000000000000000000000";
const circleId = "33333333-3333-4333-8333-333333333333";
const hash = `0x${"a".repeat(64)}`;
const silent = { error() {}, info() {} };

// Execute the current route/helper modules with only their external boundaries mocked.
function load(path, modules, extra = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ module: { exports: {} }, exports: {}, console: silent, process: { env: {} }, AbortSignal, performance,
    require(name) { assert.ok(name in modules, `Unmocked boundary ${name}`); return modules[name]; }, ...extra });
  context.exports = context.module.exports;
  vm.runInContext(compiled, context, { timeout: 2000 });
  return context.module.exports;
}

function routeHarness({ early = true, recipients = [{ receiverAddress: receiver, amountUsdc: "1" }], state = "confirmed", timeout = false, delegated = false, executionError, failAt, reused = false } = {}) {
  const effects = { callbacks: [], sent: [], receipts: [], fees: [], finalized: [], released: [], retained: [], bound: [], delegatedReleased: [], reservations: [] };
  class PolicyError extends Error {}
  const spend = {
    checkAndReserveSpendingLimit: async (...args) => { effects.reservations.push(args); return { allowed: true, operationId: "operation", reused }; },
    retainSubmittedSpendingLimitOperation: async id => effects.retained.push(id),
    bindSubmittedSpendingLimitOperation: async (...args) => effects.bound.push(args),
    finalizeSpendingLimitOperation: async (...args) => effects.finalized.push(args),
    releaseSpendingLimitOperation: async id => effects.released.push(id),
  };
  const { POST } = load("../../../app/api/user/wallet/send/route.ts", {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) }, after: callback => effects.callbacks.push(callback) },
    ethers: { ethers },
    "@/lib/auth": { getSessionWallet: async () => sender },
    "@/lib/accounts/roles": { requireAccountRole: async () => ({ ok: true }) },
    "@/lib/custody": { CirclePaymasterPolicyError: PolicyError, deterministicIdempotencyKey: x => x,
      getCircleTransactionStatus: async () => ({ status: state, txHash: state === "confirmed" || state === "failed" ? hash : undefined }),
      getWalletCustody: async () => ({ executeContract: async call => {
        effects.sent.push(call);
        if (executionError === "policy") throw new PolicyError("policy rejected before submission");
        if (executionError === "unknown") throw new Error("connection dropped during submission");
        if (failAt === effects.sent.length) throw new Error("recipient execution failed");
        return { txHash: call.waitForConfirmation ? hash : "", circleTxId: circleId };
      } }) },
    "@/lib/dms/system": { parseUsdcToMicros: value => ethers.parseUnits(value, 6) },
    "@/lib/serverPg": { withPgClient: async callback => callback({ query: async () => ({ rows: [{ circle_wallet_id: "wallet", provider: "circle" }] }) }) },
    "@/lib/contracts/constants": { USDC_NATIVE_GAS_ADDRESS: token }, "@/lib/contracts/abis": { USDC_ERC20_ABI: [] },
    "@/lib/prisma": { prisma: {} },
    "@/lib/commitId": { CommitAccessError: class extends Error {}, resolveSpendingAuthority: async () => ({ fundingWallet: sender, delegated, commitId: "commit" }),
      recordSubUserSpend: async () => ({ allowed: true }), releaseSubUserSpend: async (...args) => effects.delegatedReleased.push(args) },
    "@/utils/security": { sanitizeInput: x => x },
    "@/lib/admin/withdrawalHolds": { assertWithdrawalAllowed: async () => {}, WithdrawalHeldError: class extends Error {} },
    "@/lib/accountHalt": { assertAccountNotHalted: async () => {}, AccountHaltError: class extends Error {} },
    "@/lib/dms/blocks": { assertNotBlocked: async () => {} },
    "@supabase/supabase-js": { createClient: () => null }, "@/lib/receipts/binding": { bindTxToReceipt: async () => {} },
    "@/lib/payments/batchLimits": { MAX_BATCH_RECIPIENTS: 100 },
    "@/lib/email/settlementReceipts": { sendSettlementReceipts: async receipt => effects.receipts.push(receipt) },
    "@/lib/spendingLimits": spend,
    "@/lib/sponsor/userPaidTransfer": { estimateArcNetworkFeeMicros: async () => ({ feeMicros: 10n }), chargeNetworkFee: async data => effects.fees.push(data) },
    "@/lib/vault/onchain": { readUsdcBalance: async () => 100000000n, embeddedTransferReverted: async () => false },
    "@/lib/circle/devWallets": { getDevWalletsClient: () => ({ getTransaction: async () => { if (timeout) throw new Error("timeout"); return { data: { transaction: { txHash: hash } } }; } }) },
  });
  return { effects, run: async () => {
    const result = await POST(new Request("http://localhost/api/user/wallet/send", { method: "POST", headers: { "x-request-id": "request" }, body: JSON.stringify({ earlySubmission: early, recipients }) }));
    for (const callback of effects.callbacks) await callback();
    return result;
  } };
}

test("accepted confirmation timeout retains spending without fees or success receipts", async () => {
  const { effects, run } = routeHarness({ timeout: true, state: "pending" });
  const result = await run();
  assert.equal(result.body.status, "pending");
  assert.deepEqual(effects.retained, ["operation"]);
  assert.deepEqual(effects.bound, [["operation", circleId]]);
  assert.equal(effects.released.length + effects.finalized.length + effects.fees.length + effects.receipts.length + effects.delegatedReleased.length, 0);
});

test("early single replays reserve the same identity used to deduplicate Circle submission", async () => {
  const { effects, run } = routeHarness({ timeout: true, state: "pending" });
  await run();
  await run();
  assert.equal(effects.reservations[0][3], effects.reservations[1][3]);
  assert.equal(effects.reservations[0][3], effects.sent[0].idempotencyKey);
  assert.equal(effects.sent[0].idempotencyKey, effects.sent[1].idempotencyKey);
  for (const options of [{ delegated: true }, { early: false }, { recipients: [{ receiverAddress: receiver, amountUsdc: "1" }, { receiverAddress: receiver2, amountUsdc: "2" }] }]) {
    const ordinary = routeHarness(options);
    await ordinary.run();
    assert.equal(ordinary.effects.reservations[0][3], undefined);
  }
});

for (const timeout of [false, true]) test(`proven inner revert skips fee and success receipt even when SDK ${timeout ? "rejects" : "confirms"}`, async () => {
  const { effects, run } = routeHarness({ state: "failed", timeout });
  await run();
  assert.deepEqual(effects.released, ["operation"]);
  assert.equal(effects.finalized.length + effects.fees.length + effects.receipts.length, 0);
  assert.equal(effects.delegatedReleased.length, 0);
});

test("owned confirmed single send finalizes, charges and receipts once", async () => {
  const { effects, run } = routeHarness();
  await run();
  assert.equal(effects.finalized.length, 1);
  assert.equal(effects.fees.length, 1);
  assert.equal(effects.receipts.length, 1);
  assert.equal(effects.receipts[0].txHash, hash);
});

test("batch requesting early submission waits every leg and preserves every settled receipt", async () => {
  const { effects, run } = routeHarness({ recipients: [{ receiverAddress: receiver, amountUsdc: "1" }, { receiverAddress: receiver2, amountUsdc: "2" }] });
  const result = await run();
  assert.equal(result.body.status, "confirmed");
  assert.ok(effects.sent.every(call => call.waitForConfirmation));
  assert.equal(effects.retained.length, 0);
  assert.equal(effects.finalized[0][1], 3000000n);
  assert.deepEqual(effects.receipts.map(x => x.payeeAddress), [receiver, receiver2]);
});

test("pre-submission policy rejection releases the durable reservation", async () => {
  const { effects, run } = routeHarness({ executionError: "policy" });
  const result = await run();
  assert.equal(result.body.success, false);
  assert.deepEqual(effects.released, ["operation"]);
  assert.equal(effects.delegatedReleased.length, 0);
  assert.equal(effects.fees.length + effects.receipts.length + effects.finalized.length, 0);
});

test("a replay's local policy rejection cannot release a possibly accepted original request", async () => {
  const { effects, run } = routeHarness({ executionError: "policy", reused: true });
  assert.equal((await run()).body.status, "pending");
  assert.equal(effects.released.length + effects.finalized.length, 0);
});

test("lost Circle acceptance response retains cap and reports uncertainty rather than claiming no funds moved", async () => {
  const { effects, run } = routeHarness({ executionError: "unknown" });
  const result = await run();
  assert.equal(result.body.status, "pending");
  assert.match(result.body.error, /outcome is uncertain/);
  assert.match(result.body.error, /do not resend/);
  assert.equal(effects.retained.length, 1);
  assert.equal(effects.released.length + effects.finalized.length + effects.fees.length + effects.receipts.length, 0);
});

test("delegated single send requesting early acceptance retains synchronous allowance accounting", async () => {
  const { effects, run } = routeHarness({ delegated: true });
  assert.equal((await run()).body.status, "confirmed");
  assert.equal(effects.sent[0].waitForConfirmation, true);
  assert.equal(effects.retained.length, 0);
  assert.equal(effects.finalized[0][1], 1000000n);
  assert.equal(effects.delegatedReleased.length, 0);
  const failed = routeHarness({ delegated: true, executionError: "policy" });
  await failed.run();
  assert.deepEqual(failed.effects.delegatedReleased, [["commit", 1000000n]]);
  assert.deepEqual(failed.effects.released, ["operation"]);
});

test("partially failed batch charges, finalizes and receipts only its settled prefix", async () => {
  const { effects, run } = routeHarness({ failAt: 2, recipients: [{ receiverAddress: receiver, amountUsdc: "1" }, { receiverAddress: receiver2, amountUsdc: "2" }] });
  const result = await run();
  assert.equal(result.status, 207);
  assert.equal(result.body.transfers.length, 1);
  assert.equal(effects.finalized[0][1], 1000000n);
  assert.deepEqual(effects.receipts.map(x => x.payeeAddress), [receiver]);
  assert.equal(effects.fees.length, 1);
});

const eventInterface = new ethers.Interface([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
function event(name, values, address = token) { return { ...eventInterface.encodeEventLog(eventInterface.getEvent(name), values), address }; }
function custodyHarness({ receipt, txState = "CONFIRMED", owner = "wallet", rpcError = false, hasHash = true } = {}) {
  const reconciled = [];
  const custody = load("../../custody/index.ts", {
    "node:crypto": { randomUUID: () => circleId, createHash: () => {} }, ethers: { ethers },
    "@/lib/serverPg": { pgMaybeOne: async () => ({ circle_wallet_id: "wallet" }) },
    "@/lib/circle/devWallets": { getDevWalletsClient: () => ({ getTransaction: async () => ({ data: { transaction: { state: txState, txHash: hasHash ? hash : undefined, walletId: owner } } }) }) },
    "@/lib/vault/onchain": { readProvider: () => ({ getTransactionReceipt: async () => { if (rpcError) throw new Error("RPC unavailable"); return receipt; } }) },
    "@/lib/contracts/constants": { USDC_NATIVE_GAS_ADDRESS: token },
    "@/lib/spendingLimits": { reconcileSubmittedSpendingLimitOperation: async (...args) => reconciled.push(args) },
  });
  return { custody, reconciled };
}

test("Circle confirmed + successful outer receipt still fails an inner user operation", async () => {
  const { custody, reconciled } = custodyHarness({ receipt: { status: 1, logs: [event("UserOperationEvent", [hash, sender, receiver, 0n, false, 0n, 0n])] } });
  assert.equal((await custody.getCircleTransactionStatus(circleId, sender)).status, "failed");
  assert.deepEqual(reconciled, [[sender, circleId, "failed"]]);
});

test("actual owned USDC credit confirms despite stale Circle state", async () => {
  const { custody, reconciled } = custodyHarness({ txState: "PENDING", receipt: { status: 1, logs: [event("Transfer", [sender, receiver, 1000000n])] } });
  assert.equal((await custody.getCircleTransactionStatus(circleId, sender)).status, "confirmed");
  assert.deepEqual(reconciled, [[sender, circleId, "confirmed"]]);
});

test("unknown receipt, RPC errors, other wallet and absent USDC credit never confirm or release", async () => {
  for (const options of [{ receipt: null }, { rpcError: true }, { owner: "other", receipt: { status: 1, logs: [event("Transfer", [sender, receiver, 1n])] } }, { receipt: { status: 1, logs: [event("Transfer", [receiver2, receiver, 1n])] } }]) {
    const { custody, reconciled } = custodyHarness(options);
    assert.equal((await custody.getCircleTransactionStatus(circleId, sender)).status, "pending");
    assert.equal(reconciled.length, 0);
  }
});

test("terminal Circle failure releases only the bound owned reservation", async () => {
  const { custody, reconciled } = custodyHarness({ txState: "FAILED", hasHash: false });
  assert.equal((await custody.getCircleTransactionStatus(circleId, sender)).status, "failed");
  assert.deepEqual(reconciled, [[sender, circleId, "failed"]]);
});

test("broadcast transaction relies on chain evidence even when Circle reports failure", async () => {
  const confirmed = custodyHarness({ txState: "FAILED", receipt: { status: 1, logs: [event("Transfer", [sender, receiver, 1n])] } });
  assert.equal((await confirmed.custody.getCircleTransactionStatus(circleId, sender)).status, "confirmed");
  const unknown = custodyHarness({ txState: "FAILED", rpcError: true });
  assert.equal((await unknown.custody.getCircleTransactionStatus(circleId, sender)).status, "pending");
  assert.equal(unknown.reconciled.length, 0);
});

test("browser transfer status verifies inner execution and actual sender rather than outer success", async () => {
  const { custody } = custodyHarness({ receipt: { status: 1, logs: [event("UserOperationEvent", [hash, sender, receiver, 0n, false, 0n, 0n])] } });
  const { GET } = load("../../../app/api/user/wallet/send/status/route.ts", {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    "@/lib/auth": { getSessionWallet: async () => sender },
    "@/lib/accounts/roles": { requireAccountRole: async () => ({ ok: true }) },
    "@/lib/custody": custody,
    "@/lib/commitId": { resolveSpendingAuthority: async () => ({ fundingWallet: sender }) },
  }, { URL });
  assert.equal((await GET(new Request(`http://localhost/status?txHash=${hash}`))).body.status, "failed");
  assert.equal((await custodyHarness({ receipt: { status: 0, logs: [] } }).custody.getArcTransferStatus(hash, sender)).status, "failed");
});

test("reservation queries retain submitted operations beyond TTL and reconcile by owner and Circle identity", async () => {
  const statements = [];
  const api = load("../../spendingLimits.ts", {
    "@/lib/serverPg": { withPgClient: async callback => callback({ query: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes("daily_spent")) return { rows: [{ daily_spent: "1000000", weekly_spent: "1000000", monthly_spent: "1000000" }] };
      return { rows: [{ id: "operation" }] };
    } }) }, ethers: { formatUnits: ethers.formatUnits },
    "@/lib/kyc/tier": { getAccountKycTier: async () => ({ tier: 1, tierLabel: "Verified" }) },
  });
  await api.retainSubmittedSpendingLimitOperation("operation");
  await api.bindSubmittedSpendingLimitOperation("operation", circleId);
  await api.checkAndReserveSpendingLimit(sender, 1000000n);
  await api.getAccountSpendingStatus(sender);
  await api.reconcileSubmittedSpendingLimitOperation(sender, circleId, "confirmed");
  await api.reconcileSubmittedSpendingLimitOperation(sender, circleId, "failed");
  assert.ok(statements.some(({ sql }) => sql.includes("'infinity'::timestamptz")));
  for (const { sql } of statements.filter(x => x.sql.includes("daily_spent"))) {
    assert.equal((sql.match(/EXISTS \(SELECT 1 FROM spending_limit_reservations/g) || []).length, 3);
    assert.ok(sql.includes("OR status = 'PENDING'"), "durable pending survives the outer 30-day cutoff");
  }
  for (const { sql, params } of statements.slice(-2)) {
    assert.ok(sql.includes("reservation.id = $2::uuid") && sql.includes("lower(operation.user_address) = $1") && sql.includes("operation.status = 'PENDING'"));
    assert.equal(params[0], sender); assert.equal(params[1], circleId);
  }
  assert.deepEqual(statements.slice(-2).map(x => x.params[2]), ["FINALIZED", "RELEASED"]);
});

test("real Postgres retains late submitted reservations, isolates owners and reconciles exactly once", async () => {
  // PGlite is already bundled with the repository's Prisma tooling; this uses an isolated
  // in-memory Postgres instance, never a configured platform database.
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  const schema = readFileSync(new URL("../../../../supabase/migrations/20260719183000_expand_schemas.sql", import.meta.url), "utf8");
  const tables = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS public.spending_limit_operations"), schema.indexOf("ALTER TABLE public.spending_limit_operations"));
  await db.exec(tables);
  const api = load("../../spendingLimits.ts", {
    "@/lib/serverPg": { withPgClient: async callback => callback(db) },
    ethers: { formatUnits: ethers.formatUnits },
    "@/lib/kyc/tier": { getAccountKycTier: async () => ({ tier: 1, tierLabel: "Verified" }) },
  });
  try {
    const reserved = await api.checkAndReserveSpendingLimit(sender, 1000000000n);
    await api.retainSubmittedSpendingLimitOperation(reserved.operationId);
    await api.bindSubmittedSpendingLimitOperation(reserved.operationId, circleId);
    await db.query("UPDATE spending_limit_operations SET created_at = now() - interval '40 days' WHERE id = $1", [reserved.operationId]);
    const blocked = await api.checkAndReserveSpendingLimit(sender, 2000000000n);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.limitPeriod, "daily");
    assert.equal((await api.getAccountSpendingStatus(sender)).spent.dailyUsdc, "1000.0");
    await api.reconcileSubmittedSpendingLimitOperation(receiver, circleId, "failed");
    assert.equal((await api.getAccountSpendingStatus(sender)).spent.dailyUsdc, "1000.0");
    await api.reconcileSubmittedSpendingLimitOperation(sender, circleId, "confirmed");
    await api.reconcileSubmittedSpendingLimitOperation(sender, circleId, "failed");
    assert.equal((await api.getAccountSpendingStatus(sender)).spent.dailyUsdc, "1000.0", "later failure must not release a confirmed operation");
    const rows = await db.query("SELECT status, created_at > now() - interval '1 minute' AS recent FROM spending_limit_operations WHERE id = $1", [reserved.operationId]);
    assert.equal(rows.rows[0].status, "FINALIZED");
    assert.equal(rows.rows[0].recent, true, "late settlement counts in the current rolling window");
    const second = await api.checkAndReserveSpendingLimit(sender, 1000000n);
    await api.retainSubmittedSpendingLimitOperation(second.operationId);
    const secondId = "55555555-5555-4555-8555-555555555555";
    await api.bindSubmittedSpendingLimitOperation(second.operationId, secondId);
    await api.reconcileSubmittedSpendingLimitOperation(sender, secondId, "failed");
    assert.equal((await api.getAccountSpendingStatus(sender)).spent.dailyUsdc, "1000.0");
  } finally { await db.close(); }
});

test("real Postgres request replay shares one durable reservation and terminal accounting", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  const schema = readFileSync(new URL("../../../../supabase/migrations/20260719183000_expand_schemas.sql", import.meta.url), "utf8");
  await db.exec(schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS public.spending_limit_operations"), schema.indexOf("ALTER TABLE public.spending_limit_operations")));
  const api = load("../../spendingLimits.ts", {
    "@/lib/serverPg": { withPgClient: async callback => callback(db) },
    ethers: { formatUnits: ethers.formatUnits },
    "@/lib/kyc/tier": { getAccountKycTier: async () => ({ tier: 1, tierLabel: "Verified" }) },
  });
  try {
    for (const terminal of ["confirmed", "failed"]) {
      const operationId = terminal === "confirmed" ? "66666666-6666-4666-8666-666666666666" : "77777777-7777-4777-8777-777777777777";
      const providerId = terminal === "confirmed" ? circleId : "88888888-8888-4888-8888-888888888888";
      const initial = await api.checkAndReserveSpendingLimit(sender, 1000000n, "DIRECT_SEND", operationId);
      assert.equal(initial.operationId, operationId);
      await api.retainSubmittedSpendingLimitOperation(operationId);
      await api.bindSubmittedSpendingLimitOperation(operationId, providerId);
      await db.query("UPDATE spending_limit_operations SET created_at = now() - interval '40 days' WHERE id = $1", [operationId]);
      const replay = await api.checkAndReserveSpendingLimit(sender, 1000000n, "DIRECT_SEND", operationId);
      assert.equal(replay.operationId, initial.operationId);
      assert.equal(replay.reused, true);
      await api.retainSubmittedSpendingLimitOperation(operationId);
      await api.bindSubmittedSpendingLimitOperation(operationId, providerId);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM spending_limit_reservations WHERE operation_id=$1", [operationId])).rows[0].count, 1);
      for (const [wallet, amount, kind] of [[receiver, 1000000n, "DIRECT_SEND"], [sender, 2000000n, "DIRECT_SEND"], [sender, 1000000n, "BATCH_SEND"]]) {
        assert.equal((await api.checkAndReserveSpendingLimit(wallet, amount, kind, operationId)).code, "SPENDING_OPERATION_CONFLICT");
      }
      await api.reconcileSubmittedSpendingLimitOperation(sender, providerId, terminal);
      const first = (await db.query("SELECT status, created_at::text, finalized_at::text FROM spending_limit_operations WHERE id=$1", [operationId])).rows[0];
      await api.reconcileSubmittedSpendingLimitOperation(sender, providerId, terminal);
      await api.finalizeSpendingLimitOperation(operationId, 1000000n);
      await api.releaseSpendingLimitOperation(operationId);
      const second = (await db.query("SELECT status, created_at::text, finalized_at::text FROM spending_limit_operations WHERE id=$1", [operationId])).rows[0];
      assert.deepEqual(second, first, "repeated callbacks cannot revive or rewrite terminal accounting");
      const afterTerminal = await api.checkAndReserveSpendingLimit(sender, 1000000n, "DIRECT_SEND", operationId);
      assert.equal(afterTerminal.allowed, terminal === "confirmed");
      if (terminal === "failed") assert.equal(afterTerminal.code, "SPENDING_OPERATION_RELEASED");
    }
    assert.equal((await db.query("SELECT count(*)::int AS count FROM spending_limit_operations")).rows[0].count, 2);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM spending_limit_operations WHERE status='PENDING'")).rows[0].count, 0);
    assert.equal((await api.getAccountSpendingStatus(sender)).spent.dailyUsdc, "1.0");

    // An expired unsubmitted replay must be checked against today's cap again.
    const expiredId = "99999999-9999-4999-8999-999999999999";
    await api.checkAndReserveSpendingLimit(sender, 1000000000n, "DIRECT_SEND", expiredId);
    await db.query("UPDATE spending_limit_operations SET created_at=now()-interval '1 day' WHERE id=$1", [expiredId]);
    await api.checkAndReserveSpendingLimit(sender, 2000000000n);
    assert.equal((await api.checkAndReserveSpendingLimit(sender, 1000000000n, "DIRECT_SEND", expiredId)).allowed, false);
  } finally { await db.close(); }
});
