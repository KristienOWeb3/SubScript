"use client";

/* Stat cards and the sparkline they embed.
 *
 * Lifted out of AdminCharts.tsx so the two smallest pieces of the console stop sharing a 900-line
 * file with the full charts. Same names, same props — anything reading these from the barrel keeps
 * working.
 */

import React, { useId, useMemo } from "react";
import { TrendingUp, TrendingDown } from "@/components/icons";
import { linearPath, type Pt } from "./chartGeometry";
import { CHART_SERIES } from "./chartPalette";

// -------------------------------------------------------------
// 5. Metric Sparkline
// -------------------------------------------------------------
/**
 * A bare trend line, sized in pixels, for sitting beside a figure.
 *
 * It is decoration and nothing else: whatever it shows, the number next to it already says. So it
 * is hidden from assistive tech (`aria-hidden`, plus `focusable="false"` to keep legacy IE/Edge tab
 * order out of it) rather than left in the tree as an unlabelled graphic a screen reader announces
 * with no name and no meaning.
 *
 * Straight segments, never smoothed. A sparkline has too few samples for a curve to be honest —
 * interpolating would draw values between two readings that were never measured.
 */
export function MetricSparkline({
  data,
  color = CHART_SERIES.primary,
  width = 90,
  height = 30,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const pathD = useMemo(() => {
    if (!data || data.length < 2) return "";
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const pts: Pt[] = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * (width - 4) + 2;
      const normalized = (val - min) / (max - min || 1);
      return { x, y: height - 4 - normalized * (height - 8) };
    });
    return linearPath(pts);
  }, [data, width, height]);

  /* One point or none still renders the box, empty. Returning null here used to collapse the
     sparkline's slot, which pulled the value and its delta sideways — so a card with a short
     history sat differently from its neighbours in the same row, and the row twitched as soon as
     data arrived. The geometry holds whether or not there is a line to draw. */
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="max-w-full overflow-visible"
      aria-hidden="true"
      focusable="false"
    >
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

type Direction = "up" | "down" | "flat";

/* Which way the delta points, decided once.
 *
 * The markup used to hardcode a "-" in front of the down branch, so a caller passing -5 with
 * isPositive={false} rendered "--5%". Callers are inconsistent by now — some pass a magnitude and
 * lean on the flag, some pass a signed number — so both are read here and the displayed figure is
 * always Math.abs. An explicit negative counts as a decrease whatever the flag says, and a zero is
 * neither direction, because painting 0% green with an up arrow claims growth that never happened. */
function resolveDelta(changePercent: string | number, isPositive: boolean) {
  const numeric = typeof changePercent === "number" ? changePercent : Number.parseFloat(String(changePercent));
  const readable = Number.isFinite(numeric);

  const direction: Direction =
    readable && numeric === 0 ? "flat" : readable && numeric < 0 ? "down" : isPositive ? "up" : "down";

  /* Strip the sign rather than reformat, so "12.50" keeps its trailing zero instead of coming back
     from Number as "12.5". */
  const magnitude =
    typeof changePercent === "number"
      ? String(Math.abs(changePercent))
      : String(changePercent).trim().replace(/^[+-]/, "");

  return { direction, magnitude };
}

