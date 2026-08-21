"use client";

/* Area trend chart for the admin console.
 *
 * Everything positional in here comes from ONE call to buildScales. That is the point of the
 * rewrite: the previous version computed gridlines from `(height - 40) * (1 - ratio) + 15` and data
 * from a separate scaleY whose zero sat at `chartHeight - paddingY`, so the line labelled "0" was
 * about 30px away from where a zero value actually plotted — the axis disagreed with the data on a
 * money dashboard. A gridline and a datum at the same value now land on the same pixel because they
 * are the same function call.
 */

import React, { useId, useMemo, useState } from "react";
import { CHART_INK, CHART_SERIES } from "./chartPalette";
import {
    CHART_PAD,
    buildScales,
    formatCompact,
    formatCount,
    formatMoney,
    monotonePath,
    thinLabelIndices,
    useCursorKeys,
    useDomain,
    useMeasuredWidth,
    usePrefersReducedMotion,
} from "./chartGeometry";

/** How a value should read. "count" drops the currency prefix — 12 new merchants is not "$12". */
export type ChartValueKind = "money" | "count";

/* One plotted sample. This type lives here rather than in AdminCharts because AdminCharts is now a
   barrel that re-exports FROM this file — importing the type back out of it, even type-only, would
   put the two modules in a cycle for no benefit. */
export interface DataPoint {
    date: string;
    label: string;
    value: number;
    secondaryValue?: number;
    meta?: Record<string, any>;
}

