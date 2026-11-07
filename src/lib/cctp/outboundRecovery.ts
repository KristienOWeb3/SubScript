import { ethers } from "ethers";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { getDevWalletsClient } from "@/lib/circle/devWallets";
import { readProvider } from "@/lib/vault/onchain";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID, ARC_TOKEN_MESSENGER_ADDRESS, USDC_NATIVE_GAS_ADDRESS, isProd } from "@/lib/contracts/constants";

const burnEvents = new ethers.Interface([
    "event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)",
]);
type Burn = { id: string; user_wallet: string; net_amount_micros: string; destination_domain: number;
    burn_provider_id: string | null; burn_ref_id: string; burn_started_at: string;
    burn_mint_recipient: string; burn_lookup_cursor: string | null };

async function boundedRead<T>(read: Promise<T>, milliseconds = 5000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([read,new Promise<never>((_resolve,reject)=>{
            timer=setTimeout(()=>reject(new Error("CCTP_BURN_RECOVERY_TIMEOUT")),milliseconds);
        })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function provesOutboundBurn(job: Pick<Burn,"user_wallet"|"net_amount_micros"|"destination_domain"|"burn_mint_recipient">,
    receipt: {status: number | null; logs: ReadonlyArray<{address: string; topics: readonly string[]; data: string}>}) {
    if (receipt.status !== 1) return false;
    return receipt.logs.some(log => {
        if (log.address.toLowerCase() !== ARC_TOKEN_MESSENGER_ADDRESS.toLowerCase()) return false;
        try {
            const event = burnEvents.parseLog({topics: [...log.topics], data: log.data});
            return event?.name === "DepositForBurn"
                && String(event.args.burnToken).toLowerCase() === USDC_NATIVE_GAS_ADDRESS.toLowerCase()
                && String(event.args.depositor).toLowerCase() === job.user_wallet.toLowerCase()
                && BigInt(event.args.amount) === BigInt(job.net_amount_micros)
                && Number(event.args.destinationDomain) === Number(job.destination_domain)
                && String(event.args.mintRecipient).toLowerCase() === job.burn_mint_recipient.toLowerCase();
        } catch { return false; }
    });
}

export async function recordOutboundBurnProvider(id: string, providerId: string) {
    const row = await pgMaybeOne(`update cctp_bridge_transfers set burn_provider_id=$2,updated_at=now()
        where id=$1 and burn_ref_id is not null and (burn_provider_id is null or burn_provider_id=$2) returning id`, [id,providerId]);
    if (!row) throw new Error("CCTP_BURN_PROVIDER_CONFLICT");
}

/** Read-only provider/chain recovery: never creates, approves, burns or resubmits money. */
export async function recoverOutboundCctpBurns(limit = 5) {
    const rows = await pgQuery<Burn>(`select id,user_wallet,net_amount_micros::text,destination_domain,
        burn_provider_id,burn_ref_id,burn_started_at,burn_mint_recipient,burn_lookup_cursor
        from cctp_bridge_transfers where direction='outbound_withdrawal' and burn_started_at is not null
          and status in ('pending_burn','pending_fee') order by updated_at asc limit $1`, [Math.min(limit,10)]);
    let recovered = 0;
    for (const row of rows) {
        try {
            const owner = await pgMaybeOne<{circle_wallet_id:string}>(
                "select circle_wallet_id from user_embedded_wallets where lower(wallet_address)=$1", [row.user_wallet.toLowerCase()]);
            if (!owner?.circle_wallet_id) throw new Error("CCTP_BURN_OWNER_UNVERIFIED");
            const client = getDevWalletsClient();
            let providerId = row.burn_provider_id;
            if (!providerId) {
                // Advance a durable cursor so a busy wallet cannot starve recovery. Once fully
                // scanned, restart on the next tick to include delayed provider indexing.
                const page = await boundedRead(client.listTransactions({walletIds:[owner.circle_wallet_id],
                    from:new Date(new Date(row.burn_started_at).getTime()-60_000).toISOString(),
                    pageSize:50, ...(row.burn_lookup_cursor ? {pageAfter:row.burn_lookup_cursor} : {})}));
                const transactions = page.data?.transactions ?? [];
                const matching = transactions.filter(tx => tx.walletId === owner.circle_wallet_id && tx.refId === row.burn_ref_id);
                if (matching.length > 1) throw new Error("CCTP_BURN_REFERENCE_AMBIGUOUS");
                providerId = matching[0]?.id ?? null;
                if (!providerId) {
                    await pgQuery("update cctp_bridge_transfers set burn_lookup_cursor=$2,updated_at=now() where id=$1", [row.id,transactions.length===50 ? transactions[transactions.length-1].id : null]);
                    continue;
                }
                await recordOutboundBurnProvider(row.id,providerId);
            }
            const transaction = (await client.getTransaction({id:providerId,signal:AbortSignal.timeout(5000)})).data?.transaction;
            if (!transaction || transaction.walletId !== owner.circle_wallet_id || transaction.refId !== row.burn_ref_id) throw new Error("CCTP_BURN_OWNER_UNVERIFIED");
            if (!transaction.txHash) {
                if (["FAILED","CANCELLED","DENIED"].includes(String(transaction.state))) {
                    await pgQuery(`update cctp_bridge_transfers set status='failed',
                        error_message='Burn rejected before broadcast; reconcile any collected bridge fee.',updated_at=now()
                        where id=$1 and status in ('pending_burn','pending_fee')`,[row.id]);
                }
                continue;
            }
            const provider = readProvider();
            if (Number((await boundedRead(provider.getNetwork())).chainId) !== (isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID)) throw new Error("CCTP_BURN_NETWORK_MISMATCH");
            const receipt = await boundedRead(provider.getTransactionReceipt(transaction.txHash));
            if (receipt?.status === 0) {
                await pgQuery(`update cctp_bridge_transfers set status='failed',
                    error_message='Burn reverted on Arc; reconcile any collected bridge fee.',updated_at=now()
                    where id=$1 and status in ('pending_burn','pending_fee')`,[row.id]);
                continue;
            }
            if (!receipt || !provesOutboundBurn(row,receipt)) continue;
            await pgQuery(`update cctp_bridge_transfers set burn_tx_hash=$2,status='pending_attestation',
                error_message=null,updated_at=now() where id=$1 and status in ('pending_burn','pending_fee')
                and (burn_tx_hash is null or burn_tx_hash=$2)`, [row.id,transaction.txHash.toLowerCase()]);
            recovered++;
        } catch (error) {
            await pgQuery("update cctp_bridge_transfers set error_message=$2,updated_at=now() where id=$1", [row.id,error instanceof Error ? error.message : "CCTP_BURN_RECOVERY_PENDING"]).catch(()=>undefined);
        }
    }
    return {recovered};
}
