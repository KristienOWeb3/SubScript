import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { encodeFunctionData, decodeFunctionData, parseUnits } from "viem";
import * as quoteHelpers from "../sendQuote.ts";
import { calculateBridgeFee, listBridgeRoutes } from "../../cctp/feeEngine.ts";
import { USDC_NATIVE_GAS_ADDRESS, ARC_TOKEN_MESSENGER_ADDRESS, BRIDGE_FEE_TREASURY_ADDRESS, SOLANA_CCTP_CONFIG } from "../../contracts/constants.ts";

const page = ts.createSourceFile("page.tsx", await readFile(new URL("../../../app/dashboard/user/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modal = ts.createSourceFile("SendSingleModal.tsx", await readFile(new URL("../../../components/SendSingleModal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const optimistic = ts.createSourceFile("optimisticTx.ts", await readFile(new URL("../../optimisticTx.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter();

// Execute the current production callbacks, without importing/rendering the entire dashboard.
// The AST selects named declarations; the TypeScript compiler removes only their type annotations.
function declaration(source, name) {
  let selected;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      let expression = node.initializer;
      if (expression && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "useCallback") expression = expression.arguments[0];
      assert.ok(expression, `Missing initializer for ${name}`);
      selected = `const ${name} = ${printer.printNode(ts.EmitHint.Expression, expression, source)};`;
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      selected = printer.printNode(ts.EmitHint.Unspecified, node, source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(selected, `Production declaration ${name} must exist`);
  return selected;
}

function execute(source, names, injected) {
  const text = names.map(name => declaration(source, name)).join("\n") + `\nmodule.exports = { ${names.join(", ")} };`;
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const exports = {};
  const context = vm.createContext({ ...injected, module: { exports }, exports });
  vm.runInContext(compiled.outputText, context, { filename: `${source.fileName}:extracted-callbacks`, timeout: 1000 });
  return context.module.exports;
}

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const txHash = `0x${"3".repeat(64)}`;
const mintTxHash = `0x${"4".repeat(64)}`;
const bridgeRoute = listBridgeRoutes("outbound_withdrawal").find(route => route.name.includes("Base"));
assert.ok(bridgeRoute, "Platform must define its Base route");

function dashboard(overrides = {}) {
  const environment = {
    ...quoteHelpers, encodeFunctionData, decodeFunctionData, parseUnits,
    calculateBridgeFee, listBridgeRoutes,
    USDC_NATIVE_GAS_ADDRESS, ARC_TOKEN_MESSENGER_ADDRESS, BRIDGE_FEE_TREASURY_ADDRESS, SOLANA_CCTP_CONFIG,
    isEmbeddedWalletSession: false, accountAddress: sender,
    publicClient: { estimateContractGas: async () => 65_000n, getGasPrice: async () => 30_000_000_000n },
    ...overrides,
  };
  return execute(page, ["CCTP_ERC20_ABI", "CCTP_TOKEN_MESSENGER_V2_ABI", "ANY_DESTINATION_CALLER", "CCTP_FINALITY_STANDARD", "toBytes32Address", "limitDecimals", "getSingleSendQuote", "handleSingleSend"], environment);
}

test("external Arc quote estimates the actual recipient transfer and adds 18dp native gas", async () => {
  let request;
  const { getSingleSendQuote } = dashboard({ publicClient: {
    estimateContractGas: async params => { request = params; return 65_000n; },
    getGasPrice: async () => 30_000_000_000n,
  } });
  const quote = await getSingleSendQuote({ amount: "10.123456", networkId: "arc", recipientAddress: recipient });
  assert.equal(request.account, sender);
  assert.equal(request.address, USDC_NATIVE_GAS_ADDRESS);
  assert.equal(request.functionName, "transfer");
  assert.deepEqual([...request.args], [recipient, 10_123_456n]);
  assert.equal(quote.feeUsdc, "0.00195");
  assert.equal(quote.recipientUsdc, "10.123456");
  assert.equal(quote.totalDebitUsdc, "10.125406");
  assert.equal(quote.estimated, true);
});

test("external Arc quote rejects missing recipient, zero gas data, and unavailable RPC", async () => {
  await assert.rejects(dashboard().getSingleSendQuote({ amount: "10", networkId: "arc" }), /Select a recipient/);
  for (const [gas, price] of [[0n, 1n], [1n, 0n]]) {
    const { getSingleSendQuote } = dashboard({ publicClient: { estimateContractGas: async () => gas, getGasPrice: async () => price } });
    await assert.rejects(getSingleSendQuote({ amount: "10", networkId: "arc", recipientAddress: recipient }), /invalid gas estimate/);
  }
  const { getSingleSendQuote } = dashboard({ publicClient: {
    estimateContractGas: async () => { throw new Error("RPC offline"); }, getGasPrice: async () => 1n,
  } });
  await assert.rejects(getSingleSendQuote({ amount: "10", networkId: "arc", recipientAddress: recipient }), /RPC offline/);
});

function enabledBridge(overrides = {}) {
  // Availability is controlled only inside this isolated test context. Production flags are untouched.
  return dashboard({ listBridgeRoutes: direction => listBridgeRoutes(direction).map(route => ({ ...route, available: route.id === bridgeRoute.id })), ...overrides });
}

test("external CCTP quote simulates fee, approval, and net burn together before reserving gas", async () => {
  let request;
  const subject = enabledBridge({ publicClient: {
    simulateCalls: async params => { request = params; return { results: [30_000n, 40_000n, 90_000n].map(gasUsed => ({ status: "success", gasUsed })) }; },
    getGasPrice: async () => 20_000_000_000n,
  } });
  const result = await subject.getSingleSendQuote({ amount: "100", networkId: bridgeRoute.id, recipientAddress: recipient });
  const fee = calculateBridgeFee(100_000_000n, bridgeRoute.id, "outbound_withdrawal");
  assert.equal(request.account, sender);
  assert.equal(request.validation, false);
  assert.equal(request.calls.length, 3);
  assert.deepEqual(Array.from(request.calls, call => call.to), [USDC_NATIVE_GAS_ADDRESS, USDC_NATIVE_GAS_ADDRESS, ARC_TOKEN_MESSENGER_ADDRESS]);
  const feeCall = decodeFunctionData({ abi: subject.CCTP_ERC20_ABI, data: request.calls[0].data });
  const approval = decodeFunctionData({ abi: subject.CCTP_ERC20_ABI, data: request.calls[1].data });
  const burn = decodeFunctionData({ abi: subject.CCTP_TOKEN_MESSENGER_V2_ABI, data: request.calls[2].data });
  assert.equal(feeCall.functionName, "transfer");
  assert.deepEqual(feeCall.args, [BRIDGE_FEE_TREASURY_ADDRESS, fee.feeMicros]);
  assert.equal(approval.functionName, "approve");
  assert.deepEqual(approval.args, [ARC_TOKEN_MESSENGER_ADDRESS, fee.netMicros]);
  assert.equal(burn.functionName, "depositForBurn");
  assert.equal(burn.args[0], fee.netMicros);
  assert.equal(burn.args[1], fee.domain);
  assert.equal(burn.args[2], `0x${recipient.slice(2).padStart(64, "0")}`);
  assert.equal(result.feeUsdc, quoteHelpers.microsToUsdc(fee.feeMicros));
  assert.equal(result.recipientUsdc, quoteHelpers.microsToUsdc(fee.netMicros));
  assert.equal(result.nativeGasUsdc, "0.0032");
  assert.equal(result.totalDebitUsdc, "100.0032");
  assert.equal(result.gasPaidByWallet, true);
});

test("external CCTP rejects unavailable simulation and a reverted simulated burn", async () => {
  const unavailable = enabledBridge({ publicClient: {
    simulateCalls: async () => { throw new Error("Method unavailable"); }, getGasPrice: async () => 1n,
  } });
  await assert.rejects(unavailable.getSingleSendQuote({ amount: "100", networkId: bridgeRoute.id, recipientAddress: recipient }), /cannot estimate.*wallet gas/);
  const reverted = enabledBridge({ publicClient: {
    simulateCalls: async () => ({ results: [{ status: "success", gasUsed: 30_000n }, { status: "failure", gasUsed: 20_000n }] }),
    getGasPrice: async () => 1n,
  } });
  await assert.rejects(reverted.getSingleSendQuote({ amount: "100", networkId: bridgeRoute.id, recipientAddress: recipient }), /could not be simulated/);
});

function sendHarness(receipt, balance = 100_000_000n) {
  const events = { status: [], loading: [], writes: [], optimistic: [], logs: [], refreshes: [] };
  const subject = dashboard({
    singleResolved: { address: recipient, alias: "recipient.sub" }, singleResolving: false,
    singleAmount: "10", isOwnWalletAddress: () => false,
    setSingleSendStatus: status => events.status.push(status), setSingleSendLoading: loading => events.loading.push(loading),
    chainId: 5042002, activeArcChain: { id: 5042002 }, usdcBalance: balance,
    writeContractAsync: async request => { events.writes.push(request); return txHash; },
    publicClient: { estimateContractGas: async () => 65_000n, getGasPrice: async () => 30_000_000_000n, waitForTransactionReceipt: async () => receipt },
    singleSendNetworks: { current: new Map() },
    recordOptimisticTx: tx => events.optimistic.push(tx), readOptimisticTxs: () => [], setOptimisticTxs: () => {},
    setSingleRecipient: () => {}, setSingleAmount: () => {},
    fetch: async (url, options) => { events.logs.push({ url, options }); return {}; },
    loadDms: async () => {}, refetchUsdc: async () => events.refreshes.push("balance"), loadDepositsSilently: () => {},
    getExplorerTxUrl: hash => `https://arcscan.app/tx/${hash}`,
  });
  return { subject, events };
}

test("external reverted receipt cannot return a Sent result or log/clear a successful transfer", async () => {
  const { subject, events } = sendHarness({ status: "reverted", gasUsed: 42_000n, effectiveGasPrice: 12_000_000_000n });
  assert.equal(await subject.handleSingleSend({ preventDefault() {} }, "arc"), undefined);
  assert.equal(events.writes.length, 1);
  assert.equal(events.optimistic.length, 0);
  assert.equal(events.logs.length, 0);
  assert.equal(events.refreshes.length, 0);
  assert.deepEqual(events.loading, [true, false]);
  assert.match(events.status.at(-1), /reverted on Arc/);
});

test("confirmed external receipt uses mined gas rather than its earlier quote", async () => {
  const { subject, events } = sendHarness({ status: "success", gasUsed: 42_000n, effectiveGasPrice: 12_000_000_000n });
  const result = await subject.handleSingleSend({ preventDefault() {} }, "arc");
  assert.equal(result.status, "confirmed");
  assert.equal(result.txHash, txHash);
  assert.equal(result.feeUsdc, "0.000504");
  assert.equal(result.totalDebitUsdc, "10.000504");
  assert.equal(result.estimated, false);
  assert.equal(events.optimistic.length, 1);
  assert.equal(events.logs.length, 1);
  assert.deepEqual(events.refreshes, ["balance"]);
});

test("fresh external gas reserve is checked before a wallet signature", async () => {
  const { subject, events } = sendHarness({ status: "success" }, 10_000_000n);
  assert.equal(await subject.handleSingleSend({ preventDefault() {} }, "arc"), undefined);
  assert.equal(events.writes.length, 0);
  assert.match(events.status.at(-1), /no longer covers.*network fee/);
});

function arrivalHarness(overrides = {}) {
  let now = 1_000_000;
  const events = { sent: [], countdown: [], intervals: [], cleared: [], successes: [], presentation: [], arrivals: [] };
  const nullRef = () => ({ current: null });
  const subject = execute(modal, ["arrivalEstimateSeconds", "formatShortAddress", "handleSuccessSequence"], {
    setSentResult: result => events.sent.push(result), setSendingState() {},
    onPresentationPause: paused => events.presentation.push(paused), setDoneReady() {},
    setArriveStatus: status => events.arrivals.push(typeof status === "function" ? status(events.arrivals.at(-1)) : status),
    handleRef: nullRef(),
    localStorage: { getItem: () => null, setItem() {} }, recipient, selectedNetwork: bridgeRoute.id, resolved: { address: recipient },
    arcRingRef: nullRef(), heroLogoRef: nullRef(), okDiscRef: nullRef(), heroTitleRef: nullRef(), sliderButtonRef: nullRef(), sliderThumbRef: nullRef(), countdownCircleRef: nullRef(), arrivesBRef: nullRef(), countdownDigitsRef: nullRef(),
    runTokenRef: { current: 1 }, intervalRef: { current: null },
    setTimeout: () => 1, wait: async () => {}, Date: { now: () => now },
    onSendSuccess: result => events.successes.push(result), setArriveCountdown: seconds => events.countdown.push(seconds),
    window: { setInterval: callback => { events.intervals.push(callback); return events.intervals.length; }, clearInterval: id => events.cleared.push(id) },
    ...overrides,
  });
  return { subject, events, advance(ms) { now += ms; } };
}

test("pending arrival countdown starts from actual result estimate and follows elapsed seconds", async () => {
  const { subject, events, advance } = arrivalHarness();
  const result = { txHash, status: "pending_attestation", arrival: "About 15 minutes" };
  await subject.handleSuccessSequence(1, result);
  assert.equal(events.sent[0], result);
  assert.equal(events.successes.length, 0, "presentation must not repeat submission success");
  assert.deepEqual(events.presentation, [false]);
  assert.equal(events.arrivals[0], "counting");
  assert.deepEqual(events.countdown, [900]);
  advance(1000); events.intervals[0]();
  assert.deepEqual(events.countdown, [900, 899]);
  advance(899_000); events.intervals[0]();
  assert.equal(events.countdown.at(-1), 0);
  assert.deepEqual(events.cleared, [1]);
});

test("delayed confirmation releases the reservation before balance refresh without revealing history", async () => {
  const events = [];
  const subject = execute(page, ["handleSendConfirmed"], {
    lastOptimisticSendId: { current: "optimistic-delayed" },
    singleSendNetworks: { current: new Map() },
    updateOptimisticTx: (id, hash) => events.push(["settled", id, hash]),
    setOptimisticTxs() {}, readOptimisticTxs: () => [],
    refetchUsdc: async () => events.push(["balance"]), loadDms: async () => {}, loadSubscriptions: async () => {}, console,
  });
  subject.handleSendConfirmed({ status: "confirmed", txHash });
  assert.deepEqual(events, [["settled", "optimistic-delayed", txHash], ["balance"]]);
});

function optimisticHarness() {
  const storage = new Map();
  return execute(optimistic, ["STORAGE_KEY", "OPTIMISTIC_ID_PREFIX", "TTL_MS", "isFresh", "read", "write", "recordOptimisticTx", "readOptimisticTxs", "updateOptimisticTx", "revealOptimisticTx", "removeOptimisticTx", "reconcileOptimisticTxs"], {
    Date, window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
  });
}

test("actual optimistic storage updates a hashless accepted row while keeping its history hidden", () => {
  const subject = optimisticHarness();
  const id = subject.recordOptimisticTx({ txHash: null, recipientAddress: recipient, recipientLabel: "recipient.sub", amountUsdc: "10", revealed: false });
  subject.updateOptimisticTx(id, txHash);
  const settled = subject.readOptimisticTxs()[0];
  assert.equal(settled.txHash, txHash);
  assert.equal(settled.revealed, false);
  assert.equal(subject.readOptimisticTxs().filter(row => !row.txHash).length, 0);
  subject.revealOptimisticTx(id);
  assert.equal(subject.readOptimisticTxs()[0].revealed, true);
  subject.removeOptimisticTx(id);
  assert.equal(subject.readOptimisticTxs().length, 0);
});

test("pending failure clears the reservation before refresh and Done never restarts status polling", () => {
  const events = [];
  const subject = execute(page, ["handleSendFailed", "handleSendModalClose"], {
    lastOptimisticSendId: { current: "optimistic-failed" },
    removeOptimisticTx: id => events.push(["remove", id]), readOptimisticTxs: () => [], setOptimisticTxs() {},
    refetchUsdc: async () => events.push(["balance"]), setSingleSendStatus() {}, setSendSingleModalOpen() {},
    cancelPendingArrivalWatch: id => events.push(["cancel", id]), console,
  });
  subject.handleSendFailed();
  subject.handleSendModalClose({ result: { status: "failed", txHash } });
  assert.deepEqual(events, [["remove", "optimistic-failed"], ["balance"], ["remove", "optimistic-failed"], ["cancel", "optimistic-failed"], ["balance"]]);
});

test("closing a bridge receipt preserves destination tracking instead of treating its burn as delivery", () => {
  let watch;
  const subject = execute(page, ["handleSendModalClose"], {
    lastOptimisticSendId: { current: null }, setSendSingleModalOpen() {},
    watchPendingArrival: value => { watch = value; }, singleResolved: { address: recipient }, singleAmount: "",
    formatAddress: value => value,
  });
  subject.handleSendModalClose({ result: { status: "pending_attestation", networkId: bridgeRoute.id, transferId: "bridge-id", txHash, recipientAddress: recipient, amountUsdc: "10" } });
  assert.equal(watch.networkId, bridgeRoute.id);
  assert.equal(watch.transferId, "bridge-id");
  assert.equal(watch.txHash, txHash);
});

test("closed bridge watcher polls destination status and ignores a confirmed burn until mint settlement", async () => {
  let poll;
  let minted = false;
  const storage = optimisticHarness();
  storage.recordOptimisticTx({ id: "bridge-row", txHash, recipientAddress: recipient, recipientLabel: "recipient.sub", amountUsdc: "10", revealed: false });
  const requests = [], reveals = [];
  const subject = execute(page, ["cancelPendingArrivalWatch", "watchPendingArrival"], {
    pendingArrivalWatches: { current: new Map() },
    URLSearchParams, AbortSignal, AbortController, Date,
    window: { setInterval: callback => { poll = callback; return 1; }, clearInterval() {} },
    fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ transfer: { status: "completed", mintTxHash: minted ? mintTxHash : null } }) }; },
    singleSendNetworks: { current: new Map() },
    revealOptimisticTx: (...args) => { reveals.push(args); storage.revealOptimisticTx(...args); }, readOptimisticTxs: storage.readOptimisticTxs, setOptimisticTxs() {},
    setTxFilter() {}, setActiveTab() {}, setAnimatingTxId() {},
    refetchUsdc: async () => {}, loadDepositsSilently: async () => {}, loadDms: async () => {},
  });
  subject.watchPendingArrival({ optimisticId: "bridge-row", networkId: bridgeRoute.id, transferId: "bridge-id", txHash });
  await poll();
  assert.deepEqual(requests, ["/api/user/cctp/status/bridge-id"]);
  assert.equal(reveals.length, 0);
  minted = true;
  await poll();
  assert.deepEqual(reveals, [["bridge-row", txHash]]);
  assert.equal(storage.readOptimisticTxs()[0].txHash, txHash);
  assert.equal(storage.readOptimisticTxs()[0].revealed, true);
  assert.equal(storage.reconcileOptimisticTxs([txHash]).length, 0, "burn-based deposits ledger removes the optimistic row without a duplicate");
});

test("bridge receipt polling waits for a destination mint; a successful origin burn cannot mark Arrived", async () => {
  const requests = [];
  let status = "pending_attestation";
  const storage = optimisticHarness();
  storage.recordOptimisticTx({ id: "bridge-open", txHash, recipientAddress: recipient, recipientLabel: "recipient.sub", amountUsdc: "10", revealed: false });
  const settled = [];
  const { subject, events } = arrivalHarness({
    statusPollRef: { current: null }, statusRequestRef: { current: false }, URLSearchParams, AbortSignal,
    fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ transfer: { status, mintTxHash: status === "completed" ? mintTxHash : null } }) }; },
    getExplorerTxUrl: hash => hash,
    onSendSuccess: result => { settled.push(result); storage.updateOptimisticTx("bridge-open", result.txHash); },
  });
  await subject.handleSuccessSequence(1, { txHash, explorerUrl: `https://arcscan.app/tx/${txHash}`, transferId: "bridge-id", status: "pending_attestation", arrival: "15 minutes" });
  await events.intervals[1]();
  assert.equal(events.arrivals.at(-1), "counting");
  assert.equal(events.successes.length, 0);
  assert.deepEqual(requests, ["/api/user/cctp/status/bridge-id"]);
  status = "completed";
  await events.intervals[1]();
  assert.equal(events.arrivals.at(-1), "arrived");
  assert.equal(settled.at(-1).status, "confirmed");
  assert.equal(settled.at(-1).txHash, txHash);
  assert.equal(settled.at(-1).explorerUrl, `https://arcscan.app/tx/${txHash}`);
  assert.equal(storage.readOptimisticTxs()[0].txHash, txHash);
  assert.equal(storage.readOptimisticTxs()[0].revealed, false);
  assert.equal(storage.reconcileOptimisticTxs([txHash]).length, 0);
});

