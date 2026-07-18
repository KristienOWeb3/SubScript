"use client";

import { useCallback, useEffect, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    Loader2,
    RefreshCw,
    Shield,
} from "@/components/icons";

type KycStatus =
    | "PENDING"
    | "IN_REVIEW"
    | "NEEDS_INPUT"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "REVOKED";

interface KycVerification {
    id: string;
    kind: "INDIVIDUAL" | "BUSINESS";
    countryCode: string;
    requestedLevel: "STANDARD" | "ENHANCED";
    status: KycStatus;
    reasonCode: string | null;
    reasonLabel: string | null;
    revision: number;
    submittedAt: string;
    decidedAt: string | null;
    expiresAt: string | null;
    canResubmit: boolean;
}

interface KycResponse {
    success?: boolean;
    available?: boolean;
    message?: string;
    verification?: KycVerification | null;
    redirectUrl?: string | null;
    supportedCountries?: string[];
    error?: string;
}

/* What each verification tier unlocks, shown so people know why they'd verify.
   Verification itself launches with mainnet. */
const USER_TIER_PERKS = [
    {
        name: "Tier 0 — Basic",
        requirement: "No verification needed",
        perks: [
            "Send and receive USDC payments",
            "Subscriptions, payment links, and DM requests",
            "Gas sponsored by SubScript on supported actions",
        ],
    },
    {
        name: "Tier 1 — Verified",
        requirement: "Identity verification (KYC)",
        perks: [
            "Higher transaction and spending limits",
            "Fiat on-ramp and off-ramp access as they launch",
            "Access to regulated features on mainnet",
        ],
    },
];

const statusStyles: Record<KycStatus, string> = {
    PENDING: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    IN_REVIEW: "border-sky-400/25 bg-sky-400/10 text-sky-200",
    NEEDS_INPUT: "border-orange-400/25 bg-orange-400/10 text-orange-200",
    APPROVED: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    REJECTED: "border-red-400/25 bg-red-400/10 text-red-200",
    EXPIRED: "border-white/15 bg-white/5 text-white/60",
    REVOKED: "border-red-400/25 bg-red-400/10 text-red-200",
};

const statusLabels: Record<KycStatus, string> = {
    PENDING: "Submitted",
    IN_REVIEW: "Under review",
    NEEDS_INPUT: "Action needed",
    APPROVED: "Approved",
    REJECTED: "Not approved",
    EXPIRED: "Expired",
    REVOKED: "Revoked",
};

