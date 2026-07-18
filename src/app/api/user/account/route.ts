/* Delete the signed-in user's SubScript account (profile-level deletion).
 *
 * SubScript wallets are custodial, so deletion never destroys key material or the
 * financial ledger (receipts, on-chain history stay for both sides of every payment).
 * What it does: refuses while money is still moving (active subscriptions, escrowed
 * vault funds), then erases the profile — alias, PII, notification prefs, DM threads'
 * personal linkage stays untouched — revokes every session, and removes the account
 * role so the address is no longer a SubScript user. Signing in again with the same
 * email re-onboards fresh and restores access to any remaining wallet funds.
 */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie } from "@/lib/authCookies";

export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const normalized = wallet.toLowerCase();

        const roleCheck = await requireAccountRole(normalized, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({
                error: "Only user accounts can be deleted here. Merchant accounts must contact support@subscriptonarc.com so customer obligations can be wound down safely.",
            }, { status: 403 });
        }

        /* Guard 1: active subscriptions keep billing authorizations alive — deleting the
           profile under them would leave charges the user can no longer see or cancel. */
        const activeSubscriptions = await prisma.subscription.count({
            where: { subscriber: normalized, status: "ACTIVE" },
        });
        if (activeSubscriptions > 0) {
            return NextResponse.json({
                error: `You still have ${activeSubscriptions} active subscription${activeSubscriptions === 1 ? "" : "s"}. Cancel them first, then delete your account.`,
                code: "ACTIVE_SUBSCRIPTIONS",
            }, { status: 409 });
        }

        /* Guard 2: escrowed vault money (committed or owed) must be settled/withdrawn first. */
        const vaults = await prisma.meteredVault.findMany({
            where: { userAddress: normalized },
            select: { balanceUsdc: true, commitUsdc: true, owedUsdc: true },
        });
        const escrowed = vaults.reduce(
            (sum, v) => sum + v.balanceUsdc + v.commitUsdc + v.owedUsdc,
            BigInt(0),
        );
        if (escrowed > BigInt(0)) {
            return NextResponse.json({
                error: "You still have funds committed to merchant vaults (or an outstanding owed balance). Withdraw or settle them first, then delete your account.",
                code: "VAULT_FUNDS_PRESENT",
            }, { status: 409 });
        }

        /* Profile erasure. Receipts/ledger rows are retained (they are the counterparty's
           records too); everything identifying the profile goes. Customer delete cascades
           the zero-balance vault rows. */
        await prisma.$transaction([
            prisma.session.deleteMany({ where: { wallet: normalized } }),
            prisma.addressAlias.deleteMany({ where: { address: normalized } }),
            prisma.customer.deleteMany({ where: { walletAddress: normalized } }),
            prisma.accountRole.deleteMany({ where: { address: normalized } }),
        ]);

        await prisma.auditEvent.create({
            data: {
                actor: normalized,
                action: "ACCOUNT_DELETED",
                resourceType: "ACCOUNT",
                resourceId: normalized,
                metadata: { initiatedBy: "user" },
            },
        }).catch(() => { /* audit best-effort; deletion already committed */ });

        const response = NextResponse.json({
            success: true,
            message: "Your account has been deleted and you have been signed out everywhere.",
        });
        clearSessionCookie(response, request);
        return response;
    } catch (error: any) {
        console.error("Account deletion failed:", error);
        return NextResponse.json({ error: "Account deletion failed. Nothing was removed — please try again or contact support." }, { status: 500 });
    }
}