test("a failed pending receipt stores terminal failure and invokes reservation cleanup", async () => {
  const failures = [];
  const { subject, events } = arrivalHarness({
    selectedNetwork: "arc", statusPollRef: { current: null }, statusRequestRef: { current: false }, URLSearchParams, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ status: "failed" }) }),
    onSendFailure: result => failures.push(result),
  });
  await subject.handleSuccessSequence(1, { txHash: "", circleTxId: "accepted", status: "pending", arrival: "15s" });
  await events.intervals[1]();
  assert.equal(events.sent.at(-1).status, "failed");
  assert.equal(events.arrivals.at(-1), "failed");
  assert.equal(failures.length, 1);
  assert.equal(events.successes.length, 0);
});

test("confirmed Arc does not invent an arrival countdown", async () => {
  const { subject, events } = arrivalHarness();
  await subject.handleSuccessSequence(1, { txHash, status: "confirmed", arrival: "Confirmed on Arc" });
  assert.equal(events.intervals.length, 0);
  assert.equal(events.countdown.length, 0);
  assert.equal(events.arrivals[0], "arrived");
});


function overlappingWatcherHarness() {
  const storage = optimisticHarness();
  const pendingArrivalWatches = { current: new Map() };
  const lastOptimisticSendId = { current: null };
  const intervals = new Map();
  const responses = new Map();
  const requests = [];
  let intervalCount = 0;
  const subject = execute(page, ["cancelPendingArrivalWatch", "watchPendingArrival", "handleSendModalClose"], {
    ...storage, pendingArrivalWatches, lastOptimisticSendId,
    URLSearchParams, AbortSignal, AbortController, Date, console,
    singleResolved: null, singleAmount: "", formatAddress: value => value,
    singleSendNetworks: { current: new Map() },
    window: { setInterval: callback => { intervals.set(++intervalCount, callback); return intervalCount; }, clearInterval: id => intervals.delete(id) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/user/dms") return {};
      const id = new URLSearchParams(url.split("?")[1]).get("circleTxId");
      const response = responses.get(id) || { status: "pending" };
      return { ok: true, json: async () => typeof response === "function" ? response() : response };
    },
    setOptimisticTxs() {}, setSingleSendStatus() {}, setSendSingleModalOpen() {},
    setTxFilter() {}, setActiveTab() {}, setAnimatingTxId() {},
    refetchUsdc: async () => {}, loadDepositsSilently: async () => {}, loadDms: async () => {},
  });
  const close = (id, status = "pending") => {
    storage.recordOptimisticTx({ id, txHash: null, recipientAddress: recipient, recipientLabel: "recipient.sub", amountUsdc: "1", revealed: false });
    lastOptimisticSendId.current = id;
    subject.handleSendModalClose({ result: { status, txHash: "", circleTxId: id, networkId: "arc", recipientAddress: recipient, amountUsdc: "1" } });
  };
  return { subject, storage, pendingArrivalWatches, intervals, responses, requests, close, get intervalCount() { return intervalCount; } };
}

