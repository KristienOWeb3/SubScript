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
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
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

/**
 * Best-effort: deliver a push to every registered destination for a wallet. Never throws — callers
 * fire this as a side-effect of an already-committed action. Expired browser subscriptions
 * (HTTP 404/410) are pruned automatically.
 */
export async function sendPushToWallet(walletAddress: string, payload: PushPayload): Promise<void> {
    if (!supabaseAdmin || !walletAddress) return;
    const wallet = walletAddress.toLowerCase();

    const { data: subs, error } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("wallet_address", wallet);

    if (error || !subs || subs.length === 0) return;

    const webConfigured = ensureVapidConfigured();
    const serialized = JSON.stringify(payload);

    await Promise.all(
        subs.map(async (sub: any) => {
            try {
                if (sub.platform === "web") {
                    if (!webConfigured || !sub.endpoint || !sub.p256dh || !sub.auth) return;
                    await webpush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                        serialized
                    );
                    await supabaseAdmin!
                        .from("push_subscriptions")
                        .update({ last_used_at: new Date().toISOString() })
                        .eq("id", sub.id);
                } else {
                    /* Native push (FCM/APNs) for the future SubScript mobile app — not yet wired.
                       The subscription row + payload are ready; only the dispatch call is missing. */
                }
            } catch (err: any) {
                const status = err?.statusCode;
                if (status === 404 || status === 410) {
                    await supabaseAdmin!.from("push_subscriptions").delete().eq("id", sub.id);
                } else {
                    console.error("[push] delivery failed:", err?.message || err);
                }
            }
        })
    );
}