// -------------------------------------------------------------
// 6. Stat Card With Embedded Sparkline
// -------------------------------------------------------------
export function StatCardWithSparkline({
  label,
  value,
  changePercent,
  isPositive = true,
  changeLabel = "vs last period",
  sparklineData,
  icon: Icon,
  color = CHART_SERIES.primary,
  badgeText,
}: {
  label: string;
  value: string | number;
  changePercent?: string | number;
  isPositive?: boolean;
  /** What the delta is measured against. The date range is picked outside this card, so the card
   *  cannot know it — pass the range the reader actually chose. */
  changeLabel?: string;
  sparklineData?: number[];
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
  badgeText?: string;
}) {
  const cardId = useId();
  const labelId = `${cardId}-label`;
  const valueId = `${cardId}-value`;

  const delta = changePercent === undefined ? null : resolveDelta(changePercent, isPositive);

  /* The sign character carries the direction on its own. Colour and an arrow are both easy to lose
     — greyscale printing, forced-colours mode, an icon that never loads — and "5%" with neither
     left is a number with no story. */
  const deltaTone =
    delta?.direction === "up" ? "text-emerald-600" : delta?.direction === "down" ? "text-rose-500" : "text-[#64748b]";
  const deltaSign = delta?.direction === "up" ? "+" : delta?.direction === "down" ? "-" : "";
  const spokenDelta =
    delta?.direction === "up"
      ? `Up ${delta.magnitude}%`
      : delta?.direction === "down"
        ? `Down ${delta.magnitude}%`
        : "No change";

  return (
    /* Two things are load-bearing on this root.
     *
     * min-w-0: as a grid item the card defaults to min-width:auto, so a long figure like
     * $12,345,678.90 widens the track instead of fitting and the whole grid spills past its
     * container — which is what happened when the admin sidebar expanded and took width away.
     *
     * container-type:inline-size: makes the card a query container, so the figure below can size
     * itself against THIS CARD's width rather than the viewport's. The sidebar changes the card's
     * width without changing the viewport, so vw-based scaling cannot see the thing that actually
     * moved. It also stops the card's width depending on its contents, which is the overflow this
     * originally had. */
    <div
      role="figure"
      aria-labelledby={`${labelId} ${valueId}`}
      className="min-w-0 [container-type:inline-size] rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between transition hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="min-w-0 text-[10px] font-black uppercase tracking-wider text-[#64748b]">{label}</span>
        {Icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#f1f5f9] text-[#2775ca]">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="my-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Never wrap a money figure. This used to carry overflow-wrap:anywhere so a long value
              would fold to a second line, but a number has no legal break point: $83.00 came out
              as "$83." / "00", and in a narrower card as "$8" / "3.0" / "0" — unreadable, and on a
              financial dashboard actively misleading about the amount.
              It scales instead: clamped to the card's inline size so it shrinks to fit down to
              18px and never exceeds the 24px it was designed at. */}
          <p id={valueId} className="text-[clamp(1.125rem,7cqi,1.5rem)] font-black leading-tight text-[#0f172a] tracking-tight whitespace-nowrap">{value}</p>
          {delta && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-bold">
              <span className={`flex items-center gap-0.5 ${deltaTone}`}>
                <span aria-hidden="true" className="flex items-center gap-0.5">
                  {delta.direction === "up" && <TrendingUp className="h-3 w-3 shrink-0" />}
                  {delta.direction === "down" && <TrendingDown className="h-3 w-3 shrink-0" />}
                  {deltaSign}
                  {delta.magnitude}%
                </span>
                <span className="sr-only">{spokenDelta}</span>
              </span>
              <span className="text-[#94a3b8] font-normal">{changeLabel}</span>
            </div>
          )}
          {badgeText && (
            /* Wraps rather than truncates. These are already short ("44 confirmed receipts",
               "Arc Mainnet"), and truncating left "44 con…" / "Arc …" / "Act…" — which conveys
               nothing at all. Unlike the figure above, this is prose and has spaces to break at. */
            <span className="mt-1 inline-block max-w-full rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[9px] font-bold leading-snug text-[#64748b]">
              {badgeText}
            </span>
          )}
        </div>

        {sparklineData && sparklineData.length > 1 && (
          /* The sparkline yields before the number does: it is decoration, the figure is the point
             of the card. These grids run to five columns, so at lg a card is only ~200px wide and
             there is not room for both — the sparkline waits for xl rather than squeezing the value,
             which is what produced "$8 / 3.0 / 0". Also allowed to shrink rather than hold its
             full 90px. */
          <div className="hidden min-w-0 max-w-[40%] shrink justify-end xl:flex">
            <MetricSparkline data={sparklineData} color={color} />
          </div>
        )}
      </div>
    </div>
  );
}