for (const firstStatus of ["confirmed", "failed"]) {
  for (const secondStatus of ["pending", "failed"]) {
    test(`Done on a second ${secondStatus} send preserves the first send's ${firstStatus} cleanup`, async () => {
      const h = overlappingWatcherHarness();
      h.close("optimistic-first");
      const firstPoll = h.intervals.get(1);
      h.close("optimistic-second", secondStatus);
      assert.equal(h.pendingArrivalWatches.current.has("optimistic-first"), true);
      assert.equal(h.intervals.get(1), firstPoll, "adding or removing another operation must not restart the first poll");
      assert.equal(h.pendingArrivalWatches.current.has("optimistic-second"), secondStatus === "pending");
      h.responses.set("optimistic-first", { status: firstStatus, txHash: firstStatus === "confirmed" ? txHash : null });
      await firstPoll();
      assert.equal(h.pendingArrivalWatches.current.has("optimistic-first"), false);
      const rows = h.storage.readOptimisticTxs();
      assert.equal(rows.filter(row => row.id === "optimistic-first" && !row.txHash).length, 0);
      if (firstStatus === "confirmed") {
        assert.equal(rows.find(row => row.id === "optimistic-first").txHash, txHash);
        assert.equal(rows.find(row => row.id === "optimistic-first").revealed, true);
        const log = h.requests.find(request => request.url === "/api/user/dms");
        assert.equal(JSON.parse(log.options.body).amountUsdc, "1");
      } else assert.equal(rows.some(row => row.id === "optimistic-first"), false);
      if (secondStatus === "pending") {
        assert.equal(h.pendingArrivalWatches.current.has("optimistic-second"), true);
        assert.equal(rows.find(row => row.id === "optimistic-second").txHash, null);
        h.responses.set("optimistic-second", { status: "failed" });
        await h.intervals.get(2)();
        assert.equal(h.pendingArrivalWatches.current.size, 0);
        assert.equal(h.storage.readOptimisticTxs().some(row => row.id === "optimistic-second"), false);
      }
    });
  }
}

