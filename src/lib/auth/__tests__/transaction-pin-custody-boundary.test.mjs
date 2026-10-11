import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assertFinancialAuthorizationCurrent, runFinancialAuthorization } from '../financialAuthorizationContext.ts';

test('custody signer refuses explicit external wallets even with stale Circle markers',async()=>{
 const source=readFileSync(new URL('../../custody/index.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('custody.ts',source,ts.ScriptTarget.Latest,true);
 const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getWalletCustody');
 assert.ok(declaration);
 const compiled=ts.transpileModule(declaration.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let record,constructed=0;
 const context=vm.createContext({exports:{},pgMaybeOne:async(sql,values)=>{assert.match(sql,/provider/);assert.equal(values[0],'0xabc');return record;},CircleCustody:class{constructor(){constructed++;}}});
 vm.runInContext(compiled,context);
 for(const value of [null,{provider:'external_wallet',circle_wallet_id:'stale-circle'},{provider:'external_wallet_email_otp',circle_wallet_id:null}]){
  record=value;await assert.rejects(context.exports.getWalletCustody('0xABC'),/no server-held key/);
 }
 assert.equal(constructed,0);
 for(const provider of ['circle_google','external_wallet_email_otp',null]){
  record={provider,circle_wallet_id:'owned-circle'};await context.exports.getWalletCustody('0xABC');
 }
 assert.equal(constructed,3);
});

test('send rejects explicit external wallet records before choosing the custody signer',()=>{
 const route=readFileSync(new URL('../../../app/api/user/wallet/send/route.ts',import.meta.url),'utf8');
 assert.match(route,/if \(walletRecord\?\.provider === "external_wallet" \|\| \(!walletRecord\?\.encrypted_private_key && !walletRecord\?\.circle_wallet_id\)\)/);
 assert.ok(route.indexOf('walletRecord?.provider === "external_wallet"')<route.indexOf('const custody = await getWalletCustody(fundingWallet)'));
});

for (const authorityChanges of [true, false]) test(`Circle queue retry ${authorityChanges ? 'refuses changed authority before another submission' : 'accepts unchanged authority with the same provider key'}`, async () => {
 const source=readFileSync(new URL('../../custody/index.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('custody.ts',source,ts.ScriptTarget.Latest,true);
 const names=new Set(['CircleCustody','CirclePaymasterPolicyError','circleErrorCode','circleErrorMessage','isCircleFirstTxQueueError','isCirclePaymasterPolicyError']);
 const constants=new Set(['CIRCLE_FIRST_TX_QUEUE_RETRY_DELAYS_MS','CIRCLE_FIRST_TX_QUEUE_CODE','CIRCLE_PAYMASTER_POLICY_CODE']);
 const declarations=ast.statements.filter(node=>names.has(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>constants.has(declaration.name.getText(ast))));
 assert.equal(declarations.length,9);
 const compiled=ts.transpileModule(declarations.map(node=>node.getText(ast)).join('\n')+'\nglobalThis.Custody=CircleCustody;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const requests=[];const waits=[];let submitted=0;let validations=0;
 const approved={merchant:'approved-merchant'};let live={...approved};
 const context=vm.createContext({exports:{},console,performance,assertFinancialAuthorizationCurrent,
  ethers:{Interface:class{encodeFunctionData(){return '0xencoded';}}},circleIdempotencyKey:key=>key,
  getDevWalletsClient:()=>({createContractExecutionTransaction:async request=>{
   requests.push(request);
   if(requests.length===1) throw {code:155505};
   return {data:{id:'accepted-id',state:'INITIATED'}};
  }}),
  wait:async delay=>{waits.push(delay);if(authorityChanges)live={merchant:'changed-merchant'};},
 });
 vm.runInContext(compiled,context);
 const custody=new context.Custody('wallet','circle-wallet');
 const execute=()=>runFinancialAuthorization(approved,async()=>{validations++;return live;},()=>custody.executeContract({contractAddress:'contract',abi:[],functionName:'transfer',args:[],idempotencyKey:'stable-provider-key',waitForConfirmation:false,onSubmitted:async()=>{submitted++;}}));
 if(authorityChanges){
  await assert.rejects(execute,/TRANSACTION_AUTHORITY_CHANGED/);
  assert.equal(requests.length,1);assert.equal(submitted,0);
 }else{
  const result=await execute();
  assert.equal(result.circleTxId,'accepted-id');assert.equal(requests.length,2);assert.equal(submitted,1);
  assert.equal(requests[0].idempotencyKey,requests[1].idempotencyKey);
 }
 assert.equal(validations,2);assert.deepEqual(waits,[500]);
});
