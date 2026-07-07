"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { getDashboardUrl } from "@/utils/navigation";

export default function DashboardRouterPage() {
    const [message, setMessage] = useState("Checking your SubScript account...");

    useEffect(() => {
        let cancelled = false;

        const routeByRole = async () => {
            try {
                const res = await fetch("/api/auth/session", { cache: "no-store" });
                const data = await res.json().catch(() => ({}));

                if (cancelled) return;

                if (!res.ok || !data.loggedIn) {
                    setMessage("Redirecting to sign in...");
                    window.location.href = getDashboardUrl("USER", "/login");
                    return;
                }

                if (data.role === "USER" || data.role === "ENTERPRISE") {
                    setMessage("Opening your dashboard...");
                    window.location.href = getDashboardUrl(data.role, "/dashboard");
                    return;
                }

                setMessage("Finishing account setup...");
                window.location.href = getDashboardUrl("USER", "/signup");
            } catch {
                if (!cancelled) {
                    setMessage("Redirecting to sign in...");
                    window.location.href = getDashboardUrl("USER", "/login");
                }
            }
        };

        routeByRole();

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#050608] px-6 text-white">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/70">
                <Loader2 className="h-4 w-4 animate-spin text-[#00d2b4]" />
                <span>{message}</span>
            </div>
        </main>
    );
}
