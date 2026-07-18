/* A user cancels a metered (commit-vault) service.
 *
 * This is a user-initiated STOP signal, not an on-chain action — the escrow can't leave the
 * vault until lockedUntil elapses (the contract's cycle lock), exactly as designed. What this
 * route does:
 *   1. Records cancel_requested_at on the vault. From that moment report-usage refuses to
 *      accrue further usage, so the keeper's end-of-cycle draw is frozen to the pre-cancel
 *      total — the merchant is settled only for service already rendered (pay-after-service).
 *   2. Notifies the merchant (in-app DM + webhook) to stop rendering service and stop billing.
 *      Honoring the stop-service request is the merchant's responsibility; the protocol can't
 *      force a merchant to cut off access, so this is a signal, not enforcement.
 *   3. Tells the user when their unused escrow unlocks (lockedUntil) so they can withdraw.
 *
 * Cancellation is cleared automatically if the user later re-commits (see vault/commit).
 */
import { after, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { prisma } from "@/lib/prisma";
import { withPgClient } from "@/lib/serverPg";
import { insertPgDm, pushDmNotification } from "@/lib/dms/notifications";
import { dispatchMerchantWebhook } from "@/lib/webhookDispatch";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const { merchantAddress, reason } = body;
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }
        const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;

        const user = wallet.toLowerCase();
        const merchant = merchantAddress.toLowerCase();

        const vault = await prisma.meteredVault.findUnique({
            where: {
                userAddress_merchantAddress_environment_settlementChainId: {
                    userAddress: user,
                    merchantAddress: merchant,
                    environment: "TEST",
                    settlementChainId: BigInt(ARC_TESTNET_CHAIN_ID),
                },
            },
            select: { id: true, active: true, lockedUntil: true, cancelRequestedAt: true, balanceUsdc: true },
        });
        if (!vault) {
            return NextResponse.json(
                { error: "You don't have a metered vault with this merchant." },
                { status: 404 },
            );
        }

        const lockedUntil = vault.lockedUntil ? vault.lockedUntil.toISOString() : null;

        /* Idempotent: a second cancel just returns the existing state — never re-notifies the
           merchant or resets the cancellation timestamp. */
        if (vault.cancelRequestedAt) {
            return NextResponse.json({
                success: true,
                alreadyCancelled: true,
                cancelRequestedAt: vault.cancelRequestedAt.toISOString(),
                lockedUntil,
                withdrawableAfter: lockedUntil,
                active: vault.active,
            }, { status: 200 });
        }

        const cancelledAt = new Date();
        await prisma.meteredVault.update({
            where: { id: vault.id },
            data: { cancelRequestedAt: cancelledAt, cancelReason: cleanReason },
        });

        /* Two in-app notifications: the merchant is told to stop rendering + billing, and the
           user's own thread gets a SERVICE_PAUSED card (rendered as a pause banner with
           Resume / Top-up actions in the DM view). */
        let dmNotification: Awaited<ReturnType<typeof insertPgDm>> | null = null;
        try {
            dmNotification = await withPgClient(async (client) => {
                const merchantDm = await insertPgDm(client, {
                    sender_address: user,
                    receiver_address: merchant,
                    message_type: "SERVICE_CANCELED",
                    status: "PENDING",
                    amount_usdc: null,
                    title: "Customer paused the service",
                    description:
                        "This customer has paused your metered service. Stop rendering service and stop reporting new usage — further usage reports will be rejected. You'll be settled for usage already reported this cycle.",
                });
                await insertPgDm(client, {
                    sender_address: merchant,
                    receiver_address: user,
                    message_type: "SERVICE_PAUSED",
                    status: "PENDING",
                    amount_usdc: null,
                    title: "Service plan paused",
                    description:
                        "You paused payments for this merchant's service, so you can't use it while paused. Resume anytime, or top up your commit if it's below the platform minimum.",
                });
                return merchantDm;
            });
        } catch (dmError) {
            /* Notification is best-effort; the cancellation itself already persisted. */
            console.error("cancel-service DM insert failed:", dmError);
        }

        after(async () => {
            if (dmNotification) {
                await pushDmNotification(dmNotification).catch(() => { /* best-effort */ });
            }
            await dispatchMerchantWebhook(merchant, "vault.service_canceled", {
                userAddress: user,
                merchantAddress: merchant,
                vaultId: vault.id,
                cancelRequestedAt: cancelledAt.toISOString(),
                reason: cleanReason,
                message: "Customer cancelled the metered service. Stop rendering service; new usage reports will be rejected.",
            });
        });

        return NextResponse.json({
            success: true,
            cancelRequestedAt: cancelledAt.toISOString(),
            lockedUntil,
            withdrawableAfter: lockedUntil,
            active: vault.active,
        }, { status: 200 });
    } catch (err: any) {
        console.error("Vault cancel-service error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
