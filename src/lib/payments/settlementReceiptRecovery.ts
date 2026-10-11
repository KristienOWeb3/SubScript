import crypto from "node:crypto";
import { ethers } from "ethers";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { getDevWalletsClient } from "@/lib/circle/devWallets";
import { readProvider } from "@/lib/vault/onchain";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { sendSettlementReceipts, type SettlementKind } from "@/lib/email/settlementReceipts";
import { resolveRecipient, renderEmailLayout, htmlEscape } from "@/lib/email/core";
import { enqueueEmail, processEmailOutbox } from "@/lib/email/outbox";

export type ReceiptJobKind = "wallet_transfer" | "vault_topup" | "vault_withdraw" | "vault_reclaim" | "vault_claim" | "router_withdraw" | "payout_change";
type Job = {
    id: string; identity: string; kind: ReceiptJobKind; funding_wallet: string;
    payer_address: string | null; payee_address: string | null; amount_usdc: string | null;
    contract_address: string; chain_id: number; provider_id: string | null; tx_hash: string | null;
    state: string; created_at: string; lease_token: string; attempts: number;
};

export async function prepareSettlementReceiptJob(input: {
    identity: string; kind: ReceiptJobKind; fundingWallet: string; payerAddress?: string | null;
    payeeAddress?: string | null; amountUsdc?: bigint | null; contractAddress: string; chainId: number;
}) {
    const identity = crypto.createHash("sha256").update(input.identity).digest("hex");
    const row = await pgMaybeOne<{ id: string }>(
        `insert into settlement_receipt_jobs(identity,kind,funding_wallet,payer_address,payee_address,amount_usdc,contract_address,chain_id)
         values($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict(identity) do update set identity=excluded.identity
         where settlement_receipt_jobs.kind=excluded.kind and settlement_receipt_jobs.funding_wallet=excluded.funding_wallet
           and settlement_receipt_jobs.payer_address is not distinct from excluded.payer_address
           and settlement_receipt_jobs.payee_address is not distinct from excluded.payee_address
           and settlement_receipt_jobs.amount_usdc is not distinct from excluded.amount_usdc
           and settlement_receipt_jobs.contract_address=excluded.contract_address and settlement_receipt_jobs.chain_id=excluded.chain_id
         returning id`, [identity,input.kind,input.fundingWallet.toLowerCase(),input.payerAddress?.toLowerCase() ?? null,
            input.payeeAddress?.toLowerCase() ?? null,input.amountUsdc?.toString() ?? null,input.contractAddress.toLowerCase(),input.chainId],
    );
    if (!row) throw new Error("SETTLEMENT_RECEIPT_IDENTITY_CONFLICT");
    return row.id;
}

export async function recordSettlementReceiptSubmission(id: string, providerId: string) {
    const row = await pgMaybeOne(`update settlement_receipt_jobs set provider_id=$2,
        state=case when state='prepared' then 'submitted' else state end,updated_at=now()
        where id=$1 and (provider_id is null or provider_id=$2) returning id`, [id,providerId]);
    if (!row) throw new Error("SETTLEMENT_RECEIPT_PROVIDER_CONFLICT");
}

export async function confirmSettlementReceiptJob(id: string, txHash: string) {
    if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw new Error("INVALID_SETTLEMENT_HASH");
    const row = await pgMaybeOne(`update settlement_receipt_jobs set tx_hash=$2,
        state=case when state in ('prepared','submitted') then 'confirmed' else state end,updated_at=now()
        where id=$1 and (tx_hash is null or tx_hash=$2) returning id`, [id,txHash.toLowerCase()]);
    if (!row) throw new Error("SETTLEMENT_RECEIPT_HASH_CONFLICT");
}

export async function failSettlementReceiptJob(id: string) {
    await pgQuery("update settlement_receipt_jobs set state='failed',lease_token=null,lease_until=null,updated_at=now() where id=$1 and state in ('prepared','submitted')", [id]);
}

const events = new ethers.Interface([
    "event Transfer(address indexed from,address indexed to,uint256 value)",
    "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
    "event PayoutDelivered(address indexed merchant,address indexed destination,uint256 netAmount,uint256 fee)",
]);

