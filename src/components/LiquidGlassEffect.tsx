"use client";

import { useEffect, useId, useRef, useState } from "react";

// Physically-based "liquid glass" refraction overlay, after
// https://kube.io/blog/liquid-glass-css-svg/ — refraction (Snell's law) is
// pre-traced across a convex-squircle bezel, baked into an SVG displacement
// map, and applied to the page behind the element via backdrop-filter.
//
// SVG filters inside backdrop-filter only render in Chromium engines, and the
// effect is requested for mobile only, so the overlay activates exclusively on
// Chromium + viewports under 768px. Everywhere else it renders nothing and the
// parent keeps its existing .liquid-glass blur styling.

const GLASS_IOR = 1.5;
const LUT_SIZE = 256;

type GlassState = {
    width: number;
    height: number;
    mapUrl: string;
    scale: number;
};

// Displacement magnitude for each depth into the bezel, from ray-tracing a
// vertical ray through a convex squircle surface profile y = (1 - (1-s)^4)^1/4.
function buildMagnitudeLut(bezel: number): { lut: Float32Array; max: number } {
    const lut = new Float32Array(LUT_SIZE);
    let max = 0;
    for (let i = 0; i < LUT_SIZE; i++) {
        const s = i / (LUT_SIZE - 1); // 0 at the rim -> 1 at the bezel's inner edge
        const u = 1 - s;
        const body = 1 - u ** 4;
        const surfaceHeight = Math.pow(body, 0.25) * bezel;
        const slope = body > 1e-6 ? u ** 3 / Math.pow(body, 0.75) : 1e6;
        const thetaIn = Math.atan(slope);
        const thetaOut = Math.asin(Math.sin(thetaIn) / GLASS_IOR);
        const glassDepth = surfaceHeight + bezel * 0.25;
        const magnitude = glassDepth * Math.tan(thetaIn - thetaOut);
        lut[i] = magnitude;
        if (magnitude > max) max = magnitude;
    }
    if (max > 0) {
        for (let i = 0; i < LUT_SIZE; i++) lut[i] /= max;
    }
    return { lut, max };
}

// Bakes the displacement vector field for a rounded rectangle into a PNG data
// URL: R encodes X displacement, G encodes Y, 128 is neutral. Direction is the
// outward normal of the rounded-rect signed distance field.
function buildDisplacementMap(
    width: number,
    height: number,
    radius: number,
    bezel: number,
): { url: string; maxDisplacement: number } | null {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(width * dpr));
    const ch = Math.max(1, Math.round(height * dpr));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const { lut, max } = buildMagnitudeLut(bezel);
    const image = ctx.createImageData(cw, ch);
    const data = image.data;

    const halfW = width / 2;
    const halfH = height / 2;
    const innerW = halfW - radius;
    const innerH = halfH - radius;

    let offset = 0;
    for (let y = 0; y < ch; y++) {
        const py = (y + 0.5) / dpr - halfH;
        const qy = Math.abs(py) - innerH;
        for (let x = 0; x < cw; x++) {
            const px = (x + 0.5) / dpr - halfW;
            const qx = Math.abs(px) - innerW;

            let nx = 0;
            let ny = 0;
            let inside: number;
            if (qx > 0 && qy > 0) {
                // corner region: distance and normal come from the corner circle
                const len = Math.hypot(qx, qy);
                inside = radius - len;
                if (len > 1e-6) {
                    nx = (qx / len) * Math.sign(px);
                    ny = (qy / len) * Math.sign(py);
                }
            } else if (qx > qy) {
                inside = radius - qx;
                nx = Math.sign(px);
            } else {
                inside = radius - qy;
                ny = Math.sign(py);
            }

            let r = 128;
            let g = 128;
            if (inside > 0 && inside < bezel) {
                const idx = Math.min(
                    LUT_SIZE - 1,
                    Math.round((inside / bezel) * (LUT_SIZE - 1)),
                );
                const magnitude = lut[idx];
                r = 128 + nx * magnitude * 127;
                g = 128 + ny * magnitude * 127;
            }

            data[offset] = r;
            data[offset + 1] = g;
            data[offset + 2] = 128;
            data[offset + 3] = 255;
            offset += 4;
        }
    }

    ctx.putImageData(image, 0, 0);
    return { url: canvas.toDataURL("image/png"), maxDisplacement: max };
}

