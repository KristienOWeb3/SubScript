/*
 * Tests for the gas sponsor wallet alerting.
 *
 * What is actually worth asserting here is the de-noising, not that an email can be constructed.
 * The failure this code exists to prevent is a channel nobody reads: mail on every check and the
 * filter goes up, mail only on the first check and an ignored outage goes quiet, never mail the
 * all-clear and people learn the channel only ever complains. So the state machine gets the bulk
 * of the coverage, plus the two content rules that a previous incident turned into hard
 * requirements: the operator's number leads, and the balance is never formatted as micro-USDC.
 *
 * Modules are transpiled and run in a vm with their imports shimmed, the same way
 * gas-sponsorship.test.mjs loads gas.ts. Date is stubbed inside the context so cooldowns can be
 * fast-forwarded without sleeping.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const gasAlertsSource = readFileSync(new URL("../gasAlerts.ts", import.meta.url), "utf8");
const opsTemplateSource = readFileSync(new URL("../../email/templates/ops.ts", import.meta.url), "utf8");

const SPONSOR_ADDRESS = "0x59e6970E1e4b0b6dCFF0Fd0F0f8e2b1a0cAfe123";
const FUNDING_KEY = "sponsor_wallet_funding";
const EMERGENCY_KEY = "sponsor_emergency_stop";

function transpile(source, fileName) {
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName,
    }).outputText;
}

function loadModule(source, fileName, requireShim, extraContext = {}) {
    const testModule = { exports: {} };
    const context = vm.createContext({
        console: { error() {}, warn() {}, log() {} },
        process,
        Buffer,
        setTimeout,
        ...extraContext,
    });
    const wrapper = vm.runInContext(
        `(function (require, module, exports) { ${transpile(source, fileName)}\n })`,
        context,
        { filename: fileName.replace(/\.ts$/, ".test.cjs") },
    );
    wrapper(requireShim, testModule, testModule.exports);
    return testModule.exports;
}

/* ------------------------------------------------------------------------------------------------
 * Content rules (lib/email/templates/ops.ts)
 * ---------------------------------------------------------------------------------------------- */

/* htmlEscape is replaced with a marker rather than a real escaper. That turns "did the template
   escape every interpolated value" into something directly assertable, instead of re-testing an
   escape function that core.ts already owns. */
const ESCAPE_OPEN = "«";
const ESCAPE_CLOSE = "»";

function loadOpsTemplate() {
    const sent = [];
    const exports = loadModule(opsTemplateSource, "ops.ts", (specifier) => {
        if (specifier === "crypto" || specifier === "node:crypto") return crypto;
        if (specifier === "../core") {
            return {
                htmlEscape: (value) => `${ESCAPE_OPEN}${String(value)}${ESCAPE_CLOSE}`,
                shortAddress: (address) =>
                    address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address,
                renderEmailLayout: (opts) =>
                    `<html><preview>${ESCAPE_OPEN}${opts.previewText}${ESCAPE_CLOSE}</preview>`
                    + `<h1>${ESCAPE_OPEN}${opts.heading}${ESCAPE_CLOSE}</h1>`
                    + `<body>${opts.bodyHtml}</body>`
                    + `<cta href="${opts.cta?.url || ""}">${opts.cta?.label || ""}</cta></html>`,
                sendTransactionalEmail: async (message) => {
                    sent.push(message);
                    return "resend-id";
                },
                safelySendEmail: async (action, send) => {
                    await send();
                    return { ok: true, rateLimited: false, retryAfterSeconds: null };
                },
            };
        }
        throw new Error(`unexpected import in ops.ts: ${specifier}`);
    });
    return { ...exports, sent };
}

const healthyFacts = {
    walletAddress: SPONSOR_ADDRESS,
    estimatedTopupsRemaining: 42,
    /* What ethers.formatUnits(balance, 18) actually returns. */
    balanceNativeUsdc: "4.200000000000000000",
    topupUsdc: "0.10",
};

