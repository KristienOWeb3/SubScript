/* Next.js API route for managing SubScript Domain Names (address aliases) */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";
import { uploadProfilePicture } from "@/lib/storage";


/* Users receive .sub names; enterprises receive business namespaces. */
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

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
        }

        // 1. Resolve alias to address
        if (queryAlias) {
            const normalizedAlias = queryAlias.toLowerCase().trim();
            const { data, error } = await supabaseAdmin
                .from("address_aliases")
                .select("address, alias, is_anonymous")
                .eq("alias", normalizedAlias)
                .maybeSingle();

            if (error) {
                console.error("Error looking up alias:", error.message);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            if (!data) {
                return NextResponse.json({ success: true, address: null, alias: normalizedAlias });
            }

            // Fetch profile picture for resolved address
            const role = await getAccountRole(data.address) || "USER";
            const profile = role === "ENTERPRISE"
                ? await prisma.merchant.findUnique({ where: { walletAddress: data.address }, select: { profilePic: true, verified: true } }).catch(() => null)
                : await prisma.customer.findUnique({ where: { walletAddress: data.address }, select: { profilePic: true } }).catch(() => null);

            return NextResponse.json({
                success: true,
                address: data.address,
                alias: data.alias,
                is_anonymous: data.is_anonymous,
                profile_pic: profile?.profilePic || null,
                verified: "verified" in (profile || {}) ? Boolean((profile as any)?.verified) : false,
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

        const { data, error } = await supabaseAdmin
            .from("address_aliases")
            .select("address, alias, is_anonymous, last_changed_at")
            .eq("address", targetAddress)
            .maybeSingle();

        if (error) {
            console.error("Error fetching address alias:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const profile = role === "ENTERPRISE"
            ? await prisma.merchant.findUnique({ where: { walletAddress: targetAddress }, select: { profilePic: true, verified: true } }).catch(() => null)
            : await prisma.customer.findUnique({ where: { walletAddress: targetAddress }, select: { profilePic: true } }).catch(() => null);

        const nextChangeAt = aliasCooldownUntil(data?.last_changed_at);

        return NextResponse.json({
            success: true,
            address: targetAddress,
            alias: data?.alias || null,
            is_anonymous: data?.is_anonymous || false,
            role,
            profile_pic: profile?.profilePic || null,
            verified: "verified" in (profile || {}) ? Boolean((profile as any)?.verified) : false,
            // Cooldown info: how long until this wallet may change its DNS name again.
            change_cooldown_days: ALIAS_CHANGE_COOLDOWN_DAYS,
            next_change_at: nextChangeAt ? nextChangeAt.toISOString() : null,
        }, { status: 200 });

    } catch (err: any) {
        console.error("Alias GET error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
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
            const normalizedAlias = String(alias).toLowerCase().trim();
            const allowed = role === "ENTERPRISE"
                ? ENTERPRISE_ALIAS_REGEX.test(normalizedAlias)
                : USER_ALIAS_REGEX.test(normalizedAlias);
            if (!allowed) {
                return NextResponse.json({
                    error: role === "ENTERPRISE"
                        ? "Bad Request: Enterprise DNS names must be 3-15 characters and end with '.hq' or '.biz'"
                        : "Bad Request: User DNS names must be 3-15 characters and end with '.sub'"
                }, { status: 400 });
            }

            if (!supabaseAdmin) {
                return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
            }

            /* Check if the alias is already taken by another address */
            const { data: existing, error: checkErr } = await supabaseAdmin
                .from("address_aliases")
                .select("address")
                .eq("alias", normalizedAlias)
                .maybeSingle();

            if (checkErr) {
                console.error("Error checking alias availability:", checkErr.message);
                return NextResponse.json({ error: checkErr.message }, { status: 500 });
            }

            if (existing && existing.address !== normalizedUser) {
                return NextResponse.json({ error: "Conflict: Alias is already registered to another wallet" }, { status: 409 });
            }

            /* Look up the caller's current alias to rate-limit *name changes* to once per 365 days.
               Re-submitting the same name (e.g. just toggling anonymity) is not a change. */
            const { data: current } = await supabaseAdmin
                .from("address_aliases")
                .select("alias, last_changed_at")
                .eq("address", normalizedUser)
                .maybeSingle();

            const isNameChange = !!current && current.alias !== normalizedAlias;

            if (isNameChange) {
                const nextChangeAt = aliasCooldownUntil(current!.last_changed_at);
                if (nextChangeAt) {
                    return NextResponse.json({
                        error: cooldownMessage(nextChangeAt, "change"),
                        nextChangeAt: nextChangeAt.toISOString(),
                    }, { status: 429 });
                }
            }

            const { data, error } = await supabaseAdmin
                .from("address_aliases")
                .upsert({
                    address: normalizedUser,
                    alias: normalizedAlias,
                    is_anonymous: !!isAnonymous,
                    updated_at: new Date().toISOString(),
                    // Stamp the cooldown only on an actual name change. The initial registration
                    // (no prior row) and same-name re-submits leave it untouched, so the user
                    // keeps exactly one free change after their default username.
                    ...(isNameChange ? { last_changed_at: new Date().toISOString() } : {}),
                })
                .select("address, alias, is_anonymous")
                .single();

            if (error) {
                console.error("Error upserting address alias:", error.message);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({
                success: true,
                address: data.address,
                alias: data.alias,
                is_anonymous: data.is_anonymous,
                role
            }, { status: 200 });
        } else {
            /* If alias is empty, it means we are clearing the alias */
            if (role === "ENTERPRISE") {
                return NextResponse.json({
                    error: "Business names cannot be unregistered. Customers rely on your registered name to recognize who they are paying.",
                }, { status: 403 });
            }
            if (!supabaseAdmin) {
                return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
            }

            const { error } = await supabaseAdmin
                .from("address_aliases")
                .delete()
                .eq("address", normalizedUser);

            if (error) {
                console.error("Error clearing address alias:", error.message);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({
                success: true,
                address: normalizedUser,
                alias: null,
                is_anonymous: false
            }, { status: 200 });
        }

    } catch (err: any) {
        console.error("Alias POST error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
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

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available" }, { status: 500 });
        }

        /* Block unregistering while in the change cooldown — otherwise a user could
           delete + re-register to bypass the once-per-365-days name-change limit. */
        const { data: current } = await supabaseAdmin
            .from("address_aliases")
            .select("last_changed_at")
            .eq("address", normalizedUser)
            .maybeSingle();

        const nextChangeAt = aliasCooldownUntil(current?.last_changed_at);
        if (nextChangeAt) {
            return NextResponse.json({
                error: cooldownMessage(nextChangeAt, "unregister"),
                nextChangeAt: nextChangeAt.toISOString(),
            }, { status: 429 });
        }

        const { error } = await supabaseAdmin
            .from("address_aliases")
            .delete()
            .eq("address", normalizedUser);

        if (error) {
            console.error("Error deleting address alias:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            address: normalizedUser,
            alias: null,
            is_anonymous: false
        }, { status: 200 });

    } catch (err: any) {
        console.error("Alias DELETE error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
