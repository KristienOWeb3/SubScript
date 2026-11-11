import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('role checks use the configured database and preserve explicit roles without backfill writes',async()=>{
    const calls=[];
    let role='ENTERPRISE';
    const compiled=ts.transpileModule(readFileSync(new URL('./roles.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context=vm.createContext({module:{exports:{}},console,require:name=>{assert.equal(name,'@/lib/serverPg');return {pgMaybeOne:async(sql,args)=>{calls.push({sql,args});return role?{role}:null;},pgQuery:async()=>{throw new Error('Explicit role must not write');}};}});
    context.exports=context.module.exports;vm.runInContext(compiled,context);
    const api=context.module.exports;
    assert.equal(await api.getAccountRole(null),null);assert.equal(calls.length,0);
    assert.equal(await api.resolveAccountRoleWithBackfill('0xABC'),'ENTERPRISE');
    assert.equal(calls[0].args[0],'0xabc');
    assert.equal((await api.requireAccountRole('0xABC','USER')).ok,false);
    role='USER';assert.equal((await api.requireAccountRole('0xABC','USER')).ok,true);
    role=null;assert.equal(await api.getAccountRole('0xABC'),null);
});

function loadRoles(pg){
    const compiled=ts.transpileModule(readFileSync(new URL('./roles.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context=vm.createContext({module:{exports:{}},console,require:()=>pg});
    context.exports=context.module.exports;vm.runInContext(compiled,context);
    return context.module.exports;
}

test('sign-in role resolution leaves a brand-new wallet role-less so the account-type picker shows',async()=>{
    const writes=[];
    const api=loadRoles({
        pgMaybeOne:async(sql)=>sql.includes('as legacy')?{legacy:false}:null,
        pgQuery:async(sql)=>{writes.push(sql);},
    });
    assert.equal(await api.resolveAccountRoleForSession('0xNEW'),null);
    assert.equal(writes.length,0,'a new wallet must not get a USER role at sign-in');
});

test('sign-in role resolution still heals a legacy wallet to USER',async()=>{
    const writes=[];
    const api=loadRoles({
        pgMaybeOne:async(sql,args)=>{if(sql.includes('as legacy')){assert.equal(args[0],'0xold');return {legacy:true};}return null;},
        pgQuery:async(sql)=>{writes.push(sql);},
    });
    assert.equal(await api.resolveAccountRoleForSession('0xOLD'),'USER');
    assert.ok(writes.some(s=>s.includes("'USER'")));
});
