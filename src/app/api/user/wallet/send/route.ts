import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { getWalletCustody, deterministicIdempotencyKey } from "@/lib/custody";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { withPgClient } from "@/lib/serverPg";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";

export const maxDuration = 120;

type SendRecipient = {
    receiverAddress: string;
    amountUsdc: unknown;
};

type EmbeddedWalletRecord = {
    encrypted_private_key: string | null;
    circle_wallet_id: string | null;
    provider: string | null;
};

function formatAmount(amountMicros: bigint) {
    const microsPerUsdc = BigInt(1_000_000);
    const whole = amountMicros / microsPerUsdc;
    const fraction = (amountMicros % microsPerUsdc).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

function normalizeRecipients(body: any): SendRecipient[] {
    if (Array.isArray(body?.recipients)) {
        return body.recipients.map((item: any) => ({
            receiverAddress: item?.receiverAddress || item?.address,
            amountUsdc: item?.amountUsdc || item?.amount,
        }));
    }

    return [{
        receiverAddress: body?.receiverAddress,
        amountUsdc: body?.amountUsdc,
    }];
}

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

        const body = sanitizeInput(await request.json().catch(() => null));
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const requestId = request.headers.get("x-request-id") || crypto.randomUUID();

        const normalizedSender = wallet.toLowerCase();
        const recipients = normalizeRecipients(body);
        if (recipients.length === 0 || recipients.length > 25) {
            return NextResponse.json({ error: "Provide between 1 and 25 recipients" }, { status: 400 });
        }

        const parsedRecipients = recipients.map((item, index) => {
            if (!item.receiverAddress || !ethers.isAddress(item.receiverAddress)) {
                throw new Error(`Recipient ${index + 1} has an invalid address`);
            }
            const receiver = item.receiverAddress.toLowerCase();
            if (receiver === normalizedSender) {
                throw new Error("You cannot send USDC to your own connected wallet.");
            }
            const amountMicros = parseUsdcToMicros(item.amountUsdc);
            if (amountMicros <= BigInt(0)) {
                throw new Error(`Recipient ${index + 1} has an invalid amount`);
            }
            return {
                receiver,
                amountMicros,
            };
        });

        // Spending limit enforcement (Finding 54)
        const spendingCustomer = await prisma.customer.findFirst({
            where: { walletAddress: normalizedSender },
            select: { spendingLimitDaily: true, spendingLimitWeekly: true, spendingLimitMonthly: true },
        });
        if (spendingCustomer) {
            const totalAmount = parsedRecipients.reduce(
                (sum, r) => sum + r.amountMicros, BigInt(0)
            );
            if (spendingCustomer.spendingLimitDaily !== null && totalAmount > spendingCustomer.spendingLimitDaily) {
                return NextResponse.json({
                    error: "Transfer exceeds your daily spending limit.",
                    code: "SPENDING_LIMIT_EXCEEDED"
                }, { status: 403 });
            }
            if (spendingCustomer.spendingLimitWeekly !== null && totalAmount > spendingCustomer.spendingLimitWeekly) {
                return NextResponse.json({
                    error: "Transfer exceeds your weekly spending limit.",
                    code: "SPENDING_LIMIT_EXCEEDED"
                }, { status: 403 });
            }
            if (spendingCustomer.spendingLimitMonthly !== null && totalAmount > spendingCustomer.spendingLimitMonthly) {
                return NextResponse.json({
                    error: "Transfer exceeds your monthly spending limit.",
                    code: "SPENDING_LIMIT_EXCEEDED"
                }, { status: 403 });
            }
        }

        const walletRecord = await withPgClient(async (client) => {
            const result = await client.query(
                `select encrypted_private_key, circle_wallet_id, provider
                   from user_embedded_wallets
                  where wallet_address = $1
                  limit 1`,
                [normalizedSender]
            );
            return result.rows[0] as EmbeddedWalletRecord | undefined;
        });

        if (!walletRecord?.encrypted_private_key && !walletRecord?.circle_wallet_id) {
            return NextResponse.json({
                error: "This action needs a browser wallet signature. Generated email wallets can send from here only when their server-held key exists.",
            }, { status: 409 });
        }

        // Execution goes through the custody provider (legacy AES key or Circle MPC), which
        // waits for each transfer to confirm and throws on revert.
        const custody = await getWalletCustody(normalizedSender);
        const txs: { receiverAddress: string; amountUsdc: string; txHash: string }[] = [];

        /* Transfers move funds, so each recipient gets a deterministic Circle idempotency key
           scoped to (request, recipient, amount). A client that reuses its x-request-id on
           retry dedupes at Circle instead of paying the same recipient twice. The index is
           intentionally excluded so that partial-batch retries (where indices shift) still
           dedupe correctly for already-settled recipients. */

        /* Transfers settle one-by-one and are irreversible once mined. If a later one fails we must
           NOT report a blanket failure — that hides the transfers already sent and invites a retry
           that double-pays them. Stop at the first failure and return exactly what settled. */
        let failure: { index: number; receiverAddress: string; amountUsdc: string; error: string } | null = null;
        for (let i = 0; i < parsedRecipients.length; i++) {
            const item = parsedRecipients[i];
            try {
                const { txHash } = await custody.executeContract({
                    contractAddress: USDC_NATIVE_GAS_ADDRESS,
                    abi: USDC_ERC20_ABI,
                    functionName: "transfer",
                    args: [item.receiver, item.amountMicros],
                    idempotencyKey: deterministicIdempotencyKey(
                        `wallet-send:${normalizedSender}:${requestId}:${item.receiver}:${item.amountMicros.toString()}`
                    ),
                });
                txs.push({
                    receiverAddress: item.receiver,
                    amountUsdc: formatAmount(item.amountMicros),
                    txHash,
                });
            } catch (err: any) {
                failure = {
                    index: i,
                    receiverAddress: item.receiver,
                    amountUsdc: formatAmount(item.amountMicros),
                    error: err?.message || "Transfer failed",
                };
                break;
            }
        }

        if (failure) {
            const sent = txs.length;
            const total = parsedRecipients.length;
            return NextResponse.json({
                success: false,
                partial: sent > 0,
                transfers: txs,
                failedRecipient: failure,
                error: sent > 0
                    ? `Sent ${sent} of ${total} transfers, then recipient ${failure.index + 1} failed: ${failure.error}. The ${sent} completed transfer(s) were already settled on-chain — do not resend them; retry only the remaining recipients.`
                    : `Transfer to recipient ${failure.index + 1} failed: ${failure.error}`,
            }, { status: sent > 0 ? 207 : 400 });
        }

        return NextResponse.json({
            success: true,
            transfers: txs,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Embedded wallet send failed:", error);
        return NextResponse.json({ error: error.message || "Failed to send USDC" }, { status: 500 });
    }
}
