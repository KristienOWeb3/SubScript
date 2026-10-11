/* Next.js API route for managing SubScript Domain Names (address aliases) */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";
import { uploadProfilePicture } from "@/lib/storage";
import { pgQuery } from "@/lib/serverPg";


/* DNS aliases are a consumer convenience only. Merchant identity is merchant_id + display_name. */
const USER_ALIAS_REGEX = /^[a-z0-9-]{3,15}\.sub$/;
const ENTERPRISE_ALIAS_REGEX = /^[a-z0-9-]{3,15}\.(hq|biz)$/;
const MAX_PROFILE_PIC_BYTES = 2 * 1024 * 1024;

/* A DNS name can only be changed once every 365 days (see migration 20260630000000). */
const ALIAS_CHANGE_COOLDOWN_DAYS = 365;
const ALIAS_CHANGE_COOLDOWN_MS = ALIAS_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/**
 * If the wallet changed its alias within the cooldown window, return the date it
 * becomes eligible again; otherwise null (the change is allowed).
 */
function aliasCooldownUntil(lastChangedAt: string | null | undefined): Date | null {
    if (!lastChangedAt) return null;
    const next = new Date(new Date(lastChangedAt).getTime() + ALIAS_CHANGE_COOLDOWN_MS);
    return next.getTime() > Date.now() ? next : null;
}

