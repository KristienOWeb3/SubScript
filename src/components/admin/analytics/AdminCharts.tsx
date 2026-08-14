"use client";

import React, { useState, useMemo, useRef } from "react";
import { TrendingUp, TrendingDown, ArrowUpRight } from "@/components/icons";

export interface DataPoint {
  date: string;
  label: string;
  value: number;
  secondaryValue?: number;
  meta?: Record<string, any>;
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  sublabel?: string;
}

// -------------------------------------------------------------
// 1. Interactive Area / Line Chart
// -------------------------------------------------------------
export function AreaTrendChart({
  data,
  title,
  subtitle,
  valuePrefix = "$",
  valueSuffix = "",
  color = "#2775ca",
  secondaryColor = "#00d2b4",
  secondaryLabel,
  primaryLabel = "Settled Volume",
  height = 240,
  showRangeSelector = true,
  range,
  onRangeChange,
  emptyMessage = "No historical data in this period",
}: {
  data: DataPoint[];
  title?: string;
  subtitle?: string;
  valuePrefix?: string;
  valueSuffix?: string;
  color?: string;
  secondaryColor?: string;
  secondaryLabel?: string;
  primaryLabel?: string;
  height?: number;
  showRangeSelector?: boolean;
  range?: "7d" | "14d" | "30d" | "all";
  onRangeChange?: (range: "7d" | "14d" | "30d" | "all") => void;
  emptyMessage?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter data by selected range if provided
  const activeData = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (range === "7d") return data.slice(-7);
    if (range === "14d") return data.slice(-14);
    if (range === "30d") return data.slice(-30);
    return data;
  }, [data, range]);

  const { points, maxValue, minValue, secondaryPoints } = useMemo(() => {
    if (activeData.length === 0) {
      return { points: [], maxValue: 100, minValue: 0, secondaryPoints: [] };
    }
    const vals = activeData.map((d) => d.value);
    const secVals = activeData
      .map((d) => d.secondaryValue)
      .filter((v): v is number => typeof v === "number");
    const allVals = [...vals, ...secVals];
    const max = Math.max(...allVals, 10);
    const min = 0; // Baseline at 0 for volume

    const width = 640;
    const chartHeight = height - 40;
    const paddingX = 20;
    const paddingY = 15;

    const scaleX = (idx: number) => {
      if (activeData.length <= 1) return width / 2;
      return paddingX + (idx / (activeData.length - 1)) * (width - paddingX * 2);
    };

    const scaleY = (val: number) => {
      const normalized = (val - min) / (max - min || 1);
      return chartHeight - paddingY - normalized * (chartHeight - paddingY * 2);
    };

    const pts = activeData.map((d, i) => ({
      x: scaleX(i),
      y: scaleY(d.value),
      d,
    }));

    const secPts = activeData.map((d, i) => ({
      x: scaleX(i),
      y: scaleY(d.secondaryValue ?? 0),
      d,
    }));

    return { points: pts, maxValue: max, minValue: min, secondaryPoints: secPts };
  }, [activeData, height]);

  // Build SVG Smooth Bézier Curve Path
  const { pathD, fillD, secondaryPathD } = useMemo(() => {
    if (points.length === 0) return { pathD: "", fillD: "", secondaryPathD: "" };
    if (points.length === 1) {
      const p = points[0];
      return {
        pathD: `M ${p.x - 10} ${p.y} L ${p.x + 10} ${p.y}`,
        fillD: `M ${p.x - 10} ${height - 25} L ${p.x - 10} ${p.y} L ${p.x + 10} ${p.y} L ${p.x + 10} ${height - 25} Z`,
        secondaryPathD: "",
      };
    }

    // Helper for smooth curve
    const getCurve = (pts: Array<{ x: number; y: number }>) => {
      let d = `M ${pts[0].x},${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i === 0 ? 0 : i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
      }
      return d;
    };

    const mainCurve = getCurve(points);
    const lastX = points[points.length - 1].x;
    const firstX = points[0].x;
    const bottomY = height - 25;

    const fill = `${mainCurve} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

    let secCurve = "";
    if (secondaryPoints.length > 0 && activeData.some((d) => d.secondaryValue !== undefined)) {
      secCurve = getCurve(secondaryPoints);
    }

    return { pathD: mainCurve, fillD: fill, secondaryPathD: secCurve };
  }, [points, secondaryPoints, activeData, height]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const widthRatio = x / rect.width;
    const index = Math.round(widthRatio * (points.length - 1));
    const clamped = Math.max(0, Math.min(points.length - 1, index));
    setHoverIndex(clamped);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="relative w-full rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]" ref={containerRef}>
      {/* Header with Title & Optional Range Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          {title && <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">{title}</h3>}
          {subtitle && <p className="text-xs text-[#64748b] mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[11px] font-semibold mr-2">
            <span className="flex items-center gap-1.5 text-[#0f172a]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              {primaryLabel}
            </span>
            {secondaryLabel && (
              <span className="flex items-center gap-1.5 text-[#64748b]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: secondaryColor }} />
                {secondaryLabel}
              </span>
            )}
          </div>

          {/* Range Buttons */}
          {showRangeSelector && onRangeChange && (
            <div className="flex items-center rounded-xl bg-[#f1f5f9] p-1 border border-[#e2e8f0]">
              {(["7d", "14d", "30d", "all"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onRangeChange(r)}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition ${
                    range === r
                      ? "bg-white text-[#2775ca] shadow-sm font-bold"
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

      {/* Chart Canvas */}
      {points.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-xs text-[#94a3b8] italic">
          {emptyMessage}
        </div>
      ) : (
        <div className="relative w-full overflow-hidden select-none">
          <svg
            viewBox={`0 0 640 ${height}`}
            className="w-full overflow-visible"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                <stop offset="90%" stopColor={color} stopOpacity="0.01" />
                <stop offset="100%" stopColor={color} stopOpacity="0.00" />
              </linearGradient>
              <linearGradient id="secondaryGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.2" />
                <stop offset="100%" stopColor={secondaryColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = (height - 40) * (1 - ratio) + 15;
              const val = minValue + (maxValue - minValue) * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1="20"
                    y1={y}
                    x2="620"
                    y2={y}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                    strokeDasharray={ratio === 0 ? undefined : "3 3"}
                  />
                  <text
                    x="15"
                    y={y + 3}
                    textAnchor="end"
                    className="text-[8px] fill-[#94a3b8] font-mono font-medium"
                  >
                    {valuePrefix}
                    {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
                    {valueSuffix}
                  </text>
                </g>
              );
            })}

            {/* Area Fill */}
            <path d={fillD} fill="url(#areaGradient)" />

            {/* Secondary Line (if present) */}
            {secondaryPathD && (
              <path
                d={secondaryPathD}
                fill="none"
                stroke={secondaryColor}
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            )}

            {/* Primary Main Line */}
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Interactive Cursor & Points */}
            {activePoint && (
              <g>
                <line
                  x1={activePoint.x}
                  y1={15}
                  x2={activePoint.x}
                  y2={height - 25}
                  stroke="#cbd5e1"
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                />
                {/* Secondary Dot */}
                {secondaryPoints[hoverIndex!] && (
                  <circle
                    cx={secondaryPoints[hoverIndex!].x}
                    cy={secondaryPoints[hoverIndex!].y}
                    r="4"
                    fill={secondaryColor}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}
                {/* Primary Dot */}
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="5"
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  className="shadow-md"
                />
              </g>
            )}

            {/* X-axis Date Labels */}
            {points.map((p, i) => {
              // Show label for first, last, and evenly spaced ~4 points
              const step = Math.max(1, Math.floor(points.length / 5));
              const isLabelVisible = i === 0 || i === points.length - 1 || i % step === 0;
              if (!isLabelVisible) return null;
              return (
                <text
                  key={i}
                  x={p.x}
                  y={height - 8}
                  textAnchor="middle"
                  className="text-[9px] fill-[#64748b] font-medium"
                >
                  {p.d.label}
                </text>
              );
            })}
          </svg>

          {/* Floating Hover Tooltip */}
          {activePoint && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full transform rounded-xl border border-[#cbd5e1] bg-[#0f172a] px-3.5 py-2 text-white shadow-xl backdrop-blur-md"
              style={{
                left: `${(activePoint.x / 640) * 100}%`,
                top: `${(activePoint.y / height) * 100 - 12}%`,
              }}
            >
              <p className="text-[10px] font-semibold text-[#94a3b8] mb-0.5">{activePoint.d.label}</p>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <p className="text-xs font-black text-white">
                  {primaryLabel}: {valuePrefix}
                  {activePoint.d.value.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  {valueSuffix}
                </p>
              </div>
              {activePoint.d.secondaryValue !== undefined && secondaryLabel && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: secondaryColor }} />
                  <p className="text-[11px] font-bold text-[#cbd5e1]">
                    {secondaryLabel}: {valuePrefix}
                    {activePoint.d.secondaryValue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    {valueSuffix}
                  </p>
                </div>
              )}
              {activePoint.d.meta?.paymentCount !== undefined && (
                <p className="text-[9px] text-[#94a3b8] mt-1 border-t border-white/10 pt-1">
                  {activePoint.d.meta.paymentCount} payments recorded
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 2. Interactive Bar Chart
// -------------------------------------------------------------
export function BarMetricChart({
  data,
  title,
  subtitle,
  height = 200,
  valuePrefix = "$",
  barColor = "#2775ca",
}: {
  data: Array<{ label: string; value: number; sublabel?: string; highlight?: boolean }>;
  title?: string;
  subtitle?: string;
  height?: number;
  valuePrefix?: string;
  barColor?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxValue = useMemo(() => {
    const vals = data.map((d) => d.value);
    return Math.max(...vals, 1);
  }, [data]);

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">{title}</h3>}
          {subtitle && <p className="text-xs text-[#64748b] mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div className="flex items-end justify-between gap-2 pt-4" style={{ height }}>
        {data.map((item, idx) => {
          const barHeightPct = Math.max(6, (item.value / maxValue) * 100);
          const isHovered = hoverIdx === idx;
          return (
            <div
              key={idx}
              className="group relative flex flex-1 flex-col items-center h-full justify-end cursor-pointer"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Tooltip */}
              {isHovered && (
                <div className="absolute -top-10 z-20 whitespace-nowrap rounded-lg bg-[#0f172a] px-2.5 py-1 text-[10px] font-bold text-white shadow-lg">
                  {valuePrefix}
                  {item.value.toLocaleString()} {item.sublabel ? `(${item.sublabel})` : ""}
                </div>
              )}

              {/* Value Label */}
              <span className={`text-[9px] font-mono font-bold mb-1 transition ${isHovered ? "text-[#2775ca]" : "text-[#64748b]"}`}>
                {item.value >= 1000 ? `${(item.value / 1000).toFixed(1)}k` : item.value}
              </span>

              {/* Bar */}
              <div
                className="w-full max-w-[36px] rounded-t-lg transition-all duration-200"
                style={{
                  height: `${barHeightPct}%`,
                  backgroundColor: item.highlight ? "#00d2b4" : isHovered ? "#1d61a8" : barColor,
                  opacity: isHovered ? 1 : 0.85,
                }}
              />

              {/* X-axis Label */}
              <span className="mt-2 text-[10px] font-bold text-[#64748b] truncate w-full text-center">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. Interactive Donut / Radial Ring Chart
// -------------------------------------------------------------
export function DonutMetricChart({
  segments,
  title,
  subtitle,
  centerLabel = "Total",
  centerValue,
  size = 180,
}: {
  segments: DonutSegment[];
  title?: string;
  subtitle?: string;
  centerLabel?: string;
  centerValue?: string | number;
  size?: number;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = useMemo(() => {
    return segments.reduce((sum, s) => sum + s.value, 0);
  }, [segments]);

  const radius = size / 2 - 20;
  const circumference = 2 * Math.PI * radius;
  const strokeWidth = 22;

  let accumulatedOffset = 0;
  const arcs = segments.map((seg, idx) => {
    const fraction = total > 0 ? seg.value / total : 0;
    const strokeDasharray = `${fraction * circumference} ${circumference}`;
    const strokeDashoffset = -accumulatedOffset;
    accumulatedOffset += fraction * circumference;
    return {
      ...seg,
      fraction,
      percent: Math.round(fraction * 100),
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const activeSegment = hoveredIdx !== null ? arcs[hoveredIdx] : null;

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">{title}</h3>}
          {subtitle && <p className="text-xs text-[#64748b] mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-around gap-6">
        {/* SVG Donut */}
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="transform -rotate-90">
            {/* Background Circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="#f1f5f9"
              strokeWidth={strokeWidth}
            />

            {/* Segments */}
            {arcs.map((arc, idx) => {
              const isHovered = hoveredIdx === idx;
              return (
                <circle
                  key={idx}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="transparent"
                  stroke={arc.color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={arc.strokeDasharray}
                  strokeDashoffset={arc.strokeDashoffset}
                  className="transition-all duration-200 cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            })}
          </svg>

          {/* Center Text */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              {activeSegment ? activeSegment.label : centerLabel}
            </span>
            <span className="text-lg font-black text-[#0f172a]">
              {activeSegment
                ? `${activeSegment.value} (${activeSegment.percent}%)`
                : centerValue ?? total.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Legend List */}
        <div className="space-y-2 flex-1 max-w-[200px]">
          {arcs.map((arc, idx) => {
            const isHovered = hoveredIdx === idx;
            return (
              <div
                key={idx}
                className={`flex items-center justify-between p-1.5 rounded-xl transition cursor-pointer ${
                  isHovered ? "bg-[#f1f5f9]" : "hover:bg-[#f8fafc]"
                }`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: arc.color }}
                  />
                  <span className="text-xs font-bold text-[#0f172a] truncate">{arc.label}</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-black text-[#0f172a]">{arc.value}</span>
                  <span className="text-[10px] text-[#64748b] ml-1">({arc.percent}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 4. Gas & System Runway Gauge Chart
// -------------------------------------------------------------
export function RunwayGaugeChart({
  valueUsdc,
  topupsRemaining,
  underfunded,
  emergencyStop,
  dailyBurnRateUsdc = "0.25",
  title = "Gas Relayer Runway",
}: {
  valueUsdc: string | null;
  topupsRemaining: number | null;
  underfunded: boolean;
  emergencyStop: boolean;
  dailyBurnRateUsdc?: string;
  title?: string;
}) {
  const numericVal = valueUsdc ? parseFloat(valueUsdc) : 0;
  // Target safe reserve is ~20 USDC
  const targetSafe = 20;
  const percentage = Math.min(100, Math.max(0, (numericVal / targetSafe) * 100));

  // 180-degree semi circle
  const size = 180;
  const radius = 70;
  const strokeWidth = 14;
  const circumference = Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const statusTone = emergencyStop
    ? "text-red-500 bg-red-500/10 border-red-500/30"
    : underfunded
    ? "text-amber-500 bg-amber-500/10 border-amber-500/30"
    : "text-emerald-600 bg-emerald-500/10 border-emerald-500/30";

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">{title}</h3>
          <p className="text-xs text-[#64748b]">Native gas coverage on Arc</p>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${statusTone}`}>
          {emergencyStop ? "Stopped" : underfunded ? "Low Gas" : "Optimal"}
        </span>
      </div>

      {/* Semi-circle Gauge */}
      <div className="relative flex flex-col items-center justify-center my-3">
        <svg width={size} height={size / 2 + 15} className="overflow-visible">
          <defs>
            <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>

          {/* Background Arc */}
          <path
            d={`M 20 ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 20} ${size / 2}`}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Filled Arc */}
          <path
            d={`M 20 ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 20} ${size / 2}`}
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
          />
        </svg>

        {/* Center Readout */}
        <div className="absolute bottom-1 flex flex-col items-center text-center">
          <span className="text-2xl font-black text-[#0f172a] tracking-tight">
            {valueUsdc ? Number(valueUsdc).toFixed(2) : "0.00"}{" "}
            <span className="text-xs font-bold text-[#2775ca]">USDC</span>
          </span>
          <span className="text-[10px] font-bold text-[#64748b]">
            {topupsRemaining !== null ? `≈ ${topupsRemaining.toLocaleString()} actions remaining` : "Reserves standby"}
          </span>
        </div>
      </div>

      <div className="border-t border-[#f1f5f9] pt-3 flex items-center justify-between text-[11px] text-[#64748b]">
        <span>Target: 20.00 USDC</span>
        <span>Daily burn: ~{dailyBurnRateUsdc} USDC</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 5. Metric Sparkline
// -------------------------------------------------------------
export function MetricSparkline({
  data,
  color = "#2775ca",
  width = 90,
  height = 30,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);

  const pts = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * (width - 4) + 2;
    const normalized = (val - min) / (max - min || 1);
    const y = height - 4 - normalized * (height - 8);
    return `${x},${y}`;
  });

  const pathD = `M ${pts.join(" L ")}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// -------------------------------------------------------------
// 6. Stat Card With Embedded Sparkline
// -------------------------------------------------------------
export function StatCardWithSparkline({
  label,
  value,
  changePercent,
  isPositive = true,
  sparklineData,
  icon: Icon,
  color = "#2775ca",
  badgeText,
}: {
  label: string;
  value: string | number;
  changePercent?: string | number;
  isPositive?: boolean;
  sparklineData?: number[];
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
  badgeText?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">{label}</span>
        {Icon && (
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#f1f5f9] text-[#2775ca]">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="my-3 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-2xl font-black text-[#0f172a] tracking-tight">{value}</p>
          {changePercent !== undefined && (
            <div className="mt-1 flex items-center gap-1 text-[10px] font-bold">
              {isPositive ? (
                <span className="flex items-center gap-0.5 text-emerald-600">
                  <TrendingUp className="h-3 w-3" /> +{changePercent}%
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-rose-500">
                  <TrendingDown className="h-3 w-3" /> -{changePercent}%
                </span>
              )}
              <span className="text-[#94a3b8] font-normal">vs last period</span>
            </div>
          )}
          {badgeText && (
            <span className="mt-1 inline-block rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[9px] font-bold text-[#64748b]">
              {badgeText}
            </span>
          )}
        </div>

        {sparklineData && sparklineData.length > 1 && (
          <div className="shrink-0">
            <MetricSparkline data={sparklineData} color={color} />
          </div>
        )}
      </div>
    </div>
  );
}