test("the low alert leads with top-ups remaining, not with a raw balance", () => {
    const { buildSponsorGasAlertEmail } = loadOpsTemplate();
    const email = buildSponsorGasAlertEmail({
        adminEmail: "ops@example.com",
        condition: "funding",
        severity: "low",
        kind: "opened",
        facts: healthyFacts,
        lowThreshold: 100,
        firstAlertedAt: null,
        alertedAt: new Date("2026-08-21T10:00:00.000Z"),
    });

    /* The number an operator acts on is in the inbox list, before they open anything. */
    assert.match(email.subject, /42 top-ups/);
    assert.match(email.text, /Sponsored top-ups left: 42 top-ups/);
    /* And it is the first fact, above the wallet and far above the balance. */
    const topupsAt = email.text.indexOf("Sponsored top-ups left");
    const walletAt = email.text.indexOf("Sponsor wallet");
    const balanceAt = email.text.indexOf("Wallet balance");
    assert.ok(topupsAt >= 0 && topupsAt < walletAt && walletAt < balanceAt);
    /* Full address, because fixing this means pasting it into a wallet. */
    assert.ok(email.text.includes(SPONSOR_ADDRESS));
    /* The threshold is named so whoever gets woken up can retune it. */
    assert.match(email.text, /SPONSOR_LOW_TOPUPS_THRESHOLD/);
});

test("the balance is formatted as an 18-decimal native value, never as micro-USDC", () => {
    const { buildSponsorGasAlertEmail } = loadOpsTemplate();
    const email = buildSponsorGasAlertEmail({
        adminEmail: "ops@example.com",
        condition: "funding",
        severity: "empty",
        kind: "opened",
        facts: { ...healthyFacts, estimatedTopupsRemaining: 0, balanceNativeUsdc: "12.500000000000000000" },
        lowThreshold: 100,
        firstAlertedAt: null,
        alertedAt: new Date("2026-08-21T10:00:00.000Z"),
    });

    assert.match(email.text, /Wallet balance \(native gas USDC\): 12\.5 USDC/);
    /* formatUsdc() would have read 12500000000000000000 as micro-USDC and printed 12500000000000.
       The admin console shipped that bug once and showed a healthy balance while every sponsored
       payment failed with sponsor_underfunded. */
    assert.ok(!email.text.includes("12500000000000"));
    /* And the mail says which asset to send, because that is the thing they got wrong last time. */
    assert.match(email.text, /native USDC/);
    assert.match(email.text, /18 decimals/);
});

test("a balance below the display precision does not render as a clean zero", () => {
    const { buildSponsorGasAlertEmail } = loadOpsTemplate();
    const email = buildSponsorGasAlertEmail({
        adminEmail: "ops@example.com",
        condition: "funding",
        severity: "empty",
        kind: "opened",
        facts: { ...healthyFacts, estimatedTopupsRemaining: 0, balanceNativeUsdc: "0.000000000000000900" },
        lowThreshold: 100,
        firstAlertedAt: null,
        alertedAt: new Date("2026-08-21T10:00:00.000Z"),
    });
    assert.match(email.text, /under 0\.0001 USDC/);
});

test("every interpolated value reaches the HTML through htmlEscape", () => {
    const { buildSponsorGasAlertEmail } = loadOpsTemplate();
    /* SPONSOR_GAS_TOPUP_USDC is operator-set env, so it is the realistic injection surface. */
    const payload = `<img src=x onerror="alert(1)">`;
    const email = buildSponsorGasAlertEmail({
        adminEmail: "ops@example.com",
        condition: "funding",
        severity: "low",
        kind: "opened",
        facts: { ...healthyFacts, topupUsdc: payload },
        lowThreshold: 100,
        firstAlertedAt: null,
        alertedAt: new Date("2026-08-21T10:00:00.000Z"),
    });

    const chunks = email.html.split(payload);
    assert.ok(chunks.length > 1, "payload should appear in the HTML at all");
    for (const chunk of chunks.slice(0, -1)) {
        assert.ok(chunk.endsWith(ESCAPE_OPEN), "payload reached the HTML without htmlEscape");
    }
});

