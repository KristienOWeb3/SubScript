"use client";

/* Client-side Web Push helpers: register the service worker, manage the browser subscription,
   and sync it with the SubScript backend. */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function pushSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    );
}

export async function isPushEnabled(): Promise<boolean> {
    if (!pushSupported()) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return !!sub;
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
    if (!pushSupported()) {
        return { ok: false, error: "Push notifications aren't supported in this browser." };
    }
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
        return { ok: false, error: "Push notifications aren't configured yet. Check back soon." };
    }

    let newSubscription: PushSubscription | null = null;
    try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            return { ok: false, error: "Notification permission was denied." };
        }
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const existing = await registration.pushManager.getSubscription();
        const subscription =
            existing ||
            (await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
            }));
        if (!existing) newSubscription = subscription;

        const res = await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Could not register for push notifications.");
        }
        return { ok: true };
    } catch (err: any) {
        if (newSubscription) {
            try {
                if (!(await newSubscription.unsubscribe())) {
                    return { ok: false, error: "Push registration failed and the browser subscription could not be removed. Please try again." };
                }
            } catch {
                return { ok: false, error: "Push registration failed and the browser subscription could not be removed. Please try again." };
            }
        }
        return { ok: false, error: err?.message || "Could not enable push notifications." };
    }
}

export async function disablePush(): Promise<{ ok: boolean; error?: string }> {
    if (!pushSupported()) return { ok: true };
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
            const response = await fetch("/api/push/subscribe", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: subscription.endpoint }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                return { ok: false, error: data.error || "Could not unregister push notifications. Please try again." };
            }
            if (!(await subscription.unsubscribe())) {
                return { ok: false, error: "The browser could not disable push notifications. Please try again." };
            }
        }
        return { ok: true };
    } catch (err: any) {
        return { ok: false, error: err?.message || "Could not disable push notifications. Please try again." };
    }
}

export async function sendTestPush(): Promise<{ ok: boolean; message?: string; error?: string }> {
    try {
        const response = await fetch("/api/push/test", { method: "POST" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { ok: false, error: data.error || "Could not send a test notification." };
        }
        return { ok: true, message: data.message || "Test notification sent." };
    } catch {
        return { ok: false, error: "Could not reach the notification service." };
    }
}