/** Only matching executed USDC legs produce a monetary receipt, including inner SCA failure checks. */
export function inspectSettlementReceipt(job: Pick<Job,"kind"|"funding_wallet"|"payee_address"|"amount_usdc"|"contract_address">, receipt: {status: number | null; logs: ReadonlyArray<{address: string; topics: readonly string[]; data: string}>}) {
    if (receipt.status === 0) return {state:"failed" as const,amount:null};
    if (receipt.status !== 1) return {state:"pending" as const,amount:null};
    const transfers: bigint[] = [];
    const payouts: Array<{ destination: string; amount: bigint }> = [];
    const payoutTransfers: Array<{ destination: string; amount: bigint }> = [];
    for (const log of receipt.logs) {
        let parsed;
        try { parsed=events.parseLog({topics:[...log.topics],data:log.data}); } catch { continue; }
        if (parsed?.name==='UserOperationEvent' && String(parsed.args.sender).toLowerCase()===job.funding_wallet && parsed.args.success===false) return {state:"failed" as const,amount:null};
        if (job.kind === 'router_withdraw' && parsed?.name === 'PayoutDelivered'
            && log.address.toLowerCase() === job.contract_address
            && String(parsed.args.merchant).toLowerCase() === job.funding_wallet) {
            payouts.push({ destination: String(parsed.args.destination).toLowerCase(), amount: BigInt(parsed.args.netAmount) });
        }
        if (parsed?.name!=='Transfer' || log.address.toLowerCase()!==USDC_NATIVE_GAS_ADDRESS.toLowerCase()) continue;
        const from=String(parsed.args.from).toLowerCase(), to=String(parsed.args.to).toLowerCase();
        if (job.kind === 'router_withdraw' && from === job.contract_address) {
            payoutTransfers.push({ destination: to, amount: BigInt(parsed.args.value) });
        }
        const expectedFrom=['wallet_transfer','vault_topup'].includes(job.kind) ? job.funding_wallet : job.contract_address;
        const expectedTo=job.kind==='vault_topup' ? job.contract_address : job.payee_address;
        if(from===expectedFrom && to===expectedTo && BigInt(parsed.args.value)>0n) transfers.push(BigInt(parsed.args.value));
    }
    // The mined router event owns net amount/destination, including fee deductions and
    // concurrent deposits or payout changes after the request's preflight reads.
    if (job.kind === 'router_withdraw') {
        const payout = payouts.find(p => p.amount > 0n && (!job.payee_address || job.payee_address === p.destination)
            && payoutTransfers.some(t => t.destination === p.destination && t.amount === p.amount));
        return { state: payout ? 'confirmed' as const : 'pending' as const, amount: payout?.amount ?? null,
            destination: payout?.destination ?? null };
    }
    if(job.kind==='payout_change') return {state:"confirmed" as const,amount:null};
    const amount=job.amount_usdc===null ? transfers.reduce((sum,value)=>sum+value,0n)
        : transfers.find(value=>value===BigInt(job.amount_usdc!)) ?? 0n;
    return {state:amount>0n ? "confirmed" as const : "pending" as const,amount:amount>0n ? amount : null};
}

