"use client";

import { useState } from "react";
import { ShieldCheck, ArrowRight } from "@/components/icons";
import Reveal from "./Reveal";

const MONTHLY_VOLUME_OPTIONS = ["<$10k", "$10k–$50k", "$50k+"];
const USE_CASE_OPTIONS = ["AI Agents", "SaaS", "APIs", "Web3 Infra"];

export default function MerchantApplicationForm() {
    const [email, setEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [monthlyVolume, setMonthlyVolume] = useState(MONTHLY_VOLUME_OPTIONS[0]);
    const [useCase, setUseCase] = useState(USE_CASE_OPTIONS[0]);
    const [company, setCompany] = useState(""); // honeypot — real users leave this empty
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus("loading");
        setMessage("");
        try {
            const res = await fetch("/api/waitlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userType: "enterprise",
                    email,
                    companyName,
                    monthlyVolume,
                    useCase,
                    honeypot: company,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setStatus("success");
                setMessage(data.message || "Spot secured on priority list.");
            } else {
                setStatus("error");
                setMessage(data.error || "Something went wrong. Please try again.");
            }
        } catch {
            setStatus("error");
            setMessage("Network error. Please try again.");
        }
    };

    const inputClass = "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#00d2b4]/50 focus:outline-none";

    return (
        <section id="apply" className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
            <Reveal>
                <div className="liquid-glass border border-white/5 bg-black/30 rounded-[2rem] p-6 sm:p-12 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                    <div>
                        <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">For businesses</span>
                        <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">Apply to become a SubScript Merchant</h2>
                        <p className="mt-4 text-sm text-white/50 leading-relaxed max-w-md">
                            Route your revenue through Arc USDC — checkout, recurring billing, payment links, and metered usage with a transparent 1% fee. Tell us about your business and we'll fast-track your onboarding.
                        </p>
                    </div>

                    {status === "success" ? (
                        <div className="rounded-3xl border border-[#00d2b4]/30 bg-[#00d2b4]/[0.06] p-6 sm:p-8 text-center">
                            <ShieldCheck className="w-8 h-8 text-[#00d2b4] mx-auto mb-3" />
                            <h3 className="text-sm font-semibold text-white">Spot secured on priority list</h3>
                            <p className="mt-2 text-xs text-white/55 leading-relaxed">{message}</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-3">
                            {/* Honeypot: off-screen; bots fill it, humans don't. */}
                            <input
                                type="text"
                                name="company"
                                tabIndex={-1}
                                autoComplete="off"
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                className="absolute -left-[9999px] h-0 w-0 opacity-0"
                                aria-hidden="true"
                            />
                            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" className={inputClass} />
                            <input type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className={inputClass} />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <select value={monthlyVolume} onChange={(e) => setMonthlyVolume(e.target.value)} className={inputClass} aria-label="Monthly volume">
                                    {MONTHLY_VOLUME_OPTIONS.map((o) => <option key={o} value={o} className="bg-black">{o} / mo</option>)}
                                </select>
                                <select value={useCase} onChange={(e) => setUseCase(e.target.value)} className={inputClass} aria-label="Use case">
                                    {USE_CASE_OPTIONS.map((o) => <option key={o} value={o} className="bg-black">{o}</option>)}
                                </select>
                            </div>
                            <p className="text-[11px] text-white/35 leading-relaxed px-1">
                                No crypto wallet needed — once approved, you'll create your merchant account with email or Google and we provision a secure server-signed wallet for you.
                            </p>
                            {status === "error" && (
                                <p className="text-xs text-red-400 font-medium">{message}</p>
                            )}
                            <button
                                type="submit"
                                disabled={status === "loading"}
                                className="w-full inline-flex items-center justify-center gap-2 px-7 py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 disabled:opacity-50 text-black font-semibold rounded-2xl text-sm transition-all shadow-[0_0_24px_rgba(0,210,180,0.25)]"
                            >
                                {status === "loading" ? "Submitting…" : "Apply for merchant access"}
                                {status !== "loading" && <ArrowRight className="w-4 h-4" />}
                            </button>
                            <p className="text-[11px] text-white/35 text-center">We review applications within two business days.</p>
                        </form>
                    )}
                </div>
            </Reveal>
        </section>
    );
}
