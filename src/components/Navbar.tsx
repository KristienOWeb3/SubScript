"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Terminal, Menu, X as CloseIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Circular SVGs for Socials
function TwitterXIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    );
}

function DiscordIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    );
}

function TelegramIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
    );
}

const socialLinks = [
    { name: "X (Twitter)", href: "https://x.com/subscript", icon: TwitterXIcon },
    { name: "Discord", href: "https://discord.gg/subscript", icon: DiscordIcon },
    { name: "Telegram", href: "https://t.me/subscript", icon: TelegramIcon },
];

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [socialToast, setSocialToast] = useState<string | null>(null);
    const [wrongNetwork, setWrongNetwork] = useState(false);
    const [walletConnected, setWalletConnected] = useState(false);
    const pathname = usePathname();

    const showSocialToast = (name: string) => {
        setSocialToast(`${name} is not available because there's currently no socials for now`);
        setTimeout(() => setSocialToast(null), 2500);
    };

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
            alert("No Web3 wallet detected. Please install Metamask or Rabby.");
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
                setSocialToast("Network switch cancelled");
                setTimeout(() => setSocialToast(null), 3000);
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
                                blockExplorerUrls: ["https://explorer.arc.network"],
                            },
                        ],
                    });
                    setWrongNetwork(false);
                } catch (addError: any) {
                    if (addError.code === 4001) {
                        setSocialToast("Network switch cancelled");
                        setTimeout(() => setSocialToast(null), 3000);
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
        { name: "Sign in", href: "/login", className: "text-[#9ca3af] hover:text-white" },
    ];

    return (
        <>
            {/* Main Floating Navbar Container */}
            <div className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
                <nav
                    className={`w-full max-w-5xl liquid-glass rounded-full px-6 py-3.5 flex items-center justify-between pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${scrolled ? "bg-black/40 backdrop-blur-lg" : ""}`}
                >
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
                    <div className="hidden md:flex items-center gap-6">
                        {navLinks.filter(link => link.name !== "Sign in").map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={`text-xs font-semibold tracking-wide uppercase transition-all duration-200 ${link.className}`}
                            >
                                {link.name}
                            </Link>
                        ))}
                    </div>

                    {/* Right Action buttons */}
                    <div className="hidden md:flex items-center gap-6">
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
                            className="text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors"
                        >
                            Sign In
                        </Link>
                        <Link 
                            href="/signup"
                            className="liquid-glass rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/5 transition-all duration-200"
                        >
                            Sign Up
                        </Link>
                    </div>

                    {/* Mobile Menu Button & Sign Up */}
                    <div className="md:hidden flex items-center gap-3">
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
                            className="bg-[#00d2b4] text-[#111111] text-[10px] font-bold uppercase tracking-widest px-3.5 py-1.5 rounded-full hover:brightness-110 shadow-[0_0_8px_rgba(0,210,180,0.25)] transition-all duration-200"
                        >
                            Sign Up
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
                        className="fixed inset-0 z-50 md:hidden flex flex-col bg-black/95 backdrop-blur-xl"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
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

                        {/* Navigation Links */}
                        <div className="flex-1 px-8 py-8 flex flex-col gap-4">
                            {navLinks.map((link, idx) => (
                                <motion.div
                                    key={link.name}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                >
                                    <Link
                                        href={link.href}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className={`block text-2xl font-semibold py-2 transition-colors ${link.className}`}
                                    >
                                        {link.name}
                                    </Link>
                                </motion.div>
                            ))}
                            {/* Sign Up Link inside Mobile Overlay */}
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: navLinks.length * 0.05 }}
                                className="pt-4 border-t border-white/5"
                            >
                                <Link
                                    href="/signup"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="block text-2xl font-black text-[#00d2b4] py-2 uppercase tracking-wide"
                                >
                                    Sign Up
                                </Link>
                            </motion.div>
                        </div>

                        {/* Social Icons inside Mobile Menu */}
                        <div className="px-8 py-8 border-t border-white/5 bg-[#17171a]/50">
                            <p className="text-xs font-bold text-[#9ca3af] uppercase tracking-wider mb-4">Community</p>
                            <div className="flex items-center gap-4">
                                {socialLinks.map((social) => (
                                    <button
                                        key={social.name}
                                        onClick={() => { showSocialToast(social.name); setMobileMenuOpen(false); }}
                                        className="w-12 h-12 rounded-xl bg-[#27272a]/80 border border-white/5 flex items-center justify-center text-[#9ca3af] hover:text-[#00d2b4] hover:border-[#00d2b4] transition-all duration-200"
                                        aria-label={social.name}
                                    >
                                        <social.icon className="w-6 h-6" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Desktop Social Icons - Vertically Centered on Right Edge */}
            <div className="hidden md:flex fixed right-6 top-1/2 -translate-y-1/2 z-40 flex-col gap-4">
                {socialLinks.map((social) => (
                    <motion.button
                        key={social.name}
                        onClick={() => showSocialToast(social.name)}
                        className="w-11 h-11 rounded-full liquid-glass flex items-center justify-center text-white/50 hover:text-[#00d2b4] transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
                        aria-label={social.name}
                        whileHover={{ scale: 1.1, rotate: -6 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <social.icon className="w-4 h-4" />
                    </motion.button>
                ))}
            </div>

            {/* Social Toast Notification */}
            <AnimatePresence>
                {socialToast && (
                    <motion.div
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 liquid-glass rounded-full px-5 py-2.5 text-xs font-semibold text-white/80 tracking-wide uppercase border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.25 }}
                    >
                        {socialToast}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
