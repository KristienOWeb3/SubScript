import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
const wallet='0x1111111111111111111111111111111111111111', merchant='0x2222222222222222222222222222222222222222';
const plan='11111111-1111-4111-8111-111111111111',link='22222222-2222-4222-8222-222222222222';
test('actual PostgreSQL context binds aliases, source checkout, promotion, payout, and resume standing terms',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table user_commits(id uuid,commit_id text,wallet_address text,status text,spend_limit_usdc bigint,parent_commit_id uuid,vault_id uuid);
 create table metered_vaults(id uuid,user_address text);
 create table merchants(wallet_address text,payout_destination text,payout_settlement_enabled boolean,commit_slug text);
 create table address_aliases(address text,alias text);
 create table merchant_plans(id uuid,merchant_address text,amount_usdc bigint,period_seconds bigint,min_commitment_seconds bigint,active boolean,target_subscriber text,source_checkout_id uuid,updated_at timestamptz);
 create table payment_links(id uuid,merchant_address text,beneficiary_address text,amount_usdc bigint,active boolean,expires_at timestamptz,max_uses integer,link_kind text,sandbox_mode boolean,simulation_only boolean,settlement_chain_id bigint,deleted_at timestamptz,state_snapshot jsonb);
 create table merchant_plan_promotions(id uuid,plan_id uuid,regular_amount_usdc bigint,introductory_amount_usdc bigint,introductory_cycles integer,starts_at timestamptz,expires_at timestamptz,max_redemptions integer,new_customers_only boolean,active boolean,updated_at timestamptz);
 create table subscriptions(subscription_id bigint,contract_address text,merchant_address text,subscriber text,amount_cap_usdc numeric,billing_interval_seconds bigint,beneficiary_address text,min_commitment_until timestamptz,plan_id uuid,source_checkout_id uuid,cancel_at_period_end boolean,kind text,status text,updated_at timestamptz);`);
 await db.query("insert into merchants values($1,$2,true,'trusted-service')",[merchant,wallet]);
 await db.query("insert into address_aliases values($1,'trusted.sub')",[merchant]);
 await db.query('insert into merchant_plans values($1,$2,100,60,0,true,null,$3,now())',[plan,merchant,link]);
 await db.query(`insert into payment_links values($1,$2,null,100,true,'2026-12-01T00:00:00Z',null,'SUBSCRIPTION',false,false,5042,null,'{"periodSeconds":"60"}')`,[link,merchant]);
 await db.query('insert into merchant_plan_promotions values(gen_random_uuid(),$1,100,20,2,null,null,null,true,true,now())',[plan]);
 await db.query("insert into subscriptions values(1,'contract',$1,$2,100.0,60,null,null,$3,$4,true,'CUSTOMER','ACTIVE',now())",[merchant,wallet,plan,link]);
 const modules={'@/lib/serverPg':{pgMaybeOne:async(sql,args)=>(await db.query(sql,args)).rows[0]??null},'@/lib/subscriptions/contractBinding':{activeSubscriptionContract:()=> 'contract'},'@/lib/contracts/constants':{ARC_MAINNET_CHAIN_ID:5042,ARC_TESTNET_CHAIN_ID:5042002,isProd:true,SUBSCRIPT_ROUTER_ADDRESS:merchant,SUBSCRIPT_VAULT_ADDRESS:merchant,SUBSCRIPT_VAULT_CHAIN_ID:5042}};
 const compiled=ts.transpileModule(readFileSync(new URL('../financialPinPolicy.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({module:{exports:{}},exports:{},URL,require:name=>{assert.ok(name in modules,name);return modules[name]}});context.exports=context.module.exports;vm.runInContext(compiled,context);
 const policy=context.module.exports;
 const result=await policy.financialPinContext({checkoutSessionId:plan,subscriptionId:'sub_1'},{wallet},new Request('https://test/api/user/subscription/resume'));
 assert.equal(result.financialTerms.plans[0].id,plan);assert.equal(result.financialTerms.links[0].id,link);
 assert.equal(result.financialTerms.promotions[0].introductory_amount_usdc,'20');assert.equal(result.financialTerms.merchants[0].payout_destination,wallet);
 assert.equal(result.standingSubscription.amount_cap_usdc,'100');assert.equal(result.standingSubscription.billing_interval_seconds,'60');
 const alias=await policy.financialPinContext({planId:link},{wallet},new Request('https://test/api/user/subscription/subscribe'));
 assert.equal(alias.financialTerms.links[0].id,link);
 const load=(file,modules)=>{
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const runtime=vm.createContext({module:{exports:{}},exports:{},Date,Buffer,require:name=>{assert.ok(name in modules,name);return modules[name]}});
  runtime.exports=runtime.module.exports;vm.runInContext(code,runtime);return runtime.module.exports;
 };
 const crypt=load('../transactionPinCrypto.ts',{'node:crypto':crypto,'./transactionPinFormat':load('../transactionPinFormat.ts',{})});
 const authorization=load('../financialAuthorizationContext.ts',{'node:async_hooks':{AsyncLocalStorage},'./transactionPinCrypto':crypt});
 const planRow=result.financialTerms.plans[0];
 await authorization.runFinancialAuthorization(result,async()=>result,async()=>{
  // PostgreSQL JSON timestamp strings and Prisma Dates represent the same approved instant.
  authorization.assertAuthorizedFinancialRecord('plans',{id:plan,updated_at:new Date(planRow.updated_at),amount_usdc:'100'});
  assert.throws(()=>authorization.assertAuthorizedFinancialRecord('plans',{id:plan,updated_at:new Date(new Date(planRow.updated_at).getTime()+1000)}),/AUTHORITY_CHANGED/);
  const expiresAt=new Date(result.financialTerms.links[0].expires_at);
  authorization.assertAuthorizedFinancialRecord('links',{id:link,expires_at:expiresAt,deleted_at:null});
  assert.throws(()=>authorization.assertAuthorizedFinancialRecord('links',{id:link,expires_at:new Date(expiresAt.getTime()+1000)}),/AUTHORITY_CHANGED/);
 });
 for(const [path,locator,update] of [
  ['/api/user/vault/commit','trusted-service',"update merchants set wallet_address=$1 where commit_slug='trusted-service'"],
  ['/api/user/vault/auto-topup','trusted.sub',"update address_aliases set address=$1 where alias='trusted.sub'"],
 ]){
  const request=new Request(`https://test${path}`),body={merchantAddress:locator};
  const snapshot=await policy.financialPinContext(body,{wallet},request);
  assert.equal(snapshot.resolvedMerchant,merchant);
  await authorization.runFinancialAuthorization(snapshot,()=>policy.financialPinContext(body,{wallet},request),async()=>{
   authorization.assertAuthorizedMerchantDestination(merchant);
   assert.throws(()=>authorization.assertAuthorizedMerchantDestination(wallet),/AUTHORITY_CHANGED/);
   await db.query(update,[wallet]);
   await assert.rejects(authorization.assertFinancialAuthorizationCurrent(),/AUTHORITY_CHANGED/);
  });
 }
 }finally{await db.close()}
});
