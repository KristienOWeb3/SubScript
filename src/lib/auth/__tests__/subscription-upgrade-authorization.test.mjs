import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

function load(path, modules) {
 const source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({module:{exports:{}},exports:{},Date,Buffer,require:name=>{assert.ok(name in modules,name);return modules[name]}});
 context.exports=context.module.exports;vm.runInContext(source,context);return context.module.exports;
}

test('upgrade binder freezes the charge and detects changed derived subscription and chain credit terms',async()=>{
 const snapshot=load('../subscriptionUpgradeAuthorization.ts',{}).subscriptionUpgradeSnapshot;
 const crypt=load('../transactionPinCrypto.ts',{'node:crypto':crypto,'./transactionPinFormat':load('../transactionPinFormat.ts',{})});
 const authorization=load('../financialAuthorizationContext.ts',{'node:async_hooks':{AsyncLocalStorage},'./transactionPinCrypto':crypt});
 const terms=load('../../subscriptions/upgradeCheckout.ts',{'./planComparison':{compareRecurringRates:(a,p,b,q)=>a*BigInt(q)>b*BigInt(p)?1:-1},'./resumeBridge':{MIN_ON_CHAIN_PERIOD_SECONDS:60}}).upgradeCheckoutTerms;
 const quotedAt=new Date(Math.floor(Date.now()/1000)*1000),wallet='0x1111111111111111111111111111111111111111',merchant='0x2222222222222222222222222222222222222222';
 const target={id:'target-plan',merchantAddress:merchant,amountUsdc:200n,periodSeconds:600n};
 let current={subscriptionId:1n,contractAddress:'contract',beneficiaryAddress:null,minCommitmentUntil:null,planId:'old-plan',sourceCheckoutId:null};
 let chain={subscriber:wallet,merchant,amount:100n,period:600n,nextPayment:BigInt(Math.floor(quotedAt.getTime()/1000)+300),isActive:true};
 const route=readFileSync(new URL('../../../app/api/user/subscription/upgrade/route.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('upgrade.ts',route,ts.ScriptTarget.Latest,true);
 const declarations=['resolveUpgrade','bindUpgradeAuthorization'].map(name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name));
 assert.ok(declarations.every(Boolean));
 const compiled=ts.transpileModule(declarations.map(node=>node.getText(ast)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({Date,BigInt,resolveUpgradeTarget:async()=>({ok:true,value:target}),prisma:{subscription:{findFirst:async()=>({...current})}},onActiveContract:()=>({}),getSubscriptionOnChain:async()=>({...chain}),upgradeCheckoutTerms:terms,subscriptionUpgradeSnapshot:snapshot,financialPinContext:async()=>({actor:wallet}),TransactionPinError:class extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}});
 vm.runInContext(compiled,context);
 const bind=()=>context.bindUpgradeAuthorization({planId:target.id},{wallet},new Request('https://test/api/user/subscription/upgrade'),{quotedAt});
 const approved=await bind();
 assert.equal(approved.upgrade.subscriptionId,'1');assert.equal(approved.upgrade.charge,'150');
 await authorization.runFinancialAuthorization(approved,bind,async()=>{
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal((await bind()).upgrade.charge,approved.upgrade.charge);
  authorization.assertAuthorizedSubscriptionUpgrade((await bind()).upgrade);
  await authorization.assertFinancialAuthorizationCurrent();
  current={...current,subscriptionId:2n};
  await assert.rejects(authorization.assertFinancialAuthorizationCurrent(),/AUTHORITY_CHANGED/);
  assert.throws(()=>authorization.assertAuthorizedSubscriptionUpgrade(snapshot({current,target,onChain:chain,terms:{dueTodayMicros:150n,unusedCreditMicros:50n,useIntroductoryTerms:true}},quotedAt)),/AUTHORITY_CHANGED/);
  current={...current,subscriptionId:1n};chain={...chain,nextPayment:chain.nextPayment+60n};
  await assert.rejects(authorization.assertFinancialAuthorizationCurrent(),/AUTHORITY_CHANGED/);
  chain={...chain,nextPayment:chain.nextPayment-60n,isActive:false};
  // The first signing step intentionally revokes this authorization; its unchanged financial
  // terms remain valid for the second signing step, while initial handler resolution refuses it.
  await authorization.assertFinancialAuthorizationCurrent();
  const initial=await context.resolveUpgrade(wallet,target.id,quotedAt);
  assert.equal(initial.ok,false);assert.equal(initial.body.code,'RESUME_BEFORE_UPGRADE');
 });
 await assert.rejects(context.bindUpgradeAuthorization({planId:target.id},{wallet},new Request('https://test'),{quotedAt:new Date(Date.now()-11*60*1000)}),/quote expired/);
 // The handler compares the resolved quote before its first irreversible signing step.
 assert.ok(route.indexOf('assertAuthorizedSubscriptionUpgrade(subscriptionUpgradeSnapshot(resolved.value, quotedAt))')<route.indexOf('const revocationTxHash = await cancelFromEmbedded'));
});