function cooldownMessage(nextChangeAt: Date, verb: "change" | "unregister"): string {
    const days = Math.ceil((nextChangeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    const when = nextChangeAt.toISOString().slice(0, 10);
    return `You can only change your DNS name once every ${ALIAS_CHANGE_COOLDOWN_DAYS} days. `
        + `You can ${verb} it again on ${when} (about ${days} day${days === 1 ? "" : "s"} from now).`;
}

function getDataUrlByteLength(value: string) {
    const base64 = value.split(",")[1] || "";
    return Math.floor((base64.length * 3) / 4);
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const queryAddress = searchParams.get("address");
        const queryAlias = searchParams.get("alias");
        const merchantCommitOnly = searchParams.get("merchantCommitOnly") === "true";

        // 1. Resolve alias to address
        if (queryAlias) {
            const normalizedAlias = queryAlias.toLowerCase().trim();

            // One round trip resolves the destination, authoritative role, and avatar.
            // Merchant commit slugs retain priority; ambiguous DNS names fail closed.
            const matches = await pgQuery<{
                address: string; alias: string; is_anonymous: boolean; profile_pic: string | null;
                role: string | null; is_merchant: boolean; display_name: string | null; verified: boolean;
            }>(`with merchant as (
                select wallet_address as address, commit_slug as alias, false as is_anonymous,
                    profile_pic, 'ENTERPRISE'::text as role, true as is_merchant, display_name, verified
                from merchants where commit_slug = $1 limit 1
            ), aliases as (
                select address, alias, is_anonymous from address_aliases
                where $2::boolean and alias ilike $1 and not exists(select 1 from merchant) limit 2
            )
            select * from merchant
            union all
            select a.address, a.alias, a.is_anonymous, c.profile_pic, r.role,
                false as is_merchant, null::text as display_name, false as verified
            from aliases a left join account_roles r on r.address = lower(a.address)
            left join customers c on c.wallet_address = a.address`,
                [normalizedAlias, !merchantCommitOnly && (USER_ALIAS_REGEX.test(normalizedAlias) || ENTERPRISE_ALIAS_REGEX.test(normalizedAlias))]);
            if (matches.length > 1) return NextResponse.json({ error: "Recipient lookup is temporarily unavailable." }, { status: 503 });
            const data = matches[0];
            if (data?.is_merchant) {
                return NextResponse.json({
                    success: true,
                    address: data.address,
                    alias: data.alias,
                    commitSlug: data.alias,
                    displayName: data.display_name,
                    is_anonymous: false,
                    profile_pic: data.profile_pic || null,
                    verified: data.verified || false,
                });
            }
            if (!data || data.role === "ENTERPRISE") {
                return NextResponse.json({ success: true, address: null, alias: normalizedAlias });
            }

            return NextResponse.json({
                success: true,
                address: data.address,
                alias: data.alias,
                is_anonymous: data.is_anonymous,
                profile_pic: data.profile_pic || null,
                verified: false,
            });
        }

        // 2. Resolve address to alias
        let targetAddress = queryAddress ? queryAddress.toLowerCase() : null;

        // If no query parameters, fallback to session wallet
        if (!targetAddress) {
            const sessionWallet = await getSessionWallet(request.headers);
            if (!sessionWallet) {
                return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
            }
            targetAddress = sessionWallet.toLowerCase();
        }

        const role = await getAccountRole(targetAddress) || "USER";

        if (role === "ENTERPRISE") {
            const profile = await prisma.merchant.findUnique({
                where: { walletAddress: targetAddress },
                select: { profilePic: true, verified: true },
            }).catch(() => null);
            return NextResponse.json({
                success: true,
                address: targetAddress,
                alias: null,
                is_anonymous: false,
                role,
                profile_pic: profile?.profilePic || null,
                verified: profile?.verified || false,
                change_cooldown_days: null,
                next_change_at: null,
            });
        }

        const data = await prisma.addressAlias.findUnique({
            where: { address: targetAddress },
            select: { address: true, alias: true, isAnonymous: true, lastChangedAt: true },
        });

        const profile = await prisma.customer.findUnique({
            where: { walletAddress: targetAddress },
            select: { profilePic: true },
        }).catch(() => null);

        const nextChangeAt = aliasCooldownUntil(data?.lastChangedAt?.toISOString());

        return NextResponse.json({
            success: true,
            address: targetAddress,
            alias: data?.alias || null,
            is_anonymous: data?.isAnonymous || false,
            role,
            profile_pic: profile?.profilePic || null,
            verified: false,
            // Cooldown info: how long until this wallet may change its DNS name again.
            change_cooldown_days: ALIAS_CHANGE_COOLDOWN_DAYS,
            next_change_at: nextChangeAt ? nextChangeAt.toISOString() : null,
        }, { status: 200 });

    } catch (err: any) {
        console.error("Alias GET error:", err);
        return NextResponse.json({ error: "Recipient lookup is temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const { alias, isAnonymous, profilePic } = body;
        const role = await getAccountRole(normalizedUser) || "USER";

        if (typeof profilePic === "string") {
            if (!profilePic.startsWith("data:image/") || getDataUrlByteLength(profilePic) > MAX_PROFILE_PIC_BYTES) {
                return NextResponse.json({ error: "Profile image must be an image data URL smaller than 2MB" }, { status: 400 });
            }

            const uploadedUrl = await uploadProfilePicture(profilePic, normalizedUser);

            if (role === "ENTERPRISE") {
                await prisma.merchant.upsert({
                    where: { walletAddress: normalizedUser },
                    update: { profilePic: uploadedUrl, updatedAt: new Date() },
                    create: {
                        walletAddress: normalizedUser,
                        profilePic: uploadedUrl,
                        tier: "FREE",
                        availableBalanceUsdc: BigInt(0),
                        reservedBalanceUsdc: BigInt(0),
                    },
                });
            } else {
                await prisma.customer.upsert({
                    where: { walletAddress: normalizedUser },
                    update: { profilePic: uploadedUrl },
                    create: { walletAddress: normalizedUser, profilePic: uploadedUrl },
                });
            }

            return NextResponse.json({
                success: true,
                address: normalizedUser,
                profile_pic: uploadedUrl,
            }, { status: 200 });
        }

        if (alias !== null && alias !== undefined && alias !== "") {
            if (role === "ENTERPRISE") {
                return NextResponse.json({ error: "Merchant identity uses merchant ID and display name, not DNS." }, { status: 403 });
            }
            const normalizedAlias = String(alias).toLowerCase().trim();
            const allowed = USER_ALIAS_REGEX.test(normalizedAlias);
            if (!allowed) {
                return NextResponse.json({
                    error: "Bad Request: User DNS names must be 3-15 characters and end with '.sub'"
                }, { status: 400 });
            }

            const result = await prisma.$transaction(async (tx) => {
                // Lock even when no row exists, so concurrent first registrations and
                // changes for this wallet cannot both spend its free change.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`address-alias-wallet:${normalizedUser}`}, 0))`;
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`address-alias-name:${normalizedAlias}`}, 0))`;
                const existing = await tx.addressAlias.findMany({
                    where: { alias: { equals: normalizedAlias, mode: "insensitive" } },
                    select: { address: true },
                    take: 2,
                });
                if (existing.some((row) => row.address.toLowerCase() !== normalizedUser)) {
                    return { response: NextResponse.json({ error: "Conflict: Alias is already registered to another wallet" }, { status: 409 }) };
                }
                const current = await tx.addressAlias.findUnique({ where: { address: normalizedUser } });
                const isNameChange = !!current && current.alias.toLowerCase() !== normalizedAlias;
                if (isNameChange) {
                    const nextChangeAt = aliasCooldownUntil(current.lastChangedAt?.toISOString());
                    if (nextChangeAt) {
                        return { response: NextResponse.json({
                            error: cooldownMessage(nextChangeAt, "change"),
                            nextChangeAt: nextChangeAt.toISOString(),
                        }, { status: 429 }) };
                    }
                }
                const data = await tx.addressAlias.upsert({
                    where: { address: normalizedUser },
                    create: { address: normalizedUser, alias: normalizedAlias, isAnonymous: !!isAnonymous },
                    update: {
                        alias: normalizedAlias,
                        isAnonymous: !!isAnonymous,
                        // Initial registration and same-name privacy updates do not
                        // consume the one free change after an assigned default name.
                        ...(isNameChange ? { lastChangedAt: new Date() } : {}),
                    },
                });
                return { data };
            });
            if (result.response) return result.response;
            const data = result.data!;
            return NextResponse.json({
                success: true,
                address: data.address,
                alias: data.alias,
                is_anonymous: data.isAnonymous,
                role
            }, { status: 200 });
        } else {
            /* If alias is empty, it means we are clearing the alias */
            if (role === "ENTERPRISE") {
                return NextResponse.json({
                    error: "Business names cannot be unregistered. Customers rely on your registered name to recognize who they are paying.",
                }, { status: 403 });
            }
            return await clearAlias(normalizedUser);
        }

    } catch (err: any) {
        console.error("Alias POST error:", err);
        if (err?.code === "P2002") {
            return NextResponse.json({ error: "Conflict: Alias is already registered to another wallet" }, { status: 409 });
        }
        return NextResponse.json({ error: "DNS settings are temporarily unavailable. Please try again." }, { status: 503 });
    }
}

export async function DELETE(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        /* A merchant's registered name is the identity customers pay to — it must never be
           unregistered from the dashboard. (Support can intervene for genuine rebrands.) */
        const role = await getAccountRole(normalizedUser) || "USER";
        if (role === "ENTERPRISE") {
            return NextResponse.json({
                error: "Business names cannot be unregistered. Customers rely on your registered name to recognize who they are paying.",
            }, { status: 403 });
        }

        return await clearAlias(normalizedUser);

    } catch (err: any) {
        console.error("Alias DELETE error:", err);
        return NextResponse.json({ error: "DNS settings are temporarily unavailable. Please try again." }, { status: 503 });
    }
}

// Both explicit DELETE and an empty-name POST must honor the same cooldown.
async function clearAlias(normalizedUser: string) {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`address-alias-wallet:${normalizedUser}`}, 0))`;
        const current = await tx.addressAlias.findUnique({ where: { address: normalizedUser } });
        const nextChangeAt = aliasCooldownUntil(current?.lastChangedAt?.toISOString());
        if (nextChangeAt) {
            return NextResponse.json({
                error: cooldownMessage(nextChangeAt, "unregister"),
                nextChangeAt: nextChangeAt.toISOString(),
            }, { status: 429 });
        }
        await tx.addressAlias.deleteMany({ where: { address: normalizedUser } });
        return NextResponse.json({ success: true, address: normalizedUser, alias: null, is_anonymous: false });
    });
}
