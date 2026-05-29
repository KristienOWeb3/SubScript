"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ChevronDown, PlugZap, Menu, X as CloseIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import DepositModal from "./DepositModal";
import { useAccount, useConnect, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { formatUnits } from "viem";

const WALLET_PLACEHOLDER = "0xYOUR_CONNECTED_WALLET_ADDRESS";

const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    }
] as const;

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

export default function DashboardHeader() {
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const { address: realAddress, isConnected: realIsConnected, chain } = useAccount();
    const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { switchChain } = useSwitchChain();
    
    const [isTestMode, setIsTestMode] = useState(false);
    const [connectErrorMsg, setConnectErrorMsg] = useState<string | null>(null);
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [socialToast, setSocialToast] = useState<string | null>(null);
    
    const pathname = usePathname();

    const showSocialToast = (name: string) => {
        setSocialToast(`${name} is not available because there's currently no socials for now`);
        setTimeout(() => setSocialToast(null), 2500);
    };

    useEffect(() => {
        if (connectError) {
            setConnectErrorMsg(connectError.message);
        }
    }, [connectError]);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsTestMode(
                Boolean(window.navigator.webdriver || document.cookie.includes("subscript_e2e_test=true"))
            );
        }
    }, [realAddress, realIsConnected]);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 30);
        };
        window.addEventListener("scroll", handleScroll);
        return () => {
            window.removeEventListener("scroll", handleScroll);
        };
    }, []);

    const isConnected = realIsConnected || isTestMode;
    const address = realAddress || (isTestMode ? "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29" : undefined);
    const wrongNetwork = Boolean(realIsConnected && chain?.id !== 5042002);

    const { data: balanceRaw } = useReadContract({
        address: "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc",
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        query: {
            enabled: Boolean(address),
        }
    });

    const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
    const mockBalance = balanceRaw !== undefined ? parseFloat(formatUnits(balanceRaw, 6)).toFixed(2) : "0.00";
    const displayName = isConnected ? shortAddress : "Testing Mode";
    const depositAddress = address || WALLET_PLACEHOLDER;

    const handleConnect = () => {
        setConnectErrorMsg(null);
        const connector = connectors.find((c) => c.id === "injected") || connectors[0];
        if (connector) {
            connect({ connector });
        } else {
            connect({ connector: injected() });
        }
    };

    const switchToArcTestnet = () => {
        if (switchChain) {
            switchChain({ chainId: 5042002 });
        }
    };

    const navLinks = [
        { name: "Premium", href: "/premium", className: "text-[#d4a853] hover:text-[#e5be70]" },
        { name: "Explore", href: "/explore", className: pathname === "/explore" ? "text-[#00d2b4] font-semibold" : "text-[#9ca3af] hover:text-white" },
        { name: "Product", href: "/product", className: pathname === "/product" ? "text-[#00d2b4] font-semibold" : "text-[#9ca3af] hover:text-white" },
        { name: "Docs", href: "/docs", className: pathname === "/docs" ? "text-[#00d2b4] font-semibold" : "text-[#9ca3af] hover:text-white" },
        { name: "Developer", href: "/developer", className: pathname === "/developer" ? "text-[#00d2b4] font-semibold" : "text-[#9ca3af] hover:text-white" },
    ];

    return (
        <>
            {/* Floating Navbar Container */}
            <div className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
                <header className={`w-full max-w-5xl liquid-glass rounded-full px-6 py-3.5 flex items-center justify-between pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${scrolled ? "bg-black/40 backdrop-blur-lg" : ""}`}>
                    {/* Left Logo - Icon + Text */}
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

                    {/* Middle Desktop Nav Links */}
                    <div className="hidden md:flex items-center gap-6">
                        {navLinks.map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={`text-xs font-semibold tracking-wide uppercase transition-all duration-200 ${link.className}`}
                            >
                                {link.name}
                            </Link>
                        ))}
                    </div>

                    {/* Right side Profile + Balance + Action buttons */}
                    <div className="hidden md:flex items-center gap-4 sm:gap-6">
                        {/* Wrong Network warning */}
                        {wrongNetwork && (
                            <button
                                onClick={switchToArcTestnet}
                                className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-[10px] font-bold uppercase tracking-wider px-3.5 py-2 rounded-full transition-all duration-200"
                            >
                                Switch to Arc Testnet
                            </button>
                        )}

                        {/* User Profile */}
                        <div className="hidden sm:flex items-center gap-2.5 px-4 py-2 bg-white/[0.03] border border-white/5 rounded-full">
                            <div className="w-6 h-6 bg-[#00d2b4]/10 rounded-full flex items-center justify-center">
                                <Wallet className="w-3 h-3 text-[#00d2b4]" />
                            </div>
                            <span className="text-xs font-semibold text-white/80">{displayName}</span>
                            <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                        </div>

                        {/* Balance Display */}
                        <div className="hidden md:block text-right">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-0.5">
                                SubScript Balance
                            </p>
                            <p className="text-base font-bold text-white tracking-tight">
                                ${mockBalance}{" "}
                                <span className="text-xs text-white/60 font-normal">USDC</span>
                            </p>
                        </div>

                        {/* Deposit Button */}
                        <button
                            onClick={() => {
                                if (isConnected) {
                                    setIsDepositOpen(true);
                                } else {
                                    handleConnect();
                                }
                            }}
                            className="px-6 py-2.5 bg-[#00d2b4] text-[#111111] text-xs font-bold uppercase tracking-wider rounded-full hover:brightness-110 shadow-[0_0_15px_rgba(0,210,180,0.3)] transition-all duration-200"
                        >
                            {isConnected ? "Deposit" : isConnecting ? "Connecting" : "Connect"}
                        </button>

                        {/* Logout button */}
                        <button
                            onClick={isConnected ? () => disconnect() : handleConnect}
                            className="p-2.5 text-white/50 hover:text-white bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-full transition-all"
                            title={isConnected ? "Disconnect wallet" : "Connect wallet"}
                        >
                            <PlugZap className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="md:hidden flex items-center gap-3">
                        {wrongNetwork && (
                            <button
                                onClick={switchToArcTestnet}
                                className="bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition-all duration-200 pointer-events-auto"
                            >
                                Switch Chain
                            </button>
                        )}
                        <button
                            onClick={() => setMobileMenuOpen(true)}
                            className="p-1.5 text-white/70 hover:text-white transition-colors"
                            aria-label="Open Menu"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    </div>
                </header>
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
                        <div className="flex-1 px-8 py-6 flex flex-col gap-4 overflow-y-auto">
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

                            {/* Divider */}
                            <div className="h-[1px] bg-white/10 my-4" />

                            {/* Wallet details & controls inside Mobile Menu */}
                            <div className="space-y-4">
                                {isConnected ? (
                                    <>
                                        <div className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/5 rounded-2xl">
                                            <div className="w-8 h-8 bg-[#00d2b4]/10 rounded-full flex items-center justify-center">
                                                <Wallet className="w-4 h-4 text-[#00d2b4]" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
                                                    Connected Wallet
                                                </p>
                                                <p className="text-sm font-semibold text-white/90">{displayName}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between px-4 py-3 bg-[#00d2b4]/5 border border-[#00d2b4]/10 rounded-2xl">
                                            <div>
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
                                                    SubScript Balance
                                                </p>
                                                <p className="text-lg font-bold text-white tracking-tight">
                                                    ${mockBalance} <span className="text-xs text-white/60 font-normal">USDC</span>
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pt-2">
                                            <button
                                                onClick={() => {
                                                    setMobileMenuOpen(false);
                                                    setIsDepositOpen(true);
                                                }}
                                                className="w-full py-3 bg-[#00d2b4] text-[#111111] text-xs font-bold uppercase tracking-wider rounded-xl hover:brightness-110 transition-all duration-200"
                                            >
                                                Deposit
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setMobileMenuOpen(false);
                                                    disconnect();
                                                }}
                                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white text-xs font-bold uppercase tracking-wider rounded-xl border border-white/10 transition-all duration-200"
                                            >
                                                Disconnect
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => {
                                            setMobileMenuOpen(false);
                                            handleConnect();
                                        }}
                                        className="w-full py-3 bg-[#00d2b4] text-[#111111] text-xs font-bold uppercase tracking-wider rounded-xl hover:brightness-110 transition-all duration-200"
                                    >
                                        {isConnecting ? "Connecting" : "Connect Wallet"}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Social Icons inside Mobile Menu */}
                        <div className="px-8 py-6 border-t border-white/5 bg-[#17171a]/50">
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

            {/* Deposit Modal */}
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={false}
                depositAddress={depositAddress}
            />
        </>
    );
}
