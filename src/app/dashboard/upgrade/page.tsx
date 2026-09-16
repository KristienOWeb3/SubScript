"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sliders, ArrowRight } from "@/components/icons";

/** Paid plans are retired; this compatibility route forwards old bookmarks to KYC-gated settings. */
export default function UpgradePage() {
    const router = useRouter();

    useEffect(() => {
        const timeout = setTimeout(() => {
            router.replace("/merchant?tab=advanced");
        }, 1200);
        return () => clearTimeout(timeout);
    }, [router]);

    return (
        <div className="min-h-screen bg-[#FFFFF0] dark:bg-[#111111] text-[#082824] dark:text-white flex flex-col items-center justify-center p-6 text-center font-sans">
            <div className="max-w-md w-full rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-8 sm:p-10 shadow-sm space-y-6">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-[#8AB4DB]/20 border border-[#8AB4DB]/30 flex items-center justify-center text-[#082824] dark:text-[#8AB4DB]">
                    <Sliders className="w-7 h-7 animate-pulse" />
                </div>
                <div className="space-y-2">
                    <h1 className="text-2xl font-extrabold tracking-tight">
                        Advanced Settings
                    </h1>
                    <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">
                        All advanced merchant features — including cold storage rerouting, Arc confidentiality, and keeper execution — are now included with SubScript.
                    </p>
                </div>
                <div className="pt-2">
                    <Link
                        href="/merchant?tab=advanced"
                        className="w-full py-3.5 bg-[#000000] hover:bg-black/85 dark:bg-white dark:text-black text-white font-bold rounded-full text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                        Go to Advanced Settings <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
