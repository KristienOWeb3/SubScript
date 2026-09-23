/* Fee-recovery coverage: the network-fee estimator's bounds (runtime, mocked RPC) and the route/helper
   wiring that makes user sends & withdrawals user-paid instead of sponsored (source assertions, in the
   style of wallet-send-sponsorship.test.mjs). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

/* ---- runtime: estimator bounds ---- */
function loadNetworkFees({ gasPriceWei, rpcThrows = false }) {
    const src = readFileSync(new URL("../networkFees.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    const ctx = vm.createContext({ console: { warn() {}, error() {}, log() {} }, BigInt, Number, Math, String });
    const wrapper = vm.runInContext(`(function (require, module, exports) { ${compiled}\n })`, ctx);
    wrapper((spec) => {
        if (spec === "@/lib/payments/rpc") {
            return {
                executeWithRpcFallback: async (op) => {
                    if (rpcThrows) throw new Error("rpc down");
                    return { result: await op({ getFeeData: async () => ({ maxFeePerGas: gasPriceWei, gasPrice: gasPriceWei }) }), rpcEndpoint: "mock" };
                },
            };
        }
        throw new Error(`unexpected import: ${spec}`);
    }, mod, mod.exports);
    return mod.exports;
}

test("estimator scales with gas price, covers the fee-transfer leg, and stays within bounds", async () => {
    const fees = loadNetworkFees({ gasPriceWei: 20_000_000_000n }); // 20 gwei
    const one = await fees.estimateArcNetworkFeeMicros(1);
    // (20e9 * 65000 gas * 2 legs) / 1e12 = 2600 micros
    assert.equal(one.feeMicros, 2600n);
    assert.equal(one.fallback, false);
    // A batch charges more (more primary legs) but never below a single send.
    const five = await fees.estimateArcNetworkFeeMicros(5);
    assert.ok(five.feeMicros > one.feeMicros);
});

test("estimator floors when gas reads zero and flags fallback", async () => {
    const fees = loadNetworkFees({ gasPriceWei: 0n });
    const est = await fees.estimateArcNetworkFeeMicros(1);
    assert.equal(est.feeMicros, 2000n); // floor 0.002 USDC
    assert.equal(est.fallback, true);
});

test("estimator caps a spurious spike and never throws when RPC is down", async () => {
    const spike = await loadNetworkFees({ gasPriceWei: 5_000_000_000_000n }).estimateArcNetworkFeeMicros(1);
    assert.equal(spike.feeMicros, 50000n); // cap 0.05 USDC
    const down = await loadNetworkFees({ gasPriceWei: 0n, rpcThrows: true }).estimateArcNetworkFeeMicros(1);
    assert.equal(down.feeMicros, 2000n);
    assert.equal(down.fallback, true);
});

/* ---- wiring: user-paid routes no longer sponsor, and recover the fee ---- */
test("chargeNetworkFee dedupes with a :gasfee key, marks the call user-paid, and never throws", () => {
    const helper = source("src/lib/sponsor/userPaidTransfer.ts");
    assert.match(helper, /:gasfee/);
    assert.match(helper, /GAS_FEE_TREASURY_ADDRESS/);
    assert.match(helper, /gasPayer: "wallet"/);
    // Failure after the send settled is logged, not thrown.
    assert.match(helper, /catch \(error\)/);
    assert.doesNotMatch(helper, /throw /);
});

test("wallet send is user-paid: no sponsorship, balance-includes-fee guard, fee recovered", () => {
    const route = source("src/app/api/user/wallet/send/route.ts");
    assert.doesNotMatch(route, /await requireSponsoredGas/);
    assert.doesNotMatch(route, /action: "wallet_send"/);
    assert.match(route, /estimateArcNetworkFeeMicros\(parsedRecipients\.length\)/);
    assert.match(route, /INSUFFICIENT_BALANCE_FOR_FEE/);
    assert.match(route, /await chargeNetworkFee\(/);
    assert.match(route, /gasPayer: "wallet"/);
});

test("execute-tx no longer sponsors transferUsdc and recovers its fee", () => {
    const route = source("src/app/api/execute-tx/route.ts");
    assert.match(route, /classifyGasPayer\(\{ kind: "execute_action", action \}\)/);
    assert.match(route, /const isUserPaidTransfer = action === "transferUsdc"/);
    assert.match(route, /await chargeNetworkFee\(/);
    // Sponsorship is now conditional (sponsored branch only), not unconditional.
    assert.match(route, /if \(isUserPaidTransfer\)/);
    assert.match(route, /await requireSponsoredGas\(\{/);
});

test("embedded pay marks peer transfers user-paid and merchant deposits platform-sponsored", () => {
    const embedded = source("src/lib/paymentLinks/embeddedPay.ts");
    assert.match(embedded, /gasPayer: "wallet"/);
    assert.match(embedded, /gasPayer: "platform"/);
    const payRoute = source("src/app/api/user/payment-links/[id]/pay/route.ts");
    assert.match(payRoute, /if \(settlesDirectlyToUser\)[\s\S]*chargeNetworkFee/);
    /* Peer path guards balance ≥ amount + fee up front so the post-settlement fee charge can't fail
       for lack of funds — same guarantee as wallet/send and execute-tx. */
    assert.match(payRoute, /INSUFFICIENT_BALANCE_FOR_FEE/);
    assert.match(payRoute, /readUsdcBalance\(payer\)/);
});

test("vault withdraw and reclaim are user-paid, not sponsored", () => {
    for (const p of ["src/app/api/user/vault/withdraw/route.ts", "src/app/api/user/vault/reclaim/route.ts"]) {
        const route = source(p);
        assert.doesNotMatch(route, /requireSponsoredGas/, p);
        assert.match(route, /chargeNetworkFee/, p);
    }
});

test("the sponsorship action union no longer includes wallet_send or vault_withdraw", () => {
    const sponsor = source("src/lib/sponsor/sponsorship.ts");
    assert.doesNotMatch(sponsor, /\| "wallet_send"/);
    assert.doesNotMatch(sponsor, /\| "vault_withdraw"/);
});
