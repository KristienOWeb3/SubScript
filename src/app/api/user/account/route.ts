import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie } from "@/lib/authCookies";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { ethers } from "ethers";
import crypto from "crypto";

const STANDARD_ABI = [
    "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
];

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

        // Transition 1: Set state to CLOSURE_REQUESTED
        await prisma.$executeRaw`
            UPDATE customers SET closure_status = 'CLOSURE_REQUESTED' WHERE wallet_address = ${normalized}
        `;

        /* Guard 1: active subscriptions keep billing authorizations alive — deleting the
           profile under them would leave charges the user can no longer see or cancel. */
        const activeSubscriptions = await prisma.subscription.count({
            where: {
                subscriber: normalized,
                OR: [
                    { status: { in: ["ACTIVE", "PAST_DUE"] } },
                    { cancelAtPeriodEnd: true },
                    { revocationPending: true },
                ],
            },
        });

        // Guard 2: check for pending or unresolved custody operations/attempts
        const pendingAttempts = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT COUNT(*)::bigint AS n FROM subscription_attempts
            WHERE subscriber_address = ${normalized}
              AND status IN ('PREPARED', 'SUBMISSION_STARTED', 'SUBMISSION_UNKNOWN', 'CHAIN_CONFIRMED')
        `;
        const hasPendingAttempts = pendingAttempts && pendingAttempts[0] && Number(pendingAttempts[0].n) > 0;

        if (activeSubscriptions > 0 || hasPendingAttempts) {
            await prisma.$executeRaw`
                UPDATE customers SET closure_status = 'CLOSURE_FAILED' WHERE wallet_address = ${normalized}
            `;
            return NextResponse.json({
                error: `You still have ${activeSubscriptions} active subscriptions or pending operations. Cancel them first, then delete your account.`,
                code: "ACTIVE_OPERATIONS",
            }, { status: 409 });
        }

        /* Guard 3: escrowed vault money (committed or owed) must be settled/withdrawn first. */
        const vaults = await prisma.meteredVault.findMany({
            where: { userAddress: normalized },
            select: { balanceUsdc: true, commitUsdc: true, owedUsdc: true },
        });
        const escrowed = vaults.reduce(
            (sum, v) => sum + v.balanceUsdc + v.commitUsdc + v.owedUsdc,
            BigInt(0),
        );
        if (escrowed > BigInt(0)) {
            await prisma.$executeRaw`
                UPDATE customers SET closure_status = 'CLOSURE_FAILED' WHERE wallet_address = ${normalized}
            `;
            return NextResponse.json({
                error: "You still have funds committed to merchant vaults (or an outstanding owed balance). Withdraw or settle them first, then delete your account.",
                code: "VAULT_FUNDS_PRESENT",
            }, { status: 409 });
        }

        // Transition 2: Set state to REVOCATION_IN_PROGRESS
        await prisma.$executeRaw`
            UPDATE customers SET closure_status = 'REVOCATION_IN_PROGRESS' WHERE wallet_address = ${normalized}
        `;

        // Guard 4: verify that ALL on-chain subscriptions are inactive
        const subs = await prisma.subscription.findMany({
            where: { subscriber: normalized }
        });

        let activeOnChainCount = 0;
        for (const sub of subs) {
            try {
                const { result: onChain } = await executeWithRpcFallback(async (provider) => {
                    const contract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, STANDARD_ABI, provider);
                    return await contract.subscriptions(Number(sub.subscriptionId));
                });
                const isActiveOnChain = Boolean(onChain[5]);
                if (isActiveOnChain) {
                    activeOnChainCount++;
                }
            } catch (err) {
                console.error(`Failed to verify subscription ${sub.subscriptionId} on-chain:`, err);
                activeOnChainCount++; // Fail closed
            }
        }

        if (activeOnChainCount > 0) {
            await prisma.$executeRaw`
                UPDATE customers SET closure_status = 'CLOSURE_FAILED' WHERE wallet_address = ${normalized}
            `;
            return NextResponse.json({
                error: "You still have active on-chain subscription authorizations. Revoke them first, then delete your account.",
                code: "ONCHAIN_REVOCATION_REQUIRED",
            }, { status: 409 });
        }

        // Transition 3: Set state to READY_TO_ANONYMIZE
        await prisma.$executeRaw`
            UPDATE customers SET closure_status = 'READY_TO_ANONYMIZE' WHERE wallet_address = ${normalized}
        `;

        /* Profile erasure. Receipts/ledger rows are retained (they are the counterparty's
           records too); everything identifying the profile goes. */
        const anonymousAlias = `anonymous-${crypto.randomUUID()}`;
        await prisma.$transaction([
            prisma.session.deleteMany({ where: { wallet: normalized } }),
            prisma.addressAlias.deleteMany({ where: { address: normalized } }),
            prisma.customer.updateMany({
                where: { walletAddress: normalized },
                data: {
                    email: "",
                    alias: anonymousAlias,
                }
            }),
            prisma.accountRole.deleteMany({ where: { address: normalized } }),
        ]);

        // Transition 4: Set state to CLOSED
        await prisma.$executeRaw`
            UPDATE customers SET closure_status = 'CLOSED' WHERE wallet_address = ${normalized}
        `;

        // Anonymize key table references to prevent silent email-based reactivation
        const deletedIdPlaceholder = `deleted-${crypto.randomUUID()}`;
        await prisma.$executeRaw`
            UPDATE user_embedded_wallets 
            SET email = ${deletedIdPlaceholder}, updated_at = now() 
            WHERE wallet_address = ${normalized}
        `;
        await prisma.$executeRaw`
            UPDATE auth_identities 
            SET disabled_at = now(), current_email = ${deletedIdPlaceholder} 
            WHERE wallet_address = ${normalized}
        `;

        await prisma.auditEvent.create({
            data: {
                actor: normalized,
                action: "ACCOUNT_DELETED",
                resourceType: "ACCOUNT",
                resourceId: normalized,
                metadata: { initiatedBy: "user" },
            },
        }).catch(() => { /* audit best-effort */ });

        const response = NextResponse.json({
            success: true,
            message: "Your account has been deleted and you have been signed out everywhere.",
        });
        clearSessionCookie(response, request);
        return response;
    } catch (error: any) {
        console.error("Account deactivation/deletion failed:", error);
        return NextResponse.json({ error: "Account deletion failed. Nothing was removed — please try again or contact support." }, { status: 500 });
    }
}
