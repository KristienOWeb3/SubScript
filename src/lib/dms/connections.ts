import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withPgClient } from "@/lib/serverPg";
import { generateInviteToken } from "@/lib/dms/inviteTokens";
import { isBlocked, assertNotBlocked } from "@/lib/dms/blocks";
import { accountDisplayName } from "@/lib/identityDisplay";
import { getAccountRole } from "@/lib/accounts/roles";

const DECLINE_COOLDOWN_DAYS = 30;
const REQUEST_EXPIRATION_DAYS = 7;

/**
 * Get or initialize invite settings for a wallet, including the current signed token.
 */
export async function getOrCreateInviteSettings(wallet: string) {
    const normWallet = wallet.toLowerCase();

    let settings = await prisma.dmInviteSetting.findUnique({
        where: { walletAddress: normWallet },
    });

    if (!settings) {
        settings = await prisma.dmInviteSetting.create({
            data: {
                walletAddress: normWallet,
                tokenVersion: 1,
                tokenNonce: crypto.randomUUID(),
                enabled: true,
            },
        });
    }

    const token = generateInviteToken(normWallet, settings.tokenVersion, settings.tokenNonce);

    return {
        walletAddress: settings.walletAddress,
        tokenVersion: settings.tokenVersion,
        enabled: settings.enabled,
        token,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
    };
}

/**
 * Rotate the invite token for a wallet.
 * Increments version and changes nonce, instantly invalidating any prior links.
 */
export async function rotateInviteToken(wallet: string) {
    const normWallet = wallet.toLowerCase();
    const newNonce = crypto.randomUUID();

    const updated = await prisma.dmInviteSetting.upsert({
        where: { walletAddress: normWallet },
        create: {
            walletAddress: normWallet,
            tokenVersion: 1,
            tokenNonce: newNonce,
            enabled: true,
        },
        update: {
            tokenVersion: { increment: 1 },
            tokenNonce: newNonce,
            updatedAt: new Date(),
        },
    });

    const token = generateInviteToken(normWallet, updated.tokenVersion, updated.tokenNonce);

    return {
        tokenVersion: updated.tokenVersion,
        enabled: updated.enabled,
        token,
        updatedAt: updated.updatedAt,
    };
}

/**
 * Toggle whether incoming DM requests via invite links are enabled.
 */
export async function setInviteEnabled(wallet: string, enabled: boolean) {
    const normWallet = wallet.toLowerCase();

    const updated = await prisma.dmInviteSetting.upsert({
        where: { walletAddress: normWallet },
        create: {
            walletAddress: normWallet,
            tokenVersion: 1,
            tokenNonce: crypto.randomUUID(),
            enabled,
        },
        update: {
            enabled,
            updatedAt: new Date(),
        },
    });

    const token = generateInviteToken(normWallet, updated.tokenVersion, updated.tokenNonce);

    return {
        enabled: updated.enabled,
        tokenVersion: updated.tokenVersion,
        token,
    };
}

/**
 * Check if two user wallets have an active accepted DM connection.
 */
export async function hasActiveDmConnection(walletA: string, walletB: string): Promise<boolean> {
    const a = walletA.toLowerCase();
    const b = walletB.toLowerCase();
    if (a === b) return false;

    const [u1, u2] = a < b ? [a, b] : [b, a];

    const conn = await prisma.dmConnection.findUnique({
        where: {
            user1Address_user2Address: {
                user1Address: u1,
                user2Address: u2,
            },
        },
    });

    return Boolean(conn && conn.status === "ACCEPTED");
}

/**
 * Create a new DM connection request.
 */
