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
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

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
                        theme: "dark",
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
        <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <AnimatedGradientBg />

            <div className="relative z-10 w-full max-w-lg py-10">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
                        SubScript{" "}
                        <span className="font-serif italic lowercase font-normal text-[#00d2b4]">for business</span>
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Merchant access request</p>
                </div>

                <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
                    {sent ? (
                        <div className="space-y-6 text-center">
                            <div className="mx-auto w-12 h-12 rounded-2xl bg-[#00d2b4]/10 border border-[#00d2b4]/30 flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-[#00d2b4]" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-base font-bold uppercase tracking-wider text-white">Request sent</h2>
                                <p className="text-xs text-white/60 leading-relaxed">{sent}</p>
                            </div>
                            <p className="text-[11px] text-white/40 leading-relaxed">
                                Once you&apos;re approved we&apos;ll email an invite link to{" "}
                                <span className="font-mono text-white/60 break-all">{email.toLowerCase()}</span>. Sign up
                                with that address — the invite only works for it.
                            </p>
                            <Link
                                href="/"
                                className="inline-flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#00d2b4] hover:text-[#00d2b4]/80 transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" />
                                Back to SubScript
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start gap-3">
                                <div className="p-2.5 rounded-xl bg-[#00d2b4]/10 border border-[#00d2b4]/30 text-[#00d2b4] shrink-0">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <div className="space-y-1.5">
                                    <h2 className="text-base font-bold uppercase tracking-wider text-white">
                                        Ask for merchant access
                                    </h2>
                                    <p className="text-xs text-white/50 leading-relaxed">
                                        Merchant accounts are approved one business at a time. Tell us who you are and
                                        we&apos;ll email an invite to the address you give us.
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
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
                                    <p className="text-[9px] text-white/40 leading-relaxed">
                                        This is the address that gets the merchant account, so pick the one you want to
                                        sign in with. It can&apos;t be an email that already has a personal SubScript
                                        account.
                                    </p>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
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
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
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
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
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
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
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
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
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
                                        <label className="block self-start text-[10px] font-bold uppercase tracking-wider text-white/60">
                                            Security check
                                        </label>
                                        <div id="turnstile-merchant-access" className="my-1" />
                                    </div>
                                )}

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                        <span className="leading-relaxed">{error}</span>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={busy || !email}
                                    className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)] disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request access"}
                                    {!busy && <ArrowRight className="w-4 h-4" />}
                                </button>
                            </form>
                        </>
                    )}

                    {/* Some businesses would rather talk to a person first. Let them. */}
                    <div className="border-t border-white/5 pt-5 space-y-3">
                        <a
                            href={X_HANDLE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-2.5 transition font-bold text-[11px] uppercase tracking-wider text-white"
                        >
                            <MessageSquare className="w-4 h-4 text-[#00d2b4]" />
                            Or DM us on X
                        </a>
                        <p className="text-center text-[10px] text-white/40 leading-relaxed">
                            We&apos;re{" "}
                            <a
                                href={X_HANDLE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#00d2b4] hover:underline"
                            >
                                @SubScript_onarc
                            </a>
                            . Ask anything before you sign up — we can set your account up from there too.
                        </p>
                    </div>

                    {!sent && (
                        <p className="text-center text-xs text-white/40">
                            Just here to pay for something?{" "}
                            <Link href="/signup" className="text-[#00d2b4] font-semibold hover:underline">
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
