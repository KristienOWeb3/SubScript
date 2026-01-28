"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Terminal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Social Media Icons (Custom SVGs for brand accuracy)
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

// Social Links Configuration
const socialLinks = [
    { name: "X (Twitter)", href: "https://x.com/subscript", icon: TwitterXIcon },
    { name: "Discord", href: "https://discord.gg/subscript", icon: DiscordIcon },
    { name: "Telegram", href: "https://t.me/subscript", icon: TelegramIcon },
];

// Navigation Links Configuration
const navLinks = [
    { name: "Premium", href: "#", className: "text-amber-500 hover:text-amber-400" },
    { name: "Explore", href: "#explore", className: "text-muted-gray hover:text-white" },
    { name: "Product", href: "#", className: "text-muted-gray hover:text-white" },
    { name: "Docs", href: "#", className: "text-muted-gray hover:text-white" },
    { name: "Developer", href: "#", className: "text-muted-gray hover:text-white" },
    { name: "Sign in", href: "#", className: "text-muted-gray hover:text-white" },
];

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Close mobile menu on resize to desktop
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768) {
                setMobileMenuOpen(false);
            }
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Prevent body scroll when mobile menu is open
    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    }, [mobileMenuOpen]);

    return (
        <>
            {/* Main Navbar - z-40 so mobile menu can be on top */}
            <nav
                className={`fixed top-0 left-0 right-0 z-40 px-4 sm:px-8 py-4 transition-all duration-300 ${scrolled
                    ? "bg-dark-charcoal/95 backdrop-blur-md shadow-lg"
                    : "bg-transparent"
                    }`}
            >
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2 group">
                        <div className="w-8 h-8 bg-leetcode-teal rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                            <Terminal className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-xl font-bold text-white tracking-tight">
                            SubScript
                        </span>
                    </Link>

                    {/* Desktop Nav Links */}
                    <div className="hidden md:flex items-center gap-8">
                        {navLinks.map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={`text-sm font-medium transition-colors ${link.className}`}
                            >
                                {link.name}
                            </Link>
                        ))}
                    </div>

                    {/* Mobile Menu Button - ONLY visible when menu is CLOSED */}
                    {!mobileMenuOpen && (
                        <button
                            className="md:hidden flex flex-col gap-1.5 p-2 -mr-2"
                            aria-label="Open menu"
                            onClick={() => setMobileMenuOpen(true)}
                        >
                            <span className="w-6 h-0.5 bg-white rounded-full block" />
                            <span className="w-6 h-0.5 bg-white rounded-full block" />
                            <span className="w-6 h-0.5 bg-white rounded-full block" />
                        </button>
                    )}
                </div>
            </nav>

            {/* Mobile Menu Overlay - z-50 to be ON TOP of navbar */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <motion.div
                        className="fixed inset-0 z-50 md:hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        {/* Full-Screen Solid Background - Covers entire screen including navbar/logo */}
                        <motion.div
                            className="absolute inset-0 bg-[#0a0a0a]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        />

                        {/* Menu Content */}
                        <motion.div
                            className="relative h-full w-full flex flex-col"
                            initial={{ x: 20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 20, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            {/* Header with Logo and Close Button */}
                            <div className="flex items-center justify-between px-4 py-4">
                                {/* Logo (visible in menu) */}
                                <Link
                                    href="/"
                                    className="flex items-center gap-2"
                                    onClick={() => setMobileMenuOpen(false)}
                                >
                                    <div className="w-8 h-8 bg-leetcode-teal rounded-lg flex items-center justify-center">
                                        <Terminal className="w-5 h-5 text-white" />
                                    </div>
                                    <span className="text-xl font-bold text-white tracking-tight">
                                        SubScript
                                    </span>
                                </Link>

                                {/* Single Close Button (X icon) */}
                                <button
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="p-2 -mr-2 text-white hover:text-gray-300 transition-colors"
                                    aria-label="Close menu"
                                >
                                    <svg
                                        className="w-6 h-6"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M6 18L18 6M6 6l12 12"
                                        />
                                    </svg>
                                </button>
                            </div>

                            {/* Navigation Links */}
                            <div className="flex-1 px-6 py-6 space-y-2">
                                {navLinks.map((link, index) => (
                                    <motion.div
                                        key={link.name}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                    >
                                        <Link
                                            href={link.href}
                                            onClick={() => setMobileMenuOpen(false)}
                                            className={`block text-xl font-medium py-3 transition-colors ${link.className}`}
                                        >
                                            {link.name}
                                        </Link>
                                    </motion.div>
                                ))}
                            </div>

                            {/* Social Icons Section - Bottom of menu */}
                            <div className="px-6 py-6 border-t border-[#2a2a2a]">
                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Follow Us</p>
                                <div className="flex items-center gap-4">
                                    {socialLinks.map((social) => (
                                        <a
                                            key={social.name}
                                            href={social.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="w-12 h-12 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-400 hover:text-white hover:border-leetcode-teal transition-all duration-200"
                                            aria-label={social.name}
                                        >
                                            <social.icon className="w-6 h-6" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Desktop Social Icons - Fixed Bottom Right */}
            <div className="hidden md:flex fixed bottom-6 right-6 z-40 flex-col gap-3">
                {socialLinks.map((social) => (
                    <a
                        key={social.name}
                        href={social.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-11 h-11 rounded-xl bg-dark-charcoal/90 backdrop-blur-sm border border-[#2a2a2a] flex items-center justify-center text-gray-400 hover:text-white hover:border-leetcode-teal hover:scale-110 transition-all duration-200 shadow-lg"
                        aria-label={social.name}
                    >
                        <social.icon className="w-5 h-5" />
                    </a>
                ))}
            </div>
        </>
    );
}
