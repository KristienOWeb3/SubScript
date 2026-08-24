"use client";

/* Donut with a legend, for the admin console (white card, #0f172a ink).
 *
 * Rebuilt from the version in AdminCharts.tsx. What was actually wrong, and what replaced it:
 *
 * 1. Each segment rounded its own share, so a legend could read 33/33/33 for a whole or total 101%.
 *    Percentages now come from apportionPercents (largest remainder), which sums to exactly 100.
 * 2. All-zero data rendered an invisible ring with a "0" in the middle and no explanation. There is
 *    now an empty state that says so.
 * 3. Hover thickened the arc (strokeWidth + 4), which overlapped its neighbours and changed the
 *    ring's apparent size — the geometry moved under the cursor. Stroke width is constant now;
 *    hover dims the other arcs instead.
 * 4. A sub-1% share drew a sub-pixel arc with no hit area. Every non-zero segment gets a minimum
 *    visible sweep, and the legend row is the dependable hit target.
 * 5. The arcs were bare <circle>s with mouse handlers: no roles, no keyboard. The legend rows are
 *    real buttons, the SVG carries role="img" with a summary, and there is an sr-only table.
 */

import { useMemo, useState } from "react";

import { apportionPercents, usePrefersReducedMotion } from "./chartGeometry";
import { CHART_INK, CHART_STATUS } from "./chartPalette";

export interface DonutSegment {
    label: string;
    value: number;
    /* Optional now. Callers used to hand in raw hex, which is how two near-identical greens ended up
       on the same dashboard — unspecified segments fall back to the audited CHART_STATUS slots. */
    color?: string;
    sublabel?: string;
}

/* Ring order for defaults. warning (#ca8a04) sits just under the 3:1 mark floor and carries an
   obligation that anything painted with it also has a visible text label — the legend row and the
   sr-only table both satisfy that here. */
const DEFAULT_COLORS = [
    CHART_STATUS.info,
    CHART_STATUS.good,
    CHART_STATUS.paused,
    CHART_STATUS.warning,
    CHART_STATUS.critical,
    CHART_STATUS.inactive,
] as const;

/* The card surface. The 2px ring drawn under the arcs shows through between them, so neighbouring
   colours never touch — that separation used to come from thickening the hovered arc. */
const SURFACE = "#ffffff";

/** Arc length in px kept clear between neighbours. */
const GAP = 2;
/** Smallest arc length in px a non-zero segment may draw. Below ~6px an arc reads as nothing. */
const MIN_SWEEP = 8;

