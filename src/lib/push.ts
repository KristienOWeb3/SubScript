import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Transport-agnostic push delivery.
 *
 * Today this sends browser Web Push via VAPID. The push_subscriptions table also carries a
 * `platform` + `device_token` so the future SubScript mobile app can register native tokens and
 * be delivered through the same sendPushToWallet() call (FCM/APNs wiring is the only addition).
 */

let vapidConfigured: boolean | null = null;

function ensureVapidConfigured(): boolean {
    if (vapidConfigured !== null) return vapidConfigured;
    const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:support@subscriptonarc.com";
    if (!publicKey || !privateKey) {
        vapidConfigured = false;
        return false;
    }
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidConfigured = true;
        return true;
    } catch (error) {
        console.error("[push] invalid VAPID configuration:", error instanceof Error ? error.message : error);
        vapidConfigured = false;
        return false;
    }
}

export function getVapidPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
    title: string;
    body: string;
    /** Path to open when the notification is clicked. */
    url?: string;
    /** Collapses notifications that share a tag. */
    tag?: string;
}

export interface PushDeliveryResult {
    configured: boolean;
    storageReady: boolean;
    subscriptions: number;
    sent: number;
    failed: number;
    pruned: number;
    skipped: number;
}

function emptyDeliveryResult(configured: boolean): PushDeliveryResult {
    return {
        configured,
        storageReady: false,
        subscriptions: 0,
        sent: 0,
        failed: 0,
        pruned: 0,
        skipped: 0,
    };
}

/**
 * Best-effort: deliver a push to every registered destination for a wallet. Never throws — callers
 * fire this as a side-effect of an already-committed action. Expired browser subscriptions
 * (HTTP 404/410) are pruned automatically.
 */
export async function sendPushToWallet(
    walletAddress: string,
    payload: PushPayload
): Promise<PushDeliveryResult> {
    const webConfigured = ensureVapidConfigured();
    const result = emptyDeliveryResult(webConfigured);
    if (!supabaseAdmin || !walletAddress) return result;
    const wallet = walletAddress.toLowerCase();

    // Check push opt-out preference before loading subscriptions (Finding 55)
    const [customerProfile, merchantProfile] = await Promise.all([
        supabaseAdmin.from("customers").select("push_enabled").eq("wallet_address", wallet).maybeSingle(),
        supabaseAdmin.from("merchants").select("push_enabled").eq("wallet_address", wallet).maybeSingle()
    ]);
    if (customerProfile.data?.push_enabled === false || merchantProfile.data?.push_enabled === false) {
        return result;
    }

    const { data: subs, error } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id, platform, endpoint, p256dh, auth")
        .eq("wallet_address", wallet);

    if (error) {
        console.error("[push] subscription lookup failed:", error.message);
        return result;
    }

    result.storageReady = true;
    result.subscriptions = subs?.length ?? 0;
    if (!subs || subs.length === 0) return result;

    const serialized = JSON.stringify(payload);

    const outcomes = await Promise.all(
        subs.map(async (sub: any) => {
            try {
                if (sub.platform === "web") {
                    if (!webConfigured || !sub.endpoint || !sub.p256dh || !sub.auth) return "skipped";
                    await webpush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                        serialized
                    );
                    await supabaseAdmin!
                        .from("push_subscriptions")
                        .update({ last_used_at: new Date().toISOString() })
                        .eq("id", sub.id);
                    return "sent";
                } else {
                    /* Native push (FCM/APNs) for the future SubScript mobile app — not yet wired.
                       The subscription row + payload are ready; only the dispatch call is missing. */
                    return "skipped";
                }
            } catch (err: any) {
                const status = err?.statusCode;
                if (status === 404 || status === 410) {
                    await supabaseAdmin!.from("push_subscriptions").delete().eq("id", sub.id);
                    return "pruned";
                } else {
                    console.error("[push] delivery failed:", err?.message || err);
                    return "failed";
                }
            }
        })
    );

    for (const outcome of outcomes) {
        result[outcome] += 1;
    }
    return result;
}