test("every variant sends both parts and avoids em dashes in the copy", () => {
    const { buildSponsorGasAlertEmail, buildSponsorGasRecoveryEmail } = loadOpsTemplate();
    const alertedAt = new Date("2026-08-21T10:00:00.000Z");
    const variants = [];
    for (const severity of ["low", "empty"]) {
        for (const kind of ["opened", "changed", "reminder"]) {
            variants.push(buildSponsorGasAlertEmail({
                adminEmail: "ops@example.com",
                condition: "funding",
                severity,
                kind,
                facts: healthyFacts,
                lowThreshold: 100,
                firstAlertedAt: new Date("2026-08-21T04:00:00.000Z"),
                alertedAt,
            }));
        }
    }
    for (const kind of ["opened", "reminder"]) {
        variants.push(buildSponsorGasAlertEmail({
            adminEmail: "ops@example.com",
            condition: "emergency_stop",
            severity: "engaged",
            kind,
            facts: healthyFacts,
            lowThreshold: 100,
            firstAlertedAt: null,
            alertedAt,
        }));
    }
    for (const condition of ["funding", "emergency_stop"]) {
        variants.push(buildSponsorGasRecoveryEmail({
            adminEmail: "ops@example.com",
            condition,
            facts: healthyFacts,
            firstAlertedAt: new Date("2026-08-21T04:00:00.000Z"),
            alertedAt,
        }));
    }

    assert.equal(variants.length, 10);
    for (const email of variants) {
        assert.ok(email.subject.length > 0 && email.subject.length < 120);
        assert.ok(email.text.length > 0);
        assert.ok(email.html.length > 0);
        assert.ok(email.idempotencyKey.length > 0);
        assert.ok(!email.subject.includes("—"), `em dash in subject: ${email.subject}`);
        assert.ok(!email.text.includes("—"), `em dash in body: ${email.subject}`);
    }

    /* The all-clear says there is nothing to do, so nobody goes looking for an action. */
    const recovery = variants[variants.length - 1];
    assert.match(recovery.text, /Nothing to do/);
    /* And it says how long it was broken, which is the whole value of closing the loop. */
    assert.match(variants[variants.length - 2].text, /It was like that for about 6 hours\./);
});

test("the idempotency key hides the recipient, survives a retry, and never suppresses the re-alert", () => {
    const { buildSponsorGasAlertEmail } = loadOpsTemplate();
    const build = (alertedAt, severity = "empty", adminEmail = "ops@example.com") =>
        buildSponsorGasAlertEmail({
            adminEmail,
            condition: "funding",
            severity,
            kind: "opened",
            facts: healthyFacts,
            lowThreshold: 100,
            firstAlertedAt: null,
            alertedAt,
        }).idempotencyKey;

    const first = build(new Date("2026-08-21T10:00:00.000Z"));
    /* Same claim, retried fan-out: identical, so Resend collapses it. */
    assert.equal(first, build(new Date("2026-08-21T10:00:30.000Z")));
    /* The cooldown re-alert six hours later must NOT be collapsed. Resend dedupes for 24 hours, so
       a key that ignored time would silence exactly the reminder this design depends on. */
    assert.notEqual(first, build(new Date("2026-08-21T16:00:00.000Z")));
    /* An escalation from low to empty is a different email, not a duplicate. */
    assert.notEqual(first, build(new Date("2026-08-21T10:00:00.000Z"), "low"));
    /* Per recipient, and never the address itself: these keys reach Resend and our logs. */
    assert.notEqual(first, build(new Date("2026-08-21T10:00:00.000Z"), "empty", "other@example.com"));
    assert.ok(!first.includes("ops@example.com"));
    assert.ok(!first.includes("example.com"));
});

/* ------------------------------------------------------------------------------------------------
 * State machine (lib/sponsor/gasAlerts.ts)
 * ---------------------------------------------------------------------------------------------- */

/*
 * Stand-in for ops_alert_state. It applies the same predicates the SQL does, so what is exercised
 * here is the orchestration: whether a send is attempted, in what order, and with what wording.
 * The SQL text itself is pinned separately at the bottom of this file, because a JS reimplementation
 * of a conditional upsert cannot prove the real statement still contains its guard.
 */
