/*
 * Alerting for the gas sponsor wallet.
 *
 * getSponsorWalletStatus() has always known when sponsorship is about to stop working. Nothing
 * consumed it except two admin dashboard routes, so when the production sponsor wallet emptied,
 * the commit flow showed a bare "(error)" and no operator was told anything. Sponsored payments
 * fail closed, which is right, and therefore completely silent. That is the gap this file closes
 * (docs/email-audit.md 3.10).
 *
 * THE HARD PART IS NOT SENDING MAIL, IT IS NOT BECOMING NOISE
 * ----------------------------------------------------------
 * A check that runs every 15 minutes and mails on every underfunded read gets a filter pointed at
 * it inside a day, and the next real outage is invisible behind that filter. So:
 *
 *   1. Mail on the TRANSITION into a bad state, not on every check.
 *   2. Re-mail on a cooldown (SPONSOR_ALERT_COOLDOWN_MINUTES, default 6 hours) while the condition
 *      persists, so a genuinely ignored outage keeps surfacing instead of going quiet.
 *   3. Mail once when it recovers. A channel that only ever says "still broken" gets muted.
 *   4. Warn BEFORE the outage. `underfunded` is already an outage by the time it flips: it means
 *      the wallet cannot cover one top-up plus the gas to send it. A separate "low" tier on
 *      estimatedTopupsRemaining gives an operator lead time, which is the whole point of a number
 *      that answers "is this enough".
 *
 * All of that needs the last alerted state to survive across serverless invocations, which is what
 * ops_alert_state is for. See supabase/migrations/20260821120000_ops_alert_state.sql for why it is
 * Postgres and not the Upstash mirror, and note the choice of raw SQL over Prisma here: the table
 * is created by that migration, and this alert has no business forcing a prisma/schema.prisma
 * change on top of it. lib/email/core.ts already reads its own state through serverPg the same way.
 *
 * Emergency stop is tracked as a second, independent alert. It is on the same status object, so it
 * is nearly free, and it is the other switch that stops every sponsored payment with nothing on
 * the outside changing. Kept separate from funding rather than folded in: an operator who
 * deliberately engaged the stop still needs to hear that the wallet is empty, and each condition
 * gets its own cooldown.
 */

import { getSponsorWalletStatus, type SponsorWalletStatus } from "@/lib/sponsor/gas";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";
import { listAdminNotificationEmails } from "@/lib/email/adminRecipients";
import {
    sendSponsorGasAlertEmail,
    sendSponsorGasRecoveryEmail,
    type SponsorGasAlertKind,
    type SponsorGasCondition,
    type SponsorGasFacts,
    type SponsorGasSeverity,
} from "@/lib/email/templates/ops";

export const SPONSOR_FUNDING_ALERT_KEY = "sponsor_wallet_funding";
export const SPONSOR_EMERGENCY_STOP_ALERT_KEY = "sponsor_emergency_stop";

/* Roughly a day of early-stage sponsored volume at the default 0.10 USDC gas target, so an alert
   at this level lands with time to act on it rather than during the outage. Raise it as volume
   grows: SPONSOR_LOW_TOPUPS_THRESHOLD overrides, and the alert email says so. */
const DEFAULT_LOW_TOPUPS_THRESHOLD = 100;

/* Long enough that a persistent outage produces 4 emails a day rather than 96, short enough that
   an alert opened overnight is still in front of somebody by morning. The ops category allows 60
   per recipient per hour, so this is nowhere near the cap. */
const DEFAULT_COOLDOWN_MINUTES = 6 * 60;

function readPositiveIntEnv(name: string, fallback: number) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const lowTopupsThreshold = () => readPositiveIntEnv("SPONSOR_LOW_TOPUPS_THRESHOLD", DEFAULT_LOW_TOPUPS_THRESHOLD);
export const alertCooldownMinutes = () => readPositiveIntEnv("SPONSOR_ALERT_COOLDOWN_MINUTES", DEFAULT_COOLDOWN_MINUTES);

/* "unknown" is not alertable. See classifySponsorFunding. */
export type SponsorFundingState = "ok" | "low" | "empty" | "unknown";

/**
 * Turn a status read into an alert state.
 *
 * `underfunded` is used verbatim for "empty" rather than recomputed, so this can never disagree
 * with the check the live sponsorship path actually gates on.
 *
 * A failed balance read is "unknown", deliberately NOT an alert. Arc RPC blips are routine, which
 * is the entire reason executeWithRpcFallback exists, and a flapping "cannot read the balance"
 * alert would train people to mute the one channel that matters. getSponsorWalletStatus already
 * fails safe here by reporting underfunded: false on a read error; treating that as "ok" would be
 * worse than treating it as unknown, because it would fabricate a recovery notice and clear a real
 * firing alert. Unknown touches no state at all.
 */
