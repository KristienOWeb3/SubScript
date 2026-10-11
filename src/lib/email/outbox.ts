import crypto from "node:crypto";
import { pgMaybeOne, pgQuery, withPgClient } from "@/lib/serverPg";
import { configuredSender, sendImmediateEmail, RECIPIENT_HOURLY_LIMIT, type EmailMessage } from "./core";

export type OutboxRow = {
    id: string; message: EmailMessage & { from?: string }; attempts: number;
    lease_token: string; first_attempt_at: string | null; ambiguous_since: string | null;
};

export const emailIdentity = (message: EmailMessage) => crypto.createHash("sha256")
    .update(JSON.stringify([message.category, message.idempotencyKey, message.to.trim().toLowerCase()])).digest("hex");

/** Persist the immutable payload first. Retries never rewrite an already accepted event. */
export async function enqueueEmail(message: EmailMessage): Promise<string> {
    const identity = emailIdentity(message);
    const row = await pgMaybeOne<{ id: string }>(
        `insert into email_outbox (identity, category, recipient, message)
         values ($1, $2, $3, $4::jsonb) on conflict (identity) do update set identity = excluded.identity returning id`,
        [identity, message.category, message.to.trim().toLowerCase(), JSON.stringify({ ...message,
            to: message.to.trim().toLowerCase(), idempotencyKey: `outbox:${identity}` })],
    );
    if (!row) throw new Error("EMAIL_OUTBOX_PERSIST_FAILED");
    return row.id;
}

export function retryDecision(error: unknown, attempts: number) {
    const rawCode = error && typeof error === "object" && "code" in error && typeof (error as any).code === "string" ? String((error as any).code) : "PROVIDER_UNAVAILABLE";
    const code = /^[A-Z_][A-Z_0-9]{0,59}$/.test(rawCode) ? rawCode : "PROVIDER_UNAVAILABLE";
    const retryAfter = error && typeof error === "object" && "retryAfterSeconds" in error ? Number((error as any).retryAfterSeconds) : 0;
    return { code, delaySeconds: Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, Math.min(3600, 30 * 2 ** Math.min(attempts, 7))) };
}

/** PostgreSQL serializes this gate across all serverless instances, including immediate OTP sends. */
export async function reserveEmailProviderSlot() {
    const row = await pgMaybeOne<{ provider: string }>(
        `insert into email_provider_gate (provider, next_allowed_at) values ('resend', now() + interval '600 milliseconds')
         on conflict (provider) do update set next_allowed_at = now() + interval '600 milliseconds'
         where email_provider_gate.next_allowed_at <= now() returning provider`,
    );
    if (!row) throw Object.assign(new Error("EMAIL_PROVIDER_THROTTLED"), { code: "EMAIL_PROVIDER_THROTTLED", retryAfterSeconds: 1 });
}

export async function reserveEmailRecipientSlot(message: EmailMessage, limit: number) {
    const key = crypto.createHash("sha256").update(`${message.category}:${message.to.toLowerCase()}`).digest("hex");
    const row = await pgMaybeOne<{ key: string }>(`insert into email_recipient_rate (key, window_start, sends)
      values ($1, now(), 1) on conflict (key) do update
      set window_start = case when email_recipient_rate.window_start <= now() - interval '1 hour' then now() else email_recipient_rate.window_start end,
          sends = case when email_recipient_rate.window_start <= now() - interval '1 hour' then 1 else email_recipient_rate.sends + 1 end
      where email_recipient_rate.window_start <= now() - interval '1 hour' or email_recipient_rate.sends < $2 returning key`, [key, limit]);
    if (!row) throw Object.assign(new Error("EMAIL_RECIPIENT_THROTTLED"), { code: "EMAIL_RECIPIENT_THROTTLED", retryAfterSeconds: 3600 });
}

