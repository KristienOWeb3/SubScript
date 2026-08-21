"use client";

/* Gas relayer runway gauge.
 *
 * The arc is painted in ONE status colour taken from the relayer's actual state, not in a
 * red-to-green gradient laid across its bounding box. A gradient across the arc encodes position
 * instead of value: at full health the left end still reads red, and at 20% the only colour on
 * screen is red whether or not 20% is a problem. Colour here always agrees with the badge, and the
 * badge carries the word, so the colour stays redundant rather than load-bearing.
 *
 * The target reserve arrives as a prop and feeds both the arc maths and the footer label, because
 * the two used to be separate literals that could disagree after a one-line edit.
 */

import { usePrefersReducedMotion } from "./chartGeometry";
import { CHART_INK, CHART_STATUS } from "./chartPalette";

/* Semi-circle geometry, in CSS pixels. The arc spans cx-radius to cx+radius through the top. */
const SIZE = 180;
const RADIUS = 70;
const STROKE = 14;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRCUMFERENCE = Math.PI * RADIUS;

/* Overflow ring: a slim arc outside the track, only drawn when the balance is over target. */
const OVER_RADIUS = RADIUS + STROKE / 2 + 4;
const OVER_STROKE = 3;
const OVER_CIRCUMFERENCE = Math.PI * OVER_RADIUS;

function semiArc(r: number): string {
    return `M ${CX - r} ${CY} A ${r} ${r} 0 0 1 ${CX + r} ${CY}`;
}

/** 10% and 30% alpha on a 6-digit hex, so the badge tint tracks the status colour. */
function tint(hex: string, alpha: "10" | "30"): string {
    return `${hex}${alpha === "10" ? "1a" : "4d"}`;
}

export function RunwayGaugeChart({
    valueUsdc,
    topupsRemaining,
    underfunded,
    emergencyStop,
    dailyBurnRateUsdc = "0.25",
    targetUsdc = 20,
    title = "Gas Relayer Runway",
}: {
    valueUsdc: string | null;
    topupsRemaining: number | null;
    underfunded: boolean;
    emergencyStop: boolean;
    dailyBurnRateUsdc?: string;
    targetUsdc?: number;
    title?: string;
}) {
    const reducedMotion = usePrefersReducedMotion();

    /* parseFloat("n/a") is NaN, and NaN in the arc maths silently blanks the whole gauge while the
       readout prints "NaN". Anything unparseable reads as an empty reserve instead. */
    const parsed = valueUsdc === null ? Number.NaN : Number.parseFloat(valueUsdc);
    const balance = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const target = Number.isFinite(targetUsdc) && targetUsdc > 0 ? targetUsdc : 20;

    const ratio = balance / target;
    const fill = Math.min(1, ratio);
    const overflow = Math.min(1, Math.max(0, ratio - 1));
    const isOver = ratio > 1;

    const status = emergencyStop ? "critical" : underfunded ? "warning" : "good";
    const statusColor = CHART_STATUS[status];
    const badgeLabel = emergencyStop ? "Stopped" : underfunded ? "Running low" : "Healthy";
    const spokenStatus = emergencyStop
        ? "The relayer is stopped."
        : underfunded
          ? "Gas is running low."
          : "Gas is healthy.";

    const ratioLabel = isOver
        ? `${ratio.toFixed(1)}× target`
        : `${Math.round(fill * 100)}% of target`;
    const targetLabel = `${target.toFixed(2)} USDC`;
    const actionsLabel =
        topupsRemaining !== null
            ? `≈ ${topupsRemaining.toLocaleString()} actions left`
            : "No action estimate yet";

    const ariaLabel = `Gas relayer runway: ${balance.toFixed(2)} USDC against a ${targetLabel} target, ${ratioLabel}. ${spokenStatus}`;
    const motion = reducedMotion ? "" : " transition-[stroke-dashoffset] duration-700 ease-out";

    return (
        <div className="min-w-0 flex flex-col justify-between rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">{title}</h3>
                    <p className="text-xs text-[#64748b]">Native gas coverage on Arc</p>
                </div>
                <span
                    className="shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-black tracking-wide"
                    style={{
                        color: statusColor,
                        backgroundColor: tint(statusColor, "10"),
                        borderColor: tint(statusColor, "30"),
                    }}
                >
                    {badgeLabel}
                </span>
            </div>

            <div className="relative my-3 flex flex-col items-center justify-center">
                <svg
                    width={SIZE}
                    height={SIZE / 2 + 15}
                    role="img"
                    aria-label={ariaLabel}
                    className="overflow-visible"
                >
                    {/* Track */}
                    <path
                        d={semiArc(RADIUS)}
                        fill="none"
                        stroke={CHART_INK.gridLine}
                        strokeWidth={STROKE}
                        strokeLinecap="round"
                    />

                    {/* Fill. Butt caps, because a round cap adds half the stroke width past each end,
                        so a 0% reserve still painted a visible blob at both ends of an empty gauge. */}
                    <path
                        d={semiArc(RADIUS)}
                        fill="none"
                        stroke={statusColor}
                        strokeWidth={STROKE}
                        strokeLinecap="butt"
                        strokeDasharray={CIRCUMFERENCE}
                        strokeDashoffset={CIRCUMFERENCE * (1 - fill)}
                        className={motion.trim()}
                    />

                    {/* Over-target ring. The fill can only reach the end of the arc, so without this a
                        balance of 5x the target looks identical to hitting it exactly. */}
                    {isOver && (
                        <path
                            d={semiArc(OVER_RADIUS)}
                            fill="none"
                            stroke={statusColor}
                            strokeWidth={OVER_STROKE}
                            strokeLinecap="butt"
                            strokeDasharray={OVER_CIRCUMFERENCE}
                            strokeDashoffset={OVER_CIRCUMFERENCE * (1 - overflow)}
                            className={motion.trim()}
                        />
                    )}
                </svg>

                <div className="absolute bottom-1 flex flex-col items-center text-center">
                    <span className="text-2xl font-black tracking-tight text-[#0f172a]">
                        {balance.toFixed(2)} <span className="text-xs font-bold text-[#2775ca]">USDC</span>
                    </span>
                    <span className="text-[10px] font-bold text-[#64748b]">
                        {actionsLabel} &middot; <span style={{ color: statusColor }}>{ratioLabel}</span>
                    </span>
                </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#f1f5f9] pt-3 text-[11px] text-[#64748b]">
                <span>Target: {targetLabel}</span>
                <span>Daily burn: ~{dailyBurnRateUsdc} USDC</span>
            </div>
        </div>
    );
}
