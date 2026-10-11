import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import {ethers} from "ethers";
import {PGlite} from "@electric-sql/pglite";
import {sendSettlementReceipts} from '../../email/settlementReceipts.ts';
const funding="0x1111111111111111111111111111111111111111", payee="0x2222222222222222222222222222222222222222", usdc="0x3333333333333333333333333333333333333333";
const txHash="0x"+"a".repeat(64), providerId=crypto.randomUUID();
const iface=new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)","event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)","event PayoutDelivered(address indexed merchant,address indexed destination,uint256 netAmount,uint256 fee)"]);
function transfer(amount=100n){return {address:usdc,...iface.encodeEventLog(iface.getEvent('Transfer'),[funding,payee,amount])};}
async function fixture(realEmails = false){
 const db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create table user_embedded_wallets(wallet_address text,circle_wallet_id text);");
 await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261009160713_settlement_receipt_recovery.sql',import.meta.url),'utf8'));
 await db.query("insert into user_embedded_wallets values($1,'owned-circle-wallet')",[funding]);
 const mails=[], state={receipt:{status:1,logs:[transfer()]},owner:'owned-circle-wallet',providerReads:0};
 const modules={"node:crypto":crypto,ethers:{ethers},"@/lib/serverPg":{pgMaybeOne:async(sql,args)=>(await db.query(sql,args)).rows[0]??null,pgQuery:(sql,args)=>db.query(sql,args)},
 "@/lib/circle/devWallets":{getDevWalletsClient:()=>({getTransaction:async()=>{state.providerReads++;return {data:{transaction:{walletId:state.owner,txHash}}};}})},
 "@/lib/vault/onchain":{readProvider:()=>({getNetwork:async()=>state.networkHang ? new Promise(()=>{}) : ({chainId:5042n}),getTransactionReceipt:async()=>state.receiptHang ? new Promise(()=>{}) : state.receipt})},
 "@/lib/contracts/constants":{USDC_NATIVE_GAS_ADDRESS:usdc},"@/lib/email/settlementReceipts":{sendSettlementReceipts:async input=>{mails.push(input);if(realEmails)await sendSettlementReceipts(input);}},
 "@/lib/email/core":{resolveRecipient:async()=>null,renderEmailLayout:()=>'',htmlEscape:x=>x},"@/lib/email/outbox":{enqueueEmail:async()=>{},processEmailOutbox:async()=>{state.drains=(state.drains??0)+1;}}};
 const compiled=ts.transpileModule(readFileSync(new URL('../settlementReceiptRecovery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({module:{exports:{}},exports:{},require:name=>{assert.ok(name in modules,name);return modules[name]},Date,AbortSignal,console,setTimeout,clearTimeout});context.exports=context.module.exports;vm.runInContext(compiled,context);
 return {db,module:context.module.exports,mails,state,input:{identity:'wallet-send:operation-one:0',kind:'wallet_transfer',fundingWallet:funding,payerAddress:funding,payeeAddress:payee,amountUsdc:100n,contractAddress:usdc,chainId:5042},close:()=>db.close()};
}
test('real PostgreSQL receipt jobs survive submission timeout, validate owner, enqueue once, and deny public access',async()=>{
 const f=await fixture();try{
 const id=await f.module.prepareSettlementReceiptJob(f.input);assert.equal(await f.module.prepareSettlementReceiptJob(f.input),id);
 await assert.rejects(f.module.prepareSettlementReceiptJob({...f.input,amountUsdc:101n}),/IDENTITY_CONFLICT/);
 await f.module.recordSettlementReceiptSubmission(id,providerId);
 await assert.rejects(f.module.recordSettlementReceiptSubmission(id,crypto.randomUUID()),/PROVIDER_CONFLICT/);
 f.state.owner='unowned';assert.equal((await f.module.processSettlementReceiptJobs(1)).pending,1);assert.equal(f.mails.length,0);
 await f.db.exec("update settlement_receipt_jobs set next_attempt_at=now()");f.state.owner='owned-circle-wallet';
 assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,1);assert.equal(f.mails.length,1);assert.match(f.mails[0].settlementRef,/^settlement-leg:[a-f0-9]{64}$/);
 assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,0);assert.equal(f.mails.length,1);
 const security=(await f.db.query("select relrowsecurity as rls,has_table_privilege('anon','settlement_receipt_jobs','SELECT') as public_read from pg_class where relname='settlement_receipt_jobs'")).rows[0];assert.deepEqual(security,{rls:true,public_read:false});
 }finally{await f.close()}
});
test('outer success cannot produce a receipt for failed user operation or wrong USDC amount',async()=>{
 const f=await fixture();try{const job={kind:'wallet_transfer',funding_wallet:funding,payee_address:payee,amount_usdc:'100',contract_address:usdc};
 const innerFailure={address:payee,...iface.encodeEventLog(iface.getEvent('UserOperationEvent'),[txHash,funding,payee,0n,false,0n,0n])};
 assert.equal(f.module.inspectSettlementReceipt(job,{status:1,logs:[transfer(),innerFailure]}).state,'failed');
 assert.equal(f.module.inspectSettlementReceipt(job,{status:0,logs:[transfer()]}).state,'failed');
 assert.equal(f.module.inspectSettlementReceipt(job,{status:1,logs:[transfer(99n)]}).state,'pending');
 assert.equal(f.module.inspectSettlementReceipt(job,{status:1,logs:[transfer()]}).amount,100n);
 }finally{await f.close()}
});

test('stalled network and receipt RPC reads leave retry jobs and release leases within deadline',async()=>{
 const f=await fixture();try{const id=await f.module.prepareSettlementReceiptJob(f.input);await f.module.confirmSettlementReceiptJob(id,txHash);
 for(const phase of ['networkHang','receiptHang']){
   f.state.networkHang=false;f.state.receiptHang=false;f.state[phase]=true;
   await f.db.exec("update settlement_receipt_jobs set next_attempt_at=now()");
   const start=Date.now();assert.equal((await f.module.processSettlementReceiptJobs(1,25)).pending,1);
   assert.ok(Date.now()-start<1000,`${phase} exceeded bounded worker read`);
   const row=(await f.db.query('select state,lease_token from settlement_receipt_jobs')).rows[0];
   assert.equal(row.state,'confirmed');assert.equal(row.lease_token,null);assert.equal(f.mails.length,0);
 }
 }finally{await f.close()}
});

test('request dispatcher processes verified durable jobs then eagerly drains queued emails',async()=>{
 const f=await fixture();try{const id=await f.module.prepareSettlementReceiptJob(f.input);await f.module.confirmSettlementReceiptJob(id,txHash);await f.module.dispatchSettlementReceipts();assert.equal(f.mails.length,1);assert.equal(f.state.drains,1);}finally{await f.close()}
});

test('legacy and canonical jobs for one proved leg dedupe durable emails while distinct amounts remain separate',async()=>{
 const f=await fixture(true),priorPool=globalThis.__subscriptPgPool;
 try {
  await f.db.exec(`alter table user_embedded_wallets add column email text;
   create table customers(wallet_address text,email text,email_enabled boolean);
   create table merchants(wallet_address text,email_enabled boolean);
   create table auth_identities(wallet_address text,current_email text,disabled_at timestamptz);
   create table email_outbox(id uuid primary key default gen_random_uuid(),identity text unique,category text,recipient text,message jsonb);`);
  await f.db.query('insert into customers values($1,$2,true),($3,$4,true)',[funding,'payer@example.com',payee,'payee@example.com']);
  globalThis.__subscriptPgPool={connect:async()=>({query:(sql,args)=>f.db.query(sql,args),release(){}})};
  for(const identity of ['legacy:index:0','canonical:receiver:100']) {
   const id=await f.module.prepareSettlementReceiptJob({...f.input,identity});
   await f.module.recordSettlementReceiptSubmission(id,providerId);
   await f.module.confirmSettlementReceiptJob(id,txHash);
  }
  assert.equal((await f.module.processSettlementReceiptJobs(2)).enqueued,2);
  assert.equal(f.mails.length,1,'terminal enqueue marker also prevents replaying pre-release UUID-keyed emails');
  assert.equal((await f.db.query('select count(*)::int as n from email_outbox')).rows[0].n,2,'one receipt for each side despite two job IDs');
  const another=await f.module.prepareSettlementReceiptJob({...f.input,identity:'second-financial-leg',amountUsdc:200n});
  await f.module.confirmSettlementReceiptJob(another,txHash);f.state.receipt={status:1,logs:[transfer(100n),transfer(200n)]};
  assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,1);
  assert.notEqual(f.mails[1].settlementRef,f.mails[0].settlementRef);
  assert.equal((await f.db.query('select count(*)::int as n from email_outbox')).rows[0].n,4,'distinct proved amount gets its own per-side receipt');
  const bundled=await f.module.prepareSettlementReceiptJob({...f.input,identity:'another-owned-operation-same-hash-and-amount'});
  await f.module.recordSettlementReceiptSubmission(bundled,crypto.randomUUID());
  await f.module.confirmSettlementReceiptJob(bundled,txHash);
  assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,1);
  assert.notEqual(f.mails[2].settlementRef,f.mails[0].settlementRef,'distinct Circle operations sharing an outer transaction retain separate receipts');
  assert.equal((await f.db.query('select count(*)::int as n from email_outbox')).rows[0].n,6);
  // Simulate an already released version: the original terminal job's outbox
  // carries a UUID-based key, so new semantic-key dedupe alone cannot recognize it.
  const legacy=await f.module.prepareSettlementReceiptJob({...f.input,identity:'pre-release-terminal',amountUsdc:300n});
  const legacyProvider=crypto.randomUUID();
  await f.module.recordSettlementReceiptSubmission(legacy,legacyProvider);
  await f.module.confirmSettlementReceiptJob(legacy,txHash);
  await sendSettlementReceipts({kind:'wallet_transfer',amountUsdc:300n,txHash,
   settlementRef:`settlement-job:${legacy}`,payerAddress:funding,payeeAddress:payee});
  await f.db.query("update settlement_receipt_jobs set state='enqueued' where id=$1",[legacy]);
  const replay=await f.module.prepareSettlementReceiptJob({...f.input,identity:'new-version-replay',amountUsdc:300n});
  await f.module.recordSettlementReceiptSubmission(replay,legacyProvider);
  await f.module.confirmSettlementReceiptJob(replay,txHash);
  f.state.receipt={status:1,logs:[transfer(100n),transfer(200n),transfer(300n)]};
  const before=f.mails.length;
  assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,1);
  assert.equal(f.mails.length,before,'already-enqueued old-key receipt does not generate a new-key receipt');
  assert.equal((await f.db.query('select count(*)::int as n from email_outbox')).rows[0].n,8);
  const distinctLeg=await f.module.prepareSettlementReceiptJob({...f.input,identity:'same-provider-distinct-leg',amountUsdc:400n});
  await f.module.recordSettlementReceiptSubmission(distinctLeg,legacyProvider);
  await f.module.confirmSettlementReceiptJob(distinctLeg,txHash);
  f.state.receipt={status:1,logs:[transfer(300n),transfer(400n)]};
  assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,1);
  assert.equal(f.mails.length,before+1,'same provider ID cannot collapse a different proved amount');
  assert.equal((await f.db.query('select count(*)::int as n from email_outbox')).rows[0].n,10);
 }finally{globalThis.__subscriptPgPool=priorPool;await f.close();}
});

