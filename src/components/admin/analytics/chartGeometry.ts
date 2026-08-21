/* Shared geometry and formatting for the admin charts.
 *
 * These charts are hand-rolled SVG rather than a charting library, which is fine — but it meant
 * every component invented its own scale, and the bugs that produced were not cosmetic. The area
 * chart drew its gridlines from one formula and its data from another, so the line labelled "0" sat
 * 30px below where a zero value actually plotted: the axis disagreed with the data on a financial
 * dashboard. Both now come from buildScales, so a gridline and a datum at the same value cannot
 * land in different places — they are the same function call.
 *
 * The rule for anything in here: if two parts of a chart need to agree about a coordinate, they
 * must get it from ONE function, not from two formulas that happen to match today.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/* Plot padding in CSS pixels. Left is wide enough for a y-axis label like "$12.5k"; axis is the
 * band below the plot that x-labels live in. These are pixels and not viewBox units on purpose —
 * see useMeasuredWidth for why the charts stopped using a fixed viewBox. */
export const CHART_PAD = { left: 44, right: 12, top: 14, axis: 26 } as const;

export type Pt = { x: number; y: number };

/**
 * The chart's own width in CSS pixels, tracked as it changes.
 *
 * Why this exists: the charts used a fixed `viewBox="0 0 640 H"` with `width: 100%`, which scales
 * EVERYTHING — including text. An 8px axis label renders at ~4px in a 320px-wide card and ~11px in
 * a 900px one, so the smallest text in the console was also the least readable, and it changed size
 * depending on whether the admin sidebar was open. Measuring instead lets the SVG be 1:1 with
 * pixels, so 11px text is 11px everywhere and SVG coordinates equal overlay coordinates.
 */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(fallback);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        /* No synchronous measurement here on purpose. ResizeObserver delivers an entry as soon as it
           starts observing, so the first real width arrives through the same path as every later
           one — one code path rather than two, and nothing setting state in the effect body. */
        const ro = new ResizeObserver((entries) => {
            const w = entries[entries.length - 1]?.contentRect.width;
            if (typeof w === "number" && w > 0) setWidth(Math.round(w));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return { ref, width };
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onStoreChange: () => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    mq.addEventListener("change", onStoreChange);
    return () => mq.removeEventListener("change", onStoreChange);
}

function readReducedMotion(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * True when the reader asked the OS to reduce motion. Gate chart transitions on this.
 *
 * useSyncExternalStore rather than useState + useEffect: a media query is external state that
 * already has exactly the subscribe/read shape this hook wants. Reading it inside an effect meant
 * the first paint always animated at the default setting and got corrected a frame later — which is
 * the one frame a motion-sensitive reader was trying to avoid. The third argument is the server
 * snapshot: a server has no motion preference, so it reports false and the client corrects on
 * hydration without a mismatch.
 */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, () => false);
}

/**
 * Round a domain out to human tick values.
 *
 * Raw maxima give axes like "$8,347.20" at every gridline, which nobody reads. This snaps the top
 * of the domain to a 1/2/2.5/5/10 × 10^n step so ticks land on round numbers.
 */
export function niceScale(min: number, max: number, tickCount = 4): { min: number; max: number; ticks: number[] } {
    const safeMax = Number.isFinite(max) ? max : 0;
    const safeMin = Number.isFinite(min) ? min : 0;
    if (safeMax <= safeMin) {
        const top = safeMax > 0 ? safeMax : 10;
        return { min: 0, max: top, ticks: buildTicks(0, top, tickCount) };
    }
    const rawStep = (safeMax - safeMin) / tickCount;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const stepMultiple = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    const step = stepMultiple * mag;
    const niceMin = Math.floor(safeMin / step) * step;
    const niceMax = Math.ceil(safeMax / step) * step;
    const ticks: number[] = [];
    for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { min: niceMin, max: niceMax, ticks };
}

