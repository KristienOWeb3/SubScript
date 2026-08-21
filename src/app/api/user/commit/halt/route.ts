import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import { onActiveContract } from "@/lib/subscriptions/contractBinding";
import {
    CommitAccessError,
    getOrCreateCommitForWallet,
    haltOwnAccount,
    resumeOwnAccount,
} from "@/lib/commitId";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";

/* POST puts the caller's own account on hold; DELETE lifts it; GET reports the current state and
   what the hold would affect.
 *
 * Authorized entirely by the caller's session. Everything else in the commit system proves authority
 * by a PARENT owning a child (requireOwnedSubUser); this is the one action whose subject is the
 * caller, so haltOwnAccount goes through requireRootCommit instead — a delegated identity has no
 * account of its own to stop.
 *
 * See src/lib/accountHalt.ts for what a hold does and does not stop, and why an in-window
 * commitment still runs to term.
 */

/* Halting is a brake, so it has to stay responsive under panic: someone who has just realised money
   is leaving will hit the button more than once. The ceiling is the same 30/minute the vault share
   status route uses for revocation, and for the same reason. Flipping a status is one small write;
   the limit is there so a stolen session cannot use halt/resume as a webhook amplifier against every
   merchant the user deals with. */
const HALT_RATE_LIMIT = 30;
const HALT_RATE_WINDOW_SECONDS = 60;

