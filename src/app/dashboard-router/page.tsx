"use client";

import { useEffect, useState } from "react";
import { SkeletonPage } from "@/components/ui/skeletons";
import { getDashboardUrl } from "@/utils/navigation";

export default function DashboardRouterPage() {
    const [message, setMessage] = useState("Checking your SubScript account...");
    const [retryCount, setRetryCount] = useState(0);
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const routeByRole = async () => {
            try {
                setUnavailable(false);
                setMessage("Checking your SubScript account...");
                const res = await fetch("/api/auth/session", { cache: "no-store" });
                if (!res.ok) throw new Error("Session check unavailable");
                const data = await res.json();

                if (cancelled) return;

                if (data.loggedIn === false) {
                    setMessage("Redirecting to sign in...");
                    window.location.href = getDashboardUrl("USER", "/signin");
                    return;
                }
                if (data.loggedIn !== true || typeof data.wallet !== "string") {
                    throw new Error("Invalid session response");
                }

                const targetRole = (data.role || "USER") as "USER" | "ENTERPRISE";
                setMessage("Opening your dashboard...");
                window.location.href = getDashboardUrl(targetRole, "/dashboard");
                return;
            } catch {
                if (!cancelled) {
                    setMessage("We couldn’t check your session. Please try again.");
                    setUnavailable(true);
                }
            }
        };

        routeByRole();

        return () => {
            cancelled = true;
        };
    }, [retryCount]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#FFFFF0] px-6 text-[#082824]">
            {unavailable ? (
                <div className="text-center space-y-4">
                    <p role="alert">{message}</p>
                    <button type="button" onClick={() => setRetryCount(count => count + 1)} className="rounded-xl bg-[#2775CA] px-5 py-3 font-semibold text-white">
                        Try Again
                    </button>
                </div>
            ) : <SkeletonPage label={message} className="w-full" />}
        </main>
    );
}