export function DonutMetricChart({
    segments,
    title,
    subtitle,
    centerLabel = "Total",
    centerValue,
    size = 180,
    emptyMessage = "Nothing to show yet. Once there's activity, the split lands here.",
}: {
    segments: DonutSegment[];
    title?: string;
    subtitle?: string;
    centerLabel?: string;
    centerValue?: string | number;
    size?: number;
    emptyMessage?: string;
}) {
    const [activeIdx, setActiveIdx] = useState<number | null>(null);
    const reducedMotion = usePrefersReducedMotion();

    const radius = size / 2 - 20;
    const circumference = 2 * Math.PI * radius;
    const strokeWidth = 22;

    const { arcs, total, hasData } = useMemo(() => {
        /* Clamp at zero. The old total was a plain reduce over s.value, so one negative figure —
           a refund row, a bad join — would shrink the total below the sum of its parts and every
           fraction after it became nonsense. A negative share of a whole has no arc to draw, so it
           counts as zero here and the sr-only table still reports the value the caller passed. */
        const safeValues = segments.map((s) => (Number.isFinite(s.value) && s.value > 0 ? s.value : 0));
        const sum = safeValues.reduce((acc, v) => acc + v, 0);
        const percents = apportionPercents(safeValues);
        const nonZeroCount = safeValues.filter((v) => v > 0).length;

        let lengths = safeValues.map((v) => (sum > 0 ? (v / sum) * circumference : 0));

        /* Lift tiny slices to MIN_SWEEP and pay for it out of the slices that have room. Skipped
           when there are too many segments to fit a floor for each, since then the floor would
           consume the ring and every share would be a lie. */
        if (nonZeroCount > 0 && nonZeroCount * (MIN_SWEEP + GAP) <= circumference) {
            const deficit = lengths.reduce(
                (acc, len, i) => acc + (safeValues[i] > 0 && len < MIN_SWEEP ? MIN_SWEEP - len : 0),
                0,
            );
            const slack = lengths.reduce(
                (acc, len, i) => acc + (safeValues[i] > 0 && len > MIN_SWEEP ? len - MIN_SWEEP : 0),
                0,
            );
            if (deficit > 0 && slack > 0) {
                const keep = 1 - deficit / slack;
                lengths = lengths.map((len, i) => {
                    if (safeValues[i] <= 0) return 0;
                    return len < MIN_SWEEP ? MIN_SWEEP : MIN_SWEEP + (len - MIN_SWEEP) * keep;
                });
            }
        }

        /* Where each arc starts along the ring: a running sum of the ones before it. */
        const starts = new Array<number>(lengths.length);
        let running = 0;
        for (let i = 0; i < lengths.length; i += 1) {
            starts[i] = running;
            running += lengths[i];
        }

        /* Colour is never the only difference between two rows: a repeated label picks up its
           sublabel, or a counter, so the legend still reads correctly in greyscale. */
        const labelCounts = new Map<string, number>();
        for (const s of segments) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);
        const ordinals = new Array<number>(segments.length);
        const seen = new Map<string, number>();
        for (let i = 0; i < segments.length; i += 1) {
            const nth = (seen.get(segments[i].label) ?? 0) + 1;
            seen.set(segments[i].label, nth);
            ordinals[i] = nth;
        }

        const built = segments.map((seg, idx) => ({
            ...seg,
            color: seg.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
            displayLabel:
                (labelCounts.get(seg.label) ?? 0) > 1 && !seg.sublabel
                    ? `${seg.label} (${ordinals[idx]})`
                    : seg.label,
            percent: percents[idx],
            dashLength: nonZeroCount === 1 ? circumference : Math.max(1, lengths[idx] - GAP),
            dashOffset: -starts[idx],
            isEmpty: safeValues[idx] <= 0,
        }));

        return { arcs: built, total: sum, hasData: sum > 0 };
    }, [segments, circumference]);

    const activeSegment = activeIdx !== null ? arcs[activeIdx] ?? null : null;
    const transition = reducedMotion ? "" : "transition-opacity duration-200";

    const ringSummary = hasData
        ? `${title ?? centerLabel}: ${arcs
              .filter((a) => !a.isEmpty)
              .map((a) => `${a.displayLabel} ${a.percent}%`)
              .join(", ")}`
        : "No data to chart yet";

    return (
        <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            {(title || subtitle) && (
                <div className="mb-4">
                    {title && <h3 className="text-sm font-bold tracking-tight text-[#0f172a]">{title}</h3>}
                    {subtitle && <p className="mt-0.5 text-xs text-[#64748b]">{subtitle}</p>}
                </div>
            )}

            {!hasData ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <svg width={size} height={size} role="img" aria-label={ringSummary} focusable="false">
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="transparent"
                            stroke={CHART_INK.gridLine}
                            strokeWidth={strokeWidth}
                        />
                    </svg>
                    <p className="max-w-[260px] text-xs leading-relaxed text-[#64748b]">{emptyMessage}</p>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-around gap-6 sm:flex-row">
                    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
                        <svg
                            width={size}
                            height={size}
                            className="-rotate-90 transform"
                            role="img"
                            aria-label={ringSummary}
                            focusable="false"
                        >
                            {/* Track, for the stretch no segment covers. */}
                            <circle
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                fill="transparent"
                                stroke={CHART_INK.gridLine}
                                strokeWidth={strokeWidth}
                            />
                            {/* Surface ring. Each arc is GAP shorter than its share, so this shows
                                through as a 2px break between neighbours at every hover state. */}
                            <circle
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                fill="transparent"
                                stroke={SURFACE}
                                strokeWidth={strokeWidth}
                            />

                            {arcs.map((arc, idx) => {
                                if (arc.isEmpty) return null;
                                const dimmed = activeIdx !== null && activeIdx !== idx;
                                return (
                                    <circle
                                        key={`${arc.label}-${idx}`}
                                        cx={size / 2}
                                        cy={size / 2}
                                        r={radius}
                                        fill="transparent"
                                        stroke={arc.color}
                                        /* Constant. Growing this on hover is what shoved the
                                           neighbouring arcs and resized the ring. */
                                        strokeWidth={strokeWidth}
                                        strokeDasharray={`${arc.dashLength} ${circumference}`}
                                        strokeDashoffset={arc.dashOffset}
                                        opacity={dimmed ? 0.28 : 1}
                                        className={`cursor-pointer ${transition}`}
                                        onMouseEnter={() => setActiveIdx(idx)}
                                        onMouseLeave={() => setActiveIdx(null)}
                                    />
                                );
                            })}
                        </svg>

                        {/* The legend buttons carry this same reading in their labels, so hiding it
                            here keeps a screen reader from hearing every figure twice. */}
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-3"
                        >
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] truncate max-w-[110px]">
                                {activeSegment ? activeSegment.displayLabel : centerLabel}
                            </span>
                            <span className="text-base sm:text-lg font-black text-[#0f172a] truncate max-w-[120px]">
                                {activeSegment
                                    ? `${activeSegment.value.toLocaleString()} (${activeSegment.percent}%)`
                                    : centerValue ?? total.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    <ul className="max-w-[220px] flex-1 space-y-1">
                        {arcs.map((arc, idx) => {
                            const isActive = activeIdx === idx;
                            return (
                                <li key={`${arc.label}-${idx}`}>
                                    <button
                                        type="button"
                                        aria-pressed={isActive}
                                        aria-label={`${arc.displayLabel}${arc.sublabel ? `, ${arc.sublabel}` : ""}: ${arc.value.toLocaleString()}, ${arc.percent}% of the total`}
                                        onMouseEnter={() => setActiveIdx(idx)}
                                        onMouseLeave={() => setActiveIdx(null)}
                                        onFocus={() => setActiveIdx(idx)}
                                        onBlur={() => setActiveIdx(null)}
                                        className={`flex w-full items-center justify-between gap-2 rounded-xl p-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2775ca] focus-visible:ring-offset-1 ${
                                            reducedMotion ? "" : "transition-colors"
                                        } ${isActive ? "bg-[#f1f5f9]" : "hover:bg-[#f8fafc]"}`}
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <span
                                                aria-hidden="true"
                                                className="h-3 w-3 shrink-0 rounded-full"
                                                style={{ backgroundColor: arc.color }}
                                            />
                                            <span className="min-w-0">
                                                <span className="block truncate text-xs font-bold text-[#0f172a]">
                                                    {arc.displayLabel}
                                                </span>
                                                {arc.sublabel && (
                                                    <span className="block truncate text-[10px] text-[#64748b]">
                                                        {arc.sublabel}
                                                    </span>
                                                )}
                                            </span>
                                        </span>
                                        <span className="shrink-0 text-right">
                                            <span className="text-xs font-black text-[#0f172a]">
                                                {arc.value.toLocaleString()}
                                            </span>
                                            <span className="ml-1 text-[10px] text-[#64748b]">({arc.percent}%)</span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {hasData && (
                <table className="sr-only">
                    <caption>{title ? `${title} by segment` : "Breakdown by segment"}</caption>
                    <thead>
                        <tr>
                            <th scope="col">Segment</th>
                            <th scope="col">Value</th>
                            <th scope="col">Share</th>
                        </tr>
                    </thead>
                    <tbody>
                        {arcs.map((arc, idx) => (
                            <tr key={`${arc.label}-${idx}`}>
                                <th scope="row">
                                    {arc.displayLabel}
                                    {arc.sublabel ? ` (${arc.sublabel})` : ""}
                                </th>
                                <td>{arc.value.toLocaleString()}</td>
                                <td>{arc.percent}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