test('router receipts prove actual net payout and destination from owned contract events', async () => {
 const f = await fixture();
 try {
  const router = '0x4444444444444444444444444444444444444444';
  const payout = { address: router, ...iface.encodeEventLog(iface.getEvent('PayoutDelivered'), [funding, payee, 198n, 2n]) };
  const leg = { address: usdc, ...iface.encodeEventLog(iface.getEvent('Transfer'), [router, payee, 198n]) };
  const input = {...f.input,kind:'router_withdraw',contractAddress:router,payerAddress:null,payeeAddress:null,amountUsdc:null};
  const job = {kind:'router_withdraw',contract_address:router,funding_wallet:funding,payee_address:null,amount_usdc:'100'};
  assert.equal(f.module.inspectSettlementReceipt(job,{status:1,logs:[leg,payout]}).amount,198n,'stale gross snapshot never controls a mined net payout');
  for (const logs of [[leg], [payout], [leg,{...payout,address:payee}], [{...leg,address:router},payout]]) {
   assert.equal(f.module.inspectSettlementReceipt(job,{status:1,logs}).state,'pending');
  }
  const otherMerchant = {address:router,...iface.encodeEventLog(iface.getEvent('PayoutDelivered'),[payee,payee,198n,2n])};
  assert.equal(f.module.inspectSettlementReceipt(job,{status:1,logs:[leg,otherMerchant]}).state,'pending');
  assert.equal(f.module.inspectSettlementReceipt({...job,payee_address:funding},{status:1,logs:[leg,payout]}).state,'pending','explicit withdrawal target must match');
  const id = await f.module.prepareSettlementReceiptJob(input);
  await f.module.confirmSettlementReceiptJob(id,txHash);
  f.state.receipt = {status:1,logs:[leg,payout]};
  assert.equal((await f.module.processSettlementReceiptJobs(1)).enqueued,1);
  assert.equal(f.mails[0].amountUsdc,198n);
  assert.equal(f.mails[0].payerAddress,null);
  assert.equal(f.mails[0].payeeAddress,funding,'merchant is notified even when the payout address has no account email');
 } finally {await f.close();}
});
