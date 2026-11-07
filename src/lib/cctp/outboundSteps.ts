import { ethers } from "ethers";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { getDevWalletsClient } from "@/lib/circle/devWallets";
import { deterministicIdempotencyKey, type WalletCustody, type ContractCall } from "@/lib/custody";
import { readProvider } from "@/lib/vault/onchain";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, ARC_TOKEN_MESSENGER_ADDRESS, BRIDGE_FEE_TREASURY_ADDRESS, USDC_NATIVE_GAS_ADDRESS, isProd } from "@/lib/contracts/constants";
import { provesOutboundBurn, recordOutboundBurnProvider } from "./outboundRecovery";

type Step = "fee" | "approve" | "burn";
type StepRecord = {refId:string;startedAt:string;providerId?:string;lookupCursor?:string|null};
type Transfer = {user_wallet:string;fee_amount_micros:string;net_amount_micros:string;destination_domain:number;
    burn_mint_recipient:string;withdrawal_steps:Partial<Record<Step,StepRecord>>};
const tokenEvents = new ethers.Interface([
    "event Transfer(address indexed from,address indexed to,uint256 value)",
    "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);

async function updateStep(id:string,step:Step,values:Record<string,unknown>) {
    await pgQuery(`update cctp_bridge_transfers set withdrawal_steps=jsonb_set(withdrawal_steps,array[$2::text],
        coalesce(withdrawal_steps->$2::text,'{}'::jsonb)||$3::jsonb),updated_at=now() where id=$1`,[id,step,JSON.stringify(values)]);
}
export class OutboundStepPendingError extends Error {
    constructor(public step:Step) {super(`The ${step} transaction is being reconciled. Resume this withdrawal using its existing transfer ID.`);}
}

async function observeStep(id:string,step:Step,transfer:Transfer,record:StepRecord):Promise<string|null> {
    const owner=await pgMaybeOne<{circle_wallet_id:string}>("select circle_wallet_id from user_embedded_wallets where lower(wallet_address)=$1",[transfer.user_wallet.toLowerCase()]);
    if(!owner?.circle_wallet_id)throw new Error("CCTP_STEP_OWNER_UNVERIFIED");
    const client=getDevWalletsClient();
    let providerId=record.providerId;
    if(!providerId){
        const page=await client.listTransactions({walletIds:[owner.circle_wallet_id],from:new Date(new Date(record.startedAt).getTime()-60_000).toISOString(),pageSize:50,...(record.lookupCursor?{pageAfter:record.lookupCursor}:{})});
        const transactions=page.data?.transactions??[];
        const matching=transactions.filter(tx=>tx.walletId===owner.circle_wallet_id&&tx.refId===record.refId);
        if(matching.length>1)throw new Error("CCTP_STEP_REFERENCE_AMBIGUOUS");
        providerId=matching[0]?.id;
        if(!providerId){await updateStep(id,step,{lookupCursor:transactions.length===50?transactions[49].id:null});return null;}
        await updateStep(id,step,{providerId});
    }
    const transaction=(await client.getTransaction({id:providerId,signal:AbortSignal.timeout(5000)})).data?.transaction;
    if(!transaction||transaction.walletId!==owner.circle_wallet_id||transaction.refId!==record.refId)throw new Error("CCTP_STEP_OWNER_UNVERIFIED");
    if(!transaction.txHash)return null;
    const provider=readProvider();
    if(Number((await provider.getNetwork()).chainId)!==(isProd?ARC_MAINNET_CHAIN_ID:ARC_TESTNET_CHAIN_ID))throw new Error("CCTP_STEP_NETWORK_MISMATCH");
    const receipt=await provider.getTransactionReceipt(transaction.txHash);
    if(!receipt||receipt.status!==1)return null;
    const proved=step==='burn'?provesOutboundBurn(transfer,receipt):receipt.logs.some(log=>{
        if(log.address.toLowerCase()!==USDC_NATIVE_GAS_ADDRESS.toLowerCase())return false;
        try{
            const event=tokenEvents.parseLog({topics:[...log.topics],data:log.data});
            return step==='fee'
                ? event?.name==='Transfer'&&String(event.args.from).toLowerCase()===transfer.user_wallet.toLowerCase()
                    &&String(event.args.to).toLowerCase()===BRIDGE_FEE_TREASURY_ADDRESS.toLowerCase()&&BigInt(event.args.value)===BigInt(transfer.fee_amount_micros)
                : event?.name==='Approval'&&String(event.args.owner).toLowerCase()===transfer.user_wallet.toLowerCase()
                    &&String(event.args.spender).toLowerCase()===ARC_TOKEN_MESSENGER_ADDRESS.toLowerCase()&&BigInt(event.args.value)>=BigInt(transfer.net_amount_micros);
        }catch{return false;}
    });
    if(!proved)return null;
    if(step==='burn')await recordOutboundBurnProvider(id,providerId);
    await updateStep(id,step,{txHash:transaction.txHash});
    return transaction.txHash;
}

/** Only an explicitly PIN-authorized request may advance an unsubmitted phase.
 * Previously started phases are observed, never re-signed, even after a lost response. */
export async function executeOutboundCctpStep(id:string,step:Step,custody:WalletCustody,call:ContractCall):Promise<string> {
    const transfer=await pgMaybeOne<Transfer>("select user_wallet,fee_amount_micros::text,net_amount_micros::text,destination_domain,burn_mint_recipient,withdrawal_steps from cctp_bridge_transfers where id=$1",[id]);
    if(!transfer||transfer.user_wallet.toLowerCase()!==custody.address.toLowerCase())throw new Error("CCTP_STEP_OWNER_UNVERIFIED");
    const existing=transfer.withdrawal_steps[step];
    if(existing){const hash=await observeStep(id,step,transfer,existing);if(hash)return hash;throw new OutboundStepPendingError(step);}
    const refId=`cctp-withdraw-${step}:${id}`;
    const startedAt=new Date().toISOString();
    const claimed=await pgMaybeOne(`update cctp_bridge_transfers set withdrawal_steps=jsonb_set(withdrawal_steps,array[$2::text],$3::jsonb),updated_at=now()
        where id=$1 and not (withdrawal_steps ? $2::text) returning id`,[id,step,JSON.stringify({refId,startedAt})]);
    if(!claimed)throw new OutboundStepPendingError(step);
    await custody.executeContract({...call,idempotencyKey:deterministicIdempotencyKey(refId),refId,onSubmitted:async providerId=>{
        await Promise.all([updateStep(id,step,{providerId}),step==='burn'?recordOutboundBurnProvider(id,providerId):undefined]);
    }});
    const record=(await pgMaybeOne<Transfer>("select user_wallet,fee_amount_micros::text,net_amount_micros::text,destination_domain,burn_mint_recipient,withdrawal_steps from cctp_bridge_transfers where id=$1",[id]))!;
    const hash=await observeStep(id,step,record,record.withdrawal_steps[step]!);
    if(!hash)throw new OutboundStepPendingError(step);
    return hash;
}
