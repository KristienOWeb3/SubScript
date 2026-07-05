"use client";

import { ShieldCheck, Lock, Clock } from "@/components/icons";
import { isProd } from "@/lib/contracts/constants";

/*
 * Identity Verification (KYC/AML) — VISIBLE BUT NOT YET ACTIVE.
 *
 * Deliberately a presentational placeholder: no API calls, no data submission. Identity verification
 * ships with the Arc mainnet launch (regulated payouts, higher limits, fiat on/off-ramps), so on the
 * current testnet we surface it for transparency and roadmap visibility while keeping every control
 * disabled. When the provider integration lands, this panel becomes the entry point — wire the button
 * to the verification flow and drive the status from the account's real KYC state.
 */

const KYC_STEPS = [
    "Personal / business details",
    "Government ID + liveness check",
    "Sanctions & AML screening",
];

/**
 * @param className outer wrapper classes. Defaults to a top-bordered sub-section (for sitting among
 *   other settings sections); pass "" when mounting inside its own standalone card.
 */
export default function KycVerificationPanel({ className = "pt-4 border-t border-white/5" }: { className?: string }) {
    return (
        <div className={`space-y-4 ${className}`}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#00d2b4]" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Identity Verification (KYC)</h3>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-300">
                    <Clock className="w-3 h-3" />
                    {isProd ? "Verification opening soon" : "Available at mainnet launch"}
                </span>
            </div>

            <p className="text-[10px] text-white/40 leading-relaxed font-sans max-w-md">
                KYC/AML identity verification unlocks regulated payouts, higher limits, and fiat on/off-ramps.
                It ships with the Arc mainnet release — on the current testnet it&apos;s shown for transparency but
                is not yet active.
            </p>

            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {KYC_STEPS.map((step) => (
                        <div key={step} className="flex items-start gap-2 rounded-xl border border-white/5 bg-black/20 p-2.5">
                            <Lock className="w-3 h-3 text-white/30 mt-0.5 shrink-0" />
                            <span className="text-[9px] leading-snug text-white/50 font-sans">{step}</span>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title="Identity verification opens with the Arc mainnet launch."
                    className="w-full py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/40 text-[10px] font-bold uppercase tracking-wider cursor-not-allowed flex items-center justify-center gap-2"
                >
                    <Lock className="w-3.5 h-3.5" />
                    Start verification — mainnet only
                </button>

                <p className="text-[8px] text-white/30 text-center font-sans">
                    Status: <span className="text-amber-300/80 font-bold">Not started</span> · Provider integration finalizes at mainnet.
                </p>
            </div>
        </div>
    );
}