test("duplicate watch enrollment preserves its timer and cancelled in-flight results cannot touch a replacement", async () => {
  const h = overlappingWatcherHarness();
  h.close("optimistic-first");
  h.close("optimistic-first");
  assert.equal(h.intervalCount, 1);
  let resolveResponse;
  h.responses.set("optimistic-first", () => new Promise(resolve => { resolveResponse = resolve; }));
  const pending = h.intervals.get(1)();
  await new Promise(resolve => setImmediate(resolve));
  h.subject.cancelPendingArrivalWatch("optimistic-first");
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.close("optimistic-first");
  resolveResponse({ status: "confirmed", txHash });
  await pending;
  assert.equal(h.pendingArrivalWatches.current.has("optimistic-first"), true);
  assert.equal(h.storage.readOptimisticTxs()[0].txHash, null);
  assert.equal(h.storage.readOptimisticTxs()[0].revealed, false);
});


test("dashboard unmount cancels all watches and ignores a status response still in flight", async () => {
  const h = overlappingWatcherHarness();
  h.close("optimistic-first");
  h.close("optimistic-second");
  let resolveResponse;
  h.responses.set("optimistic-first", () => new Promise(resolve => { resolveResponse = resolve; }));
  const pending = h.intervals.get(1)();
  await new Promise(resolve => setImmediate(resolve));
  let cleanup;
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(page) === "useEffect" && node.arguments[0]?.getText(page).includes("watches.forEach(watch => watch.cancel())")) effect = node;
    ts.forEachChild(node, visit);
  }
  visit(page);
  assert.ok(effect, "watcher lifecycle must clean up on unmount");
  const context = vm.createContext({ pendingArrivalWatches: h.pendingArrivalWatches, useEffect: callback => { cleanup = callback(); } });
  const compiled = ts.transpileModule(printer.printNode(ts.EmitHint.Expression, effect, page), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  vm.runInContext(compiled.outputText, context);
  cleanup();
  assert.equal(h.pendingArrivalWatches.current.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.requests[0].options.signal.aborted, true);
  resolveResponse({ status: "confirmed", txHash });
  await pending;
  assert.equal(h.storage.readOptimisticTxs().filter(row => row.txHash).length, 0);
  assert.equal(h.storage.readOptimisticTxs().every(row => row.revealed === false), true);
});
