"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

interface AnimatedBottomNavButtonProps {
    label: string;
    icon: LucideIcon;
    active: boolean;
    onClick: () => void;
    accentClassName?: string;
    badgeCount?: number;
}

export default function AnimatedBottomNavButton({
    label,
    icon: Icon,
    active,
    onClick,
    accentClassName = "text-[#00d2b4]",
    badgeCount = 0,
}: AnimatedBottomNavButtonProps) {
    const [expanded, setExpanded] = useState(active);

    useEffect(() => {
        setExpanded(active);
    }, [active]);

    const handleClick = () => {
        setExpanded((current) => (active ? !current : true));
        onClick();
    };

    return (
        <button
            type="button"
            aria-pressed={expanded}
            aria-label={label}
            onClick={handleClick}
            className={`relative h-11 shrink-0 overflow-hidden rounded-full border transition-[width,background-color,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-90 ${
                expanded ? "w-[108px]" : "w-11"
            } ${
                active
                    ? "border-[#00d2b4]/30 bg-[#00d2b4]/10 text-white shadow-[0_8px_24px_rgba(0,210,180,0.08)]"
                    : "border-transparent bg-transparent text-white/40 hover:bg-white/[0.03] hover:text-white"
            }`}
        >
            <span className={`absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${expanded ? "scale-105" : "scale-100"}`}>
                <Icon className={`h-5 w-5 transition-colors duration-300 ${active ? accentClassName : "text-white/40"}`} />
                {badgeCount > 0 && (
                    <span className="absolute right-0 top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-black bg-red-500 px-0.5 text-[7px] font-bold leading-none text-white">
                        {badgeCount > 9 ? "9+" : badgeCount}
                    </span>
                )}
            </span>
            <span
                className={`absolute left-10 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    expanded ? "translate-x-1 opacity-100" : "-translate-x-4 opacity-0"
                }`}
            >
                {label}
            </span>
        </button>
    );
}