export async function createDmRequest({
    senderWallet,
    receiverWallet,
    note,
}: {
    senderWallet: string;
    receiverWallet: string;
    note?: string | null;
}) {
    const sender = senderWallet.toLowerCase();
    const receiver = receiverWallet.toLowerCase();

    if (sender === receiver) {
        throw new Error("You cannot send a connection request to yourself.");
    }

    // Role checks: user to user only
    const [senderRole, receiverRole] = await Promise.all([
        getAccountRole(sender),
        getAccountRole(receiver),
    ]);

    if (senderRole !== "USER" || receiverRole !== "USER") {
        throw new Error("DM invite connections are only available between user accounts.");
    }

    // Check blocks
    await assertNotBlocked(sender, receiver, "DM connection request");

    // Check if already connected
    const alreadyConnected = await hasActiveDmConnection(sender, receiver);
    if (alreadyConnected) {
        throw new Error("You are already connected with this user.");
    }

    // Check existing pending request in either direction
    const existingPending = await prisma.dmRequest.findFirst({
        where: {
            OR: [
                { senderAddress: sender, receiverAddress: receiver, status: "PENDING" },
                { senderAddress: receiver, receiverAddress: sender, status: "PENDING" },
            ],
        },
    });

    if (existingPending) {
        if (existingPending.senderAddress === sender) {
            throw new Error("You already have a pending connection request to this user.");
        } else {
            throw new Error("This user has already sent you a connection request. Check your received requests.");
        }
    }

    // Check 30-day decline cooldown
    const recentDeclined = await prisma.dmRequest.findFirst({
        where: {
            senderAddress: sender,
            receiverAddress: receiver,
            status: "DECLINED",
            cooldownUntil: { gt: new Date() },
        },
        orderBy: { cooldownUntil: "desc" },
    });

    if (recentDeclined && recentDeclined.cooldownUntil) {
        const daysLeft = Math.ceil((recentDeclined.cooldownUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        throw new Error(`Your previous request was declined. You can send another request in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`);
    }

    const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 280) : null;
    const expiresAt = new Date(Date.now() + REQUEST_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    const request = await prisma.dmRequest.create({
        data: {
            senderAddress: sender,
            receiverAddress: receiver,
            note: cleanNote,
            status: "PENDING",
            expiresAt,
        },
    });

    return request;
}

/**
 * Accept an incoming DM connection request.
 * Creates an active dm_connections row and marks request ACCEPTED.
 */
export async function acceptDmRequest(requestId: string, receiverWallet: string) {
    const normReceiver = receiverWallet.toLowerCase();

    const request = await prisma.dmRequest.findUnique({
        where: { id: requestId },
    });

    if (!request) {
        throw new Error("Connection request not found.");
    }

    if (request.receiverAddress.toLowerCase() !== normReceiver) {
        throw new Error("You are not authorized to accept this request.");
    }

    if (request.status !== "PENDING") {
        throw new Error(`This request has already been ${request.status.toLowerCase()}.`);
    }

    if (request.expiresAt < new Date()) {
        await prisma.dmRequest.update({
            where: { id: requestId },
            data: { status: "EXPIRED" },
        });
        throw new Error("This connection request has expired.");
    }

    const sender = request.senderAddress.toLowerCase();
    await assertNotBlocked(normReceiver, sender, "accepting connection");

    const [u1, u2] = normReceiver < sender ? [normReceiver, sender] : [sender, normReceiver];

    await withPgClient(async (client) => {
        await client.query("begin");
        try {
            // Update request status
            await client.query(
                `update dm_requests
                 set status = 'ACCEPTED', updated_at = now()
                 where id = $1`,
                [requestId]
            );

            // Upsert dm_connections
            await client.query(
                `insert into dm_connections (user1_address, user2_address, status, established_at, last_interaction_at)
                 values ($1, $2, 'ACCEPTED', now(), now())
                 on conflict (user1_address, user2_address)
                 do update set status = 'ACCEPTED', last_interaction_at = now(), updated_at = now()`,
                [u1, u2]
            );

            // Cancel any reverse pending requests
            await client.query(
                `update dm_requests
                 set status = 'CANCELED', updated_at = now()
                 where status = 'PENDING'
                   and sender_address = $1
                   and receiver_address = $2`,
                [normReceiver, sender]
            );

            await client.query("commit");
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });

    return { success: true, peerAddress: sender };
}

/**
 * Decline an incoming DM connection request.
 * Sets status to DECLINED and starts the 30-day cooldown.
 */
export async function declineDmRequest(requestId: string, receiverWallet: string) {
    const normReceiver = receiverWallet.toLowerCase();

    const request = await prisma.dmRequest.findUnique({
        where: { id: requestId },
    });

    if (!request) {
        throw new Error("Connection request not found.");
    }

    if (request.receiverAddress.toLowerCase() !== normReceiver) {
        throw new Error("You are not authorized to decline this request.");
    }

    if (request.status !== "PENDING") {
        throw new Error(`This request has already been ${request.status.toLowerCase()}.`);
    }

    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

    const updated = await prisma.dmRequest.update({
        where: { id: requestId },
        data: {
            status: "DECLINED",
            declinedAt: now,
            cooldownUntil,
            updatedAt: now,
        },
    });

    return { success: true, request: updated };
}

/**
 * Cancel an outgoing DM connection request (sender only).
 */
export async function cancelDmRequest(requestId: string, senderWallet: string) {
    const normSender = senderWallet.toLowerCase();

    const request = await prisma.dmRequest.findUnique({
        where: { id: requestId },
    });

    if (!request) {
        throw new Error("Connection request not found.");
    }

    if (request.senderAddress.toLowerCase() !== normSender) {
        throw new Error("You are not authorized to cancel this request.");
    }

    if (request.status !== "PENDING") {
        throw new Error(`Cannot cancel a request that is already ${request.status.toLowerCase()}.`);
    }

    const updated = await prisma.dmRequest.update({
        where: { id: requestId },
        data: {
            status: "CANCELED",
            updatedAt: new Date(),
        },
    });

    return { success: true, request: updated };
}

/**
 * List all DM connection requests for a user (both received and sent).
 */
export async function listDmRequests(wallet: string) {
    const normWallet = wallet.toLowerCase();
    const now = new Date();

    const [receivedRows, sentRows] = await Promise.all([
        prisma.dmRequest.findMany({
            where: { receiverAddress: normWallet },
            orderBy: { createdAt: "desc" },
            take: 100,
        }),
        prisma.dmRequest.findMany({
            where: { senderAddress: normWallet },
            orderBy: { createdAt: "desc" },
            take: 100,
        }),
    ]);

    // Gather unique addresses for profile enrichment
    const uniqueAddrs = new Set<string>();
    receivedRows.forEach((r) => uniqueAddrs.add(r.senderAddress.toLowerCase()));
    sentRows.forEach((s) => uniqueAddrs.add(s.receiverAddress.toLowerCase()));

    const addrList = Array.from(uniqueAddrs);
    const [aliases, customers] = await Promise.all([
        prisma.addressAlias.findMany({
            where: { address: { in: addrList } },
            select: { address: true, alias: true },
        }),
        prisma.customer.findMany({
            where: { walletAddress: { in: addrList } },
            select: { walletAddress: true, profilePic: true },
        }),
    ]);

    const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));
    const profilePicMap = new Map(customers.map((c) => [c.walletAddress.toLowerCase(), c.profilePic]));

    const formatItem = (req: any, peerAddr: string) => {
        const alias = aliasMap.get(peerAddr);
        const isExpired = req.status === "PENDING" && req.expiresAt < now;
        const currentStatus = isExpired ? "EXPIRED" : req.status;

        let cooldownDaysLeft = 0;
        if (req.cooldownUntil && req.cooldownUntil > now) {
            cooldownDaysLeft = Math.ceil((req.cooldownUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }

        return {
            id: req.id,
            senderAddress: req.senderAddress,
            receiverAddress: req.receiverAddress,
            peerAddress: peerAddr,
            peerDisplayName: accountDisplayName(alias) || `${peerAddr.slice(0, 6)}...${peerAddr.slice(-4)}`,
            peerAlias: alias || null,
            peerProfilePic: profilePicMap.get(peerAddr) || null,
            note: req.note,
            status: currentStatus,
            expiresAt: req.expiresAt,
            declinedAt: req.declinedAt,
            cooldownUntil: req.cooldownUntil,
            cooldownDaysLeft,
            createdAt: req.createdAt,
        };
    };

    const received = receivedRows.map((r) => formatItem(r, r.senderAddress.toLowerCase()));
    const sent = sentRows.map((s) => formatItem(s, s.receiverAddress.toLowerCase()));

    return { received, sent };
}

/**
 * List all active accepted connections for a user.
 */
export async function listUserConnections(wallet: string) {
    const normWallet = wallet.toLowerCase();

    const conns = await prisma.dmConnection.findMany({
        where: {
            OR: [
                { user1Address: normWallet, status: "ACCEPTED" },
                { user2Address: normWallet, status: "ACCEPTED" },
            ],
        },
        orderBy: { lastInteractionAt: "desc" },
    });

    if (conns.length === 0) return [];

    const peerAddresses = conns.map((c) =>
        c.user1Address.toLowerCase() === normWallet ? c.user2Address.toLowerCase() : c.user1Address.toLowerCase()
    );

    const [aliases, customers] = await Promise.all([
        prisma.addressAlias.findMany({
            where: { address: { in: peerAddresses } },
            select: { address: true, alias: true },
        }),
        prisma.customer.findMany({
            where: { walletAddress: { in: peerAddresses } },
            select: { walletAddress: true, profilePic: true },
        }),
    ]);

    const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));
    const profilePicMap = new Map(customers.map((c) => [c.walletAddress.toLowerCase(), c.profilePic]));

    return conns.map((c) => {
        const peer = c.user1Address.toLowerCase() === normWallet ? c.user2Address.toLowerCase() : c.user1Address.toLowerCase();
        const alias = aliasMap.get(peer);
        return {
            id: c.id,
            peerAddress: peer,
            peerDisplayName: accountDisplayName(alias) || `${peer.slice(0, 6)}...${peer.slice(-4)}`,
            peerAlias: alias || null,
            peerProfilePic: profilePicMap.get(peer) || null,
            establishedAt: c.establishedAt,
            lastInteractionAt: c.lastInteractionAt,
        };
    });
}