export function classifySponsorFunding(status: SponsorWalletStatus, threshold: number): SponsorFundingState {
    if (!status.configured) return "unknown";
    if (status.error || status.balanceUsdc === null) return "unknown";
    if (status.underfunded) return "empty";
    if (status.estimatedTopupsRemaining === null) return "unknown";
    return status.estimatedTopupsRemaining < threshold ? "low" : "ok";
}

type OpsAlertRow = {
    state: string;
    detail: string | null;
    first_alerted_at: Date | string | null;
    last_alerted_at: Date | string | null;
};

const asDate = (value: Date | string | null): Date | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

async function readAlertState(alertKey: string) {
    return pgMaybeOne<OpsAlertRow>(
        `select state, detail, first_alerted_at, last_alerted_at
           from ops_alert_state
          where alert_key = $1`,
        [alertKey],
    );
}

/*
 * Claim the right to send a firing alert, atomically.
 *
 * The WHERE on the DO UPDATE is the whole mechanism. It writes, and therefore returns a row, only
 * when the state actually changed or the cooldown has elapsed; otherwise nothing is returned and
 * nothing is sent. Two overlapping keeper runs cannot both send, because the second one's
 * predicate is already false against the row the first one wrote. That is why this state lives in
 * Postgres and not in a cache: the dedupe and the storage have to be the same operation.
 *
 * first_alerted_at is preserved across an escalation (low to empty) so the alert can say how long
 * the condition has been open, and is only reset when the alert opens from 'ok'.
 */
async function claimFiringAlert(alertKey: string, state: string, detail: string, cooldownMinutes: number) {
    const rows = await pgQuery<{ first_alerted_at: Date | string | null; last_alerted_at: Date | string | null }>(
        `insert into ops_alert_state (alert_key, state, detail, first_alerted_at, last_alerted_at, updated_at)
         values ($1, $2, $3, now(), now(), now())
         on conflict (alert_key) do update
            set state            = excluded.state,
                detail           = excluded.detail,
                first_alerted_at = case
                                       when ops_alert_state.state = 'ok' or ops_alert_state.first_alerted_at is null
                                       then now()
                                       else ops_alert_state.first_alerted_at
                                   end,
                last_alerted_at  = now(),
                updated_at       = now()
          where ops_alert_state.state is distinct from excluded.state
             or ops_alert_state.last_alerted_at is null
             or ops_alert_state.last_alerted_at < now() - ($4::int * interval '1 minute')
         returning first_alerted_at, last_alerted_at`,
        [alertKey, state, detail, cooldownMinutes],
    );
    return rows[0] || null;
}

/*
 * Claim the right to send a recovery notice. Only ever fires against a row that is currently
 * firing, so a first-ever healthy check cannot mail an all-clear for something that never broke.
 */
async function claimRecovery(alertKey: string, detail: string) {
    const rows = await pgQuery<{ last_alerted_at: Date | string | null }>(
        `update ops_alert_state
            set state = 'ok', detail = $2, first_alerted_at = null, last_alerted_at = now(), updated_at = now()
          where alert_key = $1 and state <> 'ok'
         returning last_alerted_at`,
        [alertKey, detail],
    );
    return rows[0] || null;
}

/* Keeps a heartbeat on a healthy alert so "the health check stopped running three weeks ago" is
   visible as a stale updated_at instead of as an absence of alerts. Sends nothing, ever. */
async function recordHealthy(alertKey: string, detail: string) {
    await pgQuery(
        `insert into ops_alert_state (alert_key, state, detail, updated_at)
         values ($1, 'ok', $2, now())
         on conflict (alert_key) do update
            set detail = excluded.detail, updated_at = now()
          where ops_alert_state.state = 'ok'`,
        [alertKey, detail],
    );
}

export type SponsorAlertAction =
    | { alertKey: string; sent: true; kind: SponsorGasAlertKind | "recovered"; state: string; recipients: number; delivered: number }
    | { alertKey: string; sent: false; state: string; reason: SponsorAlertSkipReason };

