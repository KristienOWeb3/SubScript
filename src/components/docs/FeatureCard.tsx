"use client";

import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

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
    iconColor = "text-blue-400",
    iconBgColor = "bg-blue-500/20",
    badge,
}: FeatureCardProps) {
    return (
        <motion.div
            className="relative p-6 rounded-xl border border-slate-800 bg-slate-900/30 hover:bg-slate-900/50 transition-all duration-300 group"
            whileHover={{ y: -2, borderColor: "rgba(59, 130, 246, 0.5)" }}
        >
            {badge && (
                <div className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-bold">
                    {badge}
                </div>
            )}

            <div
                className={`w-12 h-12 rounded-lg ${iconBgColor} flex items-center justify-center ${iconColor} mb-4 group-hover:scale-110 transition-transform`}
            >
                <Icon className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
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
    iconColor = "text-blue-400",
}: FeatureItemProps) {
    return (
        <div className="flex gap-4">
            <div
                className={`w-10 h-10 rounded-lg bg-slate-800/50 flex items-center justify-center ${iconColor} shrink-0`}
            >
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <h4 className="font-bold text-white mb-1">{title}</h4>
                <p className="text-sm text-slate-400">{description}</p>
            </div>
        </div>
    );
}
