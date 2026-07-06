"use client";

import Reveal from "./Reveal";

export default function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
    return (
        <Reveal className="text-center mb-12">
            <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">{eyebrow}</span>
            <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
            {description && (
                <p className="mt-3 text-sm text-white/50 max-w-2xl mx-auto leading-relaxed">{description}</p>
            )}
        </Reveal>
    );
}
