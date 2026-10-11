import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {sendAuthenticationCodeEmail} from '../transactional.ts';

function routeFixture(send, sleep = setTimeout) {
 const callbacks = [], logs = [];
 const modules = {
  'next/server':{NextResponse:Response,after:callback=>callbacks.push(callback)},'crypto':crypto,
  '@/lib/auth/transactionPinCrypto':{authorizationDigest:()=> 'session'},
  '@/utils/security':{sanitizeInput:value=>value},'@/lib/offlineDb':{isConnectionError:()=>false,storeLocalOtpCode:()=>{}},
  '@/lib/email/transactional':{sendAuthenticationCodeEmail:send},
  '@/lib/auth/accountEmail':{findAccountEmailBinding:async()=>null,isWalletOnlyEmailBinding:()=>false},
  '@/lib/serverPg':{withPgClient:async callback=>callback({query:async()=>({rows:[{challenge_id:crypto.randomUUID()}]})})},
  '@/lib/auth':{getSessionWallet:async()=>null,getVerifiedSessionToken:async()=>null},
  '@/lib/accounts/roles':{requireAccountRole:async()=>({ok:true})},
  '@/lib/auth/stepUp':{normalizeFinancialStepUpBinding:value=>value,financialStepUpBindingDigest:()=>null},
  '@/lib/captcha':{verifyCaptchaToken:async()=>true},
  '@/lib/distributedRateLimit':{consumeDistributedRateLimit:async()=>({ok:true})},
  '@/lib/auth/localConfiguration':{localAuthenticationConfigurationError:()=>null},
 };
 const source=readFileSync(new URL('../../../app/api/auth/otp/send/route.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({module:{exports:{}},Request,Response,Date,setTimeout:sleep,
  process:{env:{NODE_ENV:'production',JWT_SECRET:'isolated-test-secret'}},console:{error:(...values)=>logs.push(values)},
  require:name=>{assert.ok(name in modules,name);return modules[name];}});
 context.exports=context.module.exports;vm.runInContext(compiled,context);
 return {callbacks,logs,post:email=>context.module.exports.POST(new Request('https://test.invalid/api/auth/otp/send',{
  method:'POST',body:JSON.stringify({email,captchaToken:'test-only'})}))};
}

test('concurrent anonymous OTP callbacks retry the real shared Postgres provider gate', async () => {
 const db=new PGlite();const priorPool=globalThis.__subscriptPgPool,priorFetch=globalThis.fetch;
 const priorKey=process.env.RESEND_API_KEY,priorSender=process.env.EMAIL_FROM;let sends=0;
 try {
  await db.exec(`create table email_suppressions(recipient text primary key);
   create table email_provider_gate(provider text primary key,next_allowed_at timestamptz);
   create table email_recipient_rate(key text primary key,window_start timestamptz,sends integer);`);
  globalThis.__subscriptPgPool={connect:async()=>({query:(sql,params)=>db.query(sql,params),release(){}})};
  process.env.RESEND_API_KEY='test-only';process.env.EMAIL_FROM='SubScript <auth@example.com>';
  globalThis.fetch=async()=>{sends++;return Response.json({id:`otp-${sends}`});};
  const f=routeFixture(sendAuthenticationCodeEmail);
  const responses=await Promise.all([f.post('one@example.com'),f.post('two@example.com')]);
  assert.ok(responses.every(response=>response.status===200));assert.equal(sends,0);
  await Promise.all(f.callbacks.map(callback=>callback()));
  assert.equal(sends,2);assert.equal(f.logs.length,0);
 } finally {
  globalThis.__subscriptPgPool=priorPool;globalThis.fetch=priorFetch;
  if(priorKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=priorKey;
  if(priorSender===undefined)delete process.env.EMAIL_FROM;else process.env.EMAIL_FROM=priorSender;
  await db.close();
 }
});

test('anonymous retries stay bounded and never replay ambiguous acceptance',async()=>{
 for (const code of ['EMAIL_PROVIDER_THROTTLED','PROVIDER_HTTP_429','PROVIDER_UNAVAILABLE']) {
  const calls=[],delays=[];
  const f=routeFixture(async(email,pin)=>{calls.push([email,pin]);throw Object.assign(new Error('private-provider-details'),{code,retryAfterSeconds:1});},
   (callback,delay)=>{delays.push(delay);return setTimeout(callback,0);});
  assert.equal((await f.post('one@example.com')).status,200);await f.callbacks[0]();
  assert.equal(calls.length,code==='PROVIDER_UNAVAILABLE'?1:6);
  assert.equal(new Set(calls.map(call=>call[1])).size,1,'retries reuse the same OTP and provider identity');
  assert.equal(delays.length,code==='PROVIDER_UNAVAILABLE'?0:5);
  assert.doesNotMatch(JSON.stringify(f.logs),/private-provider-details|one@example.com/);
 }
});
