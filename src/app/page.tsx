"use client";

import { useState, useTransition, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Check, Mail, Loader2, AlertCircle, Building2, HelpCircle, BarChart3 } from "lucide-react";
import Navbar from "@/components/Navbar";

const subscriptions = [
    { name: "LLM Inference API", amount: "99.00", status: "active" },
    { name: "Vector DB Storage", amount: "49.00", status: "active" },
    { name: "Web Scraping Cluster", amount: "25.00", status: "active" },
    { name: "Decentralized Compute", amount: "120.00", status: "active" },
];

function RedactedShuffleText({ text, isHovered }: { text: string; isHovered: boolean }) {
    const [displayText, setDisplayText] = useState(text);
    const [isShuffling, setIsShuffling] = useState(false);

    const triggerShuffle = () => {
        if (isShuffling) return;
        setIsShuffling(true);
        const chars = "██▓▓▒▒░░01X$&#%?*+=-";
        let iteration = 0;
        
        const interval = setInterval(() => {
            setDisplayText(
                text
                    .split("")
                    .map((char, index) => {
                        if (char === " ") return " ";
                        if (index < iteration) {
                            return text[index];
                        }
                        return chars[Math.floor(Math.random() * chars.length)];
                    })
                    .join("")
            );
            
            if (iteration >= text.length) {
                clearInterval(interval);
                setIsShuffling(false);
            }
            iteration += 1 / 3;
        }, 35);
    };

    useEffect(() => {
        if (isHovered) {
            triggerShuffle();
        }
    }, [isHovered]);

    // Scramble on initial mount to simulate decryption load
    useEffect(() => {
        triggerShuffle();
    }, []);

    return (
        <span className="font-mono tracking-wide">
            {displayText}
        </span>
    );
}

function MockupDashboardCard() {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    return (
        <motion.div
            className="perspective-container w-full flex justify-center"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            {/* 3D tilted float card container (made wider and more horizontal) */}
            <motion.div
                className="w-full max-w-[420px] sm:max-w-[460px] cursor-pointer"
                animate={{
                    y: [0, -10, 0],
                    rotateX: [8, 6, 8],
                    rotateY: [-12, -9, -12],
                }}
                transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                style={{
                    transformStyle: "preserve-3d",
                }}
                whileHover={{
                    scale: 1.03,
                    rotateX: 4,
                    rotateY: -4,
                    transition: { duration: 0.3 }
                }}
            >
                {/* Dashboard mock card using .liquid-glass class */}
                <div className="w-full liquid-glass rounded-3xl p-5 sm:p-6 tablet-shadow">
                    {/* Window Control Dots: Red, Green, Blue */}
                    <div className="flex gap-1.5 mb-4">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" />
                    </div>

                    {/* Card Title */}
                    <div className="mb-4">
                        <span className="text-[9px] uppercase font-bold tracking-widest text-[#00d2b4]">Agent Allowance</span>
                        <h3 className="text-xs font-bold text-white tracking-tight">Active Subscriptions</h3>
                    </div>

                    {/* Subscription Rows (2-column grid layout to reduce vertical height and stretch horizontally) */}
                    <div className="grid grid-cols-2 gap-2">
                        {subscriptions.map((sub, idx) => (
                            <motion.div
                                key={idx}
                                className="flex items-center justify-between p-2.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl transition-all duration-300"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.1 }}
                                onMouseEnter={() => setHoveredIdx(idx)}
                                onMouseLeave={() => setHoveredIdx(null)}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {/* Indicator Dot */}
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#00d2b4] animate-pulse flex-shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] sm:text-xs font-semibold text-white truncate">
                                            <RedactedShuffleText text={sub.name} isHovered={hoveredIdx === idx} />
                                        </p>
                                        <p className="text-[9px] text-white/40 font-mono tracking-wider mt-0.5">
                                            $██.██ USDC
                                        </p>
                                    </div>
                                </div>
                                {/* Green Active Pill Badge */}
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                                    Active
                                </span>
                            </motion.div>
                        ))}
                    </div>

                    {/* Card Footer Metric */}
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[9px] text-white/50">Monthly Total</span>
                        <span className="text-xs font-bold text-[#00d2b4] font-mono tracking-wider">
                            $██.██ USDC
                        </span>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

