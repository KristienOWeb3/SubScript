"use client";

import { useEffect, useRef } from "react";

type Orb = {
    baseX: number;
    baseY: number;
    radius: number;
    color: [number, number, number];
    alpha: number;
    speedX: number;
    speedY: number;
    phaseX: number;
    phaseY: number;
};

// Brand palette: teal and warm gold, matching the public site identity.
const brandOrbs: Orb[] = [
    { baseX: 0.2,  baseY: 0.15, radius: 420, color: [0, 210, 180],  alpha: 0.30, speedX: 0.25, speedY: 0.18, phaseX: 0,   phaseY: 0.5  },
    { baseX: 0.75, baseY: 0.55, radius: 450, color: [0, 210, 180],  alpha: 0.24, speedX: 0.2,  speedY: 0.28, phaseX: 1.2, phaseY: 0    },
    { baseX: 0.5,  baseY: 0.75, radius: 350, color: [0, 160, 200],  alpha: 0.20, speedX: 0.35, speedY: 0.12, phaseX: 2.0, phaseY: 1.0  },
    { baseX: 0.1,  baseY: 0.6,  radius: 320, color: [0, 210, 180],  alpha: 0.18, speedX: 0.18, speedY: 0.25, phaseX: 0.8, phaseY: 2.5  },
    { baseX: 0.85, baseY: 0.2,  radius: 280, color: [0, 180, 160],  alpha: 0.16, speedX: 0.3,  speedY: 0.22, phaseX: 1.5, phaseY: 1.8  },
    { baseX: 0.4,  baseY: 0.35, radius: 260, color: [212, 168, 83], alpha: 0.14, speedX: 0.15, speedY: 0.3,  phaseX: 3.0, phaseY: 0.4  },
];

// Original dashboard palette: yellow-green (#ccff00) and teal orbs.
const dashboardOrbs: Orb[] = [
    { baseX: 0.2,  baseY: 0.15, radius: 420, color: [204, 255, 0],  alpha: 0.32, speedX: 0.25, speedY: 0.18, phaseX: 0,   phaseY: 0.5  },
    { baseX: 0.75, baseY: 0.55, radius: 450, color: [0, 210, 180],  alpha: 0.28, speedX: 0.2,  speedY: 0.28, phaseX: 1.2, phaseY: 0    },
    { baseX: 0.5,  baseY: 0.75, radius: 350, color: [204, 255, 0],  alpha: 0.24, speedX: 0.35, speedY: 0.12, phaseX: 2.0, phaseY: 1.0  },
    { baseX: 0.1,  baseY: 0.6,  radius: 320, color: [0, 210, 180],  alpha: 0.20, speedX: 0.18, speedY: 0.25, phaseX: 0.8, phaseY: 2.5  },
    { baseX: 0.85, baseY: 0.2,  radius: 280, color: [160, 230, 0],  alpha: 0.18, speedX: 0.3,  speedY: 0.22, phaseX: 1.5, phaseY: 1.8  },
    { baseX: 0.4,  baseY: 0.35, radius: 260, color: [212, 168, 83], alpha: 0.14, speedX: 0.15, speedY: 0.3,  phaseX: 3.0, phaseY: 0.4  },
];

/**
 * Full-screen animated gradient background with slowly morphing orbs on a
 * dark base. The default "brand" variant uses the public-site teal/gold
 * palette; "dashboard" preserves the original yellow-green dashboard look.
 *
 * Uses a fixed canvas that sits behind all page content.
 * The page <main> backgrounds must be transparent for this to show through.
 */
export default function AnimatedGradientBg({ variant = "brand" }: { variant?: "brand" | "dashboard" }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationId: number;
        let time = 0;
        let currentDpr = window.devicePixelRatio || 1;

        const resize = () => {
            currentDpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * currentDpr;
            canvas.height = window.innerHeight * currentDpr;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
        };

        resize();
        window.addEventListener("resize", resize);

        const orbs = variant === "dashboard" ? dashboardOrbs : brandOrbs;

        const draw = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;

            // Clear with dark base
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "#030303";
            ctx.fillRect(0, 0, w, h);

            // Additive blending for glowing orbs
            ctx.globalCompositeOperation = "lighter";

            for (const orb of orbs) {
                const x = orb.baseX * w + Math.sin(time * orb.speedX + orb.phaseX) * w * 0.15;
                const y = orb.baseY * h + Math.cos(time * orb.speedY + orb.phaseY) * h * 0.12;

                // Pulsing radius
                const pulse = Math.sin(time * 0.4 + orb.phaseX * 2) * 0.15 + 1;
                const r = orb.radius * pulse;

                // Pulsing alpha
                const alphaPulse = orb.alpha + Math.sin(time * 0.3 + orb.phaseY) * orb.alpha * 0.25;

                const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
                gradient.addColorStop(0, `rgba(${orb.color[0]}, ${orb.color[1]}, ${orb.color[2]}, ${alphaPulse})`);
                gradient.addColorStop(0.4, `rgba(${orb.color[0]}, ${orb.color[1]}, ${orb.color[2]}, ${alphaPulse * 0.5})`);
                gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = gradient;
                ctx.fill();
            }

            time += 0.025;
            animationId = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            window.removeEventListener("resize", resize);
            cancelAnimationFrame(animationId);
        };
    }, [variant]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 0, willChange: "transform", transform: "translate3d(0,0,0)" }}
            aria-hidden="true"
        />
    );
}
