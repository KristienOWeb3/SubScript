import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {PGlite} from "@electric-sql/pglite";

const route = readFileSync(
    new URL("../../../../src/app/api/merchant/alias/route.ts", import.meta.url),
    "utf8",
);

test("merchant alias lookup is case-insensitive without accepting LIKE wildcards", () => {
    const getHandler = route.slice(
        route.indexOf("export async function GET"),
        route.indexOf("export async function POST"),
    );
    assert.match(getHandler, /const normalizedAlias = queryAlias\.toLowerCase\(\)\.trim\(\)/);
    assert.match(getHandler, /USER_ALIAS_REGEX\.test\(normalizedAlias\) \|\| ENTERPRISE_ALIAS_REGEX\.test\(normalizedAlias\)/);
    assert.match(getHandler, /alias ilike \$1/);
    assert.doesNotMatch(getHandler, /\.eq\("alias", normalizedAlias\)/);
});

function fixture(query) {
    const state = { matches: [{address:'0x1111111111111111111111111111111111111111',alias:'kristienoweb3.sub',isAnonymous:false}], role:'USER', fail:false, lookups:0 };
    const modules = {
        'next/server':{NextResponse:Response},
        '@/lib/auth':{getSessionWallet:async()=>null},
        '@/lib/supabaseAdmin':{supabaseAdmin:{from:()=>{throw new Error('Invalid API key');}}},
        '@/lib/prisma':{prisma:{merchant:{findUnique:async()=>null},customer:{findUnique:async()=>({profilePic:'avatar.png'})},addressAlias:{findMany:async options=>{state.lookups++;assert.equal(options.where.alias.mode,'insensitive');assert.equal(options.where.alias.equals,'kristienoweb3.sub');if(state.fail)throw new Error('private database details');return state.matches;},findUnique:async()=>({...state.matches[0],lastChangedAt:null})}}},
        '@/lib/accounts/roles':{getAccountRole:async()=>state.role},
        '@/lib/serverPg':{pgQuery:query || (async(_sql,args)=>{if(state.fail)throw new Error('private database details');if(!args[1])return [];state.lookups++;return state.matches.map(row=>({...row,role:state.role,is_anonymous:row.isAnonymous,profile_pic:'avatar.png'}));})},
        '@/lib/storage':{uploadProfilePicture:async()=>{}},
    };
    const context=vm.createContext({module:{exports:{}},require:name=>modules[name],URL,Date,Response,console});
    context.exports=context.module.exports;
    vm.runInContext(ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
    return {state,get:context.module.exports.GET};
}

test('recipient resolves despite a broken Supabase HTTP key, retaining profile and role checks',async()=>{
    const {state,get}=fixture();
    let response=await get(new Request('https://test.local/api/merchant/alias?alias=KristienOWeb3.sub'));
    assert.equal(response.status,200);
    assert.equal(state.lookups,1);
    assert.deepEqual(await response.json(),{success:true,address:state.matches[0].address,alias:'kristienoweb3.sub',is_anonymous:false,profile_pic:'avatar.png',verified:false});
    state.role='ENTERPRISE';
    response=await get(new Request('https://test.local/api/merchant/alias?alias=kristienoweb3.sub'));
    assert.equal((await response.json()).address,null);
    state.role='USER';
    response=await get(new Request('https://test.local/api/merchant/alias?address='+state.matches[0].address));
    const data=await response.json();assert.equal(data.alias,'kristienoweb3.sub');assert.equal(data.change_cooldown_days,365);
});

test('single Postgres query preserves merchant priority, profile, role, and ambiguous DNS protection',async()=>{
    const db=new PGlite();let calls=0;
    try {
        await db.exec(`create table merchants(wallet_address text primary key,commit_slug text unique,profile_pic text,display_name text,verified boolean);
            create table address_aliases(address text primary key,alias text unique,is_anonymous boolean);
            create table account_roles(address text primary key,role text);
            create table customers(wallet_address text primary key,profile_pic text);
            insert into address_aliases values('user-wallet','MixedName.sub',true),('enterprise-wallet','business.hq',false);
            insert into customers values('user-wallet','avatar.png');
            insert into account_roles values('enterprise-wallet','ENTERPRISE');
            insert into merchants values('merchant-wallet','mixedname.sub','merchant.png','Merchant',true);`);
        const {get}=fixture(async(sql,args)=>{calls++;return (await db.query(sql,args)).rows;});
        const read=async(alias,suffix='')=>get(new Request('https://test.local/api/merchant/alias?alias='+encodeURIComponent(alias)+suffix));
        let body=await (await read('MIXEDNAME.SUB')).json();
        assert.equal(calls,1);assert.equal(body.address,'merchant-wallet');assert.equal(body.displayName,'Merchant');assert.equal(body.verified,true);
        await db.exec('delete from merchants');
        body=await (await read('mixedname.sub')).json();assert.equal(body.address,'user-wallet');assert.equal(body.profile_pic,'avatar.png');assert.equal(body.is_anonymous,true);
        assert.equal((await (await read('mixedname.sub','&merchantCommitOnly=true')).json()).address,null);
        assert.equal((await (await read('business.hq')).json()).address,null);
        assert.equal((await (await read('%.sub')).json()).address,null);
        await db.exec("insert into address_aliases values('other-wallet','mixedname.sub',false)");
        assert.equal((await read('mixedname.sub')).status,503);
    }finally{await db.close();}
});

test('unknown/invalid aliases never resolve; ambiguous matches and database outages fail closed',async()=>{
    const {state,get}=fixture();
    for(const alias of ['%25.sub','abc_.sub']) {
        const response=await get(new Request('https://test.local/api/merchant/alias?alias='+alias));
        assert.equal((await response.json()).address,null);
    }
    assert.equal(state.lookups,0);
    state.matches=[];
    assert.equal((await (await get(new Request('https://test.local/api/merchant/alias?alias=kristienoweb3.sub'))).json()).address,null);
    state.matches=[{},{}];
    assert.equal((await get(new Request('https://test.local/api/merchant/alias?alias=kristienoweb3.sub'))).status,503);
    state.fail=true;
    const response=await get(new Request('https://test.local/api/merchant/alias?alias=kristienoweb3.sub'));
    assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private database details/);
});
