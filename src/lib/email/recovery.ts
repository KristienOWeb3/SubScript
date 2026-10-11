import crypto from "node:crypto";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { resolveRecipient, renderEmailLayout, htmlEscape } from "./core";
import { enqueueEmail } from "./outbox";
import { sendDepositReceivedEmail, sendDepositInitiatedEmail, sendWithdrawalInitiatedEmail, sendWithdrawalCompletedEmail } from "./transactional";
import { CCTP_CONFIG, ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";
import type { ArcDepositItem } from "@/lib/deposits/arcDeposits";

/** Shared by the authorized account route and cron. A bell row never gates mail retry. */
export async function enqueueDirectDepositEmails(wallet: string, deposits: ArcDepositItem[]) {
    const normalized = wallet.toLowerCase();
    await pgQuery(`insert into email_deposit_scan_state (wallet_address) values ($1) on conflict do nothing`, [normalized]);
    const activation = await pgMaybeOne<{ activated_at: string }>(
        `select activated_at from email_deposit_scan_state where wallet_address = $1`, [normalized]);
    if (!activation) throw new Error("EMAIL_DEPOSIT_ACTIVATION_MISSING");
    const eligible = deposits.filter(d => d.incoming && d.toAddress.toLowerCase() === normalized
        && d.timestamp >= new Date(activation.activated_at).getTime() && /^0x[0-9a-f]{64}$/i.test(d.txHash));
    if (!eligible.length) return 0;
    const email = await resolveRecipient(normalized, "transactional", true);
    if (!email) return 0;
    for (const deposit of eligible) {
        await sendDepositReceivedEmail({ recipientEmail: email, amountUsdc: deposit.amountFormatted,
            originChainName: `Arc Network (${deposit.chainId})`, txHash: deposit.txHash });
    }
    return eligible.length;
}

export async function scanDepositEmails(limit = 2) {
    const { fetchArcUsdcDeposits } = await import("@/lib/deposits/arcDeposits");
    // Register newly enrolled wallets before scanning. Activation never moves backwards.
    await pgQuery(`insert into email_deposit_scan_state (wallet_address)
      select lower(wallet_address) from user_embedded_wallets where wallet_address is not null
      union select lower(wallet_address) from auth_identities where disabled_at is null
      union select lower(wallet_address) from customers where wallet_address is not null on conflict do nothing`);
    let enqueued = 0;
    for (let i = 0; i < Math.min(limit, 4); i++) {
        const token = crypto.randomUUID();
        const row = await pgMaybeOne<{ wallet_address: string }>(`with candidate as (
          select wallet_address from email_deposit_scan_state where (lease_until is null or lease_until < now())
            and (last_scanned_at is null or last_scanned_at < now() - interval '5 minutes')
          order by last_scanned_at nulls first, wallet_address for update skip locked limit 1)
          update email_deposit_scan_state s set lease_token = $1, lease_until = now() + interval '90 seconds'
          from candidate c where s.wallet_address = c.wallet_address returning s.wallet_address`, [token]);
        if (!row) break;
        const deposits = await fetchArcUsdcDeposits(row.wallet_address);
        // CCTP mint emails are owned by the bridge state machine, not direct-deposit scanning.
        const cctp = await pgQuery<{ hash: string }>(`select lower(mint_tx_hash) as hash from cctp_bridge_transfers
          where lower(recipient_address) = $1 and mint_tx_hash is not null`, [row.wallet_address]);
        const bridged = new Set(cctp.map(r => r.hash));
        enqueued += await enqueueDirectDepositEmails(row.wallet_address, deposits.filter(d => !bridged.has(d.txHash.toLowerCase())));
        await pgQuery(`update email_deposit_scan_state set last_scanned_at = now(), lease_token = null, lease_until = null
          where wallet_address = $1 and lease_token = $2`, [row.wallet_address, token]);
    }
    return enqueued;
}

export async function enqueuePinSecurityEvents(limit = 10) {
    const events = await pgQuery<{ id: string; wallet_address: string; event_kind: string; cooling_off_until: string | null }>(
        `select id, wallet_address, event_kind, cooling_off_until from transaction_pin_security_events
         where enqueued_at is null and next_attempt_at <= now() order by created_at limit $1`, [Math.min(limit, 30)]);
    let enqueued = 0;
    for (const event of events) {
        try {
            const email = await resolveRecipient(event.wallet_address, "security", true);
            if (!email) throw new Error("EMAIL_RECIPIENT_UNAVAILABLE");
            const action = event.event_kind === "enroll" ? "set up" : event.event_kind === "reset" ? "reset" : "changed";
            const body = `Your SubScript transaction PIN was ${action}.` + (event.cooling_off_until
                ? ` Outgoing transactions are paused until ${new Date(event.cooling_off_until).toUTCString()}.` : "")
                + " If you did not make this change, secure your account immediately.";
            await enqueueEmail({ to: email, category: "security", subject: "Your transaction PIN changed", text: body,
                html: renderEmailLayout({ previewText: "Your transaction PIN changed", heading: "Transaction PIN update",
                    bodyHtml: `<p>${htmlEscape(body)}</p>` }), idempotencyKey: `pin-security:${event.id}` });
            await pgQuery(`update transaction_pin_security_events set enqueued_at = now() where id = $1 and enqueued_at is null`, [event.id]);
            enqueued++;
        } catch {
            await pgQuery(`update transaction_pin_security_events set attempts = attempts + 1,
              next_attempt_at = now() + interval '5 minutes' where id = $1 and enqueued_at is null`, [event.id]);
        }
    }
    return enqueued;
}

/** Recover bridge notification failures without changing the money-moving state machine. */
export async function enqueueBridgeRecoveryEmails(limit = 10) {
    const transfers = await pgQuery<{
        id: string; phase: "started" | "completed"; direction: string; user_wallet: string; recipient_address: string;
        origin_chain_id: string; destination_chain_id: string; net_amount_micros: string;
        gross_amount_micros: string; burn_tx_hash: string | null; mint_tx_hash: string | null;
    }>(`select t.*, phase.name as phase from cctp_bridge_transfers t
       cross join (values ('started'), ('completed')) phase(name)
       where t.created_at >= (select activated_at from email_recovery_activation where purpose = 'bridge')
         and ((phase.name = 'started' and t.burn_tx_hash is not null)
           or (phase.name = 'completed' and t.status = 'completed' and t.mint_tx_hash is not null))
         and not exists(select 1 from email_bridge_notifications n where n.transfer_id = t.id and n.phase = phase.name)
       order by t.created_at limit $1`, [Math.min(limit, 20)]);
    const chainName = (id: string) => id === "arc" || [ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID].includes(Number(id) as typeof ARC_MAINNET_CHAIN_ID)
        ? "Arc Network" : CCTP_CONFIG[Number(id)]?.name || `Chain ${id}`;
    let enqueued = 0;
    for (const transfer of transfers) {
        const email = await resolveRecipient(transfer.user_wallet, "transactional", true);
        if (email) {
            const txHash = transfer.phase === "completed" ? transfer.mint_tx_hash : transfer.burn_tx_hash;
            const base = { recipientEmail: email, txHash, referenceId: transfer.id,
                amountUsdc: transfer.direction === "outbound_withdrawal" && transfer.phase === "started"
                    ? transfer.gross_amount_micros : transfer.net_amount_micros };
            if (transfer.direction === "inbound_deposit") {
                const params = { ...base, originChainName: chainName(transfer.origin_chain_id) };
                if (transfer.phase === "completed") await sendDepositReceivedEmail(params);
                else await sendDepositInitiatedEmail(params);
            } else {
                const params = { ...base, destinationChainName: chainName(transfer.destination_chain_id), destinationAddress: transfer.recipient_address };
                if (transfer.phase === "completed") await sendWithdrawalCompletedEmail(params);
                else await sendWithdrawalInitiatedEmail(params);
            }
            enqueued++;
        }
        await pgQuery(`insert into email_bridge_notifications (transfer_id,phase) values ($1,$2) on conflict do nothing`, [transfer.id, transfer.phase]);
    }
    return enqueued;
}
