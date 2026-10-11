import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

function load(file, modules) {
    const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context = vm.createContext({module:{exports:{}},require:name=>{assert.ok(name in modules,name);return modules[name];},Date,Request,Response,console,process:{env:{JWT_SECRET:'test-secret'}}});
    context.exports = context.module.exports;
    vm.runInContext(compiled,context);
    return context.module.exports;
}

test('cooldown is atomic, keeps its expiry on rejection, and resets after expiry', async () => {
    const db = new PGlite();
    try {
        await db.exec(`create table api_rate_limit_windows(scope text,key_hash text,window_started_at timestamptz,request_count integer,expires_at timestamptz,primary key(scope,key_hash,window_started_at));`);
        const limiter = load('../../distributedRateLimit.ts', {'node:crypto':crypto,'@/lib/serverPg':{pgMaybeOne:async(sql,args)=>(await db.query(sql,args)).rows[0]}});
        const options = {scope:'pin-code',key:'wallet',limit:1,windowSeconds:60,mode:'cooldown'};
        const results = await Promise.all(Array.from({length:8},()=>limiter.consumeDistributedRateLimit(options)));
        assert.equal(results.filter(result=>result.ok).length,1);
        for (const result of results.filter(result=>!result.ok)) assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 60);
        const before = (await db.query('select expires_at from api_rate_limit_windows')).rows[0].expires_at;
        assert.equal((await limiter.consumeDistributedRateLimit(options)).ok,false);
        assert.equal(String((await db.query('select expires_at from api_rate_limit_windows')).rows[0].expires_at),String(before));
        assert.equal((await limiter.consumeDistributedRateLimit({...options,key:'another-wallet'})).ok,true);
        await db.exec("update api_rate_limit_windows set expires_at=now()-interval '1 second'");
        assert.equal((await limiter.consumeDistributedRateLimit(options)).ok,true);
    } finally { await db.close(); }
});

test('PIN resend rejection happens before code replacement or delivery for all PIN actions', async () => {
    let blocked = false, unavailable = false, mailFailure = null, delivered = 0, persisted = 0;
    const limits = [];
    const route = load('../../../app/api/auth/otp/send/route.ts', {
        'next/server':{NextResponse:Response,after:()=>{}},
        'crypto':crypto,
        '@/lib/auth/transactionPinCrypto':{authorizationDigest:()=> 'session-digest'},
        '@/utils/security':{sanitizeInput:value=>value},
        '@/lib/offlineDb':{isConnectionError:()=>false,storeLocalOtpCode:()=>{}},
        '@/lib/email/transactional':{sendAuthenticationCodeEmail:async()=>{if(mailFailure)throw mailFailure;delivered++;}},
        '@/lib/auth/accountEmail':{findAccountEmailBinding:async()=>({walletAddress:'wallet'}),isWalletOnlyEmailBinding:()=>false},
        '@/lib/serverPg':{withPgClient:async callback=>callback({query:async()=>{persisted++;return {rows:[{challenge_id:'id'}]};}})},
        '@/lib/auth':{getSessionWallet:async()=> 'wallet',getVerifiedSessionToken:async()=>({token:'session'})},
        '@/lib/accounts/roles':{requireAccountRole:async()=>({ok:true})},
        '@/lib/auth/stepUp':{normalizeFinancialStepUpBinding:value=>value,financialStepUpBindingDigest:()=> 'digest'},
        '@/lib/captcha':{verifyCaptchaToken:async()=>true},
        '@/lib/distributedRateLimit':{consumeDistributedRateLimit:async options=>{limits.push(options);if(options.mode==='cooldown'){if(unavailable)throw new Error('offline');return {ok:!blocked,retryAfterSeconds:42};}return {ok:true};}},
        '@/lib/auth/localConfiguration':{localAuthenticationConfigurationError:()=>null},
    });
    const request = action=>new Request('https://test.local/api/auth/otp/send',{method:'POST',body:JSON.stringify({email:'test@example.com',purpose:'financial_step_up',stepUp:{action:`transaction-pin:${action}`}})});
    const first = await route.POST(request('enroll'));
    assert.equal(first.status,200);
    assert.equal((await first.json()).retryAfterSeconds,60);
    blocked = true;
    for(const action of ['enroll','change','reset']) {
        const response = await route.POST(request(action));
        assert.equal(response.status,429);
        assert.equal(response.headers.get('Retry-After'),'42');
    }
    assert.equal(delivered,1); assert.equal(persisted,1);
    assert.equal(limits.filter(value=>value.scope==='otp-send-email').length,1);
    assert.ok(limits.filter(value=>value.mode==='cooldown').every(value=>value.key==='wallet' && value.windowSeconds===60));
    unavailable = true;
    assert.equal((await route.POST(request('reset'))).status,503);
    assert.equal(delivered,1);
    blocked = false; unavailable = false;
    for (const failure of [new Error('private provider failure'),Object.assign(new Error('throttled'),{code:'EMAIL_PROVIDER_THROTTLED',retryAfterSeconds:5})]) {
        mailFailure = failure;
        const response = await route.POST(request('enroll'));
        assert.equal(response.status,failure.code ? 429 : 502);
        const result = await response.json();
        assert.equal(result.code,'EMAIL_DELIVERY_FAILED');
        assert.equal(result.success,undefined);
        assert.equal(result.devOtpCode,undefined);
        assert.doesNotMatch(JSON.stringify(result),/private provider/);
        if(failure.code)assert.equal(response.headers.get('Retry-After'),'5');
    }
});
