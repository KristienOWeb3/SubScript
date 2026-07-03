import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { ethers } from "ethers";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const callerAddress = wallet.toLowerCase();

        // 1. Fetch all referrals for this referrer
        const referrals = await prisma.referral.findMany({
            where: { referrerAddress: callerAddress },
            orderBy: { createdAt: "desc" }
        });

        // 2. Fetch aliases for all referred addresses to show friendly names
        const referredAddresses = referrals.map(r => r.referredAddress.toLowerCase());
        const aliases = await prisma.addressAlias.findMany({
            where: { address: { in: referredAddresses } }
        });

        const aliasMap = new Map(aliases.map(a => [a.address.toLowerCase(), a.alias]));

        const formattedReferrals = referrals.map(r => ({
            id: r.id,
            referredAddress: r.referredAddress,
            alias: aliasMap.get(r.referredAddress.toLowerCase()) || null,
            status: r.status,
            createdAt: r.createdAt,
        }));

        // 3. Resolve referrer's own alias for the link
        const ownAliasRecord = await prisma.addressAlias.findUnique({
            where: { address: callerAddress }
        });

        const refCode = ownAliasRecord?.alias || callerAddress;
        const referralLink = `https://subscriptonarc.com/signup?ref=${refCode}`;

        return NextResponse.json({
            success: true,
            count: formattedReferrals.length,
            referrals: formattedReferrals,
            referralLink
        }, { status: 200 });
    } catch (error: any) {
        console.error("GET referrals error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const callerAddress = wallet.toLowerCase();

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const { referrer } = sanitizeInput(body);
        if (!referrer || typeof referrer !== "string") {
            return NextResponse.json({ error: "Referrer is required" }, { status: 400 });
        }

        const cleanedReferrer = referrer.trim();

        // 1. Resolve referrer address
        let referrerAddress = "";
        if (ethers.isAddress(cleanedReferrer)) {
            referrerAddress = cleanedReferrer.toLowerCase();
        } else {
            // Treat as alias
            const aliasRecord = await prisma.addressAlias.findFirst({
                where: {
                    OR: [
                        { alias: { equals: cleanedReferrer, mode: "insensitive" } },
                        { alias: { equals: `${cleanedReferrer}.sub`, mode: "insensitive" } }
                    ]
                }
            });
            if (!aliasRecord) {
                return NextResponse.json({ error: "Referrer alias not found" }, { status: 404 });
            }
            referrerAddress = aliasRecord.address.toLowerCase();
        }

        // 2. Self-referral validation
        if (referrerAddress === callerAddress) {
            return NextResponse.json({ error: "You cannot refer yourself" }, { status: 400 });
        }

        // 3. Duplicate check
        const existingReferral = await prisma.referral.findUnique({
            where: { referredAddress: callerAddress }
        });

        if (existingReferral) {
            return NextResponse.json({ error: "Referral already registered for this account" }, { status: 409 });
        }

        // 4. Create referral
        await prisma.referral.create({
            data: {
                referrerAddress,
                referredAddress: callerAddress,
                status: "REGISTERED"
            }
        });

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error: any) {
        console.error("POST referrals error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
