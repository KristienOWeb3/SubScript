import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { enqueueEmail, emailIdentity, processEmailOutbox, retryDecision, recordDeliveryEvent } from "../outbox.ts";
import { sendTransactionalEmail, safelySendEmail } from "../core.ts";
import { sendAuthenticationCodeEmail } from "../transactional.ts";
import { verifyEmailWebhook } from "../webhook.ts";

const message = { to: "account@example.com", category: "transactional", subject: "Receipt", text: "Confirmed", html: "<p>Confirmed</p>", idempotencyKey: "settlement:1" };

async function withHarness(run) {
    const prior = globalThis.__subscriptPgPool;
    const priorFetch = globalThis.fetch;
    const priorKey = process.env.RESEND_API_KEY;
    const priorSender = process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = "test-no-network";
    process.env.EMAIL_FROM = "SubScript <receipts@example.com>";
    const jobs = new Map();
    const events = new Set();
    const suppressions = new Set();
    const calls = [];
    const state = { jobs, events, suppressions, calls, sends: 0, failPersist: false, failFinish: false, failProvider: false };
    globalThis.fetch = async (_url, options) => {
        state.sends++;
        state.payload = JSON.parse(options.body);
        state.providerKey = options.headers["Idempotency-Key"];
        if (state.timeoutProvider) throw new DOMException("Provider timeout for account@example.com", "TimeoutError");
        if (state.failProvider) return new Response(JSON.stringify({ message: "account@example.com secret provider body" }), { status: 429, headers: { "retry-after": "123" } });
        return new Response(JSON.stringify({ id: "provider-1" }), { status: 200 });
    };
    const query = async (sql, params = []) => {
        calls.push(sql);
        if (sql.startsWith("insert into email_outbox")) {
            if (state.failPersist) throw new Error("account@example.com persistence failure");
            if (!jobs.has(params[0])) jobs.set(params[0], { id: crypto.randomUUID(), identity: params[0], recipient: params[2],
                message: JSON.parse(params[3]), attempts: 0, status: "pending", first_attempt_at: null, ambiguous_since: null, lease_token: null });
            return { rows: [{ id: jobs.get(params[0]).id }] };
        }
        if (sql.startsWith("with candidate")) {
            assert.match(sql, /for update skip locked/);
            const job = [...jobs.values()].find(j => j.status === "pending" || (j.status === "sending" && j.expired));
            if (!job) return { rows: [] };
            Object.assign(job, { status: "sending", lease_token: params[0], attempts: job.attempts + 1, expired: false });
            return { rows: [{ ...job }] };
        }
        if (sql.includes("as suppressed")) return { rows: [{ suppressed: state.optout || suppressions.has(params[0]) }] };
        if (sql.startsWith("insert into email_provider_gate")) return { rows: state.throttle ? [] : [{ provider: "resend" }] };
        if (sql.startsWith("insert into email_recipient_rate")) return { rows: [{ key: params[0] }] };
        if (sql.includes("first_attempt_at = coalesce")) {
            const job = [...jobs.values()].find(j => j.id === params[0] && j.lease_token === params[1]);
            if (!job) return { rows: [] };
            job.first_attempt_at ||= new Date().toISOString(); job.ambiguous_since ||= new Date().toISOString(); job.message.from = params[2];
            return { rows: [{ id: job.id }] };
        }
        if (sql.startsWith("update email_outbox")) {
            const job = [...jobs.values()].find(j => j.id === params[0]);
            if (sql.includes("status = case")) {
                const next = params[2];
                job.status = job.status === "suppressed" || next === "suppressed" ? "suppressed" :
                    job.status === "delivered" || next === "delivered" ? "delivered" : next;
                job.provider_id = params[1]; job.lease_token = null;
            } else if (job?.lease_token === params[1] && job.status === "sending") {
                if (state.failFinish && params[2] === "accepted") { state.failFinish = false; throw new Error("DB lost after acceptance"); }
                job.status = sql.includes("status = 'pending'") ? "pending" : params[2];
                job.provider_id ||= sql.includes("status = 'pending'") ? null : params[3];
                job.error = sql.includes("status = 'pending'") ? params[3] : params[4];
                if (sql.includes("status = 'pending'") && params[4]) job.ambiguous_since = null;
                job.lease_token = null;
            }
            return { rows: [] };
        }
        if (sql.startsWith("insert into email_delivery_events")) {
            if (events.has(params[0])) return { rows: [] };
            events.add(params[0]); return { rows: [{ event_id: params[0] }] };
        }
        if (sql.startsWith("select id, recipient, status")) return { rows: [...jobs.values()].filter(j => j.provider_id === params[0] || j.id === params[1]) };
        if (sql.startsWith("insert into email_suppressions")) { suppressions.add(params[0]); return { rows: [] }; }
        if (["begin", "commit", "rollback"].includes(sql)) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
    };
    globalThis.__subscriptPgPool = { connect: async () => ({ query, release() {} }) };
    try { await run(state); }
    finally { globalThis.__subscriptPgPool = prior; globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = priorKey;
        if (priorSender === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = priorSender; }
}

test("durable category/event/recipient dedupe survives provider key lifetime and immutable payload", async () => withHarness(async s => {
    const id = await sendTransactionalEmail(message);
    assert.equal(s.sends, 0);
    assert.equal(await enqueueEmail({ ...message, subject: "different rendering" }), id);
    assert.equal(s.jobs.size, 1);
    assert.equal([...s.jobs.values()][0].message.subject, "Receipt");
    assert.equal(emailIdentity({ ...message, to: "ACCOUNT@example.com" }), emailIdentity(message));
    assert.notEqual(emailIdentity({ ...message, category: "security" }), emailIdentity(message));
}));

test("settled receipt queue failure propagates; generic outcome logs contain no provider PII", async t => withHarness(async s => {
    s.failPersist = true;
    await assert.rejects(sendTransactionalEmail(message));
    const logs = []; t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));
    assert.equal((await safelySendEmail("receipt", () => sendTransactionalEmail(message))).ok, false);
    assert.doesNotMatch(logs.join(" "), /account@example.com|persistence failure/);
}));