function createAlertStore(clock) {
    const rows = new Map();
    let failure = null;

    function query(sql, params) {
        if (/^\s*select state, detail/.test(sql)) {
            if (failure === "read") throw new Error("connection terminated unexpectedly");
            const row = rows.get(params[0]);
            return row ? [{ ...row }] : [];
        }
        if (/insert into ops_alert_state/.test(sql) && /returning first_alerted_at, last_alerted_at/.test(sql)) {
            if (failure === "claim") throw new Error("connection terminated unexpectedly");
            const [alertKey, state, detail, cooldownMinutes] = params;
            const now = new Date(clock.value);
            const existing = rows.get(alertKey);
            if (!existing) {
                rows.set(alertKey, { state, detail, first_alerted_at: now, last_alerted_at: now, updated_at: now });
                return [{ first_alerted_at: now, last_alerted_at: now }];
            }
            const changed = existing.state !== state;
            const cooldownElapsed = !existing.last_alerted_at
                || now.getTime() - existing.last_alerted_at.getTime() >= cooldownMinutes * 60_000;
            if (!changed && !cooldownElapsed) return [];
            if (existing.state === "ok" || !existing.first_alerted_at) existing.first_alerted_at = now;
            existing.state = state;
            existing.detail = detail;
            existing.last_alerted_at = now;
            existing.updated_at = now;
            return [{ first_alerted_at: existing.first_alerted_at, last_alerted_at: existing.last_alerted_at }];
        }
        if (/^\s*update ops_alert_state/.test(sql)) {
            if (failure === "claim") throw new Error("connection terminated unexpectedly");
            const [alertKey, detail] = params;
            const existing = rows.get(alertKey);
            if (!existing || existing.state === "ok") return [];
            const now = new Date(clock.value);
            existing.state = "ok";
            existing.detail = detail;
            existing.first_alerted_at = null;
            existing.last_alerted_at = now;
            existing.updated_at = now;
            return [{ last_alerted_at: now }];
        }
        if (/insert into ops_alert_state/.test(sql)) {
            const [alertKey, detail] = params;
            const now = new Date(clock.value);
            const existing = rows.get(alertKey);
            if (!existing) {
                rows.set(alertKey, { state: "ok", detail, first_alerted_at: null, last_alerted_at: null, updated_at: now });
            } else if (existing.state === "ok") {
                existing.detail = detail;
                existing.updated_at = now;
            }
            return [];
        }
        throw new Error(`unexpected SQL: ${sql}`);
    }

    return {
        rows,
        query,
        fail(mode) { failure = mode; },
        snapshot(alertKey) {
            const row = rows.get(alertKey);
            return row ? { ...row } : null;
        },
    };
}

function loadGasAlerts({ status, recipients = ["ops@example.com"], startAt = "2026-08-21T10:00:00.000Z" }) {
    const clock = { value: new Date(startAt).getTime() };
    const store = createAlertStore(clock);
    const sends = [];
    let statusValue = status;

    /* Fake clock inside the context so a six-hour cooldown is one line, not a six-hour test. */
    class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) super(clock.value);
            else super(...args);
        }
        static now() { return clock.value; }
    }

    const exports = loadModule(gasAlertsSource, "gasAlerts.ts", (specifier) => {
        if (specifier === "@/lib/sponsor/gas") {
            return { getSponsorWalletStatus: async () => statusValue };
        }
        if (specifier === "@/lib/serverPg") {
            return {
                pgQuery: async (sql, params) => store.query(sql, params),
                pgMaybeOne: async (sql, params) => store.query(sql, params)[0] || null,
            };
        }
        if (specifier === "@/lib/email/adminRecipients") {
            return { listAdminNotificationEmails: async () => recipients };
        }
        if (specifier === "@/lib/email/templates/ops") {
            return {
                sendSponsorGasAlertEmail: async (input) => {
                    sends.push({ type: "alert", ...input });
                    return { ok: true, rateLimited: false, retryAfterSeconds: null };
                },
                sendSponsorGasRecoveryEmail: async (input) => {
                    sends.push({ type: "recovery", ...input });
                    return { ok: true, rateLimited: false, retryAfterSeconds: null };
                },
            };
        }
        throw new Error(`unexpected import in gasAlerts.ts: ${specifier}`);
    }, { Date: FakeDate });

    return {
        run: exports.runSponsorWalletHealthCheck,
        classify: exports.classifySponsorFunding,
        sends,
        store,
        advanceMinutes(minutes) { clock.value += minutes * 60_000; },
        setStatus(next) { statusValue = next; },
        setRecipients(next) { recipients = next; },
    };
}

