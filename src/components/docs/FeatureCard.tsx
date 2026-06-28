"use client";

import { motion } from "framer-motion";
import { LucideIcon } from "@/components/icons";

interface FeatureCardProps {
    icon: LucideIcon;
    title: string;
    description: string;
    iconColor?: string;
    iconBgColor?: string;
    badge?: string;
}

export default function FeatureCard({
    icon: Icon,
    title,
    description,
    iconColor = "text-[#00d2b4]",
    iconBgColor = "bg-[#00d2b4]/10",
    badge,
}: FeatureCardProps) {
    return (
        <motion.div
            className="relative p-8 rounded-3xl border border-white/5 liquid-glass hover:bg-white/[0.03] transition-all duration-300 group"
            whileHover={{ y: -6, scale: 1.02 }}
        >
            {badge && (
                <div className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-white text-black text-xs font-bold shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                    {badge}
                </div>
            )}

            <div
                className={`w-12 h-12 rounded-2xl ${iconBgColor} border border-[#00d2b4]/10 flex items-center justify-center ${iconColor} mb-5 group-hover:scale-110 transition-transform`}
            >
                <Icon className="w-5 h-5" />
            </div>

            <h3 className="text-base font-bold text-white mb-2 uppercase tracking-wider">{title}</h3>
            <p className="text-xs text-white/50 leading-relaxed">{description}</p>
        </motion.div>
    );
}

// Smaller variant for inline features
interface FeatureItemProps {
    icon: LucideIcon;
    title: string;
    description: string;
    iconColor?: string;
}

export function FeatureItem({
    icon: Icon,
    title,
    description,
    iconColor = "text-[#00d2b4]",
}: FeatureItemProps) {
    return (
        <div className="flex gap-4">
            <div
                className={`w-10 h-10 rounded-lg bg-[#27272a]/50 border border-white/5 flex items-center justify-center ${iconColor} shrink-0`}
            >
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <h4 className="font-bold text-white mb-1">{title}</h4>
                <p className="text-sm text-[#9ca3af]">{description}</p>
            </div>
        </div>
    );
}
