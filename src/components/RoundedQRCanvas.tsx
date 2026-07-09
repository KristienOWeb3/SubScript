"use client";

import React, { useEffect, useRef } from "react";
import { createQrMatrix } from "@/lib/qr";

interface RoundedQRCanvasProps {
    value: string;
    size?: number;
    level?: "L" | "M" | "Q" | "H";
    bgColor?: string;
    fgColor?: string;
    marginModules?: number;
    id?: string;
    className?: string;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/* Canvas twin of RoundedQRCode — same matrix + rounded style, so a poster preview and its
   downloaded PNG match. Used where a real <canvas> element is required (drawImage export). */
export default function RoundedQRCanvas({
    value,
    size = 320,
    level = "H",
    bgColor = "#ffffff",
    fgColor = "#0c0d12",
    marginModules = 4,
    id,
    className,
}: RoundedQRCanvasProps) {
    const ref = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { count, dark, inFinder } = createQrMatrix(value, level);
        const total = count + marginModules * 2;
        const cell = size / total;

        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = bgColor;
        roundRect(ctx, 0, 0, size, size, cell * 3);
        ctx.fill();

        ctx.fillStyle = fgColor;
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (!dark(r, c) || inFinder(r, c)) continue;
                const cx = (marginModules + c + 0.5) * cell;
                const cy = (marginModules + r + 0.5) * cell;
                ctx.beginPath();
                ctx.arc(cx, cy, cell * 0.46, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        const finder = (rowStart: number, colStart: number) => {
            const x = (marginModules + colStart) * cell;
            const y = (marginModules + rowStart) * cell;
            ctx.fillStyle = fgColor;
            roundRect(ctx, x, y, 7 * cell, 7 * cell, 2.1 * cell);
            ctx.fill();
            ctx.fillStyle = bgColor;
            roundRect(ctx, x + cell, y + cell, 5 * cell, 5 * cell, 1.5 * cell);
            ctx.fill();
            ctx.fillStyle = fgColor;
            roundRect(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, 1 * cell);
            ctx.fill();
        };
        finder(0, 0);
        finder(0, count - 7);
        finder(count - 7, 0);
    }, [value, size, level, bgColor, fgColor, marginModules]);

    return <canvas ref={ref} id={id} width={size} height={size} className={className} style={{ width: size, height: size }} />;
}
