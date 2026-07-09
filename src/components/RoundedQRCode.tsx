"use client";

import React from "react";
import { createQrMatrix, excavateBounds } from "@/lib/qr";

type ImageSettings = { src: string; width: number; height: number; excavate?: boolean };

interface RoundedQRCodeProps {
    value: string;
    size?: number;
    level?: "L" | "M" | "Q" | "H";
    bgColor?: string;
    fgColor?: string;
    /** Quiet-zone width in modules. Defaults to the QR-spec minimum of 4. */
    marginModules?: number;
    imageSettings?: ImageSettings;
    className?: string;
    style?: React.CSSProperties;
}

/* Rounded QR renderer (SVG): data modules are dots, position patterns are rounded frames.
   Error correction is left to the caller (level "H" recommended, especially with a center
   logo) so the dot style stays reliably scannable. */
export default function RoundedQRCode({
    value,
    size = 200,
    level = "H",
    bgColor = "#ffffff",
    fgColor = "#000000",
    marginModules = 4,
    imageSettings,
    className,
    style,
}: RoundedQRCodeProps) {
    const { count, dark, inFinder } = createQrMatrix(value, level);
    const total = count + marginModules * 2;
    const pxPerModule = size / total;

    const logoModules = imageSettings
        ? Math.ceil(Math.max(imageSettings.width, imageSettings.height) / pxPerModule)
        : 0;
    const ex = imageSettings?.excavate ? excavateBounds(count, marginModules, logoModules) : null;

    const dots: React.ReactNode[] = [];
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (!dark(r, c) || inFinder(r, c)) continue;
            if (ex && r >= ex.r0 && r <= ex.r1 && c >= ex.c0 && c <= ex.c1) continue;
            dots.push(
                <circle
                    key={`${r}-${c}`}
                    cx={marginModules + c + 0.5}
                    cy={marginModules + r + 0.5}
                    r={0.46}
                    fill={fgColor}
                />,
            );
        }
    }

    /* One position-detection pattern as concentric rounded rects: 7x7 frame + 3x3 center. */
    const finder = (rowStart: number, colStart: number, key: string) => {
        const x = marginModules + colStart;
        const y = marginModules + rowStart;
        return (
            <g key={key}>
                <rect x={x} y={y} width={7} height={7} rx={2.1} ry={2.1} fill={fgColor} />
                <rect x={x + 1} y={y + 1} width={5} height={5} rx={1.5} ry={1.5} fill={bgColor} />
                <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} ry={1} fill={fgColor} />
            </g>
        );
    };

    const logoPx = imageSettings ? logoModules : 0;

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${total} ${total}`}
            className={className}
            style={style}
            shapeRendering="geometricPrecision"
            role="img"
            aria-label="QR code"
        >
            <rect width={total} height={total} rx={3} ry={3} fill={bgColor} />
            {finder(0, 0, "tl")}
            {finder(0, count - 7, "tr")}
            {finder(count - 7, 0, "bl")}
            {dots}
            {imageSettings && ex && (
                <>
                    <rect
                        x={total / 2 - logoPx / 2 - 0.4}
                        y={total / 2 - logoPx / 2 - 0.4}
                        width={logoPx + 0.8}
                        height={logoPx + 0.8}
                        rx={1.2}
                        ry={1.2}
                        fill={bgColor}
                    />
                    <image
                        href={imageSettings.src}
                        x={total / 2 - logoPx / 2}
                        y={total / 2 - logoPx / 2}
                        width={logoPx}
                        height={logoPx}
                        preserveAspectRatio="xMidYMid meet"
                    />
                </>
            )}
        </svg>
    );
}
