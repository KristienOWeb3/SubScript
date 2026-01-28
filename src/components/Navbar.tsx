"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Terminal } from "lucide-react";

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 px-8 py-4 transition-all duration-300 ${scrolled
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

                {/* Nav Links */}
                <div className="hidden md:flex items-center gap-8">
                    <Link
                        href="#"
                        className="text-amber-500 text-sm font-medium hover:text-amber-400 transition-colors"
                    >
                        Premium
                    </Link>
                    <Link
                        href="#explore"
                        className="text-muted-gray text-sm font-medium hover:text-white transition-colors"
                    >
                        Explore
                    </Link>
                    <Link
                        href="#"
                        className="text-muted-gray text-sm font-medium hover:text-white transition-colors"
                    >
                        Product
                    </Link>
                    <Link
                        href="#"
                        className="text-muted-gray text-sm font-medium hover:text-white transition-colors"
                    >
                        Developer
                    </Link>
                    <Link
                        href="#"
                        className="text-muted-gray text-sm font-medium hover:text-white transition-colors"
                    >
                        Sign in
                    </Link>
                </div>

                {/* Mobile Menu Button */}
                <button className="md:hidden flex flex-col gap-1.5" aria-label="Open menu">
                    <span className="w-6 h-0.5 bg-white rounded-full"></span>
                    <span className="w-6 h-0.5 bg-white rounded-full"></span>
                    <span className="w-6 h-0.5 bg-white rounded-full"></span>
                </button>
            </div>
        </nav>
    );
}
