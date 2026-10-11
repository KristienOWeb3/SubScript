import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
function fixture({secret='test-cron-secret',emailStatus=200,primaryFailure=false,missingConfig=false,emailError=false,emailHang=false}={}){
 const callbacks=[],effects={emailRequests:[],primaryCalls:0,logs:[],timeoutDelays:[]};
 const modules={
  '../email-delivery/route':{GET:async request=>{effects.emailRequests.push(request);if(emailError)throw new Error('private-provider-token');if(emailHang)return new Promise(()=>{});return new Response('{}',{status:emailStatus});}},
  'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)},after:callback=>callbacks.push(callback)},
  '@supabase/supabase-js':{createClient:()=>({})},
  '@/lib/payments/paymentLinkVerificationWorker':{processPaymentLinkVerificationJobs:async()=>{effects.primaryCalls++;return {success:!primaryFailure};}},
  '@/lib/subscriptions/driftHealer':{healSubscriptionDrift:async()=>({success:true})},
  '@/lib/webhookOutbox':{deliverPendingWebhookOutboxEvents:async()=>({success:true})},
  '@/lib/payments/reconciliationRetry':{processPaymentReconciliationEvents:async()=>({success:true})},
  '@/lib/prisma':{prisma:{session:{deleteMany:async()=>({count:0})},$executeRaw:async()=>0}},crypto,
 };
 const compiled=ts.transpileModule(readFileSync(new URL('../../../app/api/cron/reconcile/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({module:{exports:{}},exports:{},Request,Response,URL,Date,console:{error:(...args)=>effects.logs.push(args),log(){}},
  process:{env:{...(secret?{CRON_SECRET:secret}:{}),...(!missingConfig?{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-key'}:{})}},
  setTimeout:(callback,delay)=>{effects.timeoutDelays.push(delay);return setTimeout(callback,emailHang?5:delay);},clearTimeout,
  require:name=>{assert.ok(name in modules,name);return modules[name]},
 });context.exports=context.module.exports;vm.runInContext(compiled,context);
 return {route:context.module.exports,callbacks,effects,request:authorization=>new Request('https://test.invalid/api/cron/reconcile',{method:'POST',headers:authorization?{authorization}:{}})};
}
test('unauthorized or unconfigured reconciliation requests schedule no email recovery',async()=>{
 for(const authorization of [undefined,'Bearer wrong-secret','Basic test-cron-secret']){
  const f=fixture();assert.equal((await f.route.POST(f.request(authorization))).status,401);assert.equal(f.callbacks.length,0);assert.equal(f.effects.primaryCalls,0);assert.equal(f.effects.emailRequests.length,0);
 }
 const f=fixture({secret:''});assert.equal((await f.route.POST(f.request('Bearer test-cron-secret'))).status,500);assert.equal(f.callbacks.length,0);
});
test('authenticated existing GET or POST cron schedules reused authenticated email worker independently of primary success',async()=>{
 for(const options of [{},{primaryFailure:true},{missingConfig:true}]){
  const f=fixture(options);const response=await f.route.GET(f.request('Bearer test-cron-secret'));assert.equal(response.status,options.primaryFailure||options.missingConfig?500:200);
  assert.equal(f.callbacks.length,1);assert.equal(f.effects.emailRequests.length,0);
  await f.callbacks[0]();assert.equal(f.effects.emailRequests.length,1);
  assert.equal(f.effects.emailRequests[0].url,'https://test.invalid/api/cron/email-delivery');
  assert.equal(f.effects.emailRequests[0].headers.get('authorization'),'Bearer test-cron-secret');assert.equal(f.effects.logs.length,0);
 }
});
test('email worker failures or hangs are bounded and sanitized without altering primary result',async()=>{
 for(const options of [{emailStatus:503},{emailError:true},{emailHang:true}]){
  const f=fixture(options);assert.equal((await f.route.POST(f.request('Bearer test-cron-secret'))).status,200);
  await f.callbacks[0]();assert.equal(f.effects.logs.length,1);assert.deepEqual(f.effects.timeoutDelays,[45000]);
  assert.doesNotMatch(JSON.stringify(f.effects.logs),/private-provider-token|test-cron-secret|test-only-service-key/);
  assert.equal(f.effects.logs[0][1],options.emailHang?'EMAIL_RECOVERY_TIMEOUT':'EMAIL_RECOVERY_UNAVAILABLE');
 }
});