async function boundedReceiptRead<T>(read: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([read, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("SETTLEMENT_RPC_TIMEOUT")), milliseconds);
        })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function processSettlementReceiptJobs(limit=5, readTimeoutMs=3000) {
    const counts={enqueued:0,pending:0,failed:0,review:0};
    const deadline=Date.now()+15_000;
    for(let i=0;i<Math.min(limit,10) && Date.now()<deadline;i++) {
        const lease=crypto.randomUUID();
        const job=await pgMaybeOne<Job>(`with candidate as (
          select id from settlement_receipt_jobs where state in ('prepared','submitted','confirmed')
            and next_attempt_at<=now() and (lease_until is null or lease_until<now())
          order by created_at for update skip locked limit 1)
          update settlement_receipt_jobs j set lease_token=$1,lease_until=now()+interval '90 seconds',attempts=attempts+1
          from candidate c where j.id=c.id returning j.*`,[lease]);
        if(!job) break;
        const finish=async(state:string)=>pgQuery(`update settlement_receipt_jobs set state=$3,lease_token=null,lease_until=null,
          next_attempt_at=now()+interval '30 seconds',updated_at=now() where id=$1 and lease_token=$2`,[job.id,lease,state]);
        try {
            let txHash=job.tx_hash;
            if(job.provider_id) {
                const owner=await pgMaybeOne<{circle_wallet_id:string}>("select circle_wallet_id from user_embedded_wallets where lower(wallet_address)=$1",[job.funding_wallet]);
                const transaction=(await getDevWalletsClient().getTransaction({id:job.provider_id,signal:AbortSignal.timeout(5000)})).data?.transaction;
                if(!owner || !transaction || transaction.walletId!==owner.circle_wallet_id) throw new Error("SETTLEMENT_OWNER_UNVERIFIED");
                txHash=transaction.txHash ?? txHash;
                if(!txHash && ['FAILED','CANCELLED','DENIED'].includes(String(transaction.state))) {await finish('failed');counts.failed++;continue;}
            }
            if(!txHash) {
                const state=Date.now()-new Date(job.created_at).getTime()>15*60_000 && !job.provider_id ? 'review' : job.state;
                await finish(state); counts[state==='review'?'review':'pending']++; continue;
            }
            const provider=readProvider();
            const readBudget = () => Math.max(1, Math.min(3000, readTimeoutMs, deadline - Date.now()));
            if(Number((await boundedReceiptRead(provider.getNetwork(), readBudget())).chainId)!==job.chain_id) throw new Error("SETTLEMENT_NETWORK_MISMATCH");
            const receipt=await boundedReceiptRead(provider.getTransactionReceipt(txHash), readBudget());
            if(!receipt) {await finish(job.state);counts.pending++;continue;}
            const checked=inspectSettlementReceipt(job,receipt);
            if(checked.state!=='confirmed') {await finish(checked.state==='failed'?'failed':job.state);counts[checked.state==='failed'?'failed':'pending']++;continue;}
            // Pre-release completed jobs used a UUID-based email key. Honor their
            // durable enqueue marker as well as the new key to avoid replaying old mail.
            const previouslyEnqueued = await pgMaybeOne<{id:string}>(`select id from settlement_receipt_jobs
              where id<>$1 and state='enqueued' and kind=$2 and chain_id=$3 and funding_wallet=$4
                and payer_address is not distinct from $7 and payee_address is not distinct from $8
                and amount_usdc is not distinct from $9::bigint and contract_address=$10
                and ((provider_id is not null and provider_id=$5::uuid)
                  or ($5::uuid is null and provider_id is null and lower(tx_hash)=lower($6))) limit 1`,
            [job.id,job.kind,job.chain_id,job.funding_wallet,job.provider_id,txHash,
                job.payer_address,job.payee_address,job.amount_usdc,job.contract_address]);
            if (previouslyEnqueued) {await finish('enqueued');counts.enqueued++;continue;}
            if(checked.amount) {
                const refund = job.kind === 'vault_withdraw' || job.kind === 'vault_reclaim';
                const payer = job.kind === 'router_withdraw' || refund ? null : job.payer_address;
                const payee = job.kind === 'router_withdraw' ? job.funding_wallet : job.payee_address;
                // Older deployed jobs used the batch position in their database identity.
                // Bind the email to the proved financial leg so old/new jobs and retries
                // cannot send a second receipt for the same custody transaction.
                const legIdentity = crypto.createHash('sha256').update(JSON.stringify([
                    job.chain_id, job.kind, txHash.toLowerCase(), job.funding_wallet,
                    job.provider_id, payer, payee, checked.amount.toString(),
                    'destination' in checked ? checked.destination : job.payee_address,
                ])).digest('hex');
                await sendSettlementReceipts({kind:job.kind as SettlementKind,amountUsdc:checked.amount,txHash,
                    settlementRef:`settlement-leg:${legIdentity}`,payerAddress:payer,payeeAddress:payee});
            } else {
                const recipient=await resolveRecipient(job.funding_wallet,'security',true);
                if(!recipient) throw new Error("SETTLEMENT_RECIPIENT_UNAVAILABLE");
                const text=`Your payout destination change is confirmed. Transaction: ${txHash}. If you did not authorize this change, secure your account immediately.`;
                await enqueueEmail({to:recipient,category:'security',subject:'Your payout destination changed',text,
                    html:renderEmailLayout({previewText:'Payout destination changed',heading:'Payout destination update',bodyHtml:`<p>${htmlEscape(text)}</p>`}),
                    idempotencyKey:`settlement-job:${job.identity}:security`});
            }
            await pgQuery(`update settlement_receipt_jobs set tx_hash=$3 where id=$1 and lease_token=$2`,[job.id,lease,txHash.toLowerCase()]);
            await finish('enqueued');counts.enqueued++;
        } catch {
            // Enqueue/provider/database failure retains the job; never resubmit a financial operation.
            await finish(job.state).catch(()=>undefined);counts.pending++;
        }
    }
    return counts;
}

/** Invoked only by a request-owned after callback or the recovery cron. */
export async function dispatchSettlementReceipts() {
    await processSettlementReceiptJobs(5);
    await processEmailOutbox(5);
}
