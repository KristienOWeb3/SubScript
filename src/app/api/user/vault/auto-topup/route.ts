/* Auto top-up mandate: the user's explicit, bounded authorization for SubScript to refill a
   (user -> merchant) vault while they are not present.

   This route is the ONLY place the mandate can be granted, and it is held to the same bar as
   moving money — because it does move money, twice over: it signs an ERC-20 approve now, and it
   authorizes unattended commits later. Every gate in POST /api/user/vault/commit applies here.

   The approve() is the point of the design. The server holds Circle MPC signing authority over
   custodial wallets, so an off-chain "enabled" flag alone would mean the only thing between a bug
   and the user's balance is our own code. Approving exactly the monthly cap puts a ceiling on
   chain that survives any application error and that the user can revoke from any wallet UI
   without our cooperation. See src/lib/subscriptions/allowanceLifecycle.ts for the same doctrine
   applied to subscriptions: re-approve the horizon the user agreed to, never widen it. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { sanitizeInput } from "@/utils/security";
import { ensureUsdcAllowance, setUsdcAllowance } from "@/lib/vault/onchain";
import { SUBSCRIPT_VAULT_ADDRESS, SUBSCRIPT_VAULT_CHAIN_ID } from "@/lib/contracts/constants";
import { getWalletCustody } from "@/lib/custody";
import { isSponsoredGasError, requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { prisma } from "@/lib/prisma";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { validateMandate, nextMonthlyWindow, isRunningLow } from "@/lib/vault/autoTopUp";
import { haltGuard } from "@/lib/accountHalt";

export const maxDuration = 120;

function vaultEnvironment() {
    return SUBSCRIPT_VAULT_CHAIN_ID === 5042001 ? "LIVE" : "TEST";
}

/** Resolve a merchant alias or address the same way the commit route does, so a mandate and a
    manual commit can never end up scoped to different merchants for the same user input. */