test("worker acceptance records provider ID without claiming delivery", async () => withHarness(async s => {
    await enqueueEmail(message); await processEmailOutbox(1);
    assert.equal(s.sends, 1);
    const job = [...s.jobs.values()][0];
    assert.equal(job.status, "accepted"); assert.equal(job.provider_id, "provider-1");
    assert.match(s.providerKey, /^outbox:[a-f0-9]{64}$/);
    assert.deepEqual(s.payload.tags, [{ name: "outbox_id", value: job.id }]);
}));

test("concurrent workers claim one job and a crashed lease is recoverable with identical provider key", async () => withHarness(async s => {
    await enqueueEmail(message);
    const job = [...s.jobs.values()][0]; job.status = "sending"; job.expired = true; job.lease_token = "old-token";
    await Promise.all([processEmailOutbox(1), processEmailOutbox(1)]);
    assert.equal(s.sends, 1); assert.equal(job.status, "accepted");
    assert.ok(s.calls.some(sql => sql.includes("lease_token = $2 and status = 'sending'")));
}));

test("provider throttling retries, and a crash after acceptance retries using unchanged identity", async () => withHarness(async s => {
    await enqueueEmail(message); s.failProvider = true;
    assert.equal((await processEmailOutbox(1)).retried, 1);
    const job = [...s.jobs.values()][0]; assert.equal(job.status, "pending"); assert.equal(job.error, "PROVIDER_HTTP_429");
    assert.equal(job.ambiguous_since, null, "a known throttle rejection must not strand receipts after 24 hours");
    const key = s.providerKey; s.failProvider = false; s.failFinish = true;
    await processEmailOutbox(1); assert.equal(job.status, "pending");
    await processEmailOutbox(1); assert.equal(job.status, "accepted"); assert.equal(s.providerKey, key);
    assert.equal(retryDecision({ code: "PROVIDER_HTTP_429", retryAfterSeconds: 123 }, 1).delaySeconds, 123);
}));

test("ambiguous sends beyond provider's 24-hour guarantee go to review without duplicate mail", async () => withHarness(async s => {
    await enqueueEmail(message); const job = [...s.jobs.values()][0];
    job.first_attempt_at = job.ambiguous_since = new Date(Date.now() - 24 * 3600_000).toISOString();
    assert.equal((await processEmailOutbox(1)).review, 1); assert.equal(s.sends, 0); assert.equal(job.status, "review");
}));

test("provider timeout remains retryable with stable identity and sanitized uncertainty", async () => withHarness(async s => {
    await enqueueEmail(message); s.timeoutProvider = true;
    assert.equal((await processEmailOutbox(1)).retried, 1);
    const job = [...s.jobs.values()][0];
    assert.equal(job.status, "pending"); assert.equal(job.error, "PROVIDER_UNAVAILABLE");
    assert.ok(job.ambiguous_since); const key = s.providerKey;
    s.timeoutProvider = false; await processEmailOutbox(1);
    assert.equal(job.status, "accepted"); assert.equal(s.providerKey, key);
}));

test("opt-out or complaint suppression prevents queued receipts from sending", async () => withHarness(async s => {
    await enqueueEmail(message); s.optout = true; await processEmailOutbox(1);
    assert.equal(s.sends, 0); assert.equal([...s.jobs.values()][0].status, "suppressed");
}));

test("security OTP is immediate, provider failures explicit, code/email absent from provider key", async () => withHarness(async s => {
    s.failProvider = true; await assert.rejects(sendAuthenticationCodeEmail(message.to, "849201"));
    assert.equal(s.jobs.size, 0); assert.equal(s.sends, 1); assert.doesNotMatch(s.providerKey, /849201|account@example.com/);
}));

test("verified delivery events are replay-idempotent, adverse suppression survives delayed callbacks", async () => withHarness(async s => {
    await enqueueEmail(message); await processEmailOutbox(1); const job = [...s.jobs.values()][0];
    const event = type => ({ type, created_at: new Date().toISOString(), data: { email_id: "provider-1", tags: { outbox_id: job.id } } });
    await recordDeliveryEvent("delivered-1", event("email.delivered"));
    await recordDeliveryEvent("delivered-1", event("email.delivered"));
    await recordDeliveryEvent("sent-late", event("email.sent")); assert.equal(job.status, "delivered");
    await recordDeliveryEvent("complaint-1", event("email.complained"));
    await recordDeliveryEvent("delivered-late", event("email.delivered"));
    assert.equal(job.status, "suppressed"); assert.equal(s.suppressions.has(message.to), true); assert.equal(s.events.size, 4);
}));

test("SDK validates raw Svix signatures and rejects tampering, missing headers and old timestamps", () => {
    const secretBytes = crypto.randomBytes(32); const secret = `whsec_${secretBytes.toString("base64")}`;
    const payload = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "email-1" } });
    const timestamp = String(Math.floor(Date.now() / 1000)); const id = "msg-test";
    const signature = crypto.createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${payload}`).digest("base64");
    const headers = new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` });
    assert.equal(verifyEmailWebhook(payload, headers, secret).data.email_id, "email-1");
    assert.throws(() => verifyEmailWebhook(`${payload} `, headers, secret));
    assert.throws(() => verifyEmailWebhook(payload, new Headers(), secret));
    headers.set("svix-timestamp", String(Number(timestamp) - 301)); assert.throws(() => verifyEmailWebhook(payload, headers, secret));
});