export default function LiquidGlassEffect({
    bezel = 14,
    blur = 2.5,
    saturation = 1.4,
    strength = 1,
    className = "",
}: {
    /** Width in px of the refractive rim around the shape's edge. */
    bezel?: number;
    /** Frosting blur (px) applied to the backdrop before refraction. */
    blur?: number;
    /** Backdrop saturation boost, 1 = unchanged. */
    saturation?: number;
    /** Multiplier on the physically-derived displacement amount. */
    strength?: number;
    className?: string;
}) {
    const reactId = useId();
    const filterId = `liquid-glass-${reactId.replace(/[^a-zA-Z0-9-]/g, "")}`;
    const ref = useRef<HTMLSpanElement>(null);
    const [glass, setGlass] = useState<GlassState | null>(null);

    useEffect(() => {
        const el = ref.current;
        const parent = el?.parentElement;
        if (!el || !parent) return;

        // Chromium is the only engine that renders SVG filters in
        // backdrop-filter; iOS browsers (all WebKit) never match "Chrome/".
        const supported =
            typeof CSS !== "undefined" &&
            CSS.supports("backdrop-filter", "url(#a)") &&
            /Chrome\//.test(navigator.userAgent);
        if (!supported) return;

        const mobileQuery = window.matchMedia("(max-width: 767px)");
        let frame = 0;

        const rebuild = () => {
            if (!mobileQuery.matches) {
                setGlass(null);
                return;
            }
            const rect = parent.getBoundingClientRect();
            const width = Math.round(rect.width);
            const height = Math.round(rect.height);
            if (width < 8 || height < 8) {
                setGlass(null);
                return;
            }
            const radiusRaw =
                parseFloat(getComputedStyle(parent).borderTopLeftRadius) || 0;
            const radius = Math.min(radiusRaw, width / 2, height / 2);
            const bezelPx = Math.max(
                2,
                Math.min(bezel, Math.max(radius, 2), Math.min(width, height) / 2),
            );
            const map = buildDisplacementMap(width, height, radius, bezelPx);
            if (!map) {
                setGlass(null);
                return;
            }
            // Stored vectors span ±127/255 of the channel range around neutral,
            // so scale = 2 * max recovers real pixel displacement.
            setGlass({
                width,
                height,
                mapUrl: map.url,
                scale: 2 * map.maxDisplacement * strength,
            });
        };

        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(rebuild);
        };

        schedule();
        const observer = new ResizeObserver(schedule);
        observer.observe(parent);
        mobileQuery.addEventListener("change", schedule);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            mobileQuery.removeEventListener("change", schedule);
        };
    }, [bezel, strength]);

    // While active, the parent's own backdrop-filter must be off: an element
    // with backdrop-filter becomes a backdrop root, which would limit this
    // overlay to sampling only the parent's background instead of the page.
    const active = Boolean(glass);
    useEffect(() => {
        const parent = ref.current?.parentElement;
        if (!parent || !active) return;
        parent.style.setProperty("backdrop-filter", "none", "important");
        parent.style.setProperty("-webkit-backdrop-filter", "none", "important");
        return () => {
            parent.style.removeProperty("backdrop-filter");
            parent.style.removeProperty("-webkit-backdrop-filter");
        };
    }, [active]);

    const margin = glass ? Math.ceil(glass.scale) + 2 : 0;

    return (
        <span
            ref={ref}
            aria-hidden
            className={className}
            style={{
                position: "absolute",
                inset: 0,
                zIndex: -1,
                borderRadius: "inherit",
                pointerEvents: "none",
                ...(glass
                    ? {
                          backdropFilter: `url(#${filterId})`,
                          WebkitBackdropFilter: `url(#${filterId})`,
                      }
                    : null),
            }}
        >
            {glass && (
                <svg width="0" height="0" style={{ position: "absolute" }}>
                    <filter
                        id={filterId}
                        x={-margin}
                        y={-margin}
                        width={glass.width + margin * 2}
                        height={glass.height + margin * 2}
                        filterUnits="userSpaceOnUse"
                        primitiveUnits="userSpaceOnUse"
                        colorInterpolationFilters="sRGB"
                    >
                        <feImage
                            href={glass.mapUrl}
                            x="0"
                            y="0"
                            width={glass.width}
                            height={glass.height}
                            preserveAspectRatio="none"
                            result="map"
                        />
                        <feGaussianBlur
                            in="SourceGraphic"
                            stdDeviation={blur}
                            result="soft"
                        />
                        <feDisplacementMap
                            in="soft"
                            in2="map"
                            scale={glass.scale}
                            xChannelSelector="R"
                            yChannelSelector="G"
                            result="displaced"
                        />
                        <feColorMatrix
                            in="displaced"
                            type="saturate"
                            values={String(saturation)}
                        />
                    </filter>
                </svg>
            )}
        </span>
    );
}
