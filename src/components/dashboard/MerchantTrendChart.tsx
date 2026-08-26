"use client";

/* High-fidelity two-series trend chart for the merchant Transactions Overview.
 * Aligned with the AreaTrendChart styling (crisp dashed gridlines, refined linear gradients,
 * responsive coordinates, and floating tooltip).
 */

import React, { useId, useMemo, useState } from "react";

export type TrendPoint = {
    bucket: string;
    label: string;
    grossUsdcMicros: string;
    netUsdcMicros: string;
    transactionCount: number;
};

const microsToUsdc = (value: string | undefined) => {
    const micros = Number(value || 0);
    return Number.isFinite(micros) ? micros / 1_000_000 : 0;
};

const formatUsdc = (value: number) =>
    value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatTick = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
    return value.toFixed(0);
};

/* Catmull-Rom through the points, expressed as cubic Béziers. */
function curveThrough(points: Array<{ x: number; y: number }>) {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x - 8},${points[0].y} L ${points[0].x + 8},${points[0].y}`;
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
}

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 240;
const PAD_LEFT = 48;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export default function MerchantTrendChart({
    points,
    isDark = false,
    grossColor = "#8AB4DB",
    netColor = "#082824",
}: {
    points: TrendPoint[];
    isDark?: boolean;
    grossColor?: string;
    netColor?: string;
}) {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

    const netStroke = isDark ? "#7fd8c9" : netColor;
    const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.07)";
    const zeroColor = isDark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.15)";
    const axisText = isDark ? "rgba(244,244,245,0.5)" : "#64748b";
    const dotRing = isDark ? "#1f2023" : "#ffffff";

    const { grossPoints, netPoints, ticks } = useMemo(() => {
        const gross = points.map((p) => microsToUsdc(p.grossUsdcMicros));
        const net = points.map((p) => microsToUsdc(p.netUsdcMicros));
        const peak = Math.max(1, ...gross, ...net);

        const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
        const step = Math.ceil(peak / magnitude / 4) * magnitude || 1;
        const top = step * 4;

        const scaleX = (index: number) => {
            if (points.length <= 1) return VIEW_WIDTH / 2;
            return PAD_LEFT + (index / (points.length - 1)) * (VIEW_WIDTH - PAD_LEFT - PAD_RIGHT);
        };
        const scaleY = (value: number) => {
            const plot = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
            return PAD_TOP + plot - (value / top) * plot;
        };

        return {
            grossPoints: gross.map((value, index) => ({ x: scaleX(index), y: scaleY(value), value })),
            netPoints: net.map((value, index) => ({ x: scaleX(index), y: scaleY(value), value })),
            ticks: [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
                value: top * ratio,
                y: scaleY(top * ratio),
            })),
        };
    }, [points]);

    const grossPath = useMemo(() => curveThrough(grossPoints), [grossPoints]);
    const netPath = useMemo(() => curveThrough(netPoints), [netPoints]);
    const areaPath = useMemo(() => {
        if (!grossPath || grossPoints.length === 0) return "";
        const baseline = VIEW_HEIGHT - PAD_BOTTOM;
        const last = grossPoints[grossPoints.length - 1];
        const first = grossPoints[0];
        return `${grossPath} L ${last.x},${baseline} L ${first.x},${baseline} Z`;
    }, [grossPath, grossPoints]);

    const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
        if (points.length === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        const plotStart = PAD_LEFT / VIEW_WIDTH;
        const plotEnd = (VIEW_WIDTH - PAD_RIGHT) / VIEW_WIDTH;
        const withinPlot = (ratio - plotStart) / (plotEnd - plotStart);
        const index = Math.round(withinPlot * (points.length - 1));
        setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
    };

    if (points.length === 0) {
        return (
            <div className="flex h-56 items-center justify-center text-xs text-black/40">
                No settlements in this period
            </div>
        );
    }

    const active = hoverIndex !== null ? points[hoverIndex] : null;
    const activeGross = hoverIndex !== null ? grossPoints[hoverIndex] : null;
    const activeNet = hoverIndex !== null ? netPoints[hoverIndex] : null;

    const labelStep = Math.max(1, Math.ceil(points.length / 6));

    return (
        <div className="relative mt-3 w-full select-none rounded-2xl bg-white/40 border border-black/5 p-3 shadow-inner">
            <svg
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                className="w-full overflow-visible"
                style={{ height: VIEW_HEIGHT }}
                onMouseMove={handleMove}
                onMouseLeave={() => setHoverIndex(null)}
                role="img"
                aria-label="Gross and net settlement trend"
            >
                <defs>
                    <linearGradient id={`merchantTrendFill${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={grossColor} stopOpacity={isDark ? 0.35 : 0.32} />
                        <stop offset="90%" stopColor={grossColor} stopOpacity={0.02} />
                        <stop offset="100%" stopColor={grossColor} stopOpacity={0} />
                    </linearGradient>
                </defs>

                {ticks.map((tick) => (
                    <g key={tick.value}>
                        <line
                            x1={PAD_LEFT}
                            y1={tick.y}
                            x2={VIEW_WIDTH - PAD_RIGHT}
                            y2={tick.y}
                            stroke={tick.value === 0 ? zeroColor : gridColor}
                            strokeWidth="1"
                            strokeDasharray={tick.value === 0 ? undefined : "3 3"}
                        />
                        <text
                            x={PAD_LEFT - 8}
                            y={tick.y + 3.5}
                            textAnchor="end"
                            fontSize="9.5"
                            fill={axisText}
                            className="font-mono font-medium"
                        >
                            ${formatTick(tick.value)}
                        </text>
                    </g>
                ))}

                <path d={areaPath} fill={`url(#merchantTrendFill${uid})`} />
                <path
                    d={netPath}
                    fill="none"
                    stroke={netStroke}
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    strokeLinecap="round"
                />
                <path
                    d={grossPath}
                    fill="none"
                    stroke={grossColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {activeGross && (
                    <g>
                        <line
                            x1={activeGross.x}
                            y1={PAD_TOP}
                            x2={activeGross.x}
                            y2={VIEW_HEIGHT - PAD_BOTTOM}
                            stroke={zeroColor}
                            strokeWidth="1.5"
                            strokeDasharray="2 2"
                        />
                        {activeNet && (
                            <circle cx={activeNet.x} cy={activeNet.y} r="4" fill={netStroke} stroke={dotRing} strokeWidth="2" />
                        )}
                        <circle cx={activeGross.x} cy={activeGross.y} r="5" fill={grossColor} stroke={dotRing} strokeWidth="2.5" />
                    </g>
                )}

                {points.map((point, index) => {
                    const show = index === 0 || index === points.length - 1 || index % labelStep === 0;
                    if (!show) return null;
                    return (
                        <text
                            key={point.bucket}
                            x={grossPoints[index].x}
                            y={VIEW_HEIGHT - 8}
                            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
                            fontSize="9.5"
                            fill={hoverIndex === index ? (isDark ? "#f4f4f5" : "#082824") : axisText}
                            fontWeight={hoverIndex === index ? 700 : 500}
                            className="font-medium"
                        >
                            {point.label}
                        </text>
                    );
                })}
            </svg>

            {/* Floating Tooltip */}
            {active && activeGross && (() => {
                const xRatio = activeGross.x / VIEW_WIDTH;
                const yRatio = activeGross.y / VIEW_HEIGHT;
                const flipBelow = yRatio < 0.34;
                const xShift = xRatio < 0.2 ? "0%" : xRatio > 0.8 ? "-100%" : "-50%";
                return (
                    <div
                        className="pointer-events-none absolute z-30 whitespace-nowrap rounded-xl bg-[#082824] px-3.5 py-2 text-[11px] shadow-xl text-white border border-white/10"
                        style={{
                            left: `${Math.min(Math.max(xRatio * 100, 1), 99)}%`,
                            top: `${yRatio * 100}%`,
                            transform: `translate(${xShift}, ${flipBelow ? "14px" : "calc(-100% - 14px)"})`,
                        }}
                    >
                        <p className="mb-1 border-b border-white/10 pb-1 font-bold text-white/90">{active.label}</p>
                        <div className="space-y-0.5 text-[10px]">
                            <p className="font-semibold text-[#8AB4DB]">
                                Gross: ${formatUsdc(microsToUsdc(active.grossUsdcMicros))} USDC
                            </p>
                            <p className="font-semibold text-emerald-300">
                                Net: ${formatUsdc(microsToUsdc(active.netUsdcMicros))} USDC
                            </p>
                            <p className="text-white/60">
                                {active.transactionCount} transaction{active.transactionCount === 1 ? "" : "s"}
                            </p>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