function buildTicks(min: number, max: number, count: number): number[] {
    const step = (max - min) / count;
    return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

/**
 * The single source of truth for where a value or an index lands, in CSS pixels.
 *
 * Gridlines, axis labels, data points, the area-fill baseline and the hover crosshair all read from
 * the SAME scaleX/scaleY returned here. That is the whole point: the old code had the fill baseline
 * at `height - 25` and scaleY(0) at `height - 55`, so the area hung 30px below its own zero line.
 */
export function buildScales(opts: {
    width: number;
    height: number;
    count: number;
    min: number;
    max: number;
    pad?: { left?: number; right?: number; top?: number; axis?: number };
}) {
    const left = opts.pad?.left ?? CHART_PAD.left;
    const right = opts.pad?.right ?? CHART_PAD.right;
    const top = opts.pad?.top ?? CHART_PAD.top;
    const axis = opts.pad?.axis ?? CHART_PAD.axis;

    const plotLeft = left;
    const plotRight = Math.max(left + 1, opts.width - right);
    const plotTop = top;
    const plotBottom = Math.max(top + 1, opts.height - axis);
    const span = opts.max - opts.min || 1;

    const scaleX = (index: number) => {
        if (opts.count <= 1) return (plotLeft + plotRight) / 2;
        return plotLeft + (index / (opts.count - 1)) * (plotRight - plotLeft);
    };
    const scaleY = (value: number) => {
        const normalized = (value - opts.min) / span;
        return plotBottom - normalized * (plotBottom - plotTop);
    };
    /* The inverse of scaleX, for hover. Doing this by hand is what put the crosshair off the
       cursor: the old code mapped clientX across the FULL element width while the points only
       spanned plotLeft..plotRight, so every reading was skewed by the padding. */
    const indexAt = (offsetX: number) => {
        if (opts.count <= 1) return 0;
        const ratio = (offsetX - plotLeft) / (plotRight - plotLeft || 1);
        return Math.min(opts.count - 1, Math.max(0, Math.round(ratio * (opts.count - 1))));
    };

    return { scaleX, scaleY, indexAt, plotLeft, plotRight, plotTop, plotBottom };
}

/**
 * Monotone cubic path (Fritsch–Carlson). Use this for any trend line.
 *
 * The old smoothing used a Catmull-Rom-style tangent with no limiter, which overshoots: between a
 * flat stretch and a spike the curve bulges past both points, so it drew volume BELOW zero and
 * above the day's actual maximum. On a payments dashboard that is not a styling preference — the
 * curve was asserting values that never happened. Fritsch–Carlson clamps the tangents so the
 * interpolant never leaves the range of the data it connects.
 */
export function monotonePath(pts: Pt[]): string {
    const n = pts.length;
    if (n === 0) return "";
    if (n === 1) return `M ${pts[0].x},${pts[0].y}`;
    if (n === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;

    const dx: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        dx[i] = pts[i + 1].x - pts[i].x;
        slope[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
    }

    const m: number[] = new Array(n);
    m[0] = slope[0];
    m[n - 1] = slope[n - 2];
    for (let i = 1; i < n - 1; i++) {
        m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
    }

    for (let i = 0; i < n - 1; i++) {
        if (slope[i] === 0) {
            m[i] = 0;
            m[i + 1] = 0;
            continue;
        }
        const a = m[i] / slope[i];
        const b = m[i + 1] / slope[i];
        const s = a * a + b * b;
        if (s > 9) {
            const tau = 3 / Math.sqrt(s);
            m[i] = tau * a * slope[i];
            m[i + 1] = tau * b * slope[i];
        }
    }

    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i];
        d += ` C ${pts[i].x + h / 3},${pts[i].y + (m[i] * h) / 3} ${pts[i + 1].x - h / 3},${pts[i + 1].y - (m[i + 1] * h) / 3} ${pts[i + 1].x},${pts[i + 1].y}`;
    }
    return d;
}

