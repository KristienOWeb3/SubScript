import { financialPinContext } from "@/lib/auth/financialPinPolicy";
import { withTransactionPin } from "@/lib/auth/transactionPin";
import { assertAuthorizedMerchantDestination } from "@/lib/auth/financialAuthorizationContext";
/* User commits (escrows) USDC into a (user → merchant) vault. Clears any owed debt
   first, then restores the commit; the merchant's service activates for the cycle.
   Server-signed from the user's embedded wallet. */
import { NextResponse, after } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { readUsdcBalance } from "@/lib/vault/onchain";
import { ARC_MAINNET_CHAIN_ID, SUBSCRIPT_VAULT_CHAIN_ID, SUBSCRIPT_VAULT_ADDRESS } from "@/lib/contracts/constants";
import { dispatchSettlementReceipts, prepareSettlementReceiptJob } from "@/lib/payments/settlementReceiptRecovery";
import { CirclePaymasterPolicyError, deterministicIdempotencyKey } from "@/lib/custody";
import { isSponsoredGasError, requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { prisma } from "@/lib/prisma";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { haltGuard } from "@/lib/accountHalt";
import { isCommitSlug } from "@/lib/merchants/identity";
import { getAccountKycTier } from "@/lib/kyc/tier";
import { advanceAuthorizedVaultCommit, commitIntentOutcome, COMMIT_ENVIRONMENT, isCurrentCommitNetwork, observeWithin, reconcileVaultCommitIntent } from "@/lib/vault/commitRecovery";

export const maxDuration = 120;

async function handlePOST(request: Request) {
    const requestStartedAt = new Date();
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
        /* Committing escrow is money leaving the wallet under a brand new authorization, so a hold
           refuses it. Ahead of the email check and requireSponsoredGas: a held account should not
           spend platform gas budget on a commit that policy will reject. */
        const held = await haltGuard(wallet);
        if (held) return held;
        const tierInfo = await getAccountKycTier(wallet);
        if (tierInfo.tier < 1) {
            return NextResponse.json(
                { error: "Transactions require Tier 1 verification. Please link and verify your email to continue." },
                { status: 403 },
            );
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        const { merchantAddress: rawMerchantAddress, amountUsdc, acknowledgeUnverified } = body || {};
        if (typeof rawMerchantAddress !== "string") {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        let targetMerchant = rawMerchantAddress.toLowerCase().trim();
        if (isCommitSlug(targetMerchant)) {
            const m = await prisma.merchant.findUnique({
                where: { commitSlug: targetMerchant },
                select: { walletAddress: true },
            }).catch(() => null);
            if (m) {
                targetMerchant = m.walletAddress.toLowerCase();
            }
        }
        if (!ethers.isAddress(targetMerchant)) {
            return NextResponse.json({ error: "Invalid merchant commit name or address" }, { status: 400 });
        }
        const merchantAddress = targetMerchant;
        assertAuthorizedMerchantDestination(merchantAddress);
        let merchant = await prisma.merchant.findUnique({
            where: { walletAddress: targetMerchant },
            select: { tier: true, verified: true }
        });
        if (!merchant) {
            merchant = await prisma.merchant.upsert({
                where: { walletAddress: targetMerchant },
                create: { walletAddress: targetMerchant, tier: "FREE" },
                update: {},
            }).catch(() => ({ tier: "FREE", verified: false }));
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

        // Reconcile the durable identity before checking spendable balance. A prior
        // accepted debit may already have consumed that balance.
        let intent = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
        if (intent && (intent.userAddress !== normalizedWallet || intent.merchantAddress !== normalizedMerchant
            || BigInt(intent.amountUsdc.toString()) !== amount || !isCurrentCommitNetwork(intent))) {
            return NextResponse.json({ error: "This request id belongs to a different commit or network.", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
        }
        if (intent) {
            intent = await reconcileVaultCommitIntent(requestId, wallet);
            if (intent?.status === "MIRRORED" || intent?.status === "SUBMITTED") {
                return NextResponse.json({ ...commitIntentOutcome(intent), success: true, resumed: true });
            }
            if (intent?.status === "FAILED") {
                return NextResponse.json({ ...commitIntentOutcome(intent), error: intent.lastError || "The previous commit failed. Start a new operation.", code: "COMMIT_FAILED" }, { status: 409 });
            }
            if (intent?.commitProviderId) {
                return NextResponse.json({ ...commitIntentOutcome(intent), success: false, code: "COMMIT_PENDING" }, { status: 202 });
            }
        }
        // A submission-start marker without acceptance is ambiguous. Reusing the exact
        // custody key is the only safe retry; low balance cannot prove it failed.
        if (!intent?.submissionStartedAt) {
            const availableBalance = await readUsdcBalance(normalizedWallet);
            if (availableBalance < amount) {
                return NextResponse.json({ error: "Insufficient balance. Top up and try again", code: "INSUFFICIENT_WALLET_BALANCE",
                    availableBalanceUsdcMicros: availableBalance.toString(), requiredBalanceUsdcMicros: amount.toString() }, { status: 422 });
            }
        }
        const sponsorRequestKey = `vault-commit:${requestId}:${normalizedWallet}:${normalizedMerchant}:${amount.toString()}`;
        const custodyIdempotencyKey = deterministicIdempotencyKey(
            `req:${requestId}:vault-commit:${normalizedWallet}:${normalizedMerchant}:${amount.toString()}`);
        if (!intent) {
            try {
                intent = await prisma.vaultCommitIntent.create({ data: { requestId, userAddress: normalizedWallet,
                    merchantAddress: normalizedMerchant, amountUsdc: amount.toString(), custodyIdempotencyKey, sponsorRequestKey,
                    environment: COMMIT_ENVIRONMENT, chainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID),
                    contractAddress: SUBSCRIPT_VAULT_ADDRESS.toLowerCase(), requestStartedAt, preflightCompletedAt: new Date() } });
            } catch (error: any) {
                if (error?.code !== "P2002") throw error;
                // Another authorized request owns this identity. Read it without submitting
                // another operation; a subsequent same-id request can continue if needed.
                const existing = await reconcileVaultCommitIntent(requestId, wallet);
                if (!existing || existing.merchantAddress !== normalizedMerchant || BigInt(existing.amountUsdc.toString()) !== amount
                    || !isCurrentCommitNetwork(existing)) {
                    return NextResponse.json({ error: "Request id conflict", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
                }
                return NextResponse.json({ ...commitIntentOutcome(existing), success: ["MIRRORED", "SUBMITTED"].includes(existing.status), code: "COMMIT_PENDING" }, { status: 202 });
            }
        }

        /* Pay For Me: custody-aware, durable and budget-bounded. The commit amount is declared
           as principal so it is never reclassified as sponsored gas, and a retried request
           (same x-request-id) reuses the durable sponsorship instead of farming a new top-up. */
        try {
            await requireSponsoredGas({
                wallet: normalizedWallet,
                action: "vault_commit",
                requestKey: sponsorRequestKey,
                principalRequiredWei: 0n,
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

        const receiptJobId = await prepareSettlementReceiptJob({
            identity: `vault-commit:${requestId}:${wallet.toLowerCase()}:${merchantAddress.toLowerCase()}`,
            kind: "vault_topup",
            fundingWallet: wallet.toLowerCase(),
            payerAddress: wallet.toLowerCase(),
            payeeAddress: merchantAddress.toLowerCase(),
            amountUsdc: amount,
            contractAddress: SUBSCRIPT_VAULT_ADDRESS,
            chainId: SUBSCRIPT_VAULT_CHAIN_ID,
        });

        await prisma.vaultCommitIntent.updateMany({ where: { requestId, receiptJobId: null }, data: { receiptJobId } });
        // Observe at most 12 seconds. Acceptance callbacks persist provider identities
        // even if the caller disconnects; independent GET/cron recovery observes finality.
        const work = advanceAuthorizedVaultCommit(requestId);
        after(async () => {
            await work.catch(() => undefined);
            await dispatchSettlementReceipts().catch(() => undefined);
        });
        try {
            const outcome = await observeWithin(work, 12_000);
            if (outcome?.status === "MIRRORED" || outcome?.status === "SUBMITTED") {
                return NextResponse.json({ ...commitIntentOutcome(outcome), success: true });
            }
            if (outcome?.status === "FAILED") {
                return NextResponse.json({ ...commitIntentOutcome(outcome), error: outcome.lastError || "The commit failed.", code: "COMMIT_FAILED" }, { status: 409 });
            }
            return NextResponse.json({ ...(outcome ? commitIntentOutcome(outcome) : { requestId, pending: true }),
                success: false, code: "COMMIT_PENDING" }, { status: 202 });
        } catch (commitError: unknown) {
            // A policy rejection before any commit acceptance is definitive. Unknown
            // provider outcomes retain the durable id and must never start a new debit.
            const latest = await prisma.vaultCommitIntent.findUnique({ where: { requestId } });
            if (commitError instanceof CirclePaymasterPolicyError && !latest?.commitProviderId) {
                await prisma.vaultCommitIntent.updateMany({ where: { requestId, status: "PENDING", commitProviderId: null },
                    data: { status: "FAILED", lastError: commitError.message.slice(0, 500) } });
                return NextResponse.json({ error: commitError.message, code: commitError.code, requestId }, { status: 503 });
            }
            await prisma.vaultCommitIntent.updateMany({ where: { requestId, status: "PENDING" },
                data: { lastError: "Awaiting provider reconciliation. Resume with the same request id." } }).catch(() => undefined);
            return NextResponse.json({ success: false, pending: true, code: "COMMIT_AMBIGUOUS", requestId }, { status: 202 });
        }
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
        const intent = await reconcileVaultCommitIntent(requestId, wallet);
        if (!intent) {
            return NextResponse.json({ exists: false });
        }
        return NextResponse.json(commitIntentOutcome(intent), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    } catch (error: any) {
        console.error("Vault commit intent lookup failed:", error);
        return NextResponse.json({ error: "Unable to read commit intent" }, { status: 503 });
    }
}

export const POST = withTransactionPin({ action: "vault-commit", bind: financialPinContext }, handlePOST);
