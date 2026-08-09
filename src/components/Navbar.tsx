"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Terminal, Menu, X as CloseIcon } from "@/components/icons";
import { motion, AnimatePresence } from "framer-motion";
import LiquidGlassEffect from "@/components/LiquidGlassEffect";

const overlayVariants = {
    hidden: { y: "-100%" },
    visible: {
        y: 0,
        transition: {
            type: "tween",
            ease: [0.16, 1, 0.3, 1], // easeOutExpo
            duration: 0.45
        }
    },
    exit: {
        y: "-100%",
        transition: {
            type: "tween",
            ease: [0.7, 0, 0.84, 0], // easeInExpo
            duration: 0.35
        }
    }
};

const staggerContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.06,
            delayChildren: 0.2
        }
    },
    exit: {
        opacity: 0,
        transition: {
            staggerChildren: 0.04,
            staggerDirection: -1
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: "spring",
            stiffness: 450,
            damping: 32
        }
    },
    exit: { opacity: 0, y: 10 }
};

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [wrongNetwork, setWrongNetwork] = useState(false);
    const [walletConnected, setWalletConnected] = useState(false);
    const pathname = usePathname();

    const checkNetwork = async () => {
        if (typeof window === "undefined") return;
        const ethereum = (window as any).ethereum;
        if (!ethereum) return;

        try {
            const accounts = await ethereum.request({ method: "eth_accounts" });
            if (accounts && accounts.length > 0) {
                setWalletConnected(true);
                const chainIdHex = await ethereum.request({ method: "eth_chainId" });
                const targetChainIdHex = "0x" + (5042002).toString(16); // "0x4ceef2"
                setWrongNetwork(chainIdHex !== targetChainIdHex);
            } else {
                setWalletConnected(false);
                setWrongNetwork(false);
            }
        } catch (err) {
            console.error("Network check error:", err);
        }
    };

    const switchToArcTestnet = async () => {
        if (typeof window === "undefined") return;
        const ethereum = (window as any).ethereum;
        if (!ethereum) {
            console.warn("No compatible wallet detected. Please install a Web3 wallet such as MetaMask to switch networks.");
            return;
        }

        const chainIdHex = "0x" + (5042002).toString(16); // "0x4ceef2"
        try {
            await ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: chainIdHex }],
            });
            setWrongNetwork(false);
        } catch (switchError: any) {
            if (switchError.code === 4001) {
                console.warn("Network switch cancelled");
                return;
            }

            if (switchError.code === 4902) {
                try {
                    await ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [
                            {
                                chainId: chainIdHex,
                                chainName: "Arc Testnet",
                                rpcUrls: ["https://5042002.rpc.thirdweb.com"],
                                nativeCurrency: {
                                    name: "USDC",
                                    symbol: "USDC",
                                    decimals: 6,
                                },
                                blockExplorerUrls: ["https://testnet.arcscan.app"],
                            },
                        ],
                    });
                    setWrongNetwork(false);
                } catch (addError: any) {
                    if (addError.code === 4001) {
                        console.warn("Network switch cancelled");
                        return;
                    }
                    console.error("Failed to add Arc Testnet:", addError);
                }
            } else {
                console.error("Failed to switch to Arc Testnet:", switchError);
            }
        }
    };

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 30);
        };
        window.addEventListener("scroll", handleScroll);

        checkNetwork();

        const ethereum = (window as any).ethereum;
        if (ethereum && ethereum.on) {
            ethereum.on("chainChanged", checkNetwork);
            ethereum.on("accountsChanged", checkNetwork);
        }

        return () => {
            window.removeEventListener("scroll", handleScroll);
            if (ethereum && ethereum.removeListener) {
                ethereum.removeListener("chainChanged", checkNetwork);
                ethereum.removeListener("accountsChanged", checkNetwork);
            }
        };
    }, []);

    const navLinks = [
        { name: "Documentation", href: "/docs", className: "text-[#9ca3af] hover:text-white" },
        { name: "Protocol", href: "/protocol", className: "text-[#9ca3af] hover:text-white" },
        { name: "Compare", href: "/compare", className: "text-[#9ca3af] hover:text-white" },
        { name: "Answers", href: "/answers", className: "text-[#9ca3af] hover:text-white" },
        { name: "Support", href: "/support", className: "text-[#9ca3af] hover:text-white" },
        { name: "Sign in", href: "/login", className: "text-[#9ca3af] hover:text-white" },
    ];

    return (
        <>
            {/* Main Floating Navbar Container */}
            <div className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
                <nav
                    className={`w-full max-w-5xl liquid-glass rounded-full px-6 py-3.5 flex items-center justify-between pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${scrolled ? "bg-black/40 backdrop-blur-lg" : ""}`}
                >
                    <LiquidGlassEffect />
                    {/* Logo - Icon + Text */}
                    <Link href="/" className="flex items-center gap-2.5 group">
                        <img 
                            src="/logo.png" 
                            alt="SubScript Logo" 
                            className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)] group-hover:scale-105 transition-transform" 
                        />
                        <span className="text-base font-bold text-white tracking-tight group-hover:text-[#00d2b4] transition-colors">
                            SubScript
                        </span>
                    </Link>

                    {/* Desktop Nav Links */}
                    <div className="hidden lg:flex items-center gap-6">
                        {navLinks.filter(link => link.name !== "Sign in").map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={`text-xs font-semibold tracking-wide uppercase transition-all duration-200 ${pathname === link.href ? "text-[#00d2b4]" : "text-[#9ca3af] hover:text-white"}`}
                            >
                                {link.name}
                            </Link>
                        ))}
                    </div>

                    {/* Right Action buttons */}
                    <div className="hidden lg:flex items-center gap-6">
                        {wrongNetwork && walletConnected && (
                            <button
                                onClick={switchToArcTestnet}
                                className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-[10px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-full transition-all duration-200"
                            >
                                Switch to Arc Testnet
                            </button>
                        )}
                        <Link
                            href="/login"
                            className="text-sm font-semibold text-white/60 hover:text-white transition-colors"
                        >
                            Sign in
                        </Link>
                        <Link
                            href="/signup"
                            className="liquid-glass rounded-full px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/5 transition-all duration-200"
                        >
                            Create account
                        </Link>
                    </div>

                    {/* Mobile Menu Button & Sign Up */}
                    <div className="lg:hidden flex items-center gap-3">
                        {wrongNetwork && walletConnected && (
                            <button
                                onClick={switchToArcTestnet}
                                className="bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition-all duration-200 pointer-events-auto"
                            >
                                Switch Chain
                            </button>
                        )}
                        <Link
                            href="/signup"
                            className="bg-[#00d2b4] text-[#111111] text-xs font-semibold px-3.5 py-1.5 rounded-full hover:brightness-110 shadow-[0_0_8px_rgba(0,210,180,0.25)] transition-all duration-200"
                        >
                            Sign up
                        </Link>
                        <button
                            onClick={() => setMobileMenuOpen(true)}
                            className="p-1.5 text-white/70 hover:text-white transition-colors"
                            aria-label="Open Menu"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    </div>
                </nav>
            </div>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <motion.div
                        className="fixed inset-0 z-50 lg:hidden flex flex-col bg-black/95 backdrop-blur-xl"
                        variants={overlayVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                    >
                        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
                            {/* Logo */}
                            <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileMenuOpen(false)}>
                                <img 
                                    src="/logo.png" 
                                    alt="SubScript Logo" 
                                    className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)]" 
                                />
                                <span className="text-xl font-bold text-white tracking-tight">
                                    SubScript
                                </span>
                            </Link>

                            <button
                                onClick={() => setMobileMenuOpen(false)}
                                className="p-2 text-[#9ca3af] hover:text-white transition-colors"
                                aria-label="Close Menu"
                            >
                                <CloseIcon className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Stagger Container wraps links and footer details so everything animates in order */}
                        <motion.div
                            className="flex-1 flex flex-col min-h-0"
                            variants={staggerContainerVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                        >
                            {/* Scrollable container for links if screen is small */}
                            <div className="flex-1 px-8 py-8 flex flex-col gap-4 overflow-y-auto">
                                {navLinks.map((link) => (
                                    <motion.div
                                        key={link.name}
                                        variants={itemVariants}
                                    >
                                        <Link
                                            href={link.href}
                                            onClick={() => setMobileMenuOpen(false)}
                                            className={`block text-2xl font-semibold py-2 transition-colors ${pathname === link.href ? "text-[#00d2b4]" : "text-[#9ca3af] hover:text-white"}`}
                                        >
                                            {link.name}
                                        </Link>
                                    </motion.div>
                                ))}
                                {/* Sign Up Link inside Mobile Overlay */}
                                <motion.div
                                    variants={itemVariants}
                                    className="pt-4 border-t border-white/5"
                                >
                                    <Link
                                        href="/signup"
                                        onClick={() => setMobileMenuOpen(false)}
                                        className="block text-2xl font-semibold text-[#00d2b4] py-2"
                                    >
                                        Create account
                                    </Link>
                                </motion.div>
                            </div>

                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>


        </>
    );
}
