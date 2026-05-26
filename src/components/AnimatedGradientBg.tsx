"use client";

import { useEffect, useRef } from "react";

/**
 * Full-screen animated gradient background with slowly morphing 
 * yellow (#ccff00) and green (#00d2b4) orbs on a dark base.
 * 
 * Renders behind all page content using CSS absolute positioning + z-index.
 * Uses a canvas element with requestAnimationFrame for smooth, GPU-friendly animation.
 */
export default function AnimatedGradientBg() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationId: number;
        let time = 0;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            ctx.scale(dpr, dpr);
        };

        resize();
        window.addEventListener("resize", resize);

        // Orb definitions — each slowly drifts around the viewport
        const orbs = [
            { baseX: 0.25, baseY: 0.2, radius: 350, color: "rgba(204, 255, 0, 0.07)", speedX: 0.3, speedY: 0.2, phaseX: 0, phaseY: 0.5 },
            { baseX: 0.7, baseY: 0.6, radius: 400, color: "rgba(0, 210, 180, 0.06)", speedX: 0.25, speedY: 0.35, phaseX: 1.2, phaseY: 0 },
            { baseX: 0.5, baseY: 0.8, radius: 300, color: "rgba(204, 255, 0, 0.05)", speedX: 0.4, speedY: 0.15, phaseX: 2.0, phaseY: 1.0 },
            { baseX: 0.15, baseY: 0.65, radius: 280, color: "rgba(0, 210, 180, 0.05)", speedX: 0.2, speedY: 0.3, phaseX: 0.8, phaseY: 2.5 },
            { baseX: 0.8, baseY: 0.25, radius: 320, color: "rgba(180, 230, 0, 0.04)", speedX: 0.35, speedY: 0.25, phaseX: 1.5, phaseY: 1.8 },
        ];

        const draw = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;

            // Clear with very dark base
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "#030303";
            ctx.fillRect(0, 0, w, h);

            // Draw each orb with additive-like blending
            ctx.globalCompositeOperation = "lighter";

            for (const orb of orbs) {
                const x = orb.baseX * w + Math.sin(time * orb.speedX + orb.phaseX) * w * 0.12;
                const y = orb.baseY * h + Math.cos(time * orb.speedY + orb.phaseY) * h * 0.1;

                // Pulsing radius
                const r = orb.radius + Math.sin(time * 0.5 + orb.phaseX) * 40;

                const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
                gradient.addColorStop(0, orb.color);
                gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = gradient;
                ctx.fill();
            }

            time += 0.005; // Very slow drift
            animationId = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            window.removeEventListener("resize", resize);
            cancelAnimationFrame(animationId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: -1 }}
            aria-hidden="true"
        />
    );
}
