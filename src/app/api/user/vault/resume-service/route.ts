/* A user resumes a paused (cancel-requested) metered service.
 *
 * Resume is only allowed while the escrowed commit still meets the platform minimum
 * (STANDARD_COMMIT = 2 USDC): the pause froze usage accrual, so the merchant needs a
 * fundable balance to bill against before service restarts. If the balance is below the
 * minimum, the response says so (402 TOP_UP_REQUIRED) and the client routes the user to
 * a top-up commit instead — vault/commit clears the pause flag itself after a deposit.
 *
 * On success: the pause flag clears (report-usage accepts usage again), the user's
 * SERVICE_PAUSED card is dismissed, and the merchant is notified to resume service
 * (in-app DM + vault.service_resumed webhook).
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

/* Platform-fixed standard commitment (2 USDC in micro-USDC), mirroring the vault contract. */
const STANDARD_COMMIT_MICROS = BigInt(2_000_000);

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
        const { merchantAddress } = body;
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }

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
            select: { id: true, active: true, balanceUsdc: true, cancelRequestedAt: true },
        });
        if (!vault) {
            return NextResponse.json(
                { error: "You don't have a metered vault with this merchant." },
                { status: 404 },
            );
        }

        /* Idempotent: resuming a service that isn't paused is a no-op success. */
        if (!vault.cancelRequestedAt) {
            return NextResponse.json({ success: true, alreadyActive: true }, { status: 200 });
        }

        const balance = BigInt(vault.balanceUsdc.toString());
        if (!vault.active || balance < STANDARD_COMMIT_MICROS) {
            return NextResponse.json({
                error: "Your committed balance is below the platform minimum. Top up to at least 2 USDC to resume this service.",
                code: "TOP_UP_REQUIRED",
                balanceUsdc: balance.toString(),
                requiredUsdc: STANDARD_COMMIT_MICROS.toString(),
            }, { status: 402 });
        }

        await prisma.meteredVault.update({
            where: { id: vault.id },
            data: { cancelRequestedAt: null, cancelReason: null },
        });

        /* The pause card in the user's thread is resolved; the merchant learns service is back on. */
        let dmNotification: Awaited<ReturnType<typeof insertPgDm>> | null = null;
        try {
            dmNotification = await withPgClient(async (client) => {
                await client.query(
                    `update subscript_dms
                        set status = 'DISMISSED'
                      where sender_address = $1
                        and receiver_address = $2
                        and message_type = 'SERVICE_PAUSED'
                        and status = 'PENDING'`,
                    [merchant, user],
                );
                return insertPgDm(client, {
                    sender_address: user,
                    receiver_address: merchant,
                    message_type: "SERVICE_RESUMED",
                    status: "PENDING",
                    amount_usdc: null,
                    title: "Customer resumed the service",
                    description:
                        "This customer has resumed your metered service. You can render service and report usage against their committed balance again.",
                });
            });
        } catch (dmError) {
            /* Notification is best-effort; the resume itself already persisted. */
            console.error("resume-service DM update failed:", dmError);
        }

        after(async () => {
            if (dmNotification) {
                await pushDmNotification(dmNotification).catch(() => { /* best-effort */ });
            }
            await dispatchMerchantWebhook(merchant, "vault.service_resumed", {
                userAddress: user,
                merchantAddress: merchant,
                vaultId: vault.id,
                message: "Customer resumed the metered service. Usage reporting is accepted again.",
            });
        });

        return NextResponse.json({ success: true, balanceUsdc: balance.toString() }, { status: 200 });
    } catch (err: any) {
        console.error("Vault resume-service error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
