import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { fetchArcUsdcDeposits } from "@/lib/deposits/arcDeposits";
import { pgQuery } from "@/lib/serverPg";
import { CCTP_CONFIG } from "@/lib/contracts/constants";
import { processPendingCctpTransfers } from "@/lib/cctp/attestationWorker";
import { sweepAndBridge } from "@/lib/cctp/autoBridge";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const normalizedWallet = wallet.toLowerCase();

        // Proactively run sweep on origin chains / Arc router addresses
        void sweepAndBridge().catch(() => undefined);

        const [directDeposits, cctpTransfers] = await Promise.all([
            fetchArcUsdcDeposits(normalizedWallet).catch(() => []),
            pgQuery<any>(
                `SELECT id, direction, user_wallet, recipient_address, origin_chain_id, origin_domain,
                        destination_chain_id, destination_domain, gross_amount_micros, fee_amount_micros,
                        net_amount_micros, fee_bps, fee_tx_hash, burn_tx_hash, mint_tx_hash, status,
                        attempt_count, error_message, created_at, updated_at
                   FROM cctp_bridge_transfers
                  WHERE user_wallet = $1 OR recipient_address = $1
                  ORDER BY created_at DESC
                  LIMIT 50`,
                [normalizedWallet]
            ).catch(() => []),
        ]);

        const hasPending = cctpTransfers.some(
            (t: any) => t.status === "pending_attestation" || t.status === "minting"
        );
        if (hasPending) {
            void processPendingCctpTransfers().catch(() => undefined);
        }

        const isArcChain = (id: string | number) => id === "arc" || id === "5042002" || id === 5042002 || id === "5042001" || id === 5042001;
        const cctpItems = cctpTransfers.map((tx: any) => {
            const originName = isArcChain(tx.origin_chain_id) ? "Arc Network" : (CCTP_CONFIG[Number(tx.origin_chain_id)]?.name || `Chain ${tx.origin_chain_id}`);
            const destName = isArcChain(tx.destination_chain_id) ? "Arc Network" : (CCTP_CONFIG[Number(tx.destination_chain_id)]?.name || `Chain ${tx.destination_chain_id}`);
            const isIncoming = tx.direction === "inbound_deposit" || tx.recipient_address.toLowerCase() === normalizedWallet;
            const micros = isIncoming ? BigInt(tx.net_amount_micros || 0) : BigInt(tx.gross_amount_micros || 0);
            const whole = micros / 1_000_000n;
            const frac = (micros % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
            const amountFormatted = `${whole.toString()}.${frac}`;

            return {
                id: `cctp-${tx.id}`,
                txHash: tx.burn_tx_hash || tx.mint_tx_hash || tx.id,
                burnTxHash: tx.burn_tx_hash,
                mintTxHash: tx.mint_tx_hash,
                fromAddress: tx.user_wallet,
                toAddress: tx.recipient_address,
                direction: tx.direction,
                originChainId: tx.origin_chain_id,
                destinationChainId: tx.destination_chain_id,
                originName,
                destName,
                amountUsdc: micros.toString(),
                amountFormatted,
                timestamp: new Date(tx.created_at).getTime(),
                status: tx.status,
                isCctp: true,
                senderName: null,
            };
        });

        // Combine and dedup by txHash / mintTxHash / burnTxHash
        const seenTxHashes = new Set<string>();
        for (const item of cctpItems) {
            if (item.txHash) seenTxHashes.add(item.txHash.toLowerCase());
            if (item.mintTxHash) seenTxHashes.add(item.mintTxHash.toLowerCase());
            if (item.burnTxHash) seenTxHashes.add(item.burnTxHash.toLowerCase());
        }

        const uniqueDirect = directDeposits.filter((d) => {
            const h = (d.txHash || "").toLowerCase();
            return !seenTxHashes.has(h);
        });

        const allDeposits = [...cctpItems, ...uniqueDirect].sort((a, b) => b.timestamp - a.timestamp);

        // Dispatch in-app notification and email for newly discovered direct deposits
        const recentDirectIncoming = uniqueDirect.filter(
            (d) => d.incoming && d.timestamp > Date.now() - 3 * 24 * 60 * 60 * 1000
        );
        if (recentDirectIncoming.length > 0) {
            void (async () => {
                try {
                    const { prisma } = await import("@/lib/prisma");
                    for (const d of recentDirectIncoming) {
                        const shortRef = d.txHash ? d.txHash.slice(0, 12) : "";
                        if (!shortRef) continue;

                        const existingNotice = await prisma.accountNotification.findFirst({
                            where: {
                                recipientAddress: normalizedWallet,
                                body: { contains: shortRef },
                            },
                            select: { id: true },
                        });

                        if (!existingNotice) {
                            await prisma.accountNotification.create({
                                data: {
                                    recipientAddress: normalizedWallet,
                                    audience: "USER",
                                    title: "USDC deposit received",
                                    body: `Received ${d.amountFormatted} USDC on Arc Network (ref: ${shortRef}).`,
                                    source: "BRIDGE",
                                },
                            }).catch(() => undefined);

                            const { resolveRecipient, safelySendEmail } = await import("@/lib/email/core");
                            const email = await resolveRecipient(normalizedWallet, "transactional");
                            if (email) {
                                const { sendDepositReceivedEmail } = await import("@/lib/email/transactional");
                                await safelySendEmail("direct deposit email", () => sendDepositReceivedEmail({
                                    recipientEmail: email,
                                    amountUsdc: d.amountFormatted,
                                    originChainName: "Arc Network",
                                    txHash: d.txHash,
                                }));
                            }
                        }
                    }
                } catch (notifyErr) {
                    console.warn("[api/user/deposits] direct deposit notify error:", notifyErr);
                }
            })();
        }

        return NextResponse.json({
            success: true,
            deposits: allDeposits,
            cctpTransfers: cctpItems,
            count: allDeposits.length,
        });
    } catch (error: any) {
        console.error("[api/user/deposits] error:", error);
        return NextResponse.json({ error: error?.message || "Failed to fetch deposits" }, { status: 500 });
    }
}
