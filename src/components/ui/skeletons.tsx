"use client";

import React from "react";
import Skeleton from "./Skeleton";

/* Composite skeletons.
 *
 * The `Skeleton` primitive next door draws one bar. These assemble the shapes the app actually
 * loads — list rows, stat tiles, tables, cards — so ~20 call sites don't each hand-roll a block
 * and drift apart. Density and proportions follow the reference skeleton inlined at
 * dashboard/user/page.tsx (the full-page load), which mirrors its real layout closely enough that
 * content swapping in doesn't jump.
 *
 * ACCESSIBILITY. These replace spinners that sat beside text like "Loading history…", so the
 * announcement has to come from somewhere. Every composite is a role="status" region carrying an
 * sr-only label. Pass `label` whenever a bare "Loading…" would be ambiguous on a page with more
 * than one loading region. The bars hold no text, so they are silent to a screen reader already.
 *
 * Layout classes live on an inner element rather than the status wrapper: `sr-only` is absolutely
 * positioned but still a DOM child, so a `divide-y` or `grid` on the wrapper would count it and
 * mis-space the first real row.
 *
 * Radius: the primitive hardcodes `rounded-2xl`, and Tailwind emits `rounded-full` after it, so
 * `rounded-full` overrides while `rounded-lg`/`rounded-xl` would silently lose. Bars therefore go
 * full-pill and chunkier blocks keep the 2xl default — never pass an intermediate radius here.
 *
 * The shimmer lives in globals.css (.subscript-skeleton / .liquid-glass-skeleton), which already
 * degrades to a plain pulse under prefers-reduced-motion.
 */

type Busy = { label?: string; className?: string };

function Region({
    label = "Loading…",
    className = "",
    children,
}: Busy & { children: React.ReactNode }) {
    return (
        <div role="status" aria-live="polite" aria-busy="true" className={className}>
            <span className="sr-only">{label}</span>
            {children}
        </div>
    );
}

/** One pill bar. */
export function SkeletonLine({
    width = "100%",
    height = 10,
    faint = false,
    className = "",
}: {
    width?: string | number;
    height?: string | number;
    faint?: boolean;
    className?: string;
}) {
    return (
        <Skeleton
            width={width}
            height={height}
            variant={faint ? "faint" : "default"}
            className={`rounded-full ${className}`}
        />
    );
}

/* Ragged widths, cycled by index — a column of identical bars reads as a rendering bug. */
const PRIMARY_WIDTHS = ["62%", "48%", "71%", "55%", "66%", "43%"];
const SECONDARY_WIDTHS = ["38%", "45%", "31%", "42%", "35%", "48%"];

/**
 * Repeated list rows: optional leading avatar, one or two text lines, optional trailing amount.
 * Covers transaction lists, merchant lists, DM lists, ban lists, and the KYC review queue.
 */