function sponsorStatus(overrides = {}) {
    return {
        configured: true,
        address: SPONSOR_ADDRESS,
        balanceUsdc: "80.000000000000000000",
        topupUsdc: "0.10",
        estimatedTopupsRemaining: 800,
        underfunded: false,
        emergencyStop: false,
        error: null,
        ...overrides,
    };
}

const empty = () => sponsorStatus({
    balanceUsdc: "0.050000000000000000",
    estimatedTopupsRemaining: 0,
    underfunded: true,
});
const low = () => sponsorStatus({ balanceUsdc: "1.000000000000000000", estimatedTopupsRemaining: 10 });

const fundingAction = (result) => result.actions.find((action) => action.alertKey === FUNDING_KEY);
const emergencyAction = (result) => result.actions.find((action) => action.alertKey === EMERGENCY_KEY);

test("a healthy first check mails nobody", async () => {
    const harness = loadGasAlerts({ status: sponsorStatus() });
    const result = await harness.run();

    assert.equal(result.funding, "ok");
    assert.equal(harness.sends.length, 0);
    assert.equal(fundingAction(result).sent, false);
    /* The heartbeat still lands, so a health check that quietly stopped running shows up as a
       stale row rather than as an absence of alerts. */
    assert.equal(harness.store.snapshot(FUNDING_KEY).state, "ok");
});

test("an empty wallet alerts once, then stays quiet until the cooldown elapses", async () => {
    const harness = loadGasAlerts({ status: empty() });

    const first = await harness.run();
    assert.equal(first.funding, "empty");
    assert.equal(harness.sends.length, 1);
    assert.equal(harness.sends[0].kind, "opened");
    assert.equal(harness.sends[0].severity, "empty");

    /* Ninety-five more checks over the next 24 hours at a 15-minute cadence. Mailing on each one is
       exactly how an alert channel gets a filter pointed at it. */
    for (let i = 0; i < 20; i++) {
        harness.advanceMinutes(15);
        const repeat = await harness.run();
        assert.equal(fundingAction(repeat).sent, false);
        assert.equal(fundingAction(repeat).reason, "unchanged");
    }
    assert.equal(harness.sends.length, 1);

    /* Six hours in, an unfixed outage is worth saying again. */
    harness.advanceMinutes(60);
    const reminder = await harness.run();
    assert.equal(harness.sends.length, 2);
    assert.equal(harness.sends[1].kind, "reminder");
    assert.equal(fundingAction(reminder).sent, true);
});

test("low escalates to empty immediately, without waiting out the cooldown", async () => {
    const harness = loadGasAlerts({ status: low() });

    await harness.run();
    assert.equal(harness.sends.length, 1);
    assert.equal(harness.sends[0].severity, "low");
    assert.equal(harness.sends[0].kind, "opened");

    harness.advanceMinutes(15);
    harness.setStatus(empty());
    await harness.run();
    assert.equal(harness.sends.length, 2);
    assert.equal(harness.sends[1].severity, "empty");
    assert.equal(harness.sends[1].kind, "changed");
    /* The clock on the incident keeps running across the escalation. */
    assert.equal(harness.sends[1].firstAlertedAt.getTime(), harness.sends[0].firstAlertedAt.getTime());
});

test("recovery is announced exactly once", async () => {
    const harness = loadGasAlerts({ status: empty() });
    await harness.run();

    harness.advanceMinutes(45);
    harness.setStatus(sponsorStatus());
    const recovered = await harness.run();
    assert.equal(harness.sends.length, 2);
    assert.equal(harness.sends[1].type, "recovery");
    assert.equal(harness.sends[1].firstAlertedAt.getTime(), harness.sends[0].firstAlertedAt.getTime());
    assert.equal(fundingAction(recovered).kind, "recovered");

    for (let i = 0; i < 5; i++) {
        harness.advanceMinutes(15);
        await harness.run();
    }
    assert.equal(harness.sends.length, 2);
});