export function AreaTrendChart({
    data,
    title,
    subtitle,
    valuePrefix = "$",
    valueSuffix = "",
    valueKind = "money",
    color = CHART_SERIES.primary,
    secondaryColor = CHART_SERIES.secondary,
    secondaryLabel,
    primaryLabel = "Settled Volume",
    height = 240,
    showRangeSelector = true,
    range,
    onRangeChange,
    emptyMessage = "No historical data in this period",
    tableCaption,
}: {
    data: DataPoint[];
    title?: string;
    subtitle?: string;
    valuePrefix?: string;
    valueSuffix?: string;
    valueKind?: ChartValueKind;
    color?: string;
    secondaryColor?: string;
    secondaryLabel?: string;
    primaryLabel?: string;
    height?: number;
    showRangeSelector?: boolean;
    range?: "7d" | "14d" | "30d" | "all";
    onRangeChange?: (range: "7d" | "14d" | "30d" | "all") => void;
    emptyMessage?: string;
    tableCaption?: string;
}) {
    const [cursor, setCursor] = useState<number | null>(null);
    const { ref: plotRef, width } = useMeasuredWidth<HTMLDivElement>();
    const reducedMotion = usePrefersReducedMotion();

    /* One useId per instance, so two of these charts on the same page cannot share a gradient.
       Hardcoded ids meant the second chart's url(#areaGradient) resolved to the FIRST chart's
       gradient and it painted in the wrong colour. Non-word characters are stripped because
       useId's output contains colons. */
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
    const areaGradientId = `area-${uid}`;
    const secondaryGradientId = `secondary-${uid}`;

    const activeData = useMemo(() => {
        if (!data || data.length === 0) return [];
        if (range === "7d") return data.slice(-7);
        if (range === "14d") return data.slice(-14);
        if (range === "30d") return data.slice(-30);
        return data;
    }, [data, range]);

    const hasSecondary = useMemo(
        () => activeData.some((d) => typeof d.secondaryValue === "number"),
        [activeData],
    );

    const primaryValues = useMemo(() => activeData.map((d) => d.value), [activeData]);
    const secondaryValues = useMemo(
        () => (hasSecondary ? activeData.map((d) => d.secondaryValue ?? 0) : []),
        [activeData, hasSecondary],
    );

    const domain = useDomain(primaryValues, secondaryValues);

    const scales = useMemo(
        () =>
            buildScales({
                width,
                height,
                count: activeData.length,
                min: domain.min,
                max: domain.max,
            }),
        [width, height, activeData.length, domain.min, domain.max],
    );

    const points = useMemo(
        () => activeData.map((d, i) => ({ x: scales.scaleX(i), y: scales.scaleY(d.value), d })),
        [activeData, scales],
    );

    const secondaryPoints = useMemo(
        () =>
            hasSecondary
                ? activeData.map((d, i) => ({ x: scales.scaleX(i), y: scales.scaleY(d.secondaryValue ?? 0) }))
                : [],
        [activeData, hasSecondary, scales],
    );

    const { pathD, fillD, secondaryPathD } = useMemo(() => {
        if (points.length === 0) return { pathD: "", fillD: "", secondaryPathD: "" };
        /* The fill closes to plotBottom — the same y that scaleY(0) returns. The old code closed to
           `height - 25` while zero plotted at `height - 55`, so the area hung below its own baseline. */
        const base = scales.plotBottom;
        if (points.length === 1) {
            const p = points[0];
            return {
                pathD: `M ${p.x - 10},${p.y} L ${p.x + 10},${p.y}`,
                fillD: `M ${p.x - 10},${base} L ${p.x - 10},${p.y} L ${p.x + 10},${p.y} L ${p.x + 10},${base} Z`,
                secondaryPathD: "",
            };
        }
        /* monotonePath, not Catmull-Rom: the unlimited tangents overshot, drawing volume below zero
           and above the real maximum between a flat stretch and a spike. */
        const main = monotonePath(points);
        const fill = `${main} L ${points[points.length - 1].x},${base} L ${points[0].x},${base} Z`;
        return {
            pathD: main,
            fillD: fill,
            secondaryPathD: secondaryPoints.length > 1 ? monotonePath(secondaryPoints) : "",
        };
    }, [points, secondaryPoints, scales]);

    const xLabelIndices = useMemo(() => {
        if (points.length === 0) return [];
        const longest = activeData.reduce((n, d) => Math.max(n, d.label?.length ?? 0), 0);
        const minGap = Math.max(40, longest * 6.2 + 14);
        return thinLabelIndices(
            points.map((p) => p.x),
            minGap,
        );
    }, [points, activeData]);

    const formatValue = (value: number) =>
        valueKind === "count"
            ? `${formatCount(value)}${valueSuffix}`
            : `${valuePrefix}${formatMoney(value)}${valueSuffix}`;

    const formatTick = (value: number) =>
        valueKind === "count"
            ? `${formatCompact(value)}${valueSuffix}`
            : `${valuePrefix}${formatCompact(value)}${valueSuffix}`;

    const readIndexFrom = (event: React.PointerEvent<SVGSVGElement>) => {
        if (points.length === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        /* indexAt inverts scaleX. The old handler mapped clientX across the whole element width
           while the points only spanned plotLeft..plotRight, so the crosshair sat off the cursor. */
        setCursor(scales.indexAt(event.clientX - rect.left));
    };

    const onKeyDown = useCursorKeys(points.length, cursor, setCursor);

    const activePoint = cursor !== null ? points[cursor] ?? null : null;
    const activeSecondary = cursor !== null ? secondaryPoints[cursor] ?? null : null;

    const summary = useMemo(() => {
        if (activeData.length === 0) return emptyMessage;
        const first = activeData[0]?.label ?? "";
        const last = activeData[activeData.length - 1]?.label ?? "";
        const peak = primaryValues.length > 0 ? Math.max(...primaryValues) : 0;
        const series = secondaryLabel && hasSecondary ? `${primaryLabel} and ${secondaryLabel}` : primaryLabel;
        return `Line chart of ${series} from ${first} to ${last}. Peak ${primaryLabel} is ${formatValue(peak)}. Use the arrow keys to read each point.`;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeData, primaryValues, primaryLabel, secondaryLabel, hasSecondary, emptyMessage, valueKind, valuePrefix, valueSuffix]);

    return (
        <div className="relative min-w-0 w-full rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            {/* Header with title and optional range selector */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                    {title && <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">{title}</h3>}
                    {subtitle && <p className="text-xs text-[#64748b] mt-0.5">{subtitle}</p>}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-3 text-[11px] font-semibold mr-2">
                        <span className="flex items-center gap-1.5 text-[#0f172a]">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                            {primaryLabel}
                        </span>
                        {secondaryLabel && (
                            <span className="flex items-center gap-1.5 text-[#475569]">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: secondaryColor }} />
                                {secondaryLabel}
                            </span>
                        )}
                    </div>

                    {showRangeSelector && onRangeChange && (
                        <div className="flex items-center rounded-xl bg-[#f1f5f9] p-1 border border-[#e2e8f0]">
                            {(["7d", "14d", "30d", "all"] as const).map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => onRangeChange(r)}
                                    aria-pressed={range === r}
                                    className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                                        reducedMotion ? "" : "transition"
                                    } ${
                                        range === r
                                            ? "bg-white text-[#2775ca] shadow-sm"
                                            : "text-[#64748b] hover:text-[#0f172a]"
                                    }`}
                                >
                                    {r.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {points.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-xs italic" style={{ color: CHART_INK.axisText }}>
                    {emptyMessage}
                </div>
            ) : (
                /* Deliberately not overflow-hidden: this is the tooltip's positioning parent, and
                   clipping here is what made the hover readout vanish on a spike instead of merely
                   sitting off-centre. The tooltip clamps itself to stay inside the card, so there is
                   nothing that needs cutting off. */
                <div className="relative w-full select-none" ref={plotRef}>
                    {/* No viewBox on purpose. A fixed viewBox plus width:100% scales text too, so an
                        axis label set at 8px rendered near 4px in a narrow card. Sizing the SVG in
                        real pixels keeps 11px text at 11px, and makes SVG coordinates the same
                        coordinates the tooltip overlay uses. */}
                    <svg
                        width={width}
                        height={height}
                        className="block overflow-visible rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#2775ca] focus-visible:ring-offset-2"
                        style={{ touchAction: "pan-y" }}
                        role="img"
                        aria-label={summary}
                        tabIndex={0}
                        onPointerMove={readIndexFrom}
                        onPointerDown={readIndexFrom}
                        onPointerLeave={() => setCursor(null)}
                        onKeyDown={onKeyDown}
                        onBlur={() => setCursor(null)}
                    >
                        <defs>
                            <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                                <stop offset="90%" stopColor={color} stopOpacity="0.01" />
                                <stop offset="100%" stopColor={color} stopOpacity="0" />
                            </linearGradient>
                            <linearGradient id={secondaryGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.2" />
                                <stop offset="100%" stopColor={secondaryColor} stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        {/* Gridlines and their labels both read scaleY, the same function the data uses */}
                        {domain.ticks.map((tick) => {
                            const y = scales.scaleY(tick);
                            const isBaseline = tick === 0;
                            return (
                                <g key={tick}>
                                    <line
                                        x1={scales.plotLeft}
                                        y1={y}
                                        x2={scales.plotRight}
                                        y2={y}
                                        stroke={isBaseline ? CHART_INK.baseline : CHART_INK.gridLine}
                                        strokeWidth="1"
                                        strokeDasharray={isBaseline ? undefined : "3 3"}
                                    />
                                    <text
                                        x={scales.plotLeft - 8}
                                        y={y + 4}
                                        textAnchor="end"
                                        fontSize={11}
                                        fill={CHART_INK.axisText}
                                        className="font-mono font-medium"
                                    >
                                        {formatTick(tick)}
                                    </text>
                                </g>
                            );
                        })}

                        <path d={fillD} fill={`url(#${areaGradientId})`} />

                        {secondaryPathD && (
                            <path
                                d={secondaryPathD}
                                fill="none"
                                stroke={secondaryColor}
                                strokeWidth="2"
                                strokeDasharray="4 3"
                            />
                        )}

                        <path
                            d={pathD}
                            fill="none"
                            stroke={color}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />

                        {activePoint && (
                            <g>
                                <line
                                    x1={activePoint.x}
                                    y1={scales.plotTop}
                                    x2={activePoint.x}
                                    y2={scales.plotBottom}
                                    stroke="#94a3b8"
                                    strokeWidth="1.5"
                                    strokeDasharray="2 2"
                                />
                                {activeSecondary && (
                                    <circle
                                        cx={activeSecondary.x}
                                        cy={activeSecondary.y}
                                        r="4"
                                        fill={secondaryColor}
                                        stroke="#ffffff"
                                        strokeWidth="2"
                                    />
                                )}
                                <circle
                                    cx={activePoint.x}
                                    cy={activePoint.y}
                                    r="5"
                                    fill={color}
                                    stroke="#ffffff"
                                    strokeWidth="2.5"
                                />
                            </g>
                        )}

                        {/* X labels, thinned by pixel gap so the last one can't sit on its neighbour */}
                        {xLabelIndices.map((i) => (
                            <text
                                key={i}
                                x={points[i].x}
                                y={height - 8}
                                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                                fontSize={11}
                                fill={CHART_INK.axisText}
                                className="font-medium"
                            >
                                {points[i].d.label}
                            </text>
                        ))}
                    </svg>

                    {/* Floating hover tooltip.
                      *
                      * Anchored above the point normally and flipped below it when the point sits high
                      * in the plot — which is exactly what a spike does, and what used to push the box
                      * out through the top of the card where it was clipped and unreadable. Horizontally
                      * it stops centring near the edges and aligns to the inside instead, so the box is
                      * always fully within the chart no matter which point is hovered. Coordinates are
                      * plain pixels now: the SVG is 1:1 with CSS pixels, so a point's x is already this
                      * overlay's x and there is no ratio to convert. */}
                    {activePoint && (() => {
                        const xRatio = width > 0 ? activePoint.x / width : 0;
                        const flipBelow = activePoint.y / height < 0.34;
                        const xShift = xRatio < 0.18 ? "0%" : xRatio > 0.82 ? "-100%" : "-50%";
                        const yShift = flipBelow ? "14px" : "calc(-100% - 14px)";
                        return (
                            <div
                                data-admin-dark="true"
                                className="pointer-events-none absolute z-20 rounded-xl border border-white/15 bg-[#0f172a] px-3.5 py-2 shadow-xl"
                                style={{
                                    left: `${Math.min(Math.max(activePoint.x, 4), Math.max(width - 4, 4))}px`,
                                    top: `${activePoint.y}px`,
                                    transform: `translate(${xShift}, ${yShift})`,
                                    maxWidth: "min(260px, 90%)",
                                    transition: reducedMotion ? "none" : "left 90ms ease-out, top 90ms ease-out",
                                }}
                            >
                                <p className="text-[10px] font-semibold text-[#cbd5e1] mb-0.5">{activePoint.d.label}</p>
                                <div className="flex items-center gap-2">
                                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                    <p className="text-xs font-black text-[#f8fafc]">
                                        {primaryLabel}: {formatValue(activePoint.d.value)}
                                    </p>
                                </div>
                                {activePoint.d.secondaryValue !== undefined && secondaryLabel && (
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ backgroundColor: secondaryColor }}
                                        />
                                        <p className="text-[11px] font-bold text-[#e2e8f0]">
                                            {secondaryLabel}: {formatValue(activePoint.d.secondaryValue)}
                                        </p>
                                    </div>
                                )}
                                {activePoint.d.meta?.paymentCount !== undefined && (
                                    <p className="text-[9px] text-[#cbd5e1] mt-1 border-t border-white/10 pt-1">
                                        {activePoint.d.meta.paymentCount} payments recorded
                                    </p>
                                )}
                            </div>
                        );
                    })()}

                    {/* Spoken feedback for the keyboard cursor, since the dot alone says nothing */}
                    <p className="sr-only" aria-live="polite">
                        {activePoint
                            ? `${activePoint.d.label}: ${primaryLabel} ${formatValue(activePoint.d.value)}${
                                  activePoint.d.secondaryValue !== undefined && secondaryLabel
                                      ? `, ${secondaryLabel} ${formatValue(activePoint.d.secondaryValue)}`
                                      : ""
                              }`
                            : ""}
                    </p>

                    {/* Same numbers as a table, so the data doesn't depend on hovering to be read */}
                    <table className="sr-only">
                        <caption>{tableCaption ?? `${title ?? primaryLabel} by date`}</caption>
                        <thead>
                            <tr>
                                <th scope="col">Date</th>
                                <th scope="col">{primaryLabel}</th>
                                {hasSecondary && secondaryLabel && <th scope="col">{secondaryLabel}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {activeData.map((d, i) => (
                                <tr key={`${d.date}-${i}`}>
                                    <th scope="row">{d.label}</th>
                                    <td>{formatValue(d.value)}</td>
                                    {hasSecondary && secondaryLabel && (
                                        <td>{d.secondaryValue !== undefined ? formatValue(d.secondaryValue) : "—"}</td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
