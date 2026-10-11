import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as jose from 'jose';
import {PGlite} from '@electric-sql/pglite';

function load(file,modules) {
 const compiled=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({module:{exports:{}},exports:{},require:name=>{assert.ok(name in modules,name);return modules[name];},Buffer,TextEncoder,Request,Response,Headers,Date,URL,console,process:{env:{JWT_SECRET:'runtime-only-test-secret-at-least-32-characters'}}});
 context.exports=context.module.exports;vm.runInContext(compiled,context);return context.module.exports;
}
const wallet='0x1111111111111111111111111111111111111111';
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create table otp_codes(email text primary key,code text,expires_at timestamptz,purpose text,wallet_address text,challenge_id uuid default gen_random_uuid(),failed_attempts integer default 0,created_at timestamptz default now());create table withdrawal_holds(address text primary key,scope text,reason text,placed_by text,expires_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());`);
 await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261009155551_transaction_pin_authorization.sql',import.meta.url),'utf8'));
 let tail=Promise.resolve(),fail=false;
 const pg={withPgClient:async callback=>{if(fail){if(fail==='once')fail=false;throw new Error('private driver failure');}const prior=tail;let unlock;tail=new Promise(r=>unlock=r);await prior;try{return await callback(db);}finally{unlock();}}};
 let session={wallet,token:'session-one',expiresAt:new Date(Date.now()+60000)};
 const auth={getVerifiedSessionToken:async headers=>headers.get('cookie')==='valid'?session:null};
 const crypt=load('../transactionPinCrypto.ts',{'node:crypto':crypto,'./transactionPinFormat':load('../transactionPinFormat.ts',{})});
 const authorization=load('../financialAuthorizationContext.ts',{'node:async_hooks':{AsyncLocalStorage},'./transactionPinCrypto':crypt});
 let custody={provider:'circle_google',hasCircleWallet:true,hasEncryptedKey:false},custodyUnavailable=false;
 const custodyModule=load('../walletCustody.ts',{'@/lib/serverPg':{pgMaybeOne:async()=>{if(custodyUnavailable)throw new Error('private custody storage failure');return custody;}}});
 const eligibility=load('../transactionPinEligibility.ts',{'./walletCustody':custodyModule});
 const pin=load('../transactionPin.ts',{'./transactionPinEligibility':eligibility,'./financialAuthorizationContext':authorization,'node:crypto':crypto,'@/lib/auth':auth,'@/lib/serverPg':pg,'./transactionPinCrypto':crypt});
 const step=load('../stepUp.ts',{'node:crypto':crypto,'jose':jose,'@/lib/auth':auth,'@/lib/serverPg':pg,'./transactionPinCrypto':crypt});
 const manage=load('../transactionPinManagement.ts',{'@/lib/auth':auth,'@/lib/serverPg':pg,'./stepUp':step,'./transactionPinCrypto':crypt,'./transactionPin':pin});
 const credential=await crypt.hashTransactionPin('826491');
 await db.query('insert into transaction_pin_credentials(wallet_address,salt,pin_hash)values($1,$2,$3)',[wallet,credential.salt,credential.hash]);
 function req(id='test-operation-0001',body={recipient:'alice',amount:'1'},token){return new Request('https://example.test/api/send',{method:'POST',headers:{cookie:'valid','content-type':'application/json','x-transaction-operation-id':id,...(token?{'x-transaction-pin-token':token}:{})},body:JSON.stringify(body)});}
 async function authorize(handler,id,body){const challenge=await handler(req(id,body));assert.equal(challenge.status,428);const detail=await challenge.json();const result=await pin.authorizeTransactionPin(new Request('https://example.test/api/user/transaction-pin/authorize',{method:'POST',headers:{cookie:'valid'},body:JSON.stringify({challengeId:detail.challengeId,pin:'826491'})}));assert.equal(result.status,200);return (await result.json()).token;}
 return {db,pin,authorization,crypt,step,manage,auth,pg,req,authorize,session:()=>session,setSession:value=>session=value,setCustody:value=>custody=value,failCustody:value=>custodyUnavailable=value,fail:value=>fail=value,close:()=>db.close()};
}

test('only server custody metadata decides PIN scope, never request flags or provider labels alone',async()=>{
 const f=await fixture();try{
  let calls=0;
  const handler=f.pin.withTransactionPin({action:'send'},async request=>{assert.equal(f.pin.isTransactionPinAuthorizedRequest(request),false);calls++;return Response.json({walletApprovalRequired:true});});
  for(const custody of [null,{provider:'external_wallet',hasCircleWallet:true,hasEncryptedKey:false},{provider:'external_wallet_email_otp',hasCircleWallet:false,hasEncryptedKey:false}]){
   f.setCustody(custody);
   const request=new Request('https://example.test/api/send',{method:'POST',headers:{cookie:'valid'},body:'{}'});
   assert.equal((await handler(request)).status,200);
   const status=await f.manage.transactionPinStatus(f.req());assert.deepEqual(await status.json(),{required:false,configured:false,lockedUntil:null,coolingOffUntil:null});
   for(const action of ['enroll','change','reset'])assert.equal((await f.manage.manageTransactionPin(f.req(undefined,{pin:'926481'}),action)).status,409);
   assert.equal((await f.pin.authorizeTransactionPin(f.req())).status,409);
  }
  assert.equal(calls,3);assert.equal((await f.db.query('select count(*)::integer as count from transaction_pin_operations')).rows[0].count,0);
  for(const custody of [{provider:'external_wallet_email_otp',hasCircleWallet:true,hasEncryptedKey:false},{provider:'legacy',hasCircleWallet:false,hasEncryptedKey:true}]){
   f.setCustody(custody);
   const spoofed=f.req('spoof-custody',{isEmbedded:false,isExternalWallet:true,required:false});
   assert.equal((await handler(spoofed)).status,428);
   assert.equal((await (await f.manage.transactionPinStatus(f.req())).json()).required,true);
  }
  assert.equal(calls,3);
 }finally{await f.close();}
});

test('custody lookup outage fails closed for status, management, authorization and financial requests',async()=>{
 const f=await fixture();try{
  f.failCustody(true);let calls=0;
  const handler=f.pin.withTransactionPin({action:'send'},async()=>{calls++;return Response.json({ok:true});});
  for(const response of [await handler(f.req()),await f.manage.transactionPinStatus(f.req()),await f.manage.manageTransactionPin(f.req(),'enroll'),await f.pin.authorizeTransactionPin(f.req())]){
   assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private custody storage/);
  }
  assert.equal(calls,0);
 }finally{await f.close();}
});

test('external PIN exemption keeps standing-authority snapshots and refuses changed terms without PIN ledger writes',async()=>{
 const f=await fixture();try{
  f.setCustody(null);let terms={amount:'100',fundingWallet:'custodial-parent'},signed=0;
  const handler=f.pin.withTransactionPin({action:'delegated-send',bind:async()=>({...terms})},async request=>{
   assert.equal(f.pin.isTransactionPinAuthorizedRequest(request),false);
   assert.equal(f.authorization.authorizedFinancialSnapshot().fundingWallet,'custodial-parent');
   terms={...terms,amount:'200'};
   await f.authorization.assertFinancialAuthorizationCurrent();signed++;
   return Response.json({ok:true});
  });
  assert.equal((await handler(f.req())).status,503);assert.equal(signed,0);
  assert.equal((await f.db.query('select count(*)::integer as count from transaction_pin_operations')).rows[0].count,0);
 }finally{await f.close();}
});

test('limit increase approval follows authoritative account scope without granting global PIN authorization',async()=>{
 const f=await fixture();try{
  const request=f.req();assert.equal(await f.pin.isTransactionLimitIncreaseAuthorized(request,wallet),false);
  f.setCustody(null);assert.equal(await f.pin.isTransactionLimitIncreaseAuthorized(request,wallet),true);
  assert.equal(f.pin.isTransactionPinAuthorizedRequest(request),false);
  f.failCustody(true);await assert.rejects(f.pin.isTransactionLimitIncreaseAuthorized(request,wallet),/custody storage/);
 }finally{await f.close();}
});
test('real Postgres nonce reservation prevents concurrent custody and caches exact retry',async()=>{
 const f=await fixture();try{let calls=0,release;const wait=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
 const handler=f.pin.withTransactionPin({action:'send'},async request=>{assert.equal(f.pin.isTransactionPinAuthorizedRequest(request),true);calls++;entered();await wait;return Response.json({hash:'confirmed'});});
 const token=await f.authorize(handler,'test-operation-0001');
 const first=handler(f.req('test-operation-0001',undefined,token));await ready;
 const replay=await handler(f.req('test-operation-0001',undefined,token));assert.equal(replay.status,409);assert.equal(calls,1);release();assert.equal((await first).status,200);
 const cached=await handler(f.req('test-operation-0001'));assert.equal(cached.status,200);assert.equal((await cached.json()).hash,'confirmed');assert.equal(calls,1);
 const row=(await f.db.query('select state,token_hash from transaction_pin_operations')).rows[0];assert.equal(row.state,'complete');assert.equal(row.token_hash,null);
 }finally{await f.close();}
});
test('altered amount recipient batch schedule actor session and operation reject original token',async()=>{
 const f=await fixture();try{let calls=0;const handler=f.pin.withTransactionPin({action:'send'},async()=>{calls++;return Response.json({ok:true});});
 const body={batch:[{recipient:'alice',amount:'1'}],schedule:'tomorrow'};const token=await f.authorize(handler,'test-operation-0001',body);
 for(const altered of [{...body,schedule:'today'},{...body,batch:[{recipient:'bob',amount:'1'}]},{...body,batch:[{recipient:'alice',amount:'2'}]}])assert.equal((await handler(f.req('test-operation-0001',altered,token))).status,409);
 assert.equal((await handler(f.req('new-operation-0002',body,token))).status,403);
 f.setSession({...f.session(),token:'different-session'});assert.equal((await handler(f.req('test-operation-0001',body,token))).status,409);
 f.setSession({...f.session(),wallet:'0x2222222222222222222222222222222222222222'});assert.equal((await handler(f.req('test-operation-0001',body,token))).status,403);assert.equal(calls,0);
 }finally{await f.close();}
});
test('wrong PIN backoff persists and unavailable authorization storage fails before handler',async()=>{
 const f=await fixture();try{let calls=0;const handler=f.pin.withTransactionPin({action:'send'},async()=>{calls++;return Response.json({ok:true});});
 const challenge=await (await handler(f.req())).json();const request=()=>new Request('https://example.test/authorize',{method:'POST',headers:{cookie:'valid'},body:JSON.stringify({challengeId:challenge.challengeId,pin:'111111'})});
 for(let i=1;i<=5;i++){assert.equal((await f.pin.authorizeTransactionPin(request())).status,403);const row=(await f.db.query('select failed_attempts,locked_until from transaction_pin_credentials')).rows[0];assert.equal(row.failed_attempts,i);assert.ok(new Date(row.locked_until)>new Date());assert.equal((await f.pin.authorizeTransactionPin(request())).status,429);await f.db.exec("update transaction_pin_credentials set locked_until=now()-interval '1 second'");}
 f.fail(true);const response=await handler(f.req());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private driver|111111|salt|pin_hash/);assert.equal(calls,0);
 }finally{await f.close();}
});
test('post-submission crash never releases authorization for execution again',async()=>{
 const f=await fixture();try{let calls=0;const handler=f.pin.withTransactionPin({action:'send'},async()=>{calls++;throw new Error('post-sign crash');});const token=await f.authorize(handler,'test-operation-0001');assert.equal((await handler(f.req('test-operation-0001',undefined,token))).status,503);assert.equal((await handler(f.req('test-operation-0001',undefined,token))).status,409);assert.equal(calls,1);assert.equal((await f.db.query('select state from transaction_pin_operations')).rows[0].state,'unknown');}finally{await f.close();}
});
test('fresh OTP proof consumed once and full financial context digest rejects recipient changes',async()=>{
 const f=await fixture();try{const binding={action:'payrollPermit',amount:'100',contextDigest:f.crypt.authorizationDigest({recipients:['alice'],schedule:'tomorrow'})};const token=await f.step.createFinancialStepUpToken(f.session(),binding);const headers=new Headers({cookie:'valid','x-step-up-token':token});
 assert.equal((await f.step.authorizeFinancialStepUp({headers,wallet,binding:{...binding,contextDigest:f.crypt.authorizationDigest({recipients:['bob'],schedule:'tomorrow'})}})).ok,false);
 const results=await Promise.all([1,2].map(()=>f.step.authorizeFinancialStepUp({headers,wallet,binding})));assert.equal(results.filter(x=>x.ok).length,1);assert.equal((await f.db.query('select count(*)::integer as count from financial_step_up_consumptions')).rows[0].count,1);
 }finally{await f.close();}
});
test('PIN recovery needs fresh OTP, preserves stricter holds, invalidates nonces and enqueues alert without secrets',async()=>{
 const f=await fixture();try{
 const request=proof=>new Request('https://example.test/reset',{method:'POST',headers:{cookie:'valid',...(proof?{'x-step-up-token':proof}:{})},body:JSON.stringify({pin:'926481'})});
 assert.equal((await f.manage.manageTransactionPin(request(),'reset')).status,403);
 await f.db.query("insert into withdrawal_holds(address,scope,expires_at,placed_by)values($1,'USER',null,'admin')",[wallet]);
 const proof=await f.step.createFinancialStepUpToken(f.session(),{action:'transaction-pin:reset'});assert.equal((await f.manage.manageTransactionPin(request(proof),'reset')).status,200);
 const credential=(await f.db.query('select * from transaction_pin_credentials')).rows[0];assert.equal(credential.version,2);assert.ok(new Date(credential.cooling_off_until).getTime()>Date.now()+23*60*60*1000);
 const hold=(await f.db.query('select * from withdrawal_holds')).rows[0];assert.equal(hold.expires_at,null);assert.equal(hold.scope,'BOTH');
 const event=(await f.db.query('select * from transaction_pin_security_events')).rows[0];assert.equal(event.event_kind,'reset');assert.doesNotMatch(JSON.stringify(event),/926481|pin_hash|salt|stepUpToken/);
 assert.equal((await f.manage.manageTransactionPin(request(proof),'reset')).status,403);
 const handler=f.pin.withTransactionPin({action:'send'},async()=>{throw new Error('must never run');});assert.equal((await handler(f.req())).status,403);
 }finally{await f.close();}
});
test('cryptographic PIN storage uses distinct random salts and constant-length hashes',async()=>{
 const crypt=load('../transactionPinCrypto.ts',{'node:crypto':crypto,'./transactionPinFormat':load('../transactionPinFormat.ts',{})});const a=await crypt.hashTransactionPin('826491'),b=await crypt.hashTransactionPin('826491');assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);assert.equal(a.hash.length,64);assert.equal(await crypt.verifyTransactionPinHash('826491',a.salt,a.hash),true);assert.equal(await crypt.verifyTransactionPinHash('826492',a.salt,a.hash),false);assert.equal(crypt.validTransactionPin('123456'),false);
});

test('concurrent recovery preserves running reservations, revokes pending tokens and blocks subsequent operations',async()=>{
 const f=await fixture();let release;let running;
 try{
  let calls=0,entered;
  const wait=new Promise(resolve=>release=resolve);
  const ready=new Promise(resolve=>entered=resolve);
  const handler=f.pin.withTransactionPin({action:'send'},async()=>{calls++;entered();await wait;return Response.json({hash:'already-reserved'});});
  const runningId='running-before-reset',pendingId='authorized-before-reset';
  const runningToken=await f.authorize(handler,runningId);
  const pendingToken=await f.authorize(handler,pendingId);
  running=handler(f.req(runningId,undefined,runningToken));await ready;
  const proof=await f.step.createFinancialStepUpToken(f.session(),{action:'transaction-pin:reset'});
  const reset=await f.manage.manageTransactionPin(new Request('https://example.test/reset',{method:'POST',headers:{cookie:'valid','x-step-up-token':proof},body:JSON.stringify({pin:'926481'})}),'reset');
  assert.equal(reset.status,200);
  const rows=(await f.db.query('select operation_id,state,token_hash from transaction_pin_operations')).rows;
  assert.equal(rows.find(row=>row.operation_id===runningId).state,'running');
  const pending=rows.find(row=>row.operation_id===pendingId);assert.equal(pending.state,'challenge');assert.equal(pending.token_hash,null);
  const hold=(await f.db.query('select scope,expires_at from withdrawal_holds where address=$1',[wallet])).rows[0];assert.equal(hold.scope,'BOTH');assert.ok(new Date(hold.expires_at)>new Date());
  assert.equal((await handler(f.req(runningId,undefined,runningToken))).status,409);
  for(const request of [f.req(pendingId,undefined,pendingToken),f.req('new-after-reset')]){
   const blocked=await handler(request);assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'TRANSACTION_PIN_COOLING_OFF');
  }
  assert.equal(calls,1);
  release();assert.equal((await running).status,200);
  const cached=await handler(f.req(runningId));assert.equal(cached.status,200);assert.equal((await cached.json()).hash,'already-reserved');assert.equal(calls,1);
  // Once recovery's hold expires, its old pending token still cannot be reused.
  await f.db.exec("update transaction_pin_credentials set cooling_off_until=now()-interval '1 second'");
  const revoked=await handler(f.req(pendingId,undefined,pendingToken));assert.equal(revoked.status,403);assert.equal((await revoked.json()).code,'TRANSACTION_PIN_AUTHORIZATION_INVALID');assert.equal(calls,1);
 }finally{release?.();await running;await f.close();}
});

test('OTP send durably binds exact action and session; verify cannot swap recipient before minting proof',async()=>{
 const f=await fixture();try{let mailedCode;
 const modules={
  '@/lib/auth/localConfiguration':{localAuthenticationConfigurationError:()=>null},
  'next/server':{NextResponse:Response,after:()=>{throw new Error('financial OTP must await delivery');}},
  crypto,
  '@/utils/security':{sanitizeInput:x=>x},
  '@/lib/offlineDb':{isConnectionError:()=>false},
  '@/lib/email/transactional':{sendAuthenticationCodeEmail:async(email,code)=>{mailedCode=code;}},
  '@/lib/auth/accountEmail':{findAccountEmailBinding:async()=>({walletAddress:wallet}),isWalletOnlyEmailBinding:()=>false},
  '@/lib/serverPg':f.pg,
  '@/lib/auth':{...f.auth,getSessionWallet:async()=>wallet},
  '@/lib/accounts/roles':{requireAccountRole:async()=>({ok:true}),resolveAccountRoleWithBackfill:async()=>({role:'USER'})},
  '@/lib/auth/stepUp':f.step,
  '@/lib/auth/transactionPinCrypto':f.crypt,
  '@/lib/captcha':{verifyCaptchaToken:async()=>true},
  '@/lib/distributedRateLimit':{consumeDistributedRateLimit:async()=>({ok:true})},
  '@/lib/custody/provision':{provisionEmbeddedWallet:()=>{throw new Error('must not provision');}},
  '@/lib/authCookies':{setSessionCookie:()=>{throw new Error('must not issue login cookie');}},
  '@/lib/auth/defaultAlias':{ensureDefaultAliasFromEmail:()=>{}},
 };
 const send=load('../../../app/api/auth/otp/send/route.ts',modules);
 const verify=load('../../../app/api/auth/otp/verify/route.ts',modules);
 const binding={action:'send',recipient:'alice',amount:'1'};
 const otpRequest=body=>new Request('https://example.test/otp',{method:'POST',headers:{cookie:'valid'},body:JSON.stringify({email:'owner@example.test',purpose:'financial_step_up',stepUp:binding,...body})});
 const issued=await send.POST(otpRequest({}));assert.equal(issued.status,200);const detail=await issued.json();assert.ok(mailedCode);
 const row=(await f.db.query('select binding_digest,session_digest from otp_codes')).rows[0];assert.equal(row.binding_digest,f.step.financialStepUpBindingDigest(binding));assert.equal(row.session_digest,f.crypt.authorizationDigest(f.session().token));
 const swapped=await verify.POST(otpRequest({code:mailedCode,challengeId:detail.challengeId,stepUp:{...binding,recipient:'bob'}}));assert.equal(swapped.status,400);
 assert.equal((await f.db.query('select count(*)::integer as count from otp_codes')).rows[0].count,1);
 const valid=await verify.POST(otpRequest({code:mailedCode,challengeId:detail.challengeId}));assert.equal(valid.status,200);assert.ok((await valid.json()).stepUpToken);
 const replay=await verify.POST(otpRequest({code:mailedCode,challengeId:detail.challengeId}));assert.equal(replay.status,400);
 }finally{await f.close();}
});

test('cached result survives authority version rotation and authority lookup outage',async()=>{
 const f=await fixture();try{let version=1,calls=0,broken=false;
 const handler=f.pin.withTransactionPin({action:'rotate',bind:()=>{if(broken)throw new Error('authority unavailable');return {version};}},async()=>{calls++;version++;return Response.json({version});});
 const token=await f.authorize(handler,'test-operation-0001');const initial=await handler(f.req('test-operation-0001',undefined,token));assert.equal(initial.status,200);broken=true;
 const cached=await handler(f.req());assert.equal(cached.status,200);assert.equal((await cached.json()).version,2);assert.equal(calls,1);
 }finally{await f.close();}
});
test('already submitted response remains truthful on result-save failure, retry never signs',async()=>{
 const f=await fixture();try{let calls=0;const handler=f.pin.withTransactionPin({action:'send'},async()=>{calls++;f.fail('once');return Response.json({circleTxId:'submitted'}, {status:202});});
 const token=await f.authorize(handler,'test-operation-0001');const result=await handler(f.req('test-operation-0001',undefined,token));assert.equal(result.status,202);assert.equal((await result.json()).circleTxId,'submitted');
 assert.equal((await f.db.query('select state from transaction_pin_operations')).rows[0].state,'unknown');assert.equal((await handler(f.req())).status,409);assert.equal(calls,1);
 }finally{await f.close();}
});

test('private auth tables deny browser roles and operation keys preserve existing colon IDs',async()=>{
 const f=await fixture();try{
 const tables=(await f.db.query("select relname,relrowsecurity from pg_class where relname in ('transaction_pin_credentials','transaction_pin_operations','financial_step_up_consumptions','transaction_pin_security_events')")).rows;assert.equal(tables.length,4);assert.ok(tables.every(x=>x.relrowsecurity));
 await f.db.exec('set role anon');await assert.rejects(f.db.query('select * from transaction_pin_credentials'),/permission denied/);await f.db.exec('reset role');
 const handler=f.pin.withTransactionPin({action:'send'},async()=>Response.json({ok:true}));const key='dm-pay:12345678-1234-4234-8234-123456789abc';const token=await f.authorize(handler,key);assert.equal((await handler(f.req(key,undefined,token))).status,200);
 }finally{await f.close();}
});

test('changed standing financial terms after handler reads fail at the custody boundary',async()=>{
 const f=await fixture();try{
 let terms={amount:'100',merchant:'alice',payout:'bob'}, signed=0;
 const handler=f.pin.withTransactionPin({action:'resume',bind:async()=>({...terms})},async()=>{
   const snapshot=f.authorization.authorizedFinancialSnapshot();assert.equal(snapshot.amount,'100');
   terms={...terms,amount:'200'};
   await f.authorization.assertFinancialAuthorizationCurrent();signed++;
   return Response.json({ok:true});
 });
 const token=await f.authorize(handler,'terms-operation-0001');
 assert.equal((await handler(f.req('terms-operation-0001',undefined,token))).status,503);
 assert.equal(signed,0);assert.equal((await handler(f.req('terms-operation-0001'))).status,409);
 }finally{await f.close();}
});

test('quote time is durable across challenge retries, PIN approval and custody revalidation',async()=>{
 const f=await fixture();try{
  const quoteTimes=[];
  const handler=f.pin.withTransactionPin({action:'quoted-upgrade',bind:async(body,session,request,context)=>{
   quoteTimes.push(context.quotedAt.toISOString());return {quotedAt:context.quotedAt.toISOString(),amount:'100'};
  }},async()=>{await f.authorization.assertFinancialAuthorizationCurrent();return Response.json({ok:true});});
  assert.equal((await handler(f.req())).status,428);
  const stored=(await f.db.query('select created_at from transaction_pin_operations')).rows[0].created_at;
  await new Promise(resolve=>setTimeout(resolve,20));
  const token=await f.authorize(handler,'test-operation-0001');
  assert.equal((await handler(f.req('test-operation-0001',undefined,token))).status,200);
  assert.ok(quoteTimes.length>=4);assert.ok(quoteTimes.every(value=>value===new Date(stored).toISOString()));
  f.setCustody(null);quoteTimes.length=0;
  assert.equal((await handler(f.req('external-quote'))).status,200);
  assert.equal(quoteTimes.length,2);assert.equal(quoteTimes[0],quoteTimes[1]);
 }finally{await f.close();}
});

test('all sequential six-digit PINs and repeated digits are refused; timestamp changes alter authorization',()=>{
 const crypt=load('../transactionPinCrypto.ts',{'node:crypto':crypto,'./transactionPinFormat':load('../transactionPinFormat.ts',{})});
 for(const pin of ['012345','123456','234567','345678','456789','987654','876543','765432','654321','543210','789012','901234','210987','098765','000000','999999'])assert.equal(crypt.validTransactionPin(pin),false,pin);
 assert.notEqual(crypt.authorizationDigest({expires:new Date('2026-10-10')}),crypt.authorizationDigest({expires:new Date('2026-10-11')}));
});
test('financial telemetry redacts opaque PIN tokens, credential fields and raw request bodies',()=>{
 const privacy=load('../../telemetryPrivacy.ts',{});
 const event=privacy.redactFinancialCredentials({request:{url:'https://example.test/api/execute-tx',data:'{"pin":"826491"}',headers:{'x-transaction-pin-token':'opaque','cookie':'session'}},extra:{body:'{"pin":"826491"}',newPin:'926481',nested:{otp:'123456'}}});
 assert.equal(event.request.data,undefined);assert.equal(event.request.headers['x-transaction-pin-token'],'[Filtered]');
 assert.doesNotMatch(JSON.stringify(event),/826491|926481|123456|opaque|session/);
});