test("an unreadable balance draws no conclusion and disturbs no state", async () => {
    const harness = loadGasAlerts({ status: empty() });
    await harness.run();
    const firing = harness.store.snapshot(FUNDING_KEY);

    /* An Arc RPC blip. getSponsorWalletStatus reports underfunded: false on a read error, so
       treating this as healthy would fabricate an all-clear and clear a live alert. */
    harness.advanceMinutes(15);
    harness.setStatus(sponsorStatus({ balanceUsdc: null, estimatedTopupsRemaining: null, error: "network unreachable" }));
    const blind = await harness.run();

    assert.equal(blind.funding, "unknown");
    assert.equal(fundingAction(blind).reason, "unknown");
    assert.equal(harness.sends.length, 1);
    assert.deepEqual(harness.store.snapshot(FUNDING_KEY), firing);
});

test("no reachable admin means the cooldown is not burned on a send that never happened", async () => {
    const harness = loadGasAlerts({ status: empty(), recipients: [] });

    const noAudience = await harness.run();
    assert.equal(fundingAction(noAudience).reason, "no_recipients");
    assert.equal(harness.sends.length, 0);
    /* Nothing was claimed, so the alert is still pending rather than silently spent. */
    assert.equal(harness.store.snapshot(FUNDING_KEY), null);

    harness.setRecipients(["ops@example.com"]);
    harness.advanceMinutes(15);
    await harness.run();
    assert.equal(harness.sends.length, 1);
    assert.equal(harness.sends[0].kind, "opened");
});

test("an unreachable state store fails closed on the mail, not on the caller", async () => {
    const harness = loadGasAlerts({ status: empty() });
    harness.store.fail("read");

    const result = await harness.run();
    /* No memory means no cooldown, and no cooldown during a database incident means every admin
       gets mail every fifteen minutes. Staying quiet costs nothing: resolving the audience needs
       the same database. */
    assert.equal(harness.sends.length, 0);
    assert.equal(fundingAction(result).reason, "state_unavailable");
    assert.equal(emergencyAction(result).reason, "state_unavailable");
});

test("the emergency stop is its own alert, with its own cooldown", async () => {
    const harness = loadGasAlerts({ status: sponsorStatus({ emergencyStop: true }) });

    const engaged = await harness.run();
    assert.equal(harness.sends.length, 1);
    assert.equal(harness.sends[0].condition, "emergency_stop");
    assert.equal(harness.sends[0].severity, "engaged");
    /* Funding is fine, so it says nothing. Two conditions, two independent alerts. */
    assert.equal(fundingAction(engaged).sent, false);

    harness.advanceMinutes(15);
    harness.setStatus(sponsorStatus({ emergencyStop: false }));
    await harness.run();
    assert.equal(harness.sends.length, 2);
    assert.equal(harness.sends[1].type, "recovery");
    assert.equal(harness.sends[1].condition, "emergency_stop");
});

test("an empty wallet under an engaged emergency stop raises both", async () => {
    const harness = loadGasAlerts({ status: { ...empty(), emergencyStop: true } });
    const result = await harness.run();

    assert.equal(harness.sends.length, 2);
    assert.deepEqual(harness.sends.map((send) => send.condition).sort(), ["emergency_stop", "funding"]);
    assert.equal(fundingAction(result).sent, true);
    assert.equal(emergencyAction(result).sent, true);
});

test("a deployment with no sponsor key is not an incident", async () => {
    const harness = loadGasAlerts({
        status: {
            configured: false,
            address: null,
            balanceUsdc: null,
            topupUsdc: "0.10",
            estimatedTopupsRemaining: null,
            underfunded: false,
            emergencyStop: false,
            error: null,
        },
    });

    const result = await harness.run();
    assert.equal(result.configured, false);
    assert.equal(result.actions.length, 0);
    assert.equal(harness.sends.length, 0);
});

test("the low threshold is the alert boundary and is env-tunable", async () => {
    const harness = loadGasAlerts({ status: sponsorStatus() });
    const status = sponsorStatus({ estimatedTopupsRemaining: 100 });

    assert.equal(harness.classify(status, 100), "ok", "at the threshold is not yet low");
    assert.equal(harness.classify(sponsorStatus({ estimatedTopupsRemaining: 99 }), 100), "low");
    /* underfunded wins over the count, so this can never disagree with the check the live
       sponsorship path gates on. */
    assert.equal(harness.classify(sponsorStatus({ estimatedTopupsRemaining: 900, underfunded: true }), 100), "empty");

    const previous = process.env.SPONSOR_LOW_TOPUPS_THRESHOLD;
    process.env.SPONSOR_LOW_TOPUPS_THRESHOLD = "500";
    try {
        const tuned = loadGasAlerts({ status });
        const result = await tuned.run();
        assert.equal(result.lowThreshold, 500);
        assert.equal(result.funding, "low");
    } finally {
        if (previous === undefined) delete process.env.SPONSOR_LOW_TOPUPS_THRESHOLD;
        else process.env.SPONSOR_LOW_TOPUPS_THRESHOLD = previous;
    }
});

