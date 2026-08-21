"use client";

/* Bar chart for a single metric across a handful of buckets (revenue by day, signups by plan).
 *
 * Rebuilt from the version in AdminCharts.tsx. The rewrite is not cosmetic — the old one told the
 * reader things that were not true:
 *
 *  - Every bar was floored at 6% of the plot, so a metric of zero drew a bar the same size as a
 *    small real value. On a payments console "zero refunds" and "a few refunds" looked identical.
 *  - There was no y-axis, so the bars had no scale to be read against; the only quantity available
 *    was the number printed on each bar, which made the bars decoration.
 *  - Bars and gridlines now share ONE denominator (the nice domain max), for the same reason the
 *    area chart shares buildScales: a gridline and a datum at the same value must be the same
 *    calculation, not two formulas that agree today.
 */

import { useMemo, useState } from "react";

import { CHART_PAD, formatCompact, formatCount, formatMoney, useDomain, usePrefersReducedMotion } from "./chartGeometry";
import { CHART_INK, CHART_SERIES } from "./chartPalette";

/* A non-zero value still has to be visible when it is a rounding error next to the maximum, so
 * non-zero bars get a 3px floor. That is a rendering minimum, not the old 6%-of-plot floor: it is
 * flat, tiny, and it never applies to zero. Zero draws ZERO_TICK_PX of neutral baseline ink
 * instead, so the difference between "none" and "barely any" is carried by colour as well as
 * height — a grey hairline on the axis versus a coloured mark rising off it. */
const MIN_BAR_PX = 3;
const ZERO_TICK_PX = 1;

export type BarMetricDatum = {
    label: string;
    value: number;
    sublabel?: string;
    highlight?: boolean;
};

