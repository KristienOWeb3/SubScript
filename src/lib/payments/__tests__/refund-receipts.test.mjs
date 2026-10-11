import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import {ethers} from 'ethers';

test('vault withdrawal and reclaim persist user-only refund receipts before custody submission',async()=>{
 const wallet='0x1111111111111111111111111111111111111111',merchant='0x2222222222222222222222222222222222222222';
 const hash='0x'+'a'.repeat(64);
 for(const action of ['withdraw','reclaim']) {
  const effects=[],callbacks=[];
  const submit=async()=>{effects.push('submitted');return hash;};
  const modules={
   '@/lib/auth/financialPinPolicy':{financialPinContext:()=>null},
   '@/lib/auth/transactionPin':{withTransactionPin:(_options,handler)=>handler},
   'next/server':{NextResponse:Response,after:callback=>callbacks.push(callback)},ethers:{ethers},
   '@/lib/auth':{getSessionWallet:async()=>wallet},'@/lib/accounts/roles':{requireAccountRole:async()=>({ok:true})},
   '@/lib/dms/system':{parseUsdcToMicros:value=>ethers.parseUnits(value,6)},
   '@/utils/security':{sanitizeInput:value=>value},
   '@/lib/vault/onchain':{withdrawFromEmbedded:submit,reclaimAbandonedFromEmbedded:submit,
    syncVaultMirror:async()=>({balance:0n,owed:0n,commitNeeded:0n,active:false})},
   '@/lib/sponsor/userPaidTransfer':{estimateArcNetworkFeeMicros:async()=>({feeMicros:1n}),chargeNetworkFee:async()=>{}},
   '@/lib/network/registry':{assertFinancialNetworkReady:()=>{}},
   '@/lib/events/recordMerchantEvent':{recordMerchantEvent:async()=>{}},
   '@/lib/admin/withdrawalHolds':{assertWithdrawalAllowed:async()=>{},WithdrawalHeldError:class extends Error{}},
   '@/lib/contracts/constants':{ARC_MAINNET_CHAIN_ID:5042,SUBSCRIPT_VAULT_CHAIN_ID:5042,SUBSCRIPT_VAULT_ADDRESS:merchant},
   '@/lib/payments/settlementReceiptRecovery':{prepareSettlementReceiptJob:async input=>{effects.push(input);return 'receipt-job';},
    recordSettlementReceiptSubmission:async()=>{},confirmSettlementReceiptJob:async()=>{},dispatchSettlementReceipts:async()=>{}},
   '@/lib/kyc/tier':{getAccountKycTier:async()=>({tier:1})},crypto,
  };
  const source=readFileSync(new URL(`../../../app/api/user/vault/${action}/route.ts`,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const context=vm.createContext({module:{exports:{}},Request,Response,Date,console,
   require:name=>{assert.ok(name in modules,name);return modules[name];}});
  context.exports=context.module.exports;vm.runInContext(compiled,context);
  const response=await context.module.exports.POST(new Request(`https://test.invalid/api/user/vault/${action}`,{
   method:'POST',headers:{'x-request-id':'same-operation'},body:JSON.stringify({merchantAddress:merchant,amountUsdc:'1'})}));
  assert.equal(response.status,200);
  assert.equal(effects[0].kind,action==='withdraw'?'vault_withdraw':'vault_reclaim');
  assert.equal(effects[0].payerAddress,null,'merchant did not pay the refund and must receive no payment-sent email');
  assert.equal(effects[0].payeeAddress,wallet);
  assert.equal(effects[1],'submitted','receipt intent remains durable before funds move');
  for(const callback of callbacks)await callback();
 }
});