test("the health result never carries a recipient address", async () => {
    const harness = loadGasAlerts({ status: empty(), recipients: ["ops@example.com", "root@example.com"] });
    const result = await harness.run();

    assert.equal(fundingAction(result).recipients, 2);
    assert.equal(fundingAction(result).delivered, 2);
    assert.ok(!JSON.stringify(result).includes("example.com"));
});

/* ------------------------------------------------------------------------------------------------
 * The guards that live in SQL and in the route, which a mocked store cannot prove
 * ---------------------------------------------------------------------------------------------- */

test("the claim statement keeps its conditional-write guard", () => {
    /* Losing any one of these turns the cooldown off. The predicate IS the dedupe: it is what makes
       two overlapping keeper runs unable to both send. */
    assert.match(gasAlertsSource, /on conflict \(alert_key\) do update/);
    assert.match(gasAlertsSource, /where ops_alert_state\.state is distinct from excluded\.state/);
    assert.match(gasAlertsSource, /or ops_alert_state\.last_alerted_at is null/);
    assert.match(gasAlertsSource, /last_alerted_at < now\(\) - \(\$4::int \* interval '1 minute'\)/);
    assert.match(gasAlertsSource, /returning first_alerted_at, last_alerted_at/);
    /* Recovery only ever fires against a row that is currently firing. */
    assert.match(gasAlertsSource, /where alert_key = \$1 and state <> 'ok'/);
});

test("the health endpoint is behind the same bearer secret as every other keeper route", () => {
    const route = readFileSync(new URL("../../../app/api/internal/sponsor-health/route.ts", import.meta.url), "utf8");
    assert.match(route, /process\.env\.CRON_SECRET/);
    assert.match(route, /process\.env\.KEEPER_SECRET/);
    assert.match(route, /crypto\.timingSafeEqual/);
    assert.match(route, /\{ error: "Unauthorized" \}, \{ status: 401 \}/);
    /* No POST: this route has no body to accept and nothing to mutate on request. */
    assert.ok(!/export async function POST/.test(route));
});

/* Comments are stripped before the assertions below, because the fix deliberately leaves a comment
   naming ADMIN_ROOT_WALLET as the tombstone for the bug. Only executable lines are allowed to have
   lost or kept a reference. Same shape as the ticket-route check in email/__tests__/support. */
function withoutComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
}

test("the flags route resolves its admin audience through the shared helper, not ADMIN_ROOT_WALLET", () => {
    const route = readFileSync(new URL("../../../app/api/admin/flags/route.ts", import.meta.url), "utf8");
    const code = withoutComments(route);

    /* ADMIN_ROOT_WALLET is defined nowhere in this repo, so the old inline lookup contributed an
       empty set and dropped every root admin from the alert. Root is the tier that can toggle
       invite-only merchant signup, so it was also the tier most entitled to hear about it. */
    assert.ok(!code.includes("ADMIN_ROOT_WALLET"), "route still reads the nonexistent ADMIN_ROOT_WALLET");
    assert.ok(code.includes("listAdminNotificationEmails()"));
    assert.ok(!code.includes("prisma.adminWallet.findMany"), "route still resolves admins inline");
    assert.ok(!code.includes("prisma.authIdentity.findMany"), "route still resolves admin emails inline");

    /* The actor's alias still labels who flipped the switch. It used to be a by-product of the
       bulk aliases query that went away with the inline lookup. */
    assert.ok(code.includes("actorAlias"));
    assert.ok(code.includes("prisma.addressAlias.findUnique"));

    // The tombstone stays, so the next person to touch this does not reinvent the bug.
    assert.ok(route.includes("ADMIN_ROOT_WALLET"), "the comment recording the bug was deleted");
});
