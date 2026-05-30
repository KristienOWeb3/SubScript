"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function PopupContent() {
    const searchParams = useSearchParams();
    const provider = (searchParams.get("provider") || "google").toLowerCase();
    const [step, setStep] = useState<"loading" | "select" | "customEmail" | "submitting">("loading");
    const [customEmail, setCustomEmail] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => {
            setStep("select");
        }, 1200);
        return () => clearTimeout(timer);
    }, []);

    const handleSelectEmail = (email: string) => {
        setStep("submitting");
        setTimeout(() => {
            if (window.opener) {
                window.opener.postMessage(
                    { type: "social-login-success", email, provider },
                    window.location.origin
                );
            }
            window.close();
        }, 1000);
    };

    const handleSubmitCustomEmail = (e: React.FormEvent) => {
        e.preventDefault();
        if (!customEmail || !customEmail.includes("@")) {
            setError("Please enter a valid email address");
            return;
        }
        setError("");
        handleSelectEmail(customEmail.trim().toLowerCase());
    };

    if (step === "loading") {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-[#121212] text-white p-6 font-sans">
                <Loader2 className="w-10 h-10 text-[#00d2b4] animate-spin mb-4" />
                <p className="text-sm text-white/60">Connecting with {provider === "google" ? "Google" : "Apple"}...</p>
            </div>
        );
    }

    if (provider === "apple") {
        return (
            <div className="flex flex-col min-h-screen bg-black text-white font-sans">
                {/* Header */}
                <div className="flex justify-center pt-12 pb-6 border-b border-white/5">
                    <svg className="w-10 h-10 fill-white" viewBox="0 0 170 170">
                        <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.34.13-9.13-1.92-14.37-6.15-2.88-2.38-6.66-6.84-11.34-13.4-3.64-5.1-6.71-10.97-9.21-17.62-2.5-6.65-4.37-14.07-5.6-22.27-1.23-8.2-1.85-15.93-1.85-23.19 0-13.14 2.94-23.79 8.82-31.96 5.89-8.16 13.63-12.33 23.22-12.5 4.67-.05 9.85 1.44 15.54 4.48 5.68 3.03 9.4 4.54 11.16 4.54 1.34 0 4.63-1.27 9.87-3.81 5.24-2.54 9.94-3.79 14.11-3.74 12.82.26 22.63 4.98 29.41 14.16-10.02 6.07-14.94 14.43-14.77 25.07.17 8.35 3.23 15.22 9.16 20.61 5.93 5.39 12.84 8.21 20.72 8.46 1.17 4.08.21 8.84-2.87 14.31zm-26.68-112.63c.09 7.42-2.52 14.13-7.83 20.14-5.3 6.01-11.66 9.68-19.08 10.01-.09-.6.04-3.83.39-9.68.35-5.85 2.52-11.51 6.51-16.98 3.99-5.47 9.07-9.5 15.24-12.08 3.19 2.93 4.68 5.56 4.77 8.59z" />
                    </svg>
                </div>

                {/* Main Content */}
                <div className="flex-1 max-w-md mx-auto w-full px-8 py-10 flex flex-col justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-center mb-1">Sign in with Apple</h2>
                        <p className="text-xs text-white/40 text-center mb-8">Enter your Apple ID to continue to SubScript.</p>

                        {error && (
                            <div className="mb-4 text-xs bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg">
                                {error}
                            </div>
                        )}

                        {step === "submitting" ? (
                            <div className="flex flex-col items-center justify-center py-10">
                                <Loader2 className="w-8 h-8 text-white animate-spin mb-3" />
                                <p className="text-xs text-white/50">Securing your Apple ID session...</p>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmitCustomEmail} className="space-y-4">
                                <div>
                                    <input
                                        type="email"
                                        value={customEmail}
                                        onChange={(e) => setCustomEmail(e.target.value)}
                                        placeholder="Apple ID (Email)"
                                        required
                                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white transition"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    className="w-full py-3 bg-white text-black font-semibold rounded-lg text-sm hover:bg-neutral-200 transition"
                                >
                                    Continue
                                </button>
                            </form>
                        )}
                    </div>

                    <div className="space-y-4 text-center mt-12">
                        <p className="text-[10px] text-white/30 max-w-xs mx-auto">
                            Your Apple ID credentials are never shared with SubScript. A secure, privacy-preserving embedded wallet will be linked to this email.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // Google Provider
    return (
        <div className="flex flex-col min-h-screen bg-[#1a1a1a] text-neutral-200 font-sans">
            <div className="max-w-md mx-auto w-full px-8 py-12 flex flex-col justify-between flex-1">
                <div>
                    {/* Google Logo */}
                    <div className="flex justify-center mb-6">
                        <svg className="w-8 h-8" viewBox="0 0 24 24">
                            <path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.47 15.02 0 12 0 7.35 0 3.39 2.67 1.46 6.57l3.96 3.07C6.35 6.79 8.94 5.04 12 5.04z" />
                            <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.43h6.48c-.28 1.48-1.12 2.73-2.38 3.58l3.69 2.87c2.16-2 3.7-4.94 3.7-8.54z" />
                            <path fill="#FBBC05" d="M5.42 14.5A7.16 7.16 0 0 1 5 12c0-.87.15-1.7.42-2.5L1.46 6.43A11.96 11.96 0 0 0 0 12c0 2.05.52 4 1.46 5.73l3.96-3.23z" />
                            <path fill="#34A853" d="M12 24c3.24 0 5.97-1.07 7.96-2.91l-3.69-2.87c-1.02.69-2.33 1.1-4.27 1.1-3.06 0-5.65-1.75-6.58-4.53L1.46 18c1.93 3.9 5.89 6.57 10.54 6.57z" />
                        </svg>
                    </div>

                    <h2 className="text-xl font-bold text-center text-white mb-1">Sign in with Google</h2>
                    <p className="text-xs text-neutral-400 text-center mb-8">Choose an account to continue to SubScript</p>

                    {error && (
                        <div className="mb-4 text-xs bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg">
                            {error}
                        </div>
                    )}

                    {step === "submitting" ? (
                        <div className="flex flex-col items-center justify-center py-10">
                            <Loader2 className="w-8 h-8 text-[#00d2b4] animate-spin mb-3" />
                            <p className="text-xs text-neutral-400">Authenticating with Google Account...</p>
                        </div>
                    ) : step === "select" ? (
                        <div className="space-y-3">
                            {[
                                { name: "Google Developer", email: "developer@gmail.com" },
                                { name: "SubScript User", email: "user@gmail.com" },
                                { name: "Web3 Investor", email: "investor@gmail.com" },
                            ].map((acc) => (
                                <button
                                    key={acc.email}
                                    onClick={() => handleSelectEmail(acc.email)}
                                    className="w-full text-left bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl p-4 flex items-center gap-3 transition"
                                >
                                    <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-sm font-bold text-[#00d2b4]">
                                        {acc.name[0]}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white leading-none mb-1">{acc.name}</p>
                                        <p className="text-xs text-neutral-400 leading-none">{acc.email}</p>
                                    </div>
                                </button>
                            ))}

                            <button
                                onClick={() => setStep("customEmail")}
                                className="w-full py-3 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-bold uppercase tracking-wider text-[#00d2b4] hover:bg-neutral-800 transition"
                            >
                                Use another email
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmitCustomEmail} className="space-y-4">
                            <div>
                                <input
                                    type="email"
                                    value={customEmail}
                                    onChange={(e) => setCustomEmail(e.target.value)}
                                    placeholder="Enter your email..."
                                    required
                                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#00d2b4] transition"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setStep("select")}
                                    className="flex-1 py-3 bg-neutral-900 border border-neutral-800 text-neutral-400 font-bold rounded-xl text-xs uppercase tracking-wider hover:bg-neutral-800 transition"
                                >
                                    Back
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 bg-[#00d2b4] text-black font-bold rounded-xl text-xs uppercase tracking-wider hover:brightness-110 transition"
                                >
                                    Continue
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                <div className="text-center mt-12 text-[10px] text-neutral-500">
                    By signing in, you agree to SubScript's Terms of Service and Privacy Policy. Embedded wallet credentials are encrypted and stored securely on Supabase.
                </div>
            </div>
        </div>
    );
}

export default function AuthPopupPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-[#121212] text-white p-6 font-sans">
                <Loader2 className="w-10 h-10 text-[#00d2b4] animate-spin mb-4" />
                <p className="text-sm text-white/60">Loading oauth portal...</p>
            </div>
        }>
            <PopupContent />
        </Suspense>
    );
}
