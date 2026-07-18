"use client";

/* Registers the service worker (needed for install + Web Push) and surfaces a lightweight,
   dismissible "Install app" button — but only inside the dashboard, so the marketing site
   isn't installable. Only the dashboard becomes the installed app. */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "subscript_pwa_install_dismissed";

/* Dashboard surfaces: /user (user dashboard), /merchant, /dashboard*, /dashboard-router. */
function isDashboardPath(pathname: string | null): boolean {
    if (!pathname) return false;
    return (
        pathname === "/user" || pathname.startsWith("/user/") ||
        pathname === "/merchant" || pathname.startsWith("/merchant/") ||
        pathname.startsWith("/dashboard")
    );
}

export default function PwaInstaller() {
    const pathname = usePathname();
    const onDashboard = isDashboardPath(pathname);
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        /* Only the dashboard is installable — skip the SW + prompt on the marketing site. */
        if (!onDashboard) return;

        /* Register the SW (idempotent — registering an already-registered SW is a no-op). */
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch((err) => {
                console.error("Service worker registration failed:", err);
            });
        }

        const isStandalone =
            window.matchMedia?.("(display-mode: standalone)").matches ||
            (window.navigator as any).standalone === true;
        if (isStandalone || sessionStorage.getItem(DISMISS_KEY) === "1") return;

        const onBeforeInstall = (event: Event) => {
            event.preventDefault(); // stash it so we can trigger the prompt from our own button
            setDeferredPrompt(event as BeforeInstallPromptEvent);
            setVisible(true);
        };
        const onInstalled = () => {
            setVisible(false);
            setDeferredPrompt(null);
        };

        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstall);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, [onDashboard]);

    if (!onDashboard || !visible || !deferredPrompt) return null;

    const install = async () => {
        try {
            await deferredPrompt.prompt();
            await deferredPrompt.userChoice;
        } catch {
            /* user dismissed the native prompt — nothing to do */
        } finally {
            setVisible(false);
            setDeferredPrompt(null);
        }
    };

    const dismiss = () => {
        setVisible(false);
        try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    };

    return (
        <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 px-4 w-full max-w-sm">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 shadow-2xl backdrop-blur-xl">
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white">Install SubScript</p>
                    <p className="text-[10px] text-white/50 leading-snug">Add it to your home screen for one-tap access and notifications.</p>
                </div>
                <button
                    type="button"
                    onClick={install}
                    className="shrink-0 rounded-xl bg-[#00d2b4] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-black transition hover:brightness-110"
                >
                    Install
                </button>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss install prompt"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-white/50 transition hover:text-white"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