function formatDate(value: string | null) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? "—"
        : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function KycVerificationPanel({
    accent = "#00d2b4",
    variant = "merchant",
}: {
    accent?: "#00d2b4" | "#ccff00";
    variant?: "user" | "merchant";
}) {
    const [verification, setVerification] = useState<KycVerification | null>(null);
    const [countryCode, setCountryCode] = useState("NG");
    const [consent, setConsent] = useState(false);
    const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
    const [supportedCountries, setSupportedCountries] = useState<string[]>(["NG"]);
    const [available, setAvailable] = useState(true);
    const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadVerification = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/kyc", { cache: "no-store" });
            const data = (await response.json().catch(() => ({}))) as KycResponse;
            if (!response.ok) {
                throw new Error(data.error || "Could not load verification status.");
            }
            if (data.available === false) {
                setAvailable(false);
                setUnavailableMessage(data.message || "Identity verification (KYC) will be available on mainnet.");
                setVerification(null);
                setRedirectUrl(null);
                return;
            }
            setAvailable(true);
            setUnavailableMessage(null);
            setVerification(data.verification || null);
            setRedirectUrl(data.redirectUrl || null);
            if (data.supportedCountries?.length) {
                setSupportedCountries(data.supportedCountries);
                if (!data.verification && !data.supportedCountries.includes(countryCode)) {
                    setCountryCode(data.supportedCountries[0]);
                }
            }
            if (data.verification?.countryCode) {
                setCountryCode(data.verification.countryCode);
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Could not load verification status.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadVerification();
    }, [loadVerification]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setRedirectUrl(null);

        try {
            const response = await fetch("/api/kyc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    countryCode: countryCode.trim().toUpperCase(),
                    consent,
                }),
            });
            const data = (await response.json().catch(() => ({}))) as KycResponse;
            if (!response.ok) {
                throw new Error(data.error || "Could not start verification.");
            }
            setVerification(data.verification || null);
            setRedirectUrl(data.redirectUrl || null);
            setConsent(false);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Could not start verification.");
        } finally {
            setSubmitting(false);
        }
    };

    const canSubmit = !verification || verification.canResubmit;
    const accentText = accent === "#ccff00" ? "text-[#ccff00]" : "text-[#00d2b4]";
    const accentBorder = accent === "#ccff00"
        ? "border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/15"
        : "border-[#00d2b4]/25 bg-[#00d2b4]/10 hover:bg-[#00d2b4]/15";

    return (
        <div className="liquid-glass rounded-3xl border border-white/5 bg-black/40 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className={`rounded-2xl border border-white/10 bg-white/5 p-2.5 ${accentText}`}>
                        <Shield className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-[0.14em] text-white">
                            Identity verification
                        </h3>
                        <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-white/45">
                            Verification is handled by an approved review provider. SubScript stores the case status,
                            not your identity documents, selfies, or biometric data.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => void loadVerification()}
                    disabled={loading || submitting}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="mt-6 flex items-center gap-2 text-[10px] text-white/45">
                    <Loader2 className={`h-4 w-4 animate-spin ${accentText}`} />
                    Loading verification status…
                </div>
            ) : !available ? (
                <div className="mt-6 space-y-5">
                    <div className={`flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4`}>
                        <Shield className={`mt-0.5 h-4 w-4 shrink-0 ${accentText}`} />
                        <div>
                            <p className="text-xs font-bold text-white">
                                {unavailableMessage || "Identity verification (KYC) will be available on mainnet."}
                            </p>
                            <p className="mt-1 text-[10px] leading-relaxed text-white/45">
                                Nothing is required from you during the testnet beta. When mainnet launches you can
                                verify here to unlock the tiers below.
                            </p>
                        </div>
                    </div>
                    {variant === "user" && <UserTierPerks accentText={accentText} verified={false} />}
                </div>
            ) : (
                <div className="mt-6 space-y-5">
                    {verification && (
                        <div className="rounded-2xl border border-white/5 bg-white/[0.025] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-white/30">
                                        {verification.kind === "BUSINESS" ? "Business KYB" : "Individual KYC"}
                                    </p>
                                    <p className="mt-1 text-xs font-bold text-white">
                                        Case {verification.id.slice(0, 8)} · Revision {verification.revision}
                                    </p>
                                </div>
                                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${statusStyles[verification.status]}`}>
                                    {statusLabels[verification.status]}
                                </span>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 text-[9px] sm:grid-cols-4">
                                <div>
                                    <span className="block uppercase tracking-wider text-white/25">Country</span>
                                    <span className="mt-1 block font-mono text-white/65">{verification.countryCode}</span>
                                </div>
                                <div>
                                    <span className="block uppercase tracking-wider text-white/25">Level</span>
                                    <span className="mt-1 block text-white/65">{verification.requestedLevel}</span>
                                </div>
                                <div>
                                    <span className="block uppercase tracking-wider text-white/25">Submitted</span>
                                    <span className="mt-1 block text-white/65">{formatDate(verification.submittedAt)}</span>
                                </div>
                                <div>
                                    <span className="block uppercase tracking-wider text-white/25">Decision</span>
                                    <span className="mt-1 block text-white/65">{formatDate(verification.decidedAt)}</span>
                                </div>
                            </div>

                            {verification.reasonLabel && (
                                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-[10px] leading-relaxed text-amber-100/80">
                                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                                    {verification.reasonLabel}
                                </div>
                            )}

                            {verification.status === "APPROVED" && (
                                <div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-emerald-300">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Provider verification approved{verification.expiresAt ? ` until ${formatDate(verification.expiresAt)}` : ""}.
                                </div>
                            )}
                        </div>
                    )}

                    {redirectUrl && (
                        <a
                            href={redirectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[10px] font-black uppercase tracking-wider transition ${accentBorder} ${accentText}`}
                        >
                            Continue with verification provider
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}

                    {canSubmit && (
                        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-white/5 bg-black/20 p-4">
                            <div>
                                <label htmlFor="kyc-country" className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                                    Country of residence / registration
                                </label>
                                <select
                                    id="kyc-country"
                                    value={countryCode}
                                    onChange={(event) => setCountryCode(event.target.value)}
                                    required
                                    aria-describedby="kyc-country-help"
                                    className="mt-2 block w-24 rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm uppercase text-white outline-none transition focus:border-white/30"
                                >
                                    {supportedCountries.map((country) => (
                                        <option key={country} value={country}>{country}</option>
                                    ))}
                                </select>
                                <p id="kyc-country-help" className="mt-1 text-[8px] text-white/30">
                                    Only provider-supported jurisdictions are shown.
                                </p>
                            </div>

                            <label className="flex cursor-pointer items-start gap-3 text-[9px] leading-relaxed text-white/50">
                                <input
                                    type="checkbox"
                                    checked={consent}
                                    onChange={(event) => setConsent(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black"
                                    required
                                />
                                <span>
                                    I consent to SubScript creating a wallet-bound verification case and sharing its
                                    reference with the configured verification provider. Identity evidence is supplied
                                    directly to that provider under its privacy and retention terms.
                                </span>
                            </label>

                            <button
                                type="submit"
                                disabled={submitting || !consent || countryCode.length !== 2}
                                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[10px] font-black uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto ${accentBorder} ${accentText}`}
                            >
                                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {verification ? "Resubmit verification" : "Start verification"}
                            </button>
                        </form>
                    )}

                    {error && (
                        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-[10px] text-red-200">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {error}
                        </div>
                    )}

                    {variant === "user" && (
                        <UserTierPerks accentText={accentText} verified={verification?.status === "APPROVED"} />
                    )}

                    <p className="text-[8px] leading-relaxed text-white/25">
                        Verification approval is a provider decision and does not by itself guarantee access to every
                        regulated product. Availability depends on jurisdiction and applicable compliance policy.
                    </p>
                </div>
            )}
        </div>
    );
}

/* User-facing tier matrix: what staying basic vs verifying unlocks. */
function UserTierPerks({ accentText, verified }: { accentText: string; verified: boolean }) {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {USER_TIER_PERKS.map((tier, index) => {
                const isActive = verified ? index === 1 : index === 0;
                return (
                    <div
                        key={tier.name}
                        className={`space-y-2 rounded-2xl border p-4 ${
                            isActive ? "border-white/20 bg-white/[0.05]" : "border-white/5 bg-white/[0.02]"
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <h4 className="text-[10px] font-black uppercase tracking-wider text-white">{tier.name}</h4>
                            {isActive && (
                                <span className={`rounded bg-white/10 px-1.5 py-0.5 text-[8px] font-bold ${accentText}`}>
                                    Your tier
                                </span>
                            )}
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">{tier.requirement}</p>
                        <ul className="space-y-1 text-[9px] leading-relaxed text-white/55">
                            {tier.perks.map((perk) => (
                                <li key={perk} className="flex items-start gap-1.5">
                                    <CheckCircle2 className={`mt-0.5 h-3 w-3 shrink-0 ${index === 1 ? accentText : "text-white/30"}`} />
                                    {perk}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}
