import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {ethers} from "ethers";
import {PGlite} from "@electric-sql/pglite";

const wallet="0x1111111111111111111111111111111111111111",recipient="0x2222222222222222222222222222222222222222";
const token="0x3600000000000000000000000000000000000000",messenger="0x3333333333333333333333333333333333333333";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",providerId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",hash="0x"+"a".repeat(64);
const mint=ethers.zeroPadValue(recipient,32),ref=`cctp-withdraw-burn:${id}`;
const iface=new ethers.Interface(["event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)"]);
function receipt(overrides={}) {
    const values={token,amount:9950000n,wallet,mint,domain:6,...overrides};
    return {status:1,logs:[{address:messenger,...iface.encodeEventLog(iface.getEvent("DepositForBurn"),[values.token,values.amount,values.wallet,values.mint,values.domain,ethers.ZeroHash,ethers.ZeroHash,0n,2000,"0x"])}]};
}
async function fixture() {
    const db=new PGlite();
    await db.exec(readFileSync(new URL("../../../../supabase/migrations/20260828000000_create_cctp_bridge_transfers.sql",import.meta.url),"utf8"));
    await db.exec(readFileSync(new URL("../../../../supabase/migrations/20261016094009_durable_outbound_cctp_recovery.sql",import.meta.url),"utf8"));
    await db.exec("create table user_embedded_wallets(wallet_address text,circle_wallet_id text)");
    await db.query("insert into user_embedded_wallets values($1,'owned-wallet')",[wallet]);
    await db.query(`insert into cctp_bridge_transfers(id,direction,user_wallet,recipient_address,origin_chain_id,origin_domain,destination_chain_id,destination_domain,gross_amount_micros,fee_amount_micros,net_amount_micros,status,burn_ref_id,burn_started_at,burn_mint_recipient)
        values($1,'outbound_withdrawal',$2,$3,'arc',26,'8453',6,10000000,50000,9950000,'pending_fee',$4,now(),$5)`,[id,wallet,recipient,ref,mint]);
    const state={owner:"owned-wallet",ref,receipt:receipt(),network:5042n,page:[{id:providerId,walletId:"owned-wallet",refId:ref}]};
    const calls={creates:0,pages:0};
    const modules={ethers:{ethers},"@/lib/serverPg":{pgQuery:async(sql,args)=>(await db.query(sql,args)).rows,pgMaybeOne:async(sql,args)=>(await db.query(sql,args)).rows[0]??null},
        "@/lib/circle/devWallets":{getDevWalletsClient:()=>({listTransactions:async()=>{calls.pages++;return {data:{transactions:state.page}}},getTransaction:async()=>({data:{transaction:{id:providerId,walletId:state.owner,refId:state.ref,txHash:hash}}}),createContractExecutionTransaction:async()=>{calls.creates++;throw Error("recovery must never sign")}})},
        "@/lib/vault/onchain":{readProvider:()=>({getNetwork:async()=>({chainId:state.network}),getTransactionReceipt:async()=>state.receipt})},
        "@/lib/contracts/constants":{isProd:true,ARC_MAINNET_CHAIN_ID:5042,ARC_TESTNET_CHAIN_ID:5042002,ARC_TOKEN_MESSENGER_ADDRESS:messenger,USDC_NATIVE_GAS_ADDRESS:token}};
    const context={module:{exports:{}},exports:{},require:n=>{assert.ok(n in modules,n);return modules[n]},AbortSignal,setTimeout,clearTimeout};context.exports=context.module.exports;
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../outboundRecovery.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
    return {db,state,calls,api:context.module.exports,row:async()=>(await db.query("select * from cctp_bridge_transfers where id=$1",[id])).rows[0]};
}
test("lost acceptance response and provider persistence recover the owned burn without resubmission",async()=>{
    const f=await fixture();try{
        assert.equal((await f.api.recoverOutboundCctpBurns()).recovered,1);
        const row=await f.row();assert.equal(row.burn_provider_id,providerId);assert.equal(row.burn_tx_hash,hash);assert.equal(row.status,"pending_attestation");assert.equal(f.calls.creates,0);
        assert.equal((await f.api.recoverOutboundCctpBurns()).recovered,0);
    }finally{await f.db.close()}
});
test("burn recovery rejects another owner, reference, chain, amount, token, recipient and domain",async()=>{
    const f=await fixture();try{
        for(const change of [()=>{f.state.owner="other-wallet"},()=>{f.state.ref="other-reference"},()=>{f.state.network=1n},()=>{f.state.receipt=receipt({amount:1n})},()=>{f.state.receipt=receipt({wallet:recipient})},()=>{f.state.receipt=receipt({mint:ethers.ZeroHash})},()=>{f.state.receipt=receipt({domain:7})},()=>{f.state.receipt=receipt({token:recipient})}]){
            f.state.owner="owned-wallet";f.state.ref=ref;f.state.network=5042n;f.state.receipt=receipt();change();
            assert.equal((await f.api.recoverOutboundCctpBurns()).recovered,0);assert.equal((await f.row()).status,"pending_fee");
        }
        assert.equal(f.calls.creates,0);
    }finally{await f.db.close()}
});
test("unindexed accepted burn stays pending and durable scan cursor advances",async()=>{
    const f=await fixture();try{
        f.state.page=Array.from({length:50},(_,i)=>({id:`page-${i}`,walletId:"owned-wallet",refId:"unrelated"}));
        assert.equal((await f.api.recoverOutboundCctpBurns()).recovered,0);assert.equal((await f.row()).burn_lookup_cursor,"page-49");
        f.state.page=[];await f.api.recoverOutboundCctpBurns();assert.equal((await f.row()).burn_lookup_cursor,null);
        f.state.page=[{id:providerId,walletId:"owned-wallet",refId:ref}];assert.equal((await f.api.recoverOutboundCctpBurns()).recovered,1);
    }finally{await f.db.close()}
});