async function resolveMerchant(raw: string): Promise<string | null> {
    const candidate = raw.toLowerCase();
    const aliasRecord = await prisma.addressAlias.findFirst({
        where: {
            OR: [
                { address: candidate },
                { alias: { equals: candidate, mode: "insensitive" } },
            ],
        },
    });
    if (aliasRecord) return aliasRecord.address.toLowerCase();
    return ethers.isAddress(candidate) ? candidate : null;
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        assertFinancialNetworkReady();

        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        /* A mandate authorizes an unbounded run of future commits, which is the largest new
           authorization this account can grant, so a hold refuses it. DELETE stays open: removing a
           mandate reduces outflow. */
        const held = await haltGuard(wallet);
        if (held) return held;

        /* Same bar as committing funds: a mandate authorizes an unbounded number of future
           commits, so it must not be grantable from a session with no verified contact address. */
        const verifiedEmail = await getVerifiedAccountEmail(wallet);
        if (!verifiedEmail?.email) {
            return NextResponse.json(
                { error: "Verify an email address with OTP before enabling auto top-up." },
                { status: 403 },
            );
        }

        const body = sanitizeInput(await request.json().catch(() => null));
        const {
            merchantAddress: rawMerchantAddress,
            thresholdUsdc: rawThreshold,
            topUpAmountUsdc: rawTopUp,
            monthlyLimitUsdc: rawMonthlyLimit,
            acknowledgeUnverified,
        } = body || {};

        if (typeof rawMerchantAddress !== "string") {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const merchantAddress = await resolveMerchant(rawMerchantAddress);
        if (!merchantAddress) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }

        let thresholdUsdc: bigint;
        let topUpAmountUsdc: bigint;
        let monthlyLimitUsdc: bigint;
        try {
            /* UNITS: the request carries HUMAN USDC ("2.00"), matching `amountUsdc` on the commit
               route; parseUsdcToMicros converts to micros, which is what the columns and the JSON
               response below hold. A client that mistakenly posts micros ("2000000") is rejected by
               the CAP_ABOVE_MAXIMUM check rather than silently authorizing 2M USDC — the failure is
               loud by construction, but do not remove that cap on the assumption it is decorative. */
            thresholdUsdc = parseUsdcToMicros(rawThreshold);
            topUpAmountUsdc = parseUsdcToMicros(rawTopUp);
            monthlyLimitUsdc = parseUsdcToMicros(rawMonthlyLimit);
        } catch {
            return NextResponse.json(
                { error: "Threshold, top-up amount, and monthly cap must be USDC amounts." },
                { status: 400 },
            );
        }

        const validation = validateMandate({ thresholdUsdc, topUpAmountUsdc, monthlyLimitUsdc });
        if (!validation.ok) {
            return NextResponse.json({ error: validation.error, code: validation.code }, { status: 400 });
        }

        const normalizedWallet = wallet.toLowerCase();
        const environment = vaultEnvironment();

        /* The mandate attaches to an existing vault. Requiring one means the user has already made
           a deliberate first commit to this merchant (with its own consent gates) — a mandate can
           never be the first money that moves toward a merchant. */
        const vault = await prisma.meteredVault.findFirst({
            where: {
                userAddress: normalizedWallet,
                merchantAddress,
                environment,
                settlementChainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID),
            },
        });
        if (!vault) {
            return NextResponse.json({
                error: "Commit to this merchant before enabling auto top-up.",
                code: "VAULT_NOT_FOUND",
            }, { status: 404 });
        }
        if (vault.disputed) {
            return NextResponse.json({
                error: "This commit is under dispute. Auto top-up can't be enabled until it's resolved.",
                code: "VAULT_DISPUTED",
            }, { status: 409 });
        }

        /* An unverified merchant self-reports the usage that drains the vault, so they control the
           rate at which a mandate refills it. That is a materially larger exposure than the
           one-off commit this gate was written for — hence the same acknowledgment, restated. */
        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: merchantAddress },
            select: { verified: true },
        });
        if (!merchant?.verified && acknowledgeUnverified !== true) {
            return NextResponse.json({
                error: "This merchant is not verified by SubScript.",
                code: "UNVERIFIED_MERCHANT",
                merchantVerified: false,
                warning: "This merchant has not been verified by SubScript. Auto top-up lets them keep drawing on refills made while you are away — they report the usage that triggers each one. Only enable this for merchants you trust and have independently verified. Re-submit with acknowledgeUnverified: true to proceed.",
            }, { status: 409 });
        }

        /* Signs an approve, so the same request-id contract as a commit applies: the client must
           be able to retry an ambiguous response without granting a second allowance. */
        const requestId = request.headers.get("x-request-id")?.trim() || "";
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
            return NextResponse.json({
                error: "A stable x-request-id header is required to enable auto top-up. Reuse the SAME id when retrying.",
                code: "REQUEST_ID_REQUIRED",
            }, { status: 400 });
        }

        /* External wallets cannot be signed for server-side. Fail here rather than accepting a
           mandate that would only reveal itself as inert at the first keeper sweep. */
        try {
            await getWalletCustody(normalizedWallet);
        } catch {
            return NextResponse.json({
                error: "Auto top-up needs a SubScript wallet we can sign with. A connected browser wallet has to approve each top-up itself.",
                code: "EXTERNAL_WALLET_UNSUPPORTED",
            }, { status: 409 });
        }

        try {
            await requireSponsoredGas({
                wallet: normalizedWallet,
                action: "vault_auto_topup",
                requestKey: `auto-topup-approve:${requestId}:${normalizedWallet}:${merchantAddress}:${monthlyLimitUsdc.toString()}`,
            });
        } catch (sponsorError: unknown) {
            if (isSponsoredGasError(sponsorError)) {
                return NextResponse.json({
                    error: sponsorError.message || "Gas sponsorship failed",
                    code: "SPONSORSHIP_FAILED",
                    retryable: sponsorError.kind === "ambiguous",
                }, { status: 503 });
            }
            throw sponsorError;
        }

        /* The ceiling. ensureUsdcAllowance is a no-op when the wallet already approved at least
           this much — re-enabling with an unchanged cap therefore costs no transaction. */
        try {
            await ensureUsdcAllowance(
                await getWalletCustody(normalizedWallet),
                SUBSCRIPT_VAULT_ADDRESS,
                monthlyLimitUsdc,
            );
        } catch (approveError: any) {
            console.error("[vault/auto-topup] allowance approval failed:", approveError);
            return NextResponse.json({
                error: "Could not approve the spending limit on-chain. Nothing was enabled — try again.",
                code: "APPROVAL_FAILED",
            }, { status: 502 });
        }

        const now = new Date();
        /* Arm immediately if the vault is ALREADY below the new threshold. Otherwise a user who
           turns this on precisely because their balance is low would wait for the merchant's next
           usage report to arm it — and an exhausted vault's reports take a path that may never
           come. Evaluating at grant time makes "turn it on and it fixes itself" true. */
        const alreadyLow = isRunningLow({
            balanceUsdc: vault.balanceUsdc,
            accruedUsageUsdc: vault.accruedUsageUsdc,
            thresholdUsdc,
        });

        const updated = await prisma.meteredVault.update({
            where: { id: vault.id },
            data: {
                autoTopUpEnabled: true,
                autoTopUpConsentAt: now,
                autoTopUpAllowanceUsdc: monthlyLimitUsdc,
                thresholdUsdc,
                topUpAmountUsdc,
                monthlyLimitUsdc,
                /* Reset the window on every grant: the cap the user just agreed to is a fresh
                   budget, not one already partly spent under a previous mandate. */
                monthlyWindowStart: nextMonthlyWindow(now),
                monthlySpentUsdc: BigInt(0),
                topUpDueAt: alreadyLow ? now : null,
                autoTopUpFailureCode: null,
                autoTopUpFailedAt: null,
            },
        });

        return NextResponse.json({
            success: true,
            autoTopUp: {
                enabled: updated.autoTopUpEnabled,
                thresholdUsdc: updated.thresholdUsdc.toString(),
                topUpAmountUsdc: updated.topUpAmountUsdc.toString(),
                monthlyLimitUsdc: updated.monthlyLimitUsdc.toString(),
                monthlySpentUsdc: updated.monthlySpentUsdc.toString(),
                allowanceUsdc: updated.autoTopUpAllowanceUsdc.toString(),
                consentAt: updated.autoTopUpConsentAt,
                monthlyWindowStart: updated.monthlyWindowStart,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Auto top-up enable failed:", error);
        return NextResponse.json({ error: error.message || "Failed to enable auto top-up" }, { status: 500 });
    }
}

/* Disable the mandate. `?revokeAllowance=true` additionally sets the on-chain approval to 0.
   Not the default: the allowance is shared with manual commits, so revoking it would make the
   user's next manual top-up pay for a fresh approve. Turning the mandate off already stops every
   unattended commit — the revoke is for users who want the on-chain ceiling gone too. */
export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const url = new URL(request.url);
        const rawMerchant = url.searchParams.get("merchantAddress")?.trim() || "";
        if (!rawMerchant) {
            return NextResponse.json({ error: "merchantAddress is required" }, { status: 400 });
        }
        const merchantAddress = await resolveMerchant(rawMerchant);
        if (!merchantAddress) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const revokeAllowance = url.searchParams.get("revokeAllowance") === "true";

        const normalizedWallet = wallet.toLowerCase();
        const vault = await prisma.meteredVault.findFirst({
            where: {
                userAddress: normalizedWallet,
                merchantAddress,
                environment: vaultEnvironment(),
                settlementChainId: BigInt(SUBSCRIPT_VAULT_CHAIN_ID),
            },
            select: { id: true },
        });
        if (!vault) {
            return NextResponse.json({ error: "Vault not found", code: "VAULT_NOT_FOUND" }, { status: 404 });
        }

        /* Disable FIRST. If the revoke below fails, the mandate is already off and no unattended
           commit can run; doing it the other way round would leave a live mandate behind a failed
           revoke. */
        await prisma.meteredVault.update({
            where: { id: vault.id },
            data: {
                autoTopUpEnabled: false,
                topUpDueAt: null,
                autoTopUpFailureCode: null,
                autoTopUpFailedAt: null,
            },
        });

        let allowanceRevoked = false;
        let revokeError: string | null = null;
        if (revokeAllowance) {
            try {
                await setUsdcAllowance(normalizedWallet, SUBSCRIPT_VAULT_ADDRESS, BigInt(0));
                await prisma.meteredVault.update({
                    where: { id: vault.id },
                    data: { autoTopUpAllowanceUsdc: BigInt(0) },
                });
                allowanceRevoked = true;
            } catch (error: any) {
                console.error("[vault/auto-topup] allowance revoke failed:", error);
                revokeError = "Auto top-up is off, but the on-chain approval could not be revoked. Retry, or revoke it from your wallet.";
            }
        }

        return NextResponse.json({
            success: true,
            autoTopUp: { enabled: false },
            allowanceRevoked,
            ...(revokeError ? { warning: revokeError } : {}),
        }, { status: 200 });
    } catch (error: any) {
        console.error("Auto top-up disable failed:", error);
        return NextResponse.json({ error: error.message || "Failed to disable auto top-up" }, { status: 500 });
    }
}
