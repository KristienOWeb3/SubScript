/* User commits (escrows) USDC into a (user → merchant) vault. Clears any owed debt
   first, then restores the commit; the merchant's service activates for the cycle.
   Server-signed from the user's embedded wallet. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole, getAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { commitFromEmbedded, syncVaultMirror } from "@/lib/vault/onchain";
import { SUBSCRIPT_VAULT_CHAIN_ID } from "@/lib/contracts/constants";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { isSponsoredGasError, requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { prisma } from "@/lib/prisma";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import crypto from "crypto";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        /* Fail-closed after authentication so deployment diagnostics are not exposed to
           unauthenticated probes. Never silently fall back to a testnet address. */
        assertFinancialNetworkReady();
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }
        const verifiedEmail = await getVerifiedAccountEmail(wallet);
        if (!verifiedEmail?.email) {
            return NextResponse.json(
                { error: "Verify an email address with OTP before committing funds." },
                { status: 403 },
            );
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        const { merchantAddress, amountUsdc, acknowledgeUnverified } = body || {};
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const merchantRole = await getAccountRole(merchantAddress.toLowerCase());
        if (merchantRole !== "ENTERPRISE") {
            return NextResponse.json({ error: "Vaults can only be funded for merchant services." }, { status: 400 });
        }
        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: merchantAddress.toLowerCase() },
            select: { tier: true, verified: true }
        });
        if (!merchant || merchant.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: Vault commits are only available for Premium merchants." }, { status: 403 });
        }

        /* Informed consent for unverified merchants: metered vaults let the merchant draw reported
           usage up to the committed balance, so committing to a merchant SubScript hasn't verified
           carries real loss-of-funds risk. Require an explicit acknowledgment (client shows the
           warning) before escrowing, rather than silently proceeding. */
        if (!merchant.verified && acknowledgeUnverified !== true) {
            return NextResponse.json({
                error: "This merchant is not verified by SubScript.",
                code: "UNVERIFIED_MERCHANT",
                merchantVerified: false,
                warning: "This merchant has not been verified by SubScript. Committing funds lets them bill metered usage against your escrowed balance. Only commit to merchants you trust and have independently verified — funds lost to a fraudulent merchant may not be recoverable. Re-submit with acknowledgeUnverified: true to proceed.",
            }, { status: 409 });
        }
        const amount = parseUsdcToMicros(amountUsdc);
        if (amount <= BigInt(0)) {
            return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
        }

        /* commit escrows funds, so a retried request must reuse the same Circle idempotency key
           or it escrows twice. The client's x-request-id is REQUIRED and validated — the server
           never silently mints one for a money-moving commit, because a generated id cannot be
           reused by the client after an ambiguous response. */
        const requestId = request.headers.get("x-request-id")?.trim() || "";
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
            return NextResponse.json({
                error: "A stable x-request-id header is required for vault commits. Reuse the SAME id when retrying an ambiguous commit.",
                code: "REQUEST_ID_REQUIRED",
            }, { status: 400 });
        }

        const normalizedWallet = wallet.toLowerCase();
        const normalizedMerchant = merchantAddress.toLowerCase();
        const sponsorRequestKey = `vault-commit:${requestId}:${normalizedWallet}:${normalizedMerchant}:${amount.toString()}`;
        const custodyIdempotencyKey = deterministicIdempotencyKey(
            `req:${requestId}:vault-commit:${normalizedWallet}:${normalizedMerchant}:${amount.toString()}`);

        /* Persist the intent BEFORE anything can move money. A reload/retry resolves this row
           and reuses the same custody idempotency key instead of submitting a second commit. */
        let intent;
        try {
            intent = await prisma.vaultCommitIntent.create({
                data: {
                    requestId,
                    userAddress: normalizedWallet,
                    merchantAddress: normalizedMerchant,
                    amountUsdc: amount.toString(),
                    custodyIdempotencyKey,
                    sponsorRequestKey,
                },
            });
        } catch (e: any) {
            if (e?.code !== "P2002") throw e;
            intent = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
            if (!intent
                || intent.userAddress !== normalizedWallet
                || intent.merchantAddress !== normalizedMerchant
                || BigInt(intent.amountUsdc.toString()) !== amount) {
                return NextResponse.json({
                    error: "This request id was already used for a different commit.",
                    code: "REQUEST_ID_CONFLICT",
                }, { status: 409 });
            }
            if (intent.status === "MIRRORED" && intent.txHash) {
                /* Terminal success: return it idempotently, with a fresh mirror read. */
                const mirrored = await syncVaultMirror(wallet, merchantAddress);
                return NextResponse.json({
                    success: true,
                    txHash: intent.txHash,
                    resumed: true,
                    vault: {
                        balanceUsdc: mirrored.balance.toString(),
                        owedUsdc: mirrored.owed.toString(),
                        commitUsdc: mirrored.commitNeeded.toString(),
                        active: mirrored.active,
                    },
                }, { status: 200 });
            }
            if (intent.status === "FAILED") {
                return NextResponse.json({
                    error: intent.lastError || "The previous commit failed before submission. Start a new commit with a new request id.",
                    code: "COMMIT_FAILED",
                    requestId,
                }, { status: 409 });
            }
            /* PENDING/SUBMITTED: fall through — the deterministic custody key makes the
               resubmission below dedupe at Circle, and mirror sync completes a half-finished
               attempt. FAILED is terminal and requires a fresh user operation. */
        }

        /* Pay For Me: custody-aware, durable and budget-bounded. The commit amount is declared
           as principal so it is never reclassified as sponsored gas, and a retried request
           (same x-request-id) reuses the durable sponsorship instead of farming a new top-up. */
        try {
            await requireSponsoredGas({
                wallet: normalizedWallet,
                action: "vault_commit",
                requestKey: sponsorRequestKey,
            });
        } catch (sponsorError: unknown) {
            /* Structured definitive failures occurred before any financial submission, so the
               intent can close safely. Ambiguous sponsor hashes and unknown infrastructure
               failures stay PENDING for same-id reconciliation. */
            if (isSponsoredGasError(sponsorError) && sponsorError.kind === "definitive") {
                await prisma.vaultCommitIntent.update({
                    where: { requestId },
                    data: {
                        status: "FAILED",
                        lastError: String(sponsorError.message || sponsorError.reason || "Gas sponsorship failed").slice(0, 500),
                    },
                });
            }
            throw sponsorError;
        }

        let txHash: string;
        try {
            txHash = await commitFromEmbedded(wallet, merchantAddress, amount, custodyIdempotencyKey);
        } catch (commitError: any) {
            /* A custody error after submission started is AMBIGUOUS — Circle may have accepted
               the transaction. Record the error but keep the intent open; the client must retry
               with the SAME request id (deduped by the idempotency key), never a fresh one. */
            await prisma.vaultCommitIntent.update({
                where: { requestId },
                data: { lastError: String(commitError?.message || commitError).slice(0, 500) },
            }).catch(() => {});
            return NextResponse.json({
                error: "The commit could not be confirmed and may still be processing. Retry with the same request id — do not start a new commit.",
                code: "COMMIT_AMBIGUOUS",
                requestId,
            }, { status: 502 });
        }

        await prisma.vaultCommitIntent.update({
            where: { requestId },
            data: { status: "SUBMITTED", txHash: txHash.toLowerCase(), lastError: null },
        }).catch((persistError) => {
            console.error("[vault-commit] CRITICAL: submitted commit not recorded durably:", persistError);
        });

        const v = await syncVaultMirror(wallet, merchantAddress);

        await prisma.vaultCommitIntent.update({
            where: { requestId },
            data: { status: "MIRRORED" },
        }).catch(() => { /* SUBMITTED remains resumable; the GET resolver reports it */ });
        /* A commit changes the balance denominator for usage thresholds, so re-arm the 50%/80%
           alerts against the new balance. Re-committing is also an explicit opt back in, so it
           clears any prior cancellation and lets the merchant resume reporting usage. */
        const commitEnvironment = SUBSCRIPT_VAULT_CHAIN_ID === 5042001 ? "LIVE" : "TEST";
        await prisma.meteredVault.updateMany({
            where: {
                userAddress: wallet.toLowerCase(),
                merchantAddress: merchantAddress.toLowerCase(),
                environment: commitEnvironment,
                settlementChainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID),
            },
            data: { usageNotifiedBps: 0, cancelRequestedAt: null, cancelReason: null },
        }).catch(() => {});
        if (v.active) {
            await prisma.subscriptDm.updateMany({
                where: {
                    senderAddress: merchantAddress.toLowerCase(),
                    receiverAddress: wallet.toLowerCase(),
                    messageType: "COMMIT_EXHAUSTED",
                    status: "PENDING",
                },
                data: { status: "DISMISSED" },
            });
        }

        await recordMerchantEvent({
            merchantAddress: normalizedMerchant,
            environment: commitEnvironment as "TEST" | "LIVE",
            eventType: "vault.activated",
            resourceType: "vault",
            resourceId: `${normalizedWallet}:${normalizedMerchant}`,
            resourceVersion: 1,
            data: {
                user_address: normalizedWallet,
                merchant_address: normalizedMerchant,
                amount_usdc_micros: amount.toString(),
                vault_balance_usdc_micros: v.balance.toString(),
                tx_hash: txHash,
                active: v.active,
            },
            correlationId: requestId,
            transitionKey: `vault_commit:${txHash.toLowerCase()}`,
        }).catch(err => console.error("[vault/commit] webhook dispatch error:", err));

        return NextResponse.json({
            success: true,
            txHash,
            vault: {
                balanceUsdc: v.balance.toString(),
                owedUsdc: v.owed.toString(),
                commitUsdc: v.commitNeeded.toString(),
                active: v.active,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Vault commit failed:", error);
        return NextResponse.json({ error: error.message || "Failed to commit to vault" }, { status: 500 });
    }
}

/* Resolve a prior commit intent for the authenticated user. The browser calls this on reload
   (localStorage still holds the operation id) BEFORE allowing another commit, so an ambiguous
   attempt is resumed — never duplicated. */
export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const requestId = new URL(request.url).searchParams.get("requestId")?.trim() || "";
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
            return NextResponse.json({ error: "Invalid requestId" }, { status: 400 });
        }
        const intent = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
        if (!intent || intent.userAddress !== wallet.toLowerCase()) {
            return NextResponse.json({ exists: false });
        }
        return NextResponse.json({
            exists: true,
            status: intent.status,
            txHash: intent.txHash,
            merchantAddress: intent.merchantAddress,
            amountUsdc: intent.amountUsdc.toString(),
            lastError: intent.lastError,
        });
    } catch (error: any) {
        console.error("Vault commit intent lookup failed:", error);
        return NextResponse.json({ error: "Unable to read commit intent" }, { status: 503 });
    }
}
