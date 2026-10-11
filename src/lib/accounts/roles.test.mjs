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
