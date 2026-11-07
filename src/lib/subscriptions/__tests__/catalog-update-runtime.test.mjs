import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, modules) {
    const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context = vm.createContext({module:{exports:{}},require:name=>{assert.ok(name in modules,name); return modules[name];},Date,Request,Response,console});
    context.exports = context.module.exports;
    vm.runInContext(compiled, context);
    return context.module.exports;
}
function fixture() {
    const plans = new Map(['a','b'].map(id=>[id,{id,merchantAddress:'merchant',active:false,targetSubscriber:null,sourceCheckoutId:null,amountUsdc:1n,periodSeconds:100n}]));
    let others = 19, queue = Promise.resolve(), beforeTransaction = ()=>{};
    const events = [];
    const link = {id:'checkout',merchantAddress:'merchant',active:true,status:'PENDING',expiresAt:null,useCount:0,paidAt:null,verifiedTxHash:null,externalReference:null,beneficiaryAddress:null,payerEmail:null,receiverAddress:null,receiverPrivateKey:null,invoiceNumber:null,dueDate:null,stateSnapshot:{subscriber:'subscriber',minCommitmentSeconds:'0'}};
    const tx = {
        $executeRaw:async()=>{events.push('catalog-lock');return 1;},
        $queryRaw:async()=>{events.push('checkout-lock');return [{id:link.id}];},
        merchantPlan:{findUnique:async({where})=>{events.push('plan-read');return {...plans.get(where.id)};},count:async()=>others+[...plans.values()].filter(p=>p.active).length,update:async({where,data})=>{Object.assign(plans.get(where.id),data);return {...plans.get(where.id)};}},
        paymentLink:{findUnique:async()=>({...link})},
    };
    const prisma = {...tx,$transaction:callback=>{const run=queue.then(()=>{beforeTransaction();return callback(tx);});queue=run.catch(()=>{});return run;},merchantPlanPromotion:{findMany:async()=>[]}};
    const catalog = load('../sitePlans.ts',{'@prisma/client':{Prisma:{TransactionIsolationLevel:{ReadCommitted:'ReadCommitted'}}},'@/lib/prisma':{prisma},'@/lib/subscriptionCheckout':{readSubscriptionCheckoutMeta:value=>value,subscriptionCheckoutPeriod:()=>100n}});
    const modules = {'next/server':{NextResponse:Response},'@/lib/prisma':{prisma},'@/lib/auth':{getSessionWallet:async()=> 'merchant'},'@/lib/accounts/roles':{requireAccountRole:async()=>({ok:true})},'ethers':{ethers:{}},'viem':{formatUnits:value=>String(value)},'@/lib/apiErrors':{apiError:({status,code,message})=>Response.json({code,error:message},{status})},'@/lib/v1/merchantAuth':{authenticateMerchant:async()=>({ok:true,merchantAddress:'merchant',mode:'live'}),requireEnterpriseAndTier1:async()=>({ok:true})},'@/utils/security':{sanitizeInput:value=>value},'@/lib/dms/system':{parseUsdcToMicros:()=>1n},'@/lib/checkoutUrl':{buildSubscribeUrl:()=>''},'@/lib/subscriptions/sitePlans':catalog,'@/lib/subscriptions/promotions':{formatPromotion:()=>null,isPromotionLive:()=>false},'@/lib/contracts/constants':{DEMO_MERCHANT_ADDRESS:'demo'}};
    return {catalog,plans,link,events,route:path=>load(path,modules),setOthers:value=>{others=value;},beforeTransaction:callback=>{beforeTransaction=callback;}};
}

for (const [name,path] of [['dashboard','../../../app/api/merchant/plans/route.ts'],['API','../../../app/api/v1/plans/route.ts']]) {
    test(`${name} catalog rejects nonboolean active values without mutation`, async()=>{
        const f=fixture(), route=f.route(path);
        for (const active of ['true',1,null,{},[]]) {
            const response=await route.PATCH(new Request('https://test.local',{method:'PATCH',body:JSON.stringify({planId:'a',active})}));
            assert.equal(response.status,400,JSON.stringify(active));
            assert.equal(f.plans.get('a').active,false);
        }
    });
    test(`${name} description-only edit cannot restore concurrently disabled plan`,async()=>{
        const f=fixture();f.plans.get('a').active=true;
        f.beforeTransaction(()=>{f.plans.get('a').active=false;});
        const response=await f.route(path).PATCH(new Request('https://test.local',{method:'PATCH',body:JSON.stringify({planId:'a',description:'Updated'})}));
        assert.equal(response.status,200);assert.equal(f.plans.get('a').active,false);
        assert.equal(f.plans.get('a').description,'Updated');
    });
}
test('catalog serialization admits only one activation at capacity and rereads under lock',async()=>{
    const f=fixture();
    const results=await Promise.allSettled(['a','b'].map(id=>f.catalog.updateMerchantPlanCatalogEntry('merchant',id,{active:true})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.status,403);
    assert.equal(f.events[0],'catalog-lock');assert.equal(f.events[1],'plan-read');
    const active=[...f.plans.values()].find(p=>p.active);
    await f.catalog.updateMerchantPlanCatalogEntry('merchant',active.id,{active:true});
});
test('targeted activation locks and validates unconsumed current source and subscriber ownership',async()=>{
    for(const mutate of [link=>{link.expiresAt=new Date(0);},link=>{link.useCount=1;},link=>{link.paidAt=new Date();},link=>{link.verifiedTxHash='hash';},link=>{link.merchantAddress='other';},link=>{link.stateSnapshot.subscriber='other';},link=>{link.beneficiaryAddress='private';}]) {
        const f=fixture();Object.assign(f.plans.get('a'),{targetSubscriber:'subscriber',sourceCheckoutId:'checkout'});mutate(f.link);
        await assert.rejects(()=>f.catalog.updateMerchantPlanCatalogEntry('merchant','a',{active:true}));
        assert.equal(f.plans.get('a').active,false);assert.ok(f.events.includes('checkout-lock'));
    }
    const f=fixture();Object.assign(f.plans.get('a'),{targetSubscriber:'subscriber',sourceCheckoutId:'checkout'});f.setOthers(20);
    assert.equal((await f.catalog.updateMerchantPlanCatalogEntry('merchant','a',{active:true})).active,true);
});