async function guardHaltRate(walletAddress: string) {
    /* Fails closed on a database incident, like every sibling route. The consequence is only that
       halting is briefly unavailable, and spending is gated by the same database, so an incident
       cannot leave a halted account able to spend. */
    let rateLimit;
    try {
        rateLimit = await consumeDistributedRateLimit({
            scope: "user-commit-self-halt",
            key: walletAddress.toLowerCase(),
            limit: HALT_RATE_LIMIT,
            windowSeconds: HALT_RATE_WINDOW_SECONDS,
        });
    } catch (error) {
        console.error("Self-halt limiter failed:", error);
        return NextResponse.json(
            { error: "We can't change your hold right now. Try again in a moment." },
            { status: 503, headers: { "Retry-After": "5" } },
        );
    }
    if (!rateLimit.ok) {
        return NextResponse.json(
            { error: "That's a lot of requests. Wait a moment and try again." },
            { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
        );
    }
    return null;
}

/* What a hold on this wallet touches, and which of it keeps running.
 *
 * Two kinds of bounded commitment count, and both were agreed to before the hold:
 *   - MeteredVault.lockedUntil, the service lock window from the Merchant Protection Layer.
 *   - Subscription.minCommitmentUntil, snapshotted at subscribe time and capped at one period.
 * Unsettled accrued usage also counts: the merchant already rendered it, and a hold is not a way to
 * take delivery and then refuse to pay. */
async function summarizeExposure(walletAddress: string) {
    const wallet = walletAddress.toLowerCase();
    const now = new Date();

    const [vaults, subscriptions, delegates] = await Promise.all([
        prisma.meteredVault.findMany({
            where: { userAddress: wallet },
            select: {
                id: true,
                merchantAddress: true,
                lockedUntil: true,
                accruedUsageUsdc: true,
                active: true,
            },
        }),
        prisma.subscription.findMany({
            /* onActiveContract keeps this off ids minted by an abandoned PSA deployment, which
               restart at 1 and would otherwise report another user's subscription as this one's. */
            where: { ...onActiveContract(), subscriber: wallet, status: "ACTIVE" },
            select: { subscriptionId: true, merchantAddress: true, minCommitmentUntil: true },
        }),
        getOrCreateCommitForWallet(wallet).then(root =>
            prisma.userCommit.findMany({
                where: { parentCommitId: root.id, status: { in: ["ACTIVE", "PAUSED"] } },
                select: { commitId: true, displayName: true },
            }),
        ),
    ]);

    const commitmentByMerchant = new Map<string, Date>();
    const noteCommitment = (merchant: string, until: Date | null) => {
        if (!until || until.getTime() <= now.getTime()) return;
        const key = merchant.toLowerCase();
        const current = commitmentByMerchant.get(key);
        if (!current || until.getTime() > current.getTime()) commitmentByMerchant.set(key, until);
    };

    for (const vault of vaults) noteCommitment(vault.merchantAddress, vault.lockedUntil);
    for (const sub of subscriptions) noteCommitment(sub.merchantAddress, sub.minCommitmentUntil);

    return { wallet, now, vaults, subscriptions, delegates, commitmentByMerchant };
}

/* One event per merchant the hold touches, so each merchant learns about their own relationship and
   nothing about the others. pause_requested when something the user already committed keeps the
   draws running; paused when they have actually stopped. Fire-and-forget for the same reason the
   withdraw route is: a webhook dispatch failure must not undo a hold the user asked for. */
function announceHold(args: {
    wallet: string;
    haltedAt: Date;
    correlationId: string;
    vaults: { id: string; merchantAddress: string; accruedUsageUsdc: bigint }[];
    commitmentByMerchant: Map<string, Date>;
    merchants: string[];
}) {
    const vaultByMerchant = new Map(args.vaults.map(v => [v.merchantAddress.toLowerCase(), v]));

    return Promise.all(args.merchants.map(merchant => {
        const vault = vaultByMerchant.get(merchant);
        const commitmentUntil = args.commitmentByMerchant.get(merchant) ?? null;
        const owesUnsettledUsage = (vault?.accruedUsageUsdc ?? 0n) > 0n;
        const drawsContinue = commitmentUntil !== null || owesUnsettledUsage;

        return recordMerchantEvent({
            merchantAddress: merchant,
            environment: "TEST",
            eventType: drawsContinue ? "vault.pause_requested" : "vault.paused",
            resourceType: "vault",
            resourceId: vault?.id ?? `${args.wallet}:${merchant}`,
            resourceVersion: 1,
            data: drawsContinue
                ? {
                    user_address: args.wallet,
                    merchant_address: merchant,
                    vault_id: vault?.id ?? null,
                    halted_at: args.haltedAt.toISOString(),
                    draws_continue: true,
                    commitment_until: commitmentUntil?.toISOString() ?? null,
                }
                : {
                    user_address: args.wallet,
                    merchant_address: merchant,
                    vault_id: vault?.id ?? null,
                    halted_at: args.haltedAt.toISOString(),
                    reason: "account_holder_hold",
                },
            /* One correlation id across every merchant, because one hold is one causal act. Each
               merchant still gets its own event and sees only its own relationship. */
            correlationId: args.correlationId,
            transitionKey: `account_hold:${args.wallet}:${merchant}:${args.haltedAt.getTime()}`,
        }).catch(err => console.error("[commit/halt] webhook dispatch error:", err));
    }));
}

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const commit = await getOrCreateCommitForWallet(walletAddress);
        const exposure = await summarizeExposure(walletAddress);

        /* The UI needs the honest version of what a hold will and won't stop, so it can say so
           before the user commits to it rather than after. */
        return NextResponse.json({
            commitId: commit.commitId,
            status: commit.status,
            onHold: commit.status === "HALTED",
            haltedAt: commit.haltedAt,
            delegateCount: exposure.delegates.length,
            activeSubscriptionCount: exposure.subscriptions.length,
            vaultCount: exposure.vaults.length,
            /* Merchants whose draws or renewals keep running until the window they were given
               closes, with the date it closes. */
            runningToTerm: [...exposure.commitmentByMerchant.entries()].map(([merchant, until]) => ({
                merchantAddress: merchant,
                commitmentUntil: until.toISOString(),
            })),
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to read account hold state:", error);
        return NextResponse.json({ error: "Could not read your hold status" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const limited = await guardHaltRate(walletAddress);
        if (limited) return limited;

        /* Read the exposure BEFORE the write. Afterwards a keeper may already have skipped a
           renewal, and the merchant notice would then describe a state the user never saw. */
        const exposure = await summarizeExposure(walletAddress);
        const commit = await haltOwnAccount(walletAddress);
        const haltedAt = commit.haltedAt ?? new Date();

        const merchants = [...new Set([
            ...exposure.vaults.map(v => v.merchantAddress.toLowerCase()),
            ...exposure.subscriptions.map(s => s.merchantAddress.toLowerCase()),
        ])];

        void announceHold({
            wallet: exposure.wallet,
            haltedAt,
            correlationId: request.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
            vaults: exposure.vaults,
            commitmentByMerchant: exposure.commitmentByMerchant,
            merchants,
        });

        return NextResponse.json({
            commitId: commit.commitId,
            status: commit.status,
            onHold: true,
            haltedAt,
            merchantsNotified: merchants.length,
            runningToTerm: [...exposure.commitmentByMerchant.entries()].map(([merchant, until]) => ({
                merchantAddress: merchant,
                commitmentUntil: until.toISOString(),
            })),
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to hold account:", error);
        return NextResponse.json({ error: "Could not put your account on hold" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const limited = await guardHaltRate(walletAddress);
        if (limited) return limited;

        const commit = await resumeOwnAccount(walletAddress);
        const exposure = await summarizeExposure(walletAddress);
        const resumedAt = new Date();
        const correlationId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();

        const vaultByMerchant = new Map(
            exposure.vaults.map(v => [v.merchantAddress.toLowerCase(), v]),
        );
        const merchants = [...new Set([
            ...exposure.vaults.map(v => v.merchantAddress.toLowerCase()),
            ...exposure.subscriptions.map(s => s.merchantAddress.toLowerCase()),
        ])];

        void Promise.all(merchants.map(merchant => recordMerchantEvent({
            merchantAddress: merchant,
            environment: "TEST",
            eventType: "vault.resumed",
            resourceType: "vault",
            resourceId: vaultByMerchant.get(merchant)?.id ?? `${exposure.wallet}:${merchant}`,
            resourceVersion: 1,
            data: {
                user_address: exposure.wallet,
                merchant_address: merchant,
                vault_id: vaultByMerchant.get(merchant)?.id ?? null,
                resumed_at: resumedAt.toISOString(),
            },
            correlationId,
            transitionKey: `account_hold_lifted:${exposure.wallet}:${merchant}:${resumedAt.getTime()}`,
        }).catch(err => console.error("[commit/halt] webhook dispatch error:", err))));

        return NextResponse.json({
            commitId: commit.commitId,
            status: commit.status,
            onHold: false,
            merchantsNotified: merchants.length,
        });
    } catch (error) {
        if (error instanceof CommitAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.httpStatus });
        }
        console.error("Failed to lift account hold:", error);
        return NextResponse.json({ error: "Could not lift the hold" }, { status: 500 });
    }
}