function SuccessMessage({ message }: { message: string }) {
    const parts = message.split(/\b(X)\b/);

    return (
        <span className="break-words">
            {parts.map((part, index) =>
                part === "X" ? (
                    <a
                        key={index}
                        href="https://x.com/subscript"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#00d2b4] hover:text-white underline underline-offset-2 transition-colors font-bold"
                    >
                        X
                    </a>
                ) : (
                    <span key={index}>{part}</span>
                )
            )}
        </span>
    );
}

function WaitlistForm() {
    const [step, setStep] = useState<"button" | "email" | "company" | "useCase" | "monthlyVolume" | "success" | "error">("button");
    const [email, setEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [useCase, setUseCase] = useState("");
    const [monthlyVolume, setMonthlyVolume] = useState("");
    const [honeypot, setHoneypot] = useState("");
    const [message, setMessage] = useState("");
    const [isPending, startTransition] = useTransition();

    const handleEmailSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (email.includes("@")) {
            setStep("company");
        }
    };

    const handleCompanySubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (companyName.trim()) {
            setStep("useCase");
        }
    };

    const handleUseCaseSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (useCase) {
            setStep("monthlyVolume");
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !companyName || !useCase || !monthlyVolume) {
            setMessage("Please complete all sections.");
            setStep("error");
            return;
        }

        startTransition(async () => {
            try {
                const response = await fetch("/api/waitlist", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        email,
                        companyName,
                        useCase,
                        monthlyVolume,
                        honeypot,
                    }),
                });

                const data = await response.json();

                if (response.ok) {
                    setMessage(data.message || "Spot secured on priority list.");
                    setStep("success");
                } else {
                    setMessage(data.error || "Something went wrong.");
                    setStep("error");
                    setTimeout(() => {
                        setStep("monthlyVolume");
                    }, 3000);
                }
            } catch (err) {
                console.error("Submission error:", err);
                setMessage("Network error. Please try again.");
                setStep("error");
                setTimeout(() => {
                    setStep("monthlyVolume");
                }, 3000);
            }
        });
    };

    return (
        <div className="min-h-[50px] w-full flex justify-center lg:justify-start">
            <AnimatePresence mode="wait">
                {step === "button" && (
                    <motion.div
                        key="button"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                    >
                        <motion.button
                            onClick={() => setStep("email")}
                            className="liquid-glass rounded-full px-6 py-2 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition-all duration-200 h-9 flex items-center"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            Join Waitlist <span className="text-[#00d2b4] ml-1">&gt;</span>
                        </motion.button>
                    </motion.div>
                )}

                {step === "email" && (
                    <motion.form
                        key="email"
                        onSubmit={handleEmailSubmit}
                        className="liquid-glass rounded-full px-2 flex items-center justify-between w-full max-w-sm shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5 h-9"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="flex items-center flex-1 min-w-0 h-full">
                            <Mail className="ml-2.5 w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your business email..."
                                required
                                className="w-full bg-transparent px-2.5 text-white placeholder-white/40 focus:outline-none text-xs h-full"
                            />
                        </div>
                        <motion.button
                            type="submit"
                            className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/90 transition-all flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Next step"
                        >
                            <ArrowRight className="w-3 h-3 stroke-[2.5]" />
                        </motion.button>
                    </motion.form>
                )}

                {step === "company" && (
                    <motion.form
                        key="company"
                        onSubmit={handleCompanySubmit}
                        className="liquid-glass rounded-full px-2 flex items-center justify-between w-full max-w-sm shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5 h-9"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="flex items-center flex-1 min-w-0 h-full">
                            <button
                                type="button"
                                onClick={() => setStep("email")}
                                className="ml-0.5 p-1 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors flex-shrink-0 mr-1"
                                aria-label="Go back"
                            >
                                <ArrowLeft className="w-3 h-3" />
                            </button>
                            <Building2 className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                            <input
                                type="text"
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                placeholder="Company name..."
                                required
                                className="w-full bg-transparent px-2.5 text-white placeholder-white/40 focus:outline-none text-xs h-full"
                            />
                        </div>
                        <motion.button
                            type="submit"
                            disabled={!companyName.trim()}
                            className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/90 disabled:bg-white/50 transition-all flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Next step"
                        >
                            <ArrowRight className="w-3 h-3 stroke-[2.5]" />
                        </motion.button>
                    </motion.form>
                )}

                {step === "useCase" && (
                    <motion.form
                        key="useCase"
                        onSubmit={handleUseCaseSubmit}
                        className="liquid-glass rounded-full px-2 flex items-center justify-between w-full max-w-sm shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5 h-9"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="flex items-center flex-1 min-w-0 h-full relative">
                            <button
                                type="button"
                                onClick={() => setStep("company")}
                                className="ml-0.5 p-1 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors flex-shrink-0 mr-1"
                                aria-label="Go back"
                            >
                                <ArrowLeft className="w-3 h-3" />
                            </button>
                            <HelpCircle className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                            <select
                                value={useCase}
                                onChange={(e) => setUseCase(e.target.value)}
                                required
                                className="w-full bg-transparent px-2.5 text-white placeholder-white/40 focus:outline-none text-xs h-full cursor-pointer appearance-none pr-8"
                                style={{ colorScheme: "dark" }}
                            >
                                <option value="" disabled className="bg-[#121212] text-white/40">Select use case...</option>
                                <option value="AI Agents/Tooling" className="bg-[#121212] text-white">AI Agents/Tooling</option>
                                <option value="Global SaaS" className="bg-[#121212] text-white">Global SaaS</option>
                                <option value="API Provider" className="bg-[#121212] text-white">API Provider</option>
                                <option value="Web3 Infrastructure" className="bg-[#121212] text-white">Web3 Infrastructure</option>
                            </select>
                            <span className="absolute right-3 pointer-events-none text-white/40 text-[9px]">&#9662;</span>
                        </div>
                        <motion.button
                            type="submit"
                            disabled={!useCase}
                            className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/90 disabled:bg-white/50 transition-all flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Next step"
                        >
                            <ArrowRight className="w-3 h-3 stroke-[2.5]" />
                        </motion.button>
                    </motion.form>
                )}

                {step === "monthlyVolume" && (
                    <motion.form
                        key="monthlyVolume"
                        onSubmit={handleSubmit}
                        className="liquid-glass rounded-full px-2 flex items-center justify-between w-full max-w-sm shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5 h-9"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Honeypot field */}
                        <input
                            type="text"
                            value={honeypot}
                            onChange={(e) => setHoneypot(e.target.value)}
                            className="hidden"
                            tabIndex={-1}
                            autoComplete="off"
                        />
                        <div className="flex items-center flex-1 min-w-0 h-full relative">
                            <button
                                type="button"
                                onClick={() => setStep("useCase")}
                                disabled={isPending}
                                className="ml-0.5 p-1 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors flex-shrink-0 mr-1 disabled:opacity-50"
                                aria-label="Go back"
                            >
                                <ArrowLeft className="w-3 h-3" />
                            </button>
                            <BarChart3 className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                            <select
                                value={monthlyVolume}
                                onChange={(e) => setMonthlyVolume(e.target.value)}
                                required
                                disabled={isPending}
                                className="w-full bg-transparent px-2.5 text-white placeholder-white/40 focus:outline-none text-xs h-full cursor-pointer appearance-none pr-8 disabled:opacity-50"
                                style={{ colorScheme: "dark" }}
                            >
                                <option value="" disabled className="bg-[#121212] text-white/40">Select volume...</option>
                                <option value="< $10k" className="bg-[#121212] text-white">&lt; $10k</option>
                                <option value="$10k - $50k" className="bg-[#121212] text-white">$10k - $50k</option>
                                <option value="$50k+" className="bg-[#121212] text-white">$50k+</option>
                            </select>
                            <span className="absolute right-3 pointer-events-none text-white/40 text-[9px]">&#9662;</span>
                        </div>
                        <motion.button
                            type="submit"
                            disabled={isPending || !monthlyVolume}
                            className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/90 disabled:bg-white/50 transition-all flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Submit"
                        >
                            {isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin stroke-[2.5]" />
                            ) : (
                                <Check className="w-3 h-3 stroke-[2.5]" />
                            )}
                        </motion.button>
                    </motion.form>
                )}

                {step === "success" && (
                    <motion.div
                        key="success"
                        className="liquid-glass rounded-3xl p-5 flex items-start gap-4 w-full max-w-md shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-emerald-500/10 text-emerald-400"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="p-2 bg-emerald-500/10 rounded-full flex-shrink-0 mt-0.5 border border-emerald-500/20">
                            <Check className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-white mb-1 uppercase tracking-wider">Spot Secured</h4>
                            <p className="text-xs text-white/60 leading-relaxed">
                                <SuccessMessage message={message} />
                            </p>
                        </div>
                    </motion.div>
                )}

                {step === "error" && (
                    <motion.div
                        key="error"
                        className="liquid-glass rounded-3xl p-5 flex items-start gap-4 w-full max-w-md shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-red-500/10 text-red-400"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="p-2 bg-red-500/10 rounded-full flex-shrink-0 mt-0.5 border border-red-500/20">
                            <AlertCircle className="w-4 h-4 text-red-400 stroke-[2.5]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-white mb-1 uppercase tracking-wider">Submission Error</h4>
                            <p className="text-xs text-white/60 leading-relaxed">{message}</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function Home() {
    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative z-0 bg-transparent selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background Video (PC/Desktop) */}
            <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none opacity-30 hidden md:block">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                >
                    <source src="/subscript_video_pc.mp4" type="video/mp4" />
                </video>
                {/* Dark Vignette Overlay to ensure contrast and readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/70" />
            </div>

            {/* Background Video (Mobile) */}
            <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none opacity-30 md:hidden">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                >
                    <source src="/subscript_video_mobile.mp4" type="video/mp4" />
                </video>
                {/* Dark Vignette Overlay to ensure contrast and readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/70" />
            </div>

            {/* Background Orbs */}
            <div className="absolute top-0 right-0 w-[400px] h-[400px] sm:w-[700px] sm:h-[700px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] sm:w-[600px] sm:h-[600px] bg-[#d4a853]/3 rounded-full blur-[120px] -z-10 pointer-events-none" />

            <section id="waitlist" className="relative w-full min-h-screen flex items-center justify-center pt-32 sm:pt-36 pb-16 sm:pb-24">
                <div className="max-w-7xl mx-auto w-full px-6 sm:px-12">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
                        
                        {/* Left Column: 3D Mockup Card */}
                        <div className="flex justify-center order-2 lg:order-1 w-full">
                            <MockupDashboardCard />
                        </div>

                        {/* Right Column: Text Content */}
                        <div className="order-1 lg:order-2 text-center lg:text-left flex flex-col items-center lg:items-start">
                            {/* Eyebrow Label: Fades up, small tracking-widest uppercase */}
                            <motion.span
                                className="text-xs sm:text-sm tracking-[0.2em] font-semibold text-white/40 uppercase mb-4"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                            >
                                Agentic Billing Infrastructure
                            </motion.span>

                            {/* Heading: Massive, mixing standard sans with italic Instrument Serif */}
                            <motion.h1
                                className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-8 leading-[1.05] uppercase"
                                initial={{ opacity: 0, y: 40 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.15 }}
                            >
                                Autonomous Billing<br />
                                <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">for the</span> Machine Economy
                            </motion.h1>

                            {/* Subtext Paragraph */}
                            <motion.p
                                className="text-sm sm:text-base text-white/60 max-w-md mb-8 leading-relaxed font-sans"
                                initial={{ opacity: 0, y: 30 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.3 }}
                            >
                                The programmatic recurring payment infrastructure for AI toolchains, autonomous agents, and developer APIs. By combining zero-click smart allowances with invisible cross-chain routing, we enable software to pay software reliably, globally, and autonomously.
                            </motion.p>

                            <WaitlistForm />
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
