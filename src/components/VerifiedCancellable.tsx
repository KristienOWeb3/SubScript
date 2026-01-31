"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2 } from "lucide-react";

interface VerifiedCancellableProps {
    merchantAddress?: string;
    size?: "sm" | "md" | "lg";
    showDetails?: boolean;
}

export default function VerifiedCancellable({
    merchantAddress = "0x1234...abcd",
    size = "md",
    showDetails = false,
}: VerifiedCancellableProps) {
    const [isVerified, setIsVerified] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Simulate on-chain verification
    useEffect(() => {
        const verifyOnChain = async () => {
            setIsLoading(true);
            // Simulate network delay
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // In production, this would query the SubScript contract
            // to verify the Kill Switch exists and is callable
            setIsVerified(true);
            setIsLoading(false);
        };

        verifyOnChain();
    }, [merchantAddress]);

    const sizeClasses = {
        sm: "px-3 py-1.5 text-xs gap-1.5",
        md: "px-4 py-2 text-sm gap-2",
        lg: "px-5 py-2.5 text-base gap-2.5",
    };

    const iconSizes = {
        sm: "w-3.5 h-3.5",
        md: "w-4 h-4",
        lg: "w-5 h-5",
    };

    if (isLoading) {
        return (
            <div
                className={`inline-flex items-center rounded-full bg-slate-800 text-slate-400 font-medium ${sizeClasses[size]}`}
            >
                <Loader2 className={`${iconSizes[size]} animate-spin`} />
                <span>Verifying...</span>
            </div>
        );
    }

    if (!isVerified) {
        return (
            <div
                className={`inline-flex items-center rounded-full bg-red-950/50 border border-red-500/30 text-red-400 font-medium ${sizeClasses[size]}`}
            >
                <span>Not Verified</span>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-block"
        >
            <div
                className={`inline-flex items-center rounded-full bg-emerald-950/50 border border-emerald-500/30 text-emerald-400 font-medium ${sizeClasses[size]}`}
            >
                <ShieldCheck className={iconSizes[size]} />
                <span>Verified Cancellable</span>
            </div>

            {showDetails && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mt-2 text-xs text-slate-500"
                >
                    <p>✓ Kill Switch enabled</p>
                    <p>✓ Session Key revocable by user</p>
                    <p>✓ Protected by SubScript Protocol</p>
                </motion.div>
            )}
        </motion.div>
    );
}

// Embeddable version for merchants
export function VerifiedCancellableBadge() {
    return (
        <a
            href="https://subscript.io/verify"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:brightness-110 transition shadow-lg shadow-emerald-500/20"
        >
            <ShieldCheck className="w-4 h-4" />
            Powered by SubScript
        </a>
    );
}