export function BarMetricChart({
    data,
    title,
    subtitle,
    height = 200,
    valuePrefix = "$",
    barColor = CHART_SERIES.primary,
    valueKind = "money",
    showAxis = true,
    emptyMessage = "Nothing to chart yet.",
}: {
    data: Array<BarMetricDatum>;
    title?: string;
    subtitle?: string;
    height?: number;
    valuePrefix?: string;
    barColor?: string;
    /* Counts used to render as "$12" because valuePrefix defaulted to "$" for every caller. */
    valueKind?: "money" | "count";
    showAxis?: boolean;
    emptyMessage?: string;
}) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [focusIdx, setFocusIdx] = useState<number | null>(null);
    const reduceMotion = usePrefersReducedMotion();

    const values = useMemo(() => data.map((d) => (Number.isFinite(d.value) ? d.value : 0)), [data]);
    const domain = useDomain(values);

    /* Math.max(...[]) is -Infinity, which used to make every later number NaN on an empty series. */
    const maxIdx = useMemo(() => {
        if (values.length === 0) return null;
        let best = 0;
        for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
        return values[best] > 0 ? best : null;
    }, [values]);

    const activeIdx = hoverIdx ?? focusIdx;
    const prefix = valueKind === "money" ? valuePrefix : "";
    const fullValue = (v: number) => `${prefix}${valueKind === "money" ? formatMoney(v) : formatCount(v)}`;
    const shortValue = (v: number) => `${prefix}${formatCompact(v)}`;

    const transition = reduceMotion ? undefined : "height 200ms ease, opacity 150ms ease";

    return (
        <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            {(title || subtitle) && (
                <div className="mb-4">
                    {title && <h3 className="text-sm font-bold tracking-tight text-[#0f172a]">{title}</h3>}
                    {subtitle && <p className="mt-0.5 text-xs text-[#64748b]">{subtitle}</p>}
                </div>
            )}

            {data.length === 0 ? (
                <div
                    className="flex items-center justify-center rounded-xl border border-dashed border-[#e2e8f0] px-4 text-center text-xs text-[#64748b]"
                    style={{ height }}
                >
                    {emptyMessage}
                </div>
            ) : (
                <>
                    <div className="flex" aria-hidden="true">
                        {showAxis && (
                            <div className="relative shrink-0" style={{ width: CHART_PAD.left, height }}>
                                {domain.ticks.map((tick) => (
                                    <span
                                        key={tick}
                                        className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
                                        style={{
                                            bottom: `${(tick / (domain.max || 1)) * 100}%`,
                                            color: CHART_INK.axisText,
                                        }}
                                    >
                                        {shortValue(tick)}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className="relative min-w-0 flex-1" style={{ height }}>
                            {/* Gridlines come off the same domain as the bars, so a bar top that sits on a
                                line really is that value. */}
                            {showAxis &&
                                domain.ticks.map((tick) => (
                                    <span
                                        key={tick}
                                        className="pointer-events-none absolute inset-x-0 h-px"
                                        style={{
                                            bottom: `${(tick / (domain.max || 1)) * 100}%`,
                                            backgroundColor: tick === 0 ? CHART_INK.baseline : CHART_INK.gridLine,
                                        }}
                                    />
                                ))}

                            <div className="relative flex h-full items-end justify-between gap-2">
                                {data.map((item, idx) => {
                                    const value = values[idx];
                                    const pct = (value / (domain.max || 1)) * 100;
                                    const isActive = activeIdx === idx;
                                    const isZero = value <= 0;
                                    const showValue = isActive || (activeIdx === null && maxIdx === idx);
                                    /* Horizontal clamp, the twin of the vertical one below: a box centred on
                                       the first or last bar hangs outside the card, so near an edge it anchors
                                       inside and grows inward instead. */
                                    const ratio = data.length > 1 ? idx / (data.length - 1) : 0.5;
                                    const anchor = ratio <= 0.2 ? "start" : ratio >= 0.8 ? "end" : "center";

                                    return (
                                        <button
                                            key={`${item.label}-${idx}`}
                                            type="button"
                                            /* A bar was mouse-only: no touch, no keyboard, and nothing for a
                                               screen reader to land on. It is a real focusable control now. */
                                            aria-label={`${item.label}: ${fullValue(value)}${item.sublabel ? `, ${item.sublabel}` : ""}`}
                                            className="group relative flex h-full flex-1 cursor-pointer items-end justify-center rounded-sm bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2775ca] focus-visible:ring-offset-2"
                                            onPointerEnter={() => setHoverIdx(idx)}
                                            onPointerLeave={() => setHoverIdx((cur) => (cur === idx ? null : cur))}
                                            onFocus={() => setFocusIdx(idx)}
                                            onBlur={() => setFocusIdx((cur) => (cur === idx ? null : cur))}
                                        >
                                            {/* Tooltip. Sits just above the bar top and is clamped so a full-height bar
                                                cannot push it up out of the card, which -top-10 did. */}
                                            {isActive && (
                                                <span
                                                    data-admin-dark="true"
                                                    className={`pointer-events-none absolute z-20 max-w-[180px] rounded-lg bg-[#0f172a] px-2.5 py-1 text-left text-[10px] font-bold leading-snug text-[#f8fafc] shadow-lg ${
                                                        anchor === "start"
                                                            ? "left-0"
                                                            : anchor === "end"
                                                              ? "right-0"
                                                              : "left-1/2 -translate-x-1/2"
                                                    }`}
                                                    style={{
                                                        bottom: `min(calc(${Math.max(0, pct)}% + 26px), calc(100% - 24px))`,
                                                    }}
                                                >
                                                    {item.label} · {fullValue(value)}
                                                    {item.sublabel ? ` (${item.sublabel})` : ""}
                                                </span>
                                            )}

                                            {/* Only the maximum and the bar you are pointing at get a number. Every
                                                bar labelled was noise, and the labels collided at narrow widths.
                                                The text stays in ink tokens — the coloured bar carries identity, so
                                                emphasis here is weight, not hue. */}
                                            {showValue && (
                                                <span
                                                    className={`pointer-events-none absolute z-10 text-[10px] tabular-nums ${
                                                        isActive ? "font-bold text-[#0f172a]" : "font-semibold text-[#64748b]"
                                                    }`}
                                                    style={{ bottom: `min(calc(${Math.max(0, pct)}% + 4px), calc(100% - 12px))` }}
                                                >
                                                    {shortValue(value)}
                                                </span>
                                            )}

                                            {isZero ? (
                                                /* Zero is zero. A hairline of baseline ink says "we measured, and
                                                   there was none" without claiming any height. */
                                                <span
                                                    className="w-full max-w-[36px]"
                                                    style={{ height: ZERO_TICK_PX, backgroundColor: CHART_INK.baseline }}
                                                />
                                            ) : (
                                                <span
                                                    className="w-full max-w-[36px]"
                                                    style={{
                                                        height: `max(${MIN_BAR_PX}px, ${pct}%)`,
                                                        borderTopLeftRadius: 4,
                                                        borderTopRightRadius: 4,
                                                        backgroundColor: item.highlight ? CHART_SERIES.secondary : barColor,
                                                        /* Derived from the series colour rather than a second hard-coded
                                                           blue, so it still reads as the same series. */
                                                        filter: isActive ? "brightness(0.88)" : undefined,
                                                        /* No blanket dim: full contrast at rest, and the OTHERS step back
                                                           while you are reading one. */
                                                        opacity: activeIdx === null || isActive ? 1 : 0.55,
                                                        transition,
                                                    }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="flex" aria-hidden="true">
                        {showAxis && <div className="shrink-0" style={{ width: CHART_PAD.left }} />}
                        <div className="flex min-w-0 flex-1 justify-between gap-2">
                            {data.map((item, idx) => (
                                <span
                                    key={`${item.label}-x-${idx}`}
                                    className={`mt-2 w-full flex-1 truncate text-center text-[10px] ${
                                        activeIdx === idx ? "font-bold text-[#0f172a]" : "font-semibold text-[#64748b]"
                                    }`}
                                >
                                    {item.label}
                                </span>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* The chart's figures in text, for anyone who can't read the bars. */}
            {data.length > 0 && (
                <table className="sr-only">
                    <caption>{title ? `${title} — full figures` : "Chart values"}</caption>
                    <thead>
                        <tr>
                            <th scope="col">Bucket</th>
                            <th scope="col">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item, idx) => (
                            <tr key={`${item.label}-row-${idx}`}>
                                <th scope="row">{item.label}</th>
                                <td>
                                    {fullValue(values[idx])}
                                    {item.sublabel ? ` (${item.sublabel})` : ""}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
