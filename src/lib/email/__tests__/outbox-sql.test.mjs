import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { enqueueEmail, processEmailOutbox, recordDeliveryEvent, reserveEmailProviderSlot, reserveEmailRecipientSlot } from "../outbox.ts";

test("actual PostgreSQL outbox migration, deny-all RLS, leases/fences, gates, retry and delivery replay", async () => {
    const db = new PGlite();
    const previous = globalThis.__subscriptPgPool;
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.RESEND_API_KEY;
    const previousSender = process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = "local-test-no-network";
    process.env.EMAIL_FROM = "SubScript <receipts@example.com>";
    globalThis.__subscriptPgPool = { connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
    let sends = 0;
    globalThis.fetch = async () => { sends++; return new Response(JSON.stringify({ id: "provider-test-1" }), { status: 200 }); };
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
          create table customers(wallet_address text, email text, email_enabled boolean);
          create table merchants(wallet_address text, email_enabled boolean);
          create table user_embedded_wallets(wallet_address text, email text);
          create table auth_identities(wallet_address text, current_email text, disabled_at timestamptz);
          create table cctp_bridge_transfers(id uuid primary key);
          insert into customers values ('0xknown', 'person@example.com', true);`);
        await db.exec(readFileSync(new URL("../../../../supabase/migrations/20261009155608_email_delivery_outbox.sql", import.meta.url), "utf8"));
        const tables = ["email_outbox", "email_suppressions", "email_delivery_events", "email_provider_gate",
            "email_recipient_rate", "email_deposit_scan_state", "email_recovery_activation", "email_bridge_notifications"];
        for (const table of tables) {
            const security = (await db.query(`select c.relrowsecurity as rls,
              has_table_privilege('anon', $1, 'SELECT') as anon_select,
              has_table_privilege('authenticated', $1, 'INSERT') as auth_insert
              from pg_class c where c.relname = $1`, [table])).rows[0];
            assert.deepEqual(security, { rls: true, anon_select: false, auth_insert: false });
        }
        assert.equal((await db.query("select * from email_deposit_scan_state")).rows.length, 1);
        const message = { category: "transactional", to: "person@example.com", subject: "Receipt", text: "Settled", html: "<p>Settled</p>", idempotencyKey: "payment:one" };
        const id = await enqueueEmail(message);
        assert.equal(await enqueueEmail({ ...message, subject: "Re-render" }), id);
        assert.equal((await db.query("select message->>'subject' as subject from email_outbox")).rows[0].subject, "Receipt");
        await assert.rejects(db.query("update email_outbox set status = 'sending' where id = $1", [id]), /check constraint/);
        const lease = crypto.randomUUID();
        await db.query("update email_outbox set status = 'sending', lease_token = $2, lease_until = now() - interval '1 second' where id = $1", [id, lease]);
        const stale = await db.query(`update email_outbox set status = 'accepted', lease_token = null, lease_until = null
           where id = $1 and lease_token = $2 returning id`, [id, crypto.randomUUID()]);
        assert.equal(stale.rows.length, 0);
        assert.equal((await processEmailOutbox(1)).accepted, 1);
        let row = (await db.query("select * from email_outbox where id = $1", [id])).rows[0];
        assert.equal(sends, 1); assert.equal(row.status, "accepted"); assert.equal(row.provider_id, "provider-test-1");
        assert.equal(row.attempts, 1); assert.equal(row.lease_token, null);
        await processEmailOutbox(1); assert.equal(sends, 1);
        const event = type => ({ type, created_at: new Date().toISOString(), data: { email_id: "provider-test-1", tags: { outbox_id: id } } });
        await recordDeliveryEvent("delivery-1", event("email.delivered"));
        await recordDeliveryEvent("delivery-1", event("email.delivered"));
        await recordDeliveryEvent("sent-late", event("email.sent"));
        assert.equal((await db.query("select status from email_outbox where id = $1", [id])).rows[0].status, "delivered");
        assert.equal((await db.query("select count(*)::int as n from email_delivery_events")).rows[0].n, 2);
        await recordDeliveryEvent("complaint-1", event("email.complained"));
        await recordDeliveryEvent("delivery-late", event("email.delivered"));
        row = (await db.query("select * from email_outbox where id = $1", [id])).rows[0];
        assert.equal(row.status, "suppressed");
        assert.equal((await db.query("select recipient from email_suppressions")).rows[0].recipient, message.to);
        const early = await enqueueEmail({ ...message, to: "early@example.com", idempotencyKey: "early-webhook" });
        const earlyLease = crypto.randomUUID();
        await db.query(`update email_outbox set status = 'sending', lease_token = $2,
          lease_until = now() + interval '90 seconds', first_attempt_at = now() where id = $1`, [early, earlyLease]);
        for (const type of ["email.opened", "email.clicked", "email.unknown"]) {
            await recordDeliveryEvent(`engagement-${type}`, { type, created_at: new Date().toISOString(),
                data: { email_id: "early-provider", tags: { outbox_id: early } } });
        }
        assert.deepEqual((await db.query("select status,lease_token,provider_id from email_outbox where id = $1", [early])).rows[0],
            { status: "sending", lease_token: earlyLease, provider_id: null }, "engagement does not revoke an active worker's lease");
        await recordDeliveryEvent("early-delivery", { type: "email.delivered", created_at: new Date().toISOString(),
            data: { email_id: "early-provider", tags: { outbox_id: early } } });
        const earlyRow = (await db.query("select provider_id,status,lease_token from email_outbox where id = $1", [early])).rows[0];
        assert.deepEqual(earlyRow, { provider_id: "early-provider", status: "delivered", lease_token: null });
        assert.equal((await db.query(`update email_outbox set status = 'accepted' where id = $1 and lease_token = $2 returning id`,
            [early, earlyLease])).rows.length, 0, "stale worker cannot downgrade early delivery callback");
        await db.exec("delete from email_provider_gate");
        await reserveEmailProviderSlot(); await assert.rejects(reserveEmailProviderSlot(), /THROTTLED/);
        await db.exec("delete from email_recipient_rate");
        await reserveEmailRecipientSlot(message, 1); await assert.rejects(reserveEmailRecipientSlot(message, 1), /THROTTLED/);
        await db.exec("update email_recipient_rate set window_start = now() - interval '2 hours'");
        await reserveEmailRecipientSlot(message, 1);
        const old = await enqueueEmail({ ...message, to: "new@example.com", idempotencyKey: "ambiguous-old" });
        await db.query("update email_outbox set first_attempt_at = now() - interval '24 hours', ambiguous_since = now() - interval '24 hours' where id = $1", [old]);
        assert.equal((await processEmailOutbox(1)).review, 1); assert.equal(sends, 1);
        await recordDeliveryEvent("review-opened", { type: "email.opened", created_at: new Date().toISOString(),
            data: { email_id: "review-provider", tags: { outbox_id: old } } });
        assert.equal((await db.query("select status from email_outbox where id = $1", [old])).rows[0].status, "review");
        const queued = await enqueueEmail({ ...message, to: "queued@example.com", idempotencyKey: "queued-engagement" });
        await recordDeliveryEvent("queued-clicked", { type: "email.clicked", created_at: new Date().toISOString(),
            data: { email_id: "queued-provider", tags: { outbox_id: queued } } });
        assert.equal((await db.query("select status from email_outbox where id = $1", [queued])).rows[0].status, "pending");
        const { enqueueDirectDepositEmails, enqueuePinSecurityEvents } = await import("../recovery.ts");
        const activation = (await db.query("select activated_at from email_deposit_scan_state where wallet_address = '0xknown'")).rows[0].activated_at;
        const activationMs = new Date(activation).getTime();
        const deposit = { incoming: true, toAddress: "0xknown", txHash: `0x${"a".repeat(64)}`,
            timestamp: activationMs + 1000, amountFormatted: "1.00", chainId: 5042 };
        assert.equal(await enqueueDirectDepositEmails("0xknown", [
            { ...deposit, timestamp: activationMs - 1000 }, { ...deposit, incoming: false },
            { ...deposit, toAddress: "0xunrelated" }, { ...deposit, txHash: "bad" },
        ]), 0, "historical and unrelated deposits cannot become receipt emails");
        assert.equal(await enqueueDirectDepositEmails("0xknown", [deposit]), 1);
        assert.equal(await enqueueDirectDepositEmails("0xknown", [deposit]), 1);
        assert.equal((await db.query("select count(*)::int as n from email_outbox where message->>'subject' = 'Deposit confirmed: 1 USDC on Arc Network (5042)'")).rows[0].n, 1,
            "repeat scan persists one intent without any in-app notification marker");
        await db.exec(`create table transaction_pin_security_events(id uuid primary key, wallet_address text,
          event_kind text, cooling_off_until timestamptz, created_at timestamptz default now(),
          enqueued_at timestamptz, attempts integer default 0, next_attempt_at timestamptz default now());
          insert into transaction_pin_security_events(id,wallet_address,event_kind,cooling_off_until)
          values (gen_random_uuid(),'0xknown','reset', now() + interval '24 hours');
          update customers set email_enabled = false;`);
        assert.equal(await enqueuePinSecurityEvents(), 1);
        assert.equal(await enqueuePinSecurityEvents(), 0);
        const securityMail = (await db.query("select message from email_outbox where category = 'security'")).rows[0].message;
        assert.match(securityMail.text, /paused until/);
        assert.equal((await db.query("select enqueued_at is not null as enqueued from transaction_pin_security_events")).rows[0].enqueued, true);
        const { sendAuthenticationCodeEmail } = await import('../transactional.ts');
        const otpRecipient = 'otp-bounced@example.com';
        const beforeOtp = sends;
        await recordDeliveryEvent('otp-bounce', { type:'email.bounced', created_at:new Date().toISOString(),
            data:{email_id:'immediate-otp-provider',to:[otpRecipient.toUpperCase()],bounce:{type:'Permanent'}} });
        assert.equal((await db.query('select reason from email_suppressions where recipient=$1',[otpRecipient])).rows[0].reason,'email.bounced');
        await assert.rejects(sendAuthenticationCodeEmail(otpRecipient,'583027'), /EMAIL_RECIPIENT_SUPPRESSED/);
        assert.equal(sends,beforeOtp,'a suppressed immediate code never reaches Resend');
        await recordDeliveryEvent('otp-complaint', {type:'email.complained',created_at:new Date().toISOString(),
            data:{email_id:'immediate-other-provider',to:['complaint@example.com']}});
        assert.equal((await db.query('select reason from email_suppressions where recipient=$1',['complaint@example.com'])).rows[0].reason,'email.complained');
    } finally {
        globalThis.__subscriptPgPool = previous; globalThis.fetch = previousFetch;
        if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
        if (previousSender === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = previousSender;
        await db.close();
    }
});