/** Straight polyline, for when smoothing would imply data between samples that isn't there. */
export function linearPath(pts: Pt[]): string {
    if (pts.length === 0) return "";
    return `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")}`;
}

/**
 * Which label indices to draw so none collide, in pixels.
 *
 * The old rule (`i % step === 0`, plus first and last) collided whenever the last index landed
 * next to a kept one — 32 points put labels at both 30 and 31, overlapping. This walks left to
 * right keeping a label only if it clears the previous by minGap, always keeps the last, and drops
 * the neighbour the last one would have overlapped.
 */
export function thinLabelIndices(positions: number[], minGap: number): number[] {
    const n = positions.length;
    if (n === 0) return [];
    if (n === 1) return [0];
    const kept: number[] = [0];
    for (let i = 1; i < n - 1; i++) {
        if (positions[i] - positions[kept[kept.length - 1]] >= minGap) kept.push(i);
    }
    const last = n - 1;
    while (kept.length > 0 && positions[last] - positions[kept[kept.length - 1]] < minGap) kept.pop();
    kept.push(last);
    return kept;
}

/** Axis-label form: compact, few characters, never the full cent-precise figure. */
export function formatCompact(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${trimZero(value / 1_000_000_000)}B`;
    if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
    if (abs >= 1_000) return `${trimZero(value / 1_000)}k`;
    if (abs > 0 && abs < 1) return value.toFixed(2);
    return String(Math.round(value));
}

function trimZero(n: number): string {
    const s = n.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Tooltip form for money: full precision, because this is the figure someone acts on. */
export function formatMoney(value: number): string {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tooltip form for counts: no decimals, because half a merchant does not exist. */
export function formatCount(value: number): string {
    return Math.round(value).toLocaleString();
}

/**
 * Percentages that sum to exactly 100 (largest remainder).
 *
 * Rounding each share on its own is why a legend could read 33% / 33% / 33% for a whole, or add up
 * to 101%. A reader who totals the legend and gets the wrong number stops trusting the chart.
 */
export function apportionPercents(values: number[]): number[] {
    const total = values.reduce((sum, v) => sum + (v > 0 ? v : 0), 0);
    if (total <= 0) return values.map(() => 0);

    const exact = values.map((v) => ((v > 0 ? v : 0) / total) * 100);
    const floors = exact.map((v) => Math.floor(v));
    let remainder = 100 - floors.reduce((sum, v) => sum + v, 0);

    const order = exact
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac);

    const out = [...floors];
    for (let k = 0; k < order.length && remainder > 0; k++, remainder--) out[order[k].i] += 1;
    return out;
}

/** Stable keyboard handling for a hover cursor over `count` samples. */
export function useCursorKeys(count: number, index: number | null, setIndex: (i: number | null) => void) {
    return useCallback(
        (event: React.KeyboardEvent) => {
            if (count === 0) return;
            const current = index ?? 0;
            switch (event.key) {
                case "ArrowRight":
                    event.preventDefault();
                    setIndex(Math.min(count - 1, current + 1));
                    break;
                case "ArrowLeft":
                    event.preventDefault();
                    setIndex(Math.max(0, current - 1));
                    break;
                case "Home":
                    event.preventDefault();
                    setIndex(0);
                    break;
                case "End":
                    event.preventDefault();
                    setIndex(count - 1);
                    break;
                case "Escape":
                    setIndex(null);
                    break;
                default:
                    break;
            }
        },
        [count, index, setIndex],
    );
}

/** Memoised min/max across one or two series, floored at zero for a money baseline. */
export function useDomain(primary: number[], secondary?: number[]) {
    return useMemo(() => {
        const all = [...primary, ...(secondary ?? [])].filter((v) => Number.isFinite(v));
        const max = all.length > 0 ? Math.max(...all) : 0;
        return niceScale(0, max, 4);
    }, [primary, secondary]);
}