export async function processEmailOutbox(limit = 20) {
    const counts = { accepted: 0, retried: 0, suppressed: 0, review: 0 };
    const deadline = Date.now() + 20_000;
    for (let index = 0; index < Math.max(0, Math.min(limit, 40)); index++) {
        if (Date.now() >= deadline) break;
        const token = crypto.randomUUID();
        const job = await pgMaybeOne<OutboxRow>(
            `with candidate as (select id from email_outbox
              where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and lease_until < now())
              order by next_attempt_at, created_at for update skip locked limit 1)
             update email_outbox o set status = 'sending', lease_token = $1, lease_until = now() + interval '90 seconds',
               attempts = attempts + 1, updated_at = now() from candidate c where o.id = c.id returning o.*`, [token],
        );
        if (!job) break;
        try {
            // Resend retains idempotency only 24h. Never blindly resend ambiguous requests beyond that window.
            if (job.ambiguous_since && Date.now() - new Date(job.ambiguous_since).getTime() >= 23 * 3600_000) {
                await finish(job, "review", null, "IDEMPOTENCY_WINDOW_EXPIRED"); counts.review++; continue;
            }
            const suppression = await pgMaybeOne<{ suppressed: boolean }>(
                `select exists(select 1 from email_suppressions where recipient = $1) or
                 ($2 <> 'security' and $2 <> 'ops' and exists(
                   select 1 from customers where lower(trim(email)) = $1 and email_enabled = false
                   union all select 1 from auth_identities a join merchants m on lower(m.wallet_address) = lower(a.wallet_address)
                   where a.disabled_at is null and lower(trim(a.current_email)) = $1 and m.email_enabled = false
                   union all select 1 from user_embedded_wallets e join merchants m on lower(m.wallet_address) = lower(e.wallet_address)
                   where lower(trim(e.email)) = $1 and m.email_enabled = false
                 )) as suppressed`, [job.message.to, job.message.category],
            );
            if (suppression?.suppressed) { await finish(job, "suppressed"); counts.suppressed++; continue; }
            await reserveEmailProviderSlot();
            await reserveEmailRecipientSlot(job.message, RECIPIENT_HOURLY_LIMIT[job.message.category]);
            const from = job.message.from || configuredSender(job.message.category);
            const fenced = await pgMaybeOne<{ id: string }>(
                `update email_outbox set first_attempt_at = coalesce(first_attempt_at, now()), ambiguous_since = coalesce(ambiguous_since, now()),
                 message = jsonb_set(message, '{from}', to_jsonb($3::text))
                 where id = $1 and lease_token = $2 and status = 'sending' and lease_until > now() returning id`, [job.id, token, from],
            );
            if (!fenced) continue;
            const providerId = await sendImmediateEmail(job.message, { reservedSlot: true, reservedRecipient: true, outboxId: job.id, from });
            await finish(job, "accepted", providerId); counts.accepted++;
            if (index + 1 < limit) await new Promise(resolve => setTimeout(resolve, 650));
        } catch (error) {
            const decision = retryDecision(error, job.attempts);
            // A definitive rejection cannot have accepted this request. Preserve any *earlier*
            // ambiguous request, but allow known 429/quota failures to retry beyond a day.
            const clearAmbiguity = !job.ambiguous_since && /^PROVIDER_HTTP_(400|401|403|404|422|429)$/.test(decision.code);
            await pgQuery(`update email_outbox set status = 'pending', next_attempt_at = now() + ($3 * interval '1 second'),
              ambiguous_since = case when $5 then null else ambiguous_since end,
              last_error_code = $4, lease_until = null, lease_token = null, updated_at = now()
              where id = $1 and lease_token = $2 and status = 'sending'`, [job.id, token, decision.delaySeconds, decision.code, clearAmbiguity]);
            counts.retried++;
        }
    }
    return counts;
}

async function finish(job: OutboxRow, status: string, providerId: string | null = null, errorCode: string | null = null) {
    await pgQuery(`update email_outbox set status = $3, provider_id = coalesce(provider_id, $4), last_error_code = $5,
       lease_token = null, lease_until = null, updated_at = now() where id = $1 and lease_token = $2 and status = 'sending'`,
    [job.id, job.lease_token, status, providerId, errorCode]);
}

export type DeliveryEvent = { type: string; created_at: string; data: {
    email_id: string; to?: string[]; tags?: Record<string, string>; bounce?: { type?: string }; } };

/** Verified events only; a transaction makes replay insertion and suppression atomic. */
export async function recordDeliveryEvent(eventId: string, event: DeliveryEvent) {
    await withPgClient(async client => {
        await client.query("begin");
        try {
            const inserted = await client.query(`insert into email_delivery_events (event_id, provider_id, event_type, occurred_at)
              values ($1, $2, $3, $4) on conflict do nothing returning event_id`,
            [eventId, event.data.email_id, event.type, event.created_at]);
            if (!inserted.rows.length) { await client.query("commit"); return; }
            // Engagement or unrecognized events are audit data, never send/delivery evidence.
            if (!["email.sent", "email.delivered", "email.bounced", "email.complained", "email.failed", "email.suppressed"].includes(event.type)) {
                await client.query("commit"); return;
            }
            const rows = await client.query(`select id, recipient, status from email_outbox where provider_id = $1
              or (id::text = $2 and provider_id is null and first_attempt_at is not null) for update`,
            [event.data.email_id, event.data.tags?.outbox_id || ""]);
            const row = rows.rows[0];
            const hardBounce = event.type === "email.bounced" && event.data.bounce?.type?.toLowerCase() === "permanent";
            const suppress = hardBounce || event.type === "email.complained" || event.type === "email.suppressed";
            if (row) {
                const status = suppress ? "suppressed" : event.type === "email.delivered" ? "delivered" :
                    event.type === "email.bounced" || event.type === "email.failed" ? "failed" : "accepted";
                // Adverse terminal states prevail over delayed delivered/sent callbacks.
                await client.query(`update email_outbox set provider_id = coalesce(provider_id, $2),
                  status = case when status = 'suppressed' or $3 = 'suppressed' then 'suppressed'
                    when status = 'delivered' or $3 = 'delivered' then 'delivered'
                    when status = 'failed' and $3 = 'accepted' then status else $3 end,
                  lease_token = null, lease_until = null, updated_at = now() where id = $1`, [row.id, event.data.email_id, status]);
                if (suppress) await client.query(`insert into email_suppressions (recipient, reason) values ($1, $2)
                  on conflict (recipient) do update set reason = excluded.reason`, [row.recipient, event.type]);
            }
            // Immediate OTPs do not retain their secret payload in the outbox. The signed
            // provider event contains their recipients and durably correlates adverse events.
            if (suppress && !row && Array.isArray(event.data.to)) {
                for (const recipient of new Set(event.data.to.filter((value): value is string => typeof value === "string")
                    .map(value => value.trim().toLowerCase()).filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))) {
                    await client.query(`insert into email_suppressions (recipient, reason) values ($1, $2)
                      on conflict (recipient) do update set reason = excluded.reason`, [recipient, event.type]);
                }
            }
            await client.query("commit");
        } catch (error) { await client.query("rollback"); throw error; }
    });
}
