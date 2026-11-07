import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
function harness({blocked=false, allowed=true, timeout=false, proof="confirmed", reused=false}={}) {
    const calls={sent:0,reserved:0,retained:0,finalized:0,released:0,bound:0};
    const modules={
        "@/lib/custody": {circleIdempotencyKey:x=>x,CirclePaymasterPolicyError:class extends Error{},getWalletCustody:async()=>({executeContract:async call=>{calls.sent++;await call.onSubmitted("provider");if(timeout)throw Error("accepted timeout");return {txHash:"hash"};}})},
        "@/lib/dms/blocks":{assertNotBlocked:async()=>{if(blocked)throw Error("ACCOUNT_BLOCKED")}},
        "@/lib/admin/withdrawalHolds":{assertWithdrawalAllowed:async()=>{}},"@/lib/accountHalt":{assertAccountNotHalted:async()=>{}},
        "@/lib/contracts/constants":{USDC_NATIVE_GAS_ADDRESS:wallet},"@/lib/vault/onchain":{readProvider:()=>({getTransactionReceipt:async()=>({})})},
        "@/lib/payments/settlementReceiptRecovery":{inspectSettlementReceipt:()=>({state:proof}),prepareSettlementReceiptJob:async()=>"receipt-job",recordSettlementReceiptSubmission:async()=>{},confirmSettlementReceiptJob:async()=>{}},
        "@/lib/spendingLimits":{checkAndReserveSpendingLimit:async()=>{calls.reserved++;return {allowed,operationId:allowed?"operation":undefined,reused}},retainSubmittedSpendingLimitOperation:async()=>{calls.retained++},bindSubmittedSpendingLimitOperation:async()=>{calls.bound++},finalizeSpendingLimitOperation:async()=>{calls.finalized++},releaseSpendingLimitOperation:async()=>{calls.released++}},
    };
    const context={module:{exports:{}},exports:{},require:name=>{assert.ok(name in modules,name);return modules[name]}};context.exports=context.module.exports;
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../userTransferPolicy.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
    return {calls,run:()=>context.module.exports.executeUserTransfer({wallet,recipient,amountMicros:2501000000n,identity:"identity"})};
}
test("alternate USER transfer surfaces use the shared cap and block policy",()=>{
    const execute=readFileSync(new URL("../../../app/api/execute-tx/route.ts",import.meta.url),"utf8");
    const peer=readFileSync(new URL("../../paymentLinks/embeddedPay.ts",import.meta.url),"utf8");
    assert.match(execute,/accountRole === "USER"[\s\S]*?executeUserTransfer\(/);
    assert.match(peer,/return executeUserTransfer\(/);
});
test("over-cap transfer never submits custody",async()=>{const h=harness({allowed:false});await assert.rejects(h.run(),e=>e.code==="SPENDING_LIMIT_EXCEEDED");assert.equal(h.calls.sent,0)});
test("blocked peer never reserves or submits",async()=>{const h=harness({blocked:true});await assert.rejects(h.run(),/ACCOUNT_BLOCKED/);assert.equal(h.calls.sent+h.calls.reserved,0)});
test("accepted timeout retains spending and reports pending",async()=>{const h=harness({timeout:true});await assert.rejects(h.run(),e=>e.status===202&&e.operationId==="operation");assert.equal(h.calls.bound,1);assert.equal(h.calls.released+h.calls.finalized,0)});
test("successful outer transaction cannot finalize missing inner USDC leg",async()=>{const h=harness({proof:"pending"});await assert.rejects(h.run(),e=>e.code==="TRANSFER_PENDING");assert.equal(h.calls.finalized+h.calls.released,0)});
test("proved revert releases reservation; replay uncertainty preserves it",async()=>{const h=harness({proof:"failed"});await assert.rejects(h.run(),e=>e.code==="TRANSFER_REVERTED");assert.equal(h.calls.released,1);const replay=harness({timeout:true,reused:true});await assert.rejects(replay.run(),e=>e.code==="TRANSFER_PENDING");assert.equal(replay.calls.released,0)});
test("proved USDC credit finalizes the shared reservation",async()=>{const h=harness();assert.equal(await h.run(),"hash");assert.equal(h.calls.finalized,1)});
test("completed payment replay drains unfinished effects even when receipt already exists",async()=>{
    const source=readFileSync(new URL("../../../app/api/payment-links/verify/route.ts",import.meta.url),"utf8");
    const start=source.indexOf('after(async () => {',source.indexOf('claimResult?.outcome === "COMPLETED"'))+'after(async () => {'.length;
    const end=source.indexOf('\n            });',start);
    let worker=0;const query={select(){return query},eq(){return query},maybeSingle:async()=>({data:{receipt_id:"receipt"}})};
    const context={supabase:{from:()=>query},completedPaymentId:"payment",finalReceiptId:"receipt",normalizedTx:"hash",console,
        deliverWebhookOutboxEvent:async()=>{},processPaymentLinkVerificationJob:async()=>{worker++}};
    const compiled=ts.transpileModule('async function callback(){'+source.slice(start,end)+'}\ncallback();',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    await vm.runInNewContext(compiled,context);assert.equal(worker,1);
});
