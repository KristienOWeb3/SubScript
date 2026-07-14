/* API route to load and update system-automated DMs for the authenticated user */
import { NextResponse } from "next/server";
import { accountDisplayName, merchantDisplayName } from "@/lib/identityDisplay";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { getAccountRole, requireAccountRole } from "@/lib/accounts/roles";
import { parseUsdcToMicros } from "@/lib/dms/system";
import { createDmAndNotify } from "@/lib/dms/notifications";
import { sendSubscriptionCancellationReasonEmail } from "@/lib/email/transactional";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

export const maxDuration = 60;

const USDC_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)").toLowerCase();

/* Confirm a transfer DM corresponds to a real on-chain USDC transfer from `from` to
   `to` for at least `amountMicros`. Prevents spoofed "I sent you X" records. */
async function verifyUsdcTransferOnChain(txHash: string, from: string, to: string, amountMicros: bigint): Promise<boolean> {
    try {
        const url = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const provider = new ethers.JsonRpcProvider(url);
        /* Wait briefly for confirmation — the browser-wallet path submits without waiting. */
        const receipt = await provider.waitForTransaction(txHash, 1, 30_000);
        if (!receipt || receipt.status !== 1) return false;
        const fromTopic = ethers.zeroPadValue(from, 32).toLowerCase();
        const toTopic = ethers.zeroPadValue(to, 32).toLowerCase();
        const usdc = USDC_NATIVE_GAS_ADDRESS.toLowerCase();
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== usdc) continue;
            if ((log.topics[0] || "").toLowerCase() !== USDC_TRANSFER_TOPIC) continue;
            if ((log.topics[1] || "").toLowerCase() !== fromTopic) continue;
            if ((log.topics[2] || "").toLowerCase() !== toTopic) continue;
            if (BigInt(log.data) >= amountMicros) return true;
        }
        return false;
    } catch {
        return false;
    }
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const dms = await prisma.subscriptDm.findMany({
            where: {
                OR: [
                    { receiverAddress: wallet.toLowerCase() },
                    { senderAddress: wallet.toLowerCase() }
                ]
            },
            orderBy: {
                createdAt: "desc"
            },
            /* Cap the working set so the inbox can't load an unbounded history into memory. */
            take: 500
        });

        /* Collect unique addresses to fetch aliases and profile pics */
        const uniqueAddresses = new Set<string>();
        dms.forEach((d: any) => {
            uniqueAddresses.add(d.senderAddress.toLowerCase());
            uniqueAddresses.add(d.receiverAddress.toLowerCase());
        });

        const aliases = await prisma.addressAlias.findMany({
            where: {
                address: { in: Array.from(uniqueAddresses) }
            }
        });

        const customers = await prisma.customer.findMany({
            where: { walletAddress: { in: Array.from(uniqueAddresses) } },
            select: { walletAddress: true, profilePic: true }
        });

        const merchants = await prisma.merchant.findMany({
            where: { walletAddress: { in: Array.from(uniqueAddresses) } },
            select: { walletAddress: true, profilePic: true }
        });
        const roles = await prisma.accountRole.findMany({
            where: { address: { in: Array.from(uniqueAddresses) } },
            select: { address: true, role: true }
        });

        const aliasMap = new Map(aliases.map((a: any) => [a.address.toLowerCase(), a.alias]));
        const roleMap = new Map(roles.map((r: any) => [r.address.toLowerCase(), r.role]));
        const profilePicMap = new Map<string, string | null>();
        customers.forEach((c: any) => profilePicMap.set(c.walletAddress.toLowerCase(), c.profilePic));
        merchants.forEach((m: any) => profilePicMap.set(m.walletAddress.toLowerCase(), m.profilePic));

        const formatted = dms.map((dm: any) => ({
            id: dm.id,
            senderAddress: dm.senderAddress,
            senderName: roleMap.get(dm.senderAddress.toLowerCase()) === "ENTERPRISE"
                ? merchantDisplayName(aliasMap.get(dm.senderAddress.toLowerCase()))
                : accountDisplayName(aliasMap.get(dm.senderAddress.toLowerCase())),
            senderRole: roleMap.get(dm.senderAddress.toLowerCase()) || null,
            senderProfilePic: profilePicMap.get(dm.senderAddress.toLowerCase()) || null,
            receiverAddress: dm.receiverAddress,
            receiverName: roleMap.get(dm.receiverAddress.toLowerCase()) === "ENTERPRISE"
                ? merchantDisplayName(aliasMap.get(dm.receiverAddress.toLowerCase()))
                : accountDisplayName(aliasMap.get(dm.receiverAddress.toLowerCase())),
            receiverRole: roleMap.get(dm.receiverAddress.toLowerCase()) || null,
            receiverProfilePic: profilePicMap.get(dm.receiverAddress.toLowerCase()) || null,
            messageType: dm.messageType,
            status: dm.status,
            amountUsdc: dm.amountUsdc ? dm.amountUsdc.toString() : null,
            title: dm.title,
            description: dm.description,
            txHash: dm.txHash,
            paymentLinkId: dm.paymentLinkId,
            createdAt: dm.createdAt
        }));

        return NextResponse.json({ success: true, dms: formatted }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to load DMs:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
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

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { action } = sanitizedBody;

        if (action === "log-transfer") {
            const { receiverAddress, amountUsdc, txHash, title, description } = sanitizedBody;
            if (typeof receiverAddress !== "string" || !receiverAddress.startsWith("0x") || receiverAddress.length !== 42) {
                return NextResponse.json({ error: "Invalid receiver address" }, { status: 400 });
            }
            const normalizedWallet = wallet.toLowerCase();
            const normalizedReceiver = receiverAddress.toLowerCase();
            if (normalizedReceiver === normalizedWallet) {
                return NextResponse.json({ error: "You cannot send USDC to your own connected wallet." }, { status: 400 });
            }
            const receiverRole = await getAccountRole(normalizedReceiver);
            if (receiverRole !== "USER") {
                return NextResponse.json({ error: "Users cannot start or append peer-transfer DMs with merchant wallets." }, { status: 403 });
            }
            const existingThread = await prisma.subscriptDm.findFirst({
                where: {
                    OR: [
                        { senderAddress: normalizedWallet, receiverAddress: normalizedReceiver },
                        { senderAddress: normalizedReceiver, receiverAddress: normalizedWallet },
                    ],
                },
                select: { id: true },
            });
            if (!existingThread) {
                return NextResponse.json({ error: "A DM thread must already exist before logging a peer transfer." }, { status: 403 });
            }
            if (!amountUsdc || isNaN(Number(amountUsdc)) || Number(amountUsdc) <= 0) {
                return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
            }
            if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
                return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
            }

            const amountMicros = parseUsdcToMicros(amountUsdc);

            /* Each on-chain transfer backs at most one DM (block replaying one tx). */
            const existingForTx = await prisma.subscriptDm.findFirst({
                where: { txHash },
                select: { id: true },
            });
            if (existingForTx) {
                return NextResponse.json({ error: "This transaction has already been recorded." }, { status: 409 });
            }

            /* The transfer must be a real, confirmed USDC transfer from the sender to the
               receiver for at least the stated amount — otherwise it's a spoofed record. */
            const verified = await verifyUsdcTransferOnChain(txHash, normalizedWallet, normalizedReceiver, amountMicros);
            if (!verified) {
                return NextResponse.json(
                    { error: "Could not verify this USDC transfer on-chain. Sender, recipient, and amount must match a confirmed transfer." },
                    { status: 400 }
                );
            }

            await prisma.customer.upsert({
                where: { walletAddress: normalizedWallet },
                update: {},
                create: { walletAddress: normalizedWallet },
            });
            await prisma.customer.upsert({
                where: { walletAddress: normalizedReceiver },
                update: {},
                create: { walletAddress: normalizedReceiver },
            });

            const dm = await createDmAndNotify({
                senderAddress: normalizedWallet,
                receiverAddress: normalizedReceiver,
                messageType: "PEER_TRANSFER",
                status: "APPROVED",
                amountUsdc: amountMicros,
                txHash,
                title: title || `${amountUsdc} USDC Sent`,
                description: description || `Direct transfer of ${amountUsdc} USDC on-chain.`,
            });

            return NextResponse.json({ success: true, dmId: dm.id }, { status: 201 });
        }

        if (action === "log-reaction") {
            /* Lightweight in-thread acknowledgement (e.g. "Thanks", "Nudge").
               Reactions carry no amount and no on-chain hash, so they never render
               a transfer amount or an explorer link. */
            const { receiverAddress, title, description } = sanitizedBody;
            if (typeof receiverAddress !== "string" || !receiverAddress.startsWith("0x") || receiverAddress.length !== 42) {
                return NextResponse.json({ error: "Invalid receiver address" }, { status: 400 });
            }
            const normalizedWallet = wallet.toLowerCase();
            const normalizedReceiver = receiverAddress.toLowerCase();
            if (normalizedReceiver === normalizedWallet) {
                return NextResponse.json({ error: "You cannot send a reaction to your own wallet." }, { status: 400 });
            }
            const receiverRole = await getAccountRole(normalizedReceiver);
            if (receiverRole !== "USER") {
                return NextResponse.json({ error: "Reactions can only be sent inside peer-to-peer user threads." }, { status: 403 });
            }
            const existingThread = await prisma.subscriptDm.findFirst({
                where: {
                    OR: [
                        { senderAddress: normalizedWallet, receiverAddress: normalizedReceiver },
                        { senderAddress: normalizedReceiver, receiverAddress: normalizedWallet },
                    ],
                },
                select: { id: true },
            });
            if (!existingThread) {
                return NextResponse.json({ error: "A DM thread must already exist before sending a reaction." }, { status: 403 });
            }

            /* Anti-spam: a sender can nudge/react to a given peer at most once per hour.
               Reactions now also notify registered devices, so this protects both the
               recipient's inbox and their device notification surface. */
            const REACTION_WINDOW_MS = 60 * 60 * 1000;
            const recentReaction = await prisma.subscriptDm.findFirst({
                where: {
                    senderAddress: normalizedWallet,
                    receiverAddress: normalizedReceiver,
                    messageType: "PEER_REACTION",
                    createdAt: { gt: new Date(Date.now() - REACTION_WINDOW_MS) },
                },
                orderBy: { createdAt: "desc" },
                select: { createdAt: true },
            });
            if (recentReaction) {
                const minutesLeft = Math.max(
                    1,
                    Math.ceil((recentReaction.createdAt.getTime() + REACTION_WINDOW_MS - Date.now()) / 60000)
                );
                return NextResponse.json(
                    { error: `You can only nudge or react once an hour in a thread. Try again in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.` },
                    { status: 429 }
                );
            }

            const dm = await createDmAndNotify({
                senderAddress: normalizedWallet,
                receiverAddress: normalizedReceiver,
                messageType: "PEER_REACTION",
                status: "APPROVED",
                amountUsdc: null,
                txHash: null,
                title: typeof title === "string" && title.trim() ? title.trim().slice(0, 80) : "Reaction",
                description: typeof description === "string" ? description.trim().slice(0, 280) : null,
            });

            return NextResponse.json({ success: true, dmId: dm.id }, { status: 201 });
        }

        const { dmId, status } = sanitizedBody;

        if (typeof dmId !== "string" || !status) {
            return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
        }

        const validStatuses = ["PENDING", "APPROVED", "DECLINED", "DISMISSED", "TOO_EXPENSIVE", "LACK_OF_FEATURES", "TECHNICAL_ISSUES", "OTHER"];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }

        /* Verify the DM exists and belongs to the user. Mutating actions are receiver-only. */
        const existingDm = await prisma.subscriptDm.findUnique({
            where: { id: dmId }
        });

        if (!existingDm) {
            return NextResponse.json({ error: "DM not found" }, { status: 404 });
        }

        const normalizedWallet = wallet.toLowerCase();
        const isReceiver = existingDm.receiverAddress.toLowerCase() === normalizedWallet;
        const isSender = existingDm.senderAddress.toLowerCase() === normalizedWallet;

        if (!isReceiver && !isSender) {
            return NextResponse.json({ error: "Unauthorized access to DM" }, { status: 403 });
        }
        if (!isReceiver) {
            return NextResponse.json({ error: "Only the receiving account can confirm, decline, or dismiss this system DM" }, { status: 403 });
        }
        if (existingDm.status !== "PENDING") {
            return NextResponse.json({ error: "This DM has already been handled" }, { status: 409 });
        }
        if (status === "PENDING") {
            return NextResponse.json({ error: "Cannot reset a system DM to pending" }, { status: 400 });
        }

        const updatedDm = await prisma.subscriptDm.update({
            where: { id: dmId },
            data: { status }
        });

        /* Exit-survey reason → email the merchant (only if a real reason was chosen).
           "Prefer not to answer" submits DISMISSED, which sends nothing. */
        if (
            existingDm.messageType === "CHURN_SURVEY" &&
            ["TOO_EXPENSIVE", "LACK_OF_FEATURES", "TECHNICAL_ISSUES", "OTHER"].includes(status)
        ) {
            await sendSubscriptionCancellationReasonEmail({
                merchantAddress: existingDm.senderAddress,
                customerAddress: existingDm.receiverAddress,
                reasonCode: status,
            }).catch((err) => console.error("[dms] cancellation-reason email failed:", err));
        }

        return NextResponse.json({
            success: true,
            dm: {
                id: updatedDm.id,
                status: updatedDm.status
            }
        }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to update DM status:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
