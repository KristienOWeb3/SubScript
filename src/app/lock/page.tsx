"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react";

function LockForm() {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get("to") || "/dashboard";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const res = await fetch("/api/lock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });

            const data = await res.json();

            if (res.ok && data.success) {
                router.push(redirectTo);
                router.refresh();
            } else {
                setError(data.message || "Invalid access code");
            }
        } catch (err) {
            setError("Something went wrong. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="w-full relative">
            <div className="liquid-glass rounded-full px-3 py-1 flex items-center justify-between w-full max-w-sm mx-auto shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5 h-12">
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password..."
                    required
                    autoFocus
                    className="w-full bg-transparent px-4 py-2 text-white placeholder-white/40 focus:outline-none text-sm text-center"
                />
                <button
                    type="submit"
                    disabled={isLoading}
                    className="bg-white text-black p-2 rounded-full flex items-center justify-center hover:bg-white/90 disabled:bg-white/50 transition-all flex-shrink-0"
                    aria-label="Unlock"
                >
                    {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin stroke-[2.5]" />
                    ) : (
                        <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                    )}
                </button>

            </div>

            {/* Error message */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="flex items-center justify-center gap-2 mt-4 text-red-400 text-xs"
                    >
                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{error}</span>
                            </motion.div>
                )}
            </AnimatePresence>
        </form>
    );
}

export default function LockScreen() {
    return (
        <main className="min-h-screen w-full bg-black text-white flex items-center justify-center relative overflow-hidden px-6 selection:bg-[#00d2b4]/30 selection:text-white">
            {/* Background Video (PC/Desktop) */}
            <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none opacity-20 hidden md:block">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                >
                    <source src="/subscript_video_pc.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/70" />
            </div>

            {/* Background Video (Mobile) */}
            <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none opacity-20 md:hidden">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                >
                    <source src="/subscript_video_mobile.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/70" />
            </div>

            {/* Background Orbs */}
            <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-[#00d2b4]/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
            <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] bg-[#d4a853]/3 rounded-full blur-[100px] -z-10 pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                className="w-full max-w-md text-center flex flex-col items-center"
            >
                {/* Lock Icon Emblem */}
                <motion.div
                    className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center mb-6 shadow-xl relative"
                    animate={{
                        y: [0, -6, 0]
                    }}
                    transition={{
                        duration: 4,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                >
                    <Lock className="w-5 h-5 text-[#00d2b4]" />
                </motion.div>

                {/* Heading */}
                <h1 className="text-3xl font-extrabold text-white uppercase tracking-wider mb-2">
                    Restricted <span className="font-serif italic text-[#00d2b4] lowercase font-normal">access</span>
                </h1>
                <p className="text-xs text-white/50 mb-8 max-w-xs leading-relaxed font-sans">
                    Please enter the platform access code to unlock the SubScript portal.
                </p>

                {/* Password Input Form wrapped in Suspense */}
                <Suspense fallback={
                    <div className="w-full max-w-sm mx-auto flex justify-center py-4">
                        <Loader2 className="w-6 h-6 text-[#00d2b4] animate-spin" />
                    </div>
                }>
                    <LockForm />
                </Suspense>
            </motion.div>

            {/* Footer */}
            <div className="absolute bottom-6 left-0 right-0 z-20 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/30 max-w-md mx-auto px-6 gap-2">
                <span>© 2026 SubScript Protocol.</span>
                <div className="flex gap-4">
                    <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                    <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                </div>
            </div>
        </main>
    );
}

