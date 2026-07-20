/* User reclaims the full escrow from an abandoned vault: the cycle matured, the keeper
   never settled it within the 7-day grace, and the contract's liveness escape hatch
   (reclaimAbandonedEscrow) is now open. Server-signed from the user's embedded wallet. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { reclaimAbandonedFromEmbedded, syncVaultMirror } from "@/lib/vault/onchain";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import crypto from "crypto";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        assertFinancialNetworkReady();

        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null));
        const { merchantAddress } = body || {};
        if (typeof merchantAddress !== "string" || !ethers.isAddress(merchantAddress)) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }

        /* Reclaim returns the user's own escrow; the contract enforces the maturity + grace
           window and the dispute hold, so no additional server-side gate is needed. */
        await requireSponsoredGas({
            wallet: wallet.toLowerCase(),
            action: "execute_tx",
            requestKey: `vault-reclaim:${wallet.toLowerCase()}:${merchantAddress.toLowerCase()}`,
        });

        const txHash = await reclaimAbandonedFromEmbedded(wallet, merchantAddress);
        const v = await syncVaultMirror(wallet, merchantAddress);

        await recordMerchantEvent({
            merchantAddress: merchantAddress.toLowerCase(),
            environment: "TEST",
            eventType: "vault.reclaimed",
            resourceType: "vault",
            resourceId: `${wallet.toLowerCase()}:${merchantAddress.toLowerCase()}`,
            resourceVersion: 1,
            data: {
                user_address: wallet.toLowerCase(),
                merchant_address: merchantAddress.toLowerCase(),
                vault_balance_usdc_micros: v.balance.toString(),
                tx_hash: txHash,
                active: v.active,
            },
            correlationId: crypto.randomUUID(),
            transitionKey: `vault_reclaim:${txHash.toLowerCase()}`,
        }).catch(err => console.error("[vault/reclaim] webhook dispatch error:", err));

        return NextResponse.json({
            success: true,
            txHash,
            vault: {
                balanceUsdc: v.balance.toString(),
                active: v.active,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Vault reclaim failed:", error);
        const message = String(error?.message || "Failed to reclaim escrow");
        const status = /not abandoned|inactive|disputed|nothing to reclaim/i.test(message) ? 409 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