export function SkeletonRows({
    count = 5,
    avatar = true,
    lines = 2,
    trailing = true,
    label = "Loading list…",
    className = "",
}: Busy & {
    count?: number;
    avatar?: boolean;
    lines?: 1 | 2;
    trailing?: boolean;
}) {
    return (
        <Region label={label} className={className}>
            <div className="divide-y divide-white/[0.05]">
                {Array.from({ length: count }, (_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-4">
                        {avatar && <Skeleton circle width={40} height={40} className="shrink-0" />}
                        <div className="min-w-0 flex-1 space-y-2">
                            <SkeletonLine width={PRIMARY_WIDTHS[i % PRIMARY_WIDTHS.length]} height={11} />
                            {lines === 2 && (
                                <SkeletonLine
                                    width={SECONDARY_WIDTHS[i % SECONDARY_WIDTHS.length]}
                                    height={8}
                                    faint
                                />
                            )}
                        </div>
                        {trailing && (
                            <div className="shrink-0 space-y-2">
                                <SkeletonLine width={64} height={11} className="ml-auto" />
                                {lines === 2 && (
                                    <SkeletonLine width={40} height={8} faint className="ml-auto" />
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </Region>
    );
}

/** A glass card: eyebrow label, headline figure, then `lines` supporting bars. */
export function SkeletonCard({
    lines = 2,
    headline = true,
    label = "Loading…",
    className = "",
}: Busy & { lines?: number; headline?: boolean }) {
    return (
        <Region
            label={label}
            className={`rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl ${className}`}
        >
            <div className="space-y-3">
                <SkeletonLine width="35%" height={9} faint />
                {headline && <Skeleton width="55%" height={34} />}
                {Array.from({ length: lines }, (_, i) => (
                    <SkeletonLine
                        key={i}
                        width={SECONDARY_WIDTHS[i % SECONDARY_WIDTHS.length]}
                        height={9}
                        faint
                    />
                ))}
            </div>
        </Region>
    );
}

/**
 * Grid of small stat tiles — the admin Analytics shape, and the merchant analytics summary row.
 * `columns` maps to fixed class strings because Tailwind cannot see dynamically-built names.
 */
export function SkeletonStatGrid({
    count = 6,
    columns = 3,
    label = "Loading metrics…",
    className = "",
}: Busy & { count?: number; columns?: 2 | 3 | 4 }) {
    const cols =
        columns === 2
            ? "sm:grid-cols-2"
            : columns === 4
              ? "sm:grid-cols-2 lg:grid-cols-4"
              : "sm:grid-cols-2 lg:grid-cols-3";

    return (
        <Region label={label} className={className}>
            <div className={`grid grid-cols-1 gap-4 ${cols}`}>
                {Array.from({ length: count }, (_, i) => (
                    <div
                        key={i}
                        className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-2.5"
                    >
                        <SkeletonLine width="52%" height={8} faint />
                        <Skeleton width="68%" height={24} />
                    </div>
                ))}
            </div>
        </Region>
    );
}

/** Header row plus body rows. For tabular data that isn't an avatar list. */
export function SkeletonTable({
    rows = 5,
    columns = 4,
    label = "Loading table…",
    className = "",
}: Busy & { rows?: number; columns?: number }) {
    return (
        <Region
            label={label}
            className={`overflow-hidden rounded-2xl border border-white/10 bg-black/20 ${className}`}
        >
            <div>
                <div className="flex gap-4 border-b border-white/10 px-5 py-3.5">
                    {Array.from({ length: columns }, (_, c) => (
                        <SkeletonLine key={c} width={c === 0 ? "28%" : "16%"} height={8} faint />
                    ))}
                </div>
                <div className="divide-y divide-white/[0.05]">
                    {Array.from({ length: rows }, (_, r) => (
                        <div key={r} className="flex gap-4 px-5 py-4">
                            {Array.from({ length: columns }, (_, c) => (
                                <SkeletonLine
                                    key={c}
                                    width={c === 0 ? PRIMARY_WIDTHS[r % PRIMARY_WIDTHS.length] : "14%"}
                                    height={10}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </Region>
    );
}

/** Label + description + control, repeated. The shape of the admin System (kill switches) tab. */
export function SkeletonToggleRows({
    count = 3,
    label = "Loading settings…",
    className = "",
}: Busy & { count?: number }) {
    return (
        <Region label={label} className={className}>
            <div className="space-y-3">
                {Array.from({ length: count }, (_, i) => (
                    <div
                        key={i}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                    >
                        <div className="min-w-0 flex-1 space-y-2">
                            <SkeletonLine width={PRIMARY_WIDTHS[i % PRIMARY_WIDTHS.length]} height={10} />
                            <SkeletonLine
                                width={SECONDARY_WIDTHS[i % SECONDARY_WIDTHS.length]}
                                height={8}
                                faint
                            />
                        </div>
                        <Skeleton width={52} height={28} className="shrink-0 rounded-full" />
                    </div>
                ))}
            </div>
        </Region>
    );
}

/**
 * Whole-route placeholder for pages that render nothing until their first fetch resolves
 * (checkout, receipt, the dashboard router). Deliberately generic: it stands in for layouts this
 * module cannot know, so it aims for the right visual weight rather than a structural match.
 */
export function SkeletonPage({ label = "Loading page…", className = "" }: Busy) {
    return (
        <Region label={label} className={className}>
            <div className="mx-auto w-full max-w-2xl space-y-5 px-5 py-12">
                <div className="space-y-3">
                    <Skeleton width="45%" height={28} />
                    <SkeletonLine width="70%" height={10} faint />
                </div>
                <div className="space-y-4 rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
                    <div className="flex items-center gap-3">
                        <Skeleton circle width={44} height={44} className="shrink-0" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <SkeletonLine width="52%" height={11} />
                            <SkeletonLine width="34%" height={8} faint />
                        </div>
                    </div>
                    <div className="space-y-2.5 border-t border-white/5 pt-4">
                        <SkeletonLine width="88%" height={10} />
                        <SkeletonLine width="76%" height={10} />
                        <SkeletonLine width="60%" height={10} faint />
                    </div>
                    <Skeleton width="100%" height={44} />
                </div>
            </div>
        </Region>
    );
}