export type SponsorAlertSkipReason =
    /* Nothing changed and the cooldown has not elapsed. The overwhelmingly common outcome. */
    | "unchanged"
    /* Another invocation claimed this alert first. */
    | "claimed_elsewhere"
    /* The balance could not be read, so no conclusion was drawn and no state was touched. */
    | "unknown"
    /* No admin has a verified email on their auth identity. */
    | "no_recipients"
    /* The alert state store could not be read or written. */
    | "state_unavailable";

export type SponsorHealthCheckResult = {
    /* False when SPONSOR_PRIVATE_KEY is unset: sponsorship is off by design here. */
    configured: boolean;
    address: string | null;
    /* NATIVE gas balance at 18 decimals, verbatim from getSponsorWalletStatus. Not micro-USDC. */
    balanceNativeUsdc: string | null;
    estimatedTopupsRemaining: number | null;
    funding: SponsorFundingState;
    emergencyStop: boolean;
    readError: string | null;
    lowThreshold: number;
    cooldownMinutes: number;
    actions: SponsorAlertAction[];
};

/**
 * Read the sponsor wallet and mail platform admins if, and only if, something changed.
 *
 * Never throws. This is called by a keeper, and an alerting path that can 500 is an alerting path
 * that gets disabled.
 */
export async function runSponsorWalletHealthCheck(): Promise<SponsorHealthCheckResult> {
    const threshold = lowTopupsThreshold();
    const cooldownMinutes = alertCooldownMinutes();
    const status = await getSponsorWalletStatus();
    const funding = classifySponsorFunding(status, threshold);

    const result: SponsorHealthCheckResult = {
        configured: status.configured,
        address: status.address,
        balanceNativeUsdc: status.balanceUsdc,
        estimatedTopupsRemaining: status.estimatedTopupsRemaining,
        funding,
        emergencyStop: status.emergencyStop,
        readError: status.error,
        lowThreshold: threshold,
        cooldownMinutes,
        actions: [],
    };

    /* No sponsor key means no sponsored flows exist on this deployment, so there is nothing to
       fail and nothing to alert about. Mailing "sponsorship is not configured" every 15 minutes
       to a preview or a self-hosted install would be pure noise. */
    if (!status.configured) return result;

    const facts: SponsorGasFacts = {
        walletAddress: status.address,
        estimatedTopupsRemaining: status.estimatedTopupsRemaining,
        balanceNativeUsdc: status.balanceUsdc,
        topupUsdc: status.topupUsdc,
    };

    /* Resolved once and shared, and only when a send is actually in prospect. Never throws and
       never logged. */
    let recipientCache: string[] | null = null;
    const recipients = async () => {
        if (recipientCache === null) recipientCache = await listAdminNotificationEmails();
        return recipientCache;
    };

    result.actions.push(await reconcileAlert({
        alertKey: SPONSOR_FUNDING_ALERT_KEY,
        condition: "funding",
        state: funding,
        detail: funding === "unknown"
            ? `balance unreadable: ${status.error || "no balance"}`
            : `${status.estimatedTopupsRemaining ?? "?"} top-ups left, threshold ${threshold}`,
        cooldownMinutes,
        facts,
        threshold,
        recipients,
    }));

    result.actions.push(await reconcileAlert({
        alertKey: SPONSOR_EMERGENCY_STOP_ALERT_KEY,
        condition: "emergency_stop",
        state: status.emergencyStop ? "engaged" : "ok",
        detail: status.emergencyStop ? "SPONSOR_EMERGENCY_STOP=true" : "sponsorship enabled",
        cooldownMinutes,
        facts,
        threshold,
        recipients,
    }));

    return result;
}

/**
 * One alert's full decision: read, decide, claim, send.
 *
 * Order matters in two places. Recipients are resolved BEFORE the claim, so an audience of nobody
 * cannot burn the cooldown on a send that never happened and leave the next 6 hours silent. The
 * claim happens BEFORE the mail, so a crash mid-fan-out costs one alert to some admins rather than
 * duplicate mail to all of them; the cooldown re-alert covers anyone missed.
 */
