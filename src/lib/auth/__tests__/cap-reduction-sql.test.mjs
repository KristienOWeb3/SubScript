import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const owner='0xowner',root='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222',vault='33333333-3333-4333-8333-333333333333';
function load(file,modules){const compiled=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const context=vm.createContext({module:{exports:{}},exports:{},require:name=>{assert.ok(name in modules,name);return modules[name]},console,BigInt,Date,process});context.exports=context.module.exports;vm.runInContext(compiled,context);return context.module.exports;}
test('actual PostgreSQL conditional cap writes prevent stale reduction becoming unsigned increase for wallet and vault delegates',async()=>{
 const db=new PGlite();try{
 await db.exec('create table user_commits(id uuid primary key,commit_id text,wallet_address text,parent_commit_id uuid,status text,spend_limit_usdc bigint,spent_usdc bigint,vault_id uuid);create table metered_vaults(id uuid primary key,user_address text,balance_usdc bigint,accrued_usage_usdc bigint);');
 await db.query("insert into user_commits values($1,'root',$2,null,'ACTIVE',null,0,null),($3,'child',null,$1,'ACTIVE',100,0,$4)",[root,owner,child,vault]);
 await db.query('insert into metered_vaults values($1,$2,100000,0)',[vault,owner]);
 let race=false;
 const find=async({where,include})=>{const row=(await db.query('select * from user_commits where '+(where.id?'id=$1::uuid':'commit_id=$1'),[where.id??where.commitId])).rows[0];if(!row)return null;const result={id:row.id,commitId:row.commit_id,parentCommitId:row.parent_commit_id,walletAddress:row.wallet_address,status:row.status,spendLimitUsdc:row.spend_limit_usdc===null?null:BigInt(row.spend_limit_usdc),spentUsdc:BigInt(row.spent_usdc),vaultId:row.vault_id};
 if(include?.parent)result.parent={walletAddress:owner};if(include?.vault)result.vault={userAddress:owner,balanceUsdc:100000n,accruedUsageUsdc:0n};return result;};
 const prisma={userCommit:{findUnique:find,findUniqueOrThrow:find,findMany:async()=>[]},$queryRaw:async(strings,...values)=>{
   const sql=strings.map((part,index)=>part+(index<values.length?`$${index+1}`:'')).join('');
   if(race){race=false;await db.query('update user_commits set spend_limit_usdc=10 where id=$1',[child]);}
   return (await db.query(sql,values.map(v=>typeof v==='bigint'?v.toString():v))).rows;
 }};
 const commit=load('../../commitId.ts',{'crypto':crypto,'@/lib/prisma':{prisma},'@/lib/identityDisplay':{accountDisplayName:()=>''}});
 const sharing=load('../../vaultCommitSharing.ts',{'@/lib/prisma':{prisma},'@/lib/commitId':commit});
 for(const update of [commit.updateSubUserLimit,sharing.updateVaultShareLimit]){
   await db.query('update user_commits set spend_limit_usdc=100 where id=$1',[child]);
   race=true;await assert.rejects(update(owner,'child',90n),/current cap or authority changed/);
   assert.equal((await db.query('select spend_limit_usdc from user_commits where id=$1',[child])).rows[0].spend_limit_usdc,10);
   assert.equal((await update(owner,'child',90n,true)).spendLimitUsdc,90n);
   assert.equal((await update(owner,'child',50n)).spendLimitUsdc,50n);
   await assert.rejects(update(owner,'child',null),/current cap or authority changed/);
   assert.equal((await update(owner,'child',null,true)).spendLimitUsdc,null);
 }
 }finally{await db.close()}
});
