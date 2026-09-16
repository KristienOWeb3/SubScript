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
const PROMPTED_KEY = "subscript_pwa_install_prompted";

/* Only the primary overview/dashboard pages trigger the install prompt. */
function isOverviewDashboardPath(pathname: string | null): boolean {
    if (!pathname) return false;
    return pathname === "/dashboard" || pathname === "/dashboard/user";
}

export default function PwaInstaller() {
    const pathname = usePathname();
    const isOverview = isOverviewDashboardPath(pathname);
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;

        /* Register the SW for push notifications / offline support on dashboard surfaces */
        if ("serviceWorker" in navigator && (pathname?.startsWith("/dashboard") || pathname?.startsWith("/user"))) {
            navigator.serviceWorker
                .register("/sw.js")
                .then((registration) => {
                    registration.update().catch(() => {});
                })
                .catch((err) => {
                    console.error("Service worker registration failed:", err);
                });
        }

        /* The install prompt only pops up once and strictly on the overview/dashboard page */
        if (!isOverview) return;

        const isStandalone =
            window.matchMedia?.("(display-mode: standalone)").matches ||
            (window.navigator as any).standalone === true;

        try {
            if (isStandalone || localStorage.getItem(DISMISS_KEY) === "1" || localStorage.getItem(PROMPTED_KEY) === "1") {
                return;
            }
        } catch {
            /* ignore localStorage access errors */
        }

        const onBeforeInstall = (event: Event) => {
            event.preventDefault(); // stash it so we can trigger the prompt from our own button
            setDeferredPrompt(event as BeforeInstallPromptEvent);
            setVisible(true);
            try { localStorage.setItem(PROMPTED_KEY, "1"); } catch { /* ignore */ }
        };
        const onInstalled = () => {
            setVisible(false);
            setDeferredPrompt(null);
            try {
                localStorage.setItem(DISMISS_KEY, "1");
                localStorage.setItem(PROMPTED_KEY, "1");
            } catch { /* ignore */ }
        };

        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstall);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, [isOverview, pathname]);

    if (!isOverview || !visible || !deferredPrompt) return null;

    const install = async () => {
        try {
            await deferredPrompt.prompt();
            await deferredPrompt.userChoice;
        } catch {
            /* user dismissed the native prompt — nothing to do */
        } finally {
            setVisible(false);
            setDeferredPrompt(null);
            try {
                localStorage.setItem(DISMISS_KEY, "1");
                localStorage.setItem(PROMPTED_KEY, "1");
            } catch { /* ignore */ }
        }
    };

    const dismiss = () => {
        setVisible(false);
        try {
            localStorage.setItem(DISMISS_KEY, "1");
            localStorage.setItem(PROMPTED_KEY, "1");
        } catch { /* ignore */ }
    };

    return (
        <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 px-4 w-full max-w-sm">
            <div className="flex items-center gap-3 rounded-2xl border border-black/15 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-xl text-black">
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#111827]">Install SubScript</p>
                    <p className="text-[10px] text-black/60 leading-snug">Add to your home screen for one-tap access and instant updates.</p>
                </div>
                <button
                    type="button"
                    onClick={install}
                    className="shrink-0 rounded-xl bg-[#2775CA] px-3.5 py-2 text-[10px] font-black uppercase tracking-wider text-white transition hover:bg-[#1f62ab]"
                >
                    Install
                </button>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss install prompt"
                    className="shrink-0 rounded-xl border border-black/10 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-black/45 transition hover:bg-black/5 hover:text-black"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
