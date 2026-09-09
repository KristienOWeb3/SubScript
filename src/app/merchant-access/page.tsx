"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import {
    AlertCircle,
    ArrowLeft,
    ArrowRight,
    Building2,
    CheckCircle,
    Loader2,
    MessageSquare,
} from "@/components/icons";

/* Merchant access request — the front door for invite-only merchant signup.
 *
 * Reachable whether or not enforcement is on, so businesses can queue up before mainnet and the
 * link in /signup never dies. The page never says whether an email is already approved: the API
 * returns one uniform response for every case, and this screen shows exactly that.
 */

const X_HANDLE_URL = "https://x.com/SubScript_onarc";

const USE_CASES = [
    "SaaS subscriptions",
    "API metering",
    "AI agents and tooling",
    "Web3 infrastructure",
    "Creator memberships",
    "Something else",
];

const VOLUMES = ["Under $10k / month", "$10k – $50k / month", "$50k+ / month", "Not sure yet"];

export default function MerchantAccessPage() {
    const [email, setEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [website, setWebsite] = useState("");
    const [contactName, setContactName] = useState("");
    const [useCase, setUseCase] = useState("");
    const [monthlyVolume, setMonthlyVolume] = useState("");
    const [honeypot, setHoneypot] = useState("");

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState<string | null>(null);

    const [captchaToken, setCaptchaToken] = useState("");
    const [turnstileLoaded, setTurnstileLoaded] = useState(false);
    const isTurnstileConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    useEffect(() => {
        if (typeof window !== "undefined" && window.turnstile) setTurnstileLoaded(true);
    }, []);

    useEffect(() => {
        if (!turnstileLoaded || typeof window === "undefined" || !window.turnstile) return;
        const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
        if (!siteKey) return;

        const timer = setTimeout(() => {
            const container = document.getElementById("turnstile-merchant-access");
            if (container && container.innerHTML === "") {
                try {
                    window.turnstile.render(container, {
                        sitekey: siteKey,
                        theme: "light",
                        callback: (token: string) => setCaptchaToken(token),
                        "expired-callback": () => setCaptchaToken(""),
                        "error-callback": () => setCaptchaToken(""),
                    });
                } catch (e) {
                    console.warn("Turnstile render error:", e);
                }
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [turnstileLoaded]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.includes("@")) {
            setError("Enter a valid business email address.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/merchant-access/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    companyName,
                    website,
                    contactName,
                    useCase,
                    monthlyVolume,
                    honeypot,
                    captchaToken,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Couldn't send that. Try again.");
            setSent(data.message);
        } catch (err: any) {
            setError(err?.message || "Network error. Try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#FFFFF0] text-[#111827] selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <div className="relative z-10 w-full max-w-lg py-10">
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center gap-2.5 group mb-5">
                        <div className="w-9 h-9 rounded-lg bg-[#2775CA] flex items-center justify-center p-2 shadow-sm">
                            <img src="/logo-transparent.png" alt="SubScript Logo" className="w-full h-full object-contain brightness-0 invert" />
                        </div>
                        <span className="text-lg font-black tracking-tight text-[#111827]">SubScript</span>
                    </Link>
                    <h1 className="text-2xl font-black text-[#111827] tracking-tight">
                        SubScript for business
                    </h1>
                    <p className="text-[10px] text-black/40 uppercase tracking-widest mt-1">Merchant access request</p>
                </div>

                <div className="rounded-3xl border border-black/10 bg-white/60 p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
                    {sent ? (
                        <div className="space-y-6 text-center">
                            <div className="mx-auto w-12 h-12 rounded-2xl bg-[#2775CA]/10 border border-[#2775CA]/20 flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-[#2775CA]" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-base font-bold text-[#111827]">Request sent</h2>
                                <p className="text-xs text-black/60 leading-relaxed">{sent}</p>
                            </div>
                            <p className="text-[11px] text-black/45 leading-relaxed">
                                Once you&apos;re approved we&apos;ll email an invite link to{" "}
                                <span className="font-mono text-black/70 break-all">{email.toLowerCase()}</span>. Sign up
                                with that address — the invite only works for it.
                            </p>
                            <Link
                                href="/"
                                className="inline-flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#2775CA] hover:text-[#1f62ab] transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" />
                                Back to SubScript
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start gap-3">
                                <div className="p-2.5 rounded-xl bg-[#2775CA]/10 border border-[#2775CA]/20 text-[#2775CA] shrink-0">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <div className="space-y-1.5">
                                    <h2 className="text-base font-bold text-[#111827]">
                                        Ask for merchant access
                                    </h2>
                                    <p className="text-xs text-black/55 leading-relaxed">
                                        Merchant accounts are approved one business at a time. Tell us who you are and
                                        we&apos;ll email an invite to the address you give us.
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                                        Business email
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="billing@yourcompany.com"
                                        required
                                        className="subscript-input"
                                    />
                                    <p className="text-[9px] text-black/40 leading-relaxed">
                                        This is the address that gets the merchant account, so pick the one you want to
                                        sign in with. It can&apos;t be an email that already has a personal SubScript
                                        account.
                                    </p>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                                            Company
                                        </label>
                                        <input
                                            type="text"
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value)}
                                            placeholder="Acme Inc."
                                            className="subscript-input"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                                            Your name
                                        </label>
                                        <input
                                            type="text"
                                            value={contactName}
                                            onChange={(e) => setContactName(e.target.value)}
                                            placeholder="Jane Doe"
                                            className="subscript-input"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                                        Website or app
                                    </label>
                                    <input
                                        type="text"
                                        value={website}
                                        onChange={(e) => setWebsite(e.target.value)}
                                        placeholder="yourcompany.com"
                                        className="subscript-input"
                                    />
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                                            What you&apos;d bill for
                                        </label>
                                        <select
                                            value={useCase}
                                            onChange={(e) => setUseCase(e.target.value)}
                                            className="subscript-input"
                                        >
                                            <option value="">Pick one</option>
                                            {USE_CASES.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                                            Expected volume
                                        </label>
                                        <select
                                            value={monthlyVolume}
                                            onChange={(e) => setMonthlyVolume(e.target.value)}
                                            className="subscript-input"
                                        >
                                            <option value="">Pick one</option>
                                            {VOLUMES.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Bots fill this; humans never see it. */}
                                <input
                                    type="text"
                                    value={honeypot}
                                    onChange={(e) => setHoneypot(e.target.value)}
                                    tabIndex={-1}
                                    autoComplete="off"
                                    aria-hidden="true"
                                    className="hidden"
                                />

                                {isTurnstileConfigured && (
                                    <div className="space-y-2 pt-1 flex flex-col items-center">
                                        <label className="block self-start text-[10px] font-bold uppercase tracking-wider text-black/60">
                                            Security check
                                        </label>
                                        <div id="turnstile-merchant-access" className="my-1" />
                                    </div>
                                )}

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-600 flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                        <span className="leading-relaxed">{error}</span>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={busy || !email}
                                    className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 bg-[#2775CA] hover:bg-[#1f62ab] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm disabled:bg-black/10 disabled:text-black/40 disabled:shadow-none"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request access"}
                                    {!busy && <ArrowRight className="w-4 h-4" />}
                                </button>
                            </form>
                        </>
                    )}

                    {/* Some businesses would rather talk to a person first. Let them. */}
                    <div className="border-t border-black/10 pt-5 space-y-3">
                        <a
                            href={X_HANDLE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-3.5 bg-white hover:bg-black/[0.03] border border-black/10 rounded-2xl flex items-center justify-center gap-2.5 transition font-bold text-[11px] uppercase tracking-wider text-[#111827]"
                        >
                            <MessageSquare className="w-4 h-4 text-[#2775CA]" />
                            Or DM us on X
                        </a>
                        <p className="text-center text-[10px] text-black/40 leading-relaxed">
                            We&apos;re{" "}
                            <a
                                href={X_HANDLE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#2775CA] hover:underline"
                            >
                                @SubScript_onarc
                            </a>
                            . Ask anything before you sign up — we can set your account up from there too.
                        </p>
                    </div>

                    {!sent && (
                        <p className="text-center text-xs text-black/40">
                            Just here to pay for something?{" "}
                            <Link href="/signup" className="text-[#2775CA] font-semibold hover:underline">
                                Create a personal account
                            </Link>
                        </p>
                    )}
                </div>
            </div>

            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                strategy="afterInteractive"
                onLoad={() => setTurnstileLoaded(true)}
            />
        </div>
    );
}