async function reconcileAlert(input: {
    alertKey: string;
    condition: SponsorGasCondition;
    /* 'ok', 'unknown', or a severity the ops template understands. */
    state: SponsorFundingState | "engaged";
    detail: string;
    cooldownMinutes: number;
    facts: SponsorGasFacts;
    threshold: number;
    recipients: () => Promise<string[]>;
}): Promise<SponsorAlertAction> {
    const { alertKey, state } = input;

    /* Blind, so draw no conclusion and touch no state. Overwriting a firing alert here would
       fabricate a recovery; overwriting an 'ok' one would reset a cooldown for no reason. */
    if (state === "unknown") return { alertKey, sent: false, state, reason: "unknown" };

    let prior: OpsAlertRow | null;
    try {
        prior = await readAlertState(alertKey);
    } catch (error) {
        /*
         * Fail closed on the MAIL, not on the caller.
         *
         * An alerting path that cannot remember what it already said will mail every admin every
         * 15 minutes for the duration of a database incident, which is precisely the noise this
         * design exists to prevent. Nothing is lost by staying quiet: resolving the audience needs
         * the same database, so no email was deliverable anyway, and the admin console still shows
         * the underfunded badge.
         */
        console.error(`[sponsor-alerts] ${alertKey} state read failed, not alerting:`, error instanceof Error ? error.message : error);
        return { alertKey, sent: false, state, reason: "state_unavailable" };
    }

    const priorState = prior?.state || "ok";
    const lastAlertedAt = asDate(prior?.last_alerted_at ?? null);

    if (state === "ok") {
        if (priorState === "ok") {
            /* Heartbeat only. A write failure here is not worth a log line an operator will read
               as an incident, but it must not propagate either. */
            await recordHealthy(alertKey, input.detail).catch(() => {});
            return { alertKey, sent: false, state, reason: "unchanged" };
        }

        const audience = await input.recipients();
        if (audience.length === 0) return { alertKey, sent: false, state, reason: "no_recipients" };

        let claim: { last_alerted_at: Date | string | null } | null;
        try {
            claim = await claimRecovery(alertKey, input.detail);
        } catch (error) {
            console.error(`[sponsor-alerts] ${alertKey} recovery claim failed:`, error instanceof Error ? error.message : error);
            return { alertKey, sent: false, state, reason: "state_unavailable" };
        }
        if (!claim) return { alertKey, sent: false, state, reason: "claimed_elsewhere" };

        const alertedAt = asDate(claim.last_alerted_at) || new Date();
        let delivered = 0;
        for (const adminEmail of audience) {
            const outcome = await sendSponsorGasRecoveryEmail({
                adminEmail,
                condition: input.condition,
                facts: input.facts,
                firstAlertedAt: asDate(prior?.first_alerted_at ?? null),
                alertedAt,
            });
            if (outcome.ok) delivered += 1;
        }
        return { alertKey, sent: true, kind: "recovered", state, recipients: audience.length, delivered };
    }

    /*
     * Firing. Short-circuit on the prior row before spending queries on the audience: same state
     * and inside the cooldown is the overwhelmingly common outcome, and the claim below would
     * refuse it anyway. This read is advisory (it is not in the same transaction as the claim), so
     * the claim stays the authority on whether mail goes out.
     */
    const cooldownElapsed = !lastAlertedAt
        || Date.now() - lastAlertedAt.getTime() >= input.cooldownMinutes * 60_000;
    if (priorState === state && !cooldownElapsed) {
        return { alertKey, sent: false, state, reason: "unchanged" };
    }

    const audience = await input.recipients();
    if (audience.length === 0) return { alertKey, sent: false, state, reason: "no_recipients" };

    let claim: { first_alerted_at: Date | string | null; last_alerted_at: Date | string | null } | null;
    try {
        claim = await claimFiringAlert(alertKey, state, input.detail, input.cooldownMinutes);
    } catch (error) {
        console.error(`[sponsor-alerts] ${alertKey} alert claim failed:`, error instanceof Error ? error.message : error);
        return { alertKey, sent: false, state, reason: "state_unavailable" };
    }
    if (!claim) return { alertKey, sent: false, state, reason: "claimed_elsewhere" };

    /* Wording only. "opened" came from healthy, "changed" moved between severities (low to empty
       is the one that matters), "reminder" is the cooldown re-alert. */
    const kind: SponsorGasAlertKind = priorState === "ok"
        ? "opened"
        : priorState === state ? "reminder" : "changed";

    const alertedAt = asDate(claim.last_alerted_at) || new Date();
    let delivered = 0;
    for (const adminEmail of audience) {
        const outcome = await sendSponsorGasAlertEmail({
            adminEmail,
            condition: input.condition,
            severity: state as SponsorGasSeverity,
            kind,
            facts: input.facts,
            lowThreshold: input.threshold,
            firstAlertedAt: asDate(claim.first_alerted_at),
            alertedAt,
        });
        if (outcome.ok) delivered += 1;
    }

    return { alertKey, sent: true, kind, state, recipients: audience.length, delivered };
}
