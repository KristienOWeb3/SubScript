"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, Download, Share2, Send, ShieldCheck, Zap, Layers, Loader2 } from "@/components/icons";
import { QRCode } from "react-qrcode-logo";

interface MerchantPlan {
    id: string;
    merchantAddress: string;
    name: string;
    description?: string | null;
    detailsUrl?: string | null;
    amountUsdc: string;
    periodSeconds: string;
    active: boolean;
}

interface SharePlanModalProps {
    isOpen: boolean;
    onClose: () => void;
    plan: MerchantPlan | null;
    subscribeUrl: string;
}

type TemplateId = "neon" | "ocean" | "stark";

const formatAmount = (micros: string) => {
    try {
        return (Number(micros) / 1_000_000).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch {
        return "0.00";
    }
};

const formatPeriod = (seconds: string) => {
    const secs = Number(seconds);
    if (secs === 2592000) return "Month";
    if (secs === 31536000) return "Year";
    if (secs === 86400) return "Day";
    if (secs === 604800) return "Week";
    if (secs % 2592000 === 0) {
        const months = secs / 2592000;
        return `${months} Months`;
    }
    if (secs % 86400 === 0) {
        const days = secs / 86400;
        return `${days} Days`;
    }
    return `${secs}s`;
};

export default function SharePlanModal({
    isOpen,
    onClose,
    plan,
    subscribeUrl,
}: SharePlanModalProps) {
    const [template, setTemplate] = useState<TemplateId>("neon");
    const [copied, setCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [features, setFeatures] = useState<string[]>([
        "Secure USDC settlement on Arc",
        "Customer-controlled cancellation",
        "Fast hosted checkout",
    ]);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Reset features when a new plan is loaded
    useEffect(() => {
        if (plan) {
            setFeatures([
                "Secure USDC settlement on Arc",
                "Customer-controlled cancellation",
                "Fast hosted checkout",
            ]);
        }
    }, [plan]);

    if (!plan) return null;

    const formattedAmount = formatAmount(plan.amountUsdc);
    const formattedPeriod = formatPeriod(plan.periodSeconds);

    const handleFeatureChange = (index: number, val: string) => {
        const newFeatures = [...features];
        newFeatures[index] = val;
        setFeatures(newFeatures);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(subscribeUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleShareX = () => {
        const text = `Subscribe to our ${plan.name} on SubScript!\nPrice: $${formattedAmount} USDC / ${formattedPeriod}\n\nPay with stablecoins:`;
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(subscribeUrl)}`;
        window.open(url, "_blank");
    };

    const handleShareTelegram = () => {
        const text = `Subscribe to our ${plan.name} on SubScript! ($${formattedAmount} USDC / ${formattedPeriod})`;
        const url = `https://t.me/share/url?url=${encodeURIComponent(subscribeUrl)}&text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
    };

    const handleShareWhatsApp = () => {
        const text = `Subscribe to our ${plan.name} on SubScript! ($${formattedAmount} USDC / ${formattedPeriod}) ${subscribeUrl}`;
        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
    };

    const handleDownload = async () => {
        setDownloading(true);

        try {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Dimensions: 600x800
            const W = 600;
            const H = 800;
            canvas.width = W;
            canvas.height = H;

            // 1. Background drawing based on template
            if (template === "neon") {
                // Cyber Dark Background
                ctx.fillStyle = "#090a0d";
                ctx.fillRect(0, 0, W, H);

                // Radial Glows
                const g1 = ctx.createRadialGradient(W - 100, 100, 10, W - 100, 100, 300);
                g1.addColorStop(0, "rgba(204, 255, 0, 0.12)");
                g1.addColorStop(1, "transparent");
                ctx.fillStyle = g1;
                ctx.fillRect(0, 0, W, H);

                const g2 = ctx.createRadialGradient(100, H - 200, 10, 100, H - 200, 300);
                g2.addColorStop(0, "rgba(0, 210, 180, 0.15)");
                g2.addColorStop(1, "transparent");
                ctx.fillStyle = g2;
                ctx.fillRect(0, 0, W, H);

                // Cyber Grid Lines
                ctx.strokeStyle = "rgba(204, 255, 0, 0.03)";
                ctx.lineWidth = 1;
                const gridSpacing = 40;
                for (let x = 0; x < W; x += gridSpacing) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, H);
                    ctx.stroke();
                }
                for (let y = 0; y < H; y += gridSpacing) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(W, y);
                    ctx.stroke();
                }

                // Inner Glow Border
                ctx.strokeStyle = "rgba(204, 255, 0, 0.2)";
                ctx.lineWidth = 2;
                ctx.strokeRect(10, 10, W - 20, H - 20);

            } else if (template === "ocean") {
                // Ocean Glow background
                const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
                bgGrad.addColorStop(0, "#0b1528");
                bgGrad.addColorStop(1, "#040810");
                ctx.fillStyle = bgGrad;
                ctx.fillRect(0, 0, W, H);

                // Cyan Glow
                const g1 = ctx.createRadialGradient(W / 2, H / 3, 20, W / 2, H / 3, 400);
                g1.addColorStop(0, "rgba(0, 210, 180, 0.2)");
                g1.addColorStop(1, "transparent");
                ctx.fillStyle = g1;
                ctx.fillRect(0, 0, W, H);

                // Circular rings
                ctx.strokeStyle = "rgba(0, 210, 180, 0.05)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(W / 2, H / 3, 150, 0, Math.PI * 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(W / 2, H / 3, 250, 0, Math.PI * 2);
                ctx.stroke();

                // Inner Border
                ctx.strokeStyle = "rgba(0, 210, 180, 0.25)";
                ctx.lineWidth = 2;
                ctx.strokeRect(10, 10, W - 20, H - 20);

            } else {
                // Stark Modern template
                ctx.fillStyle = "#121212";
                ctx.fillRect(0, 0, W, H);

                // Sharp grid border
                ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
                ctx.lineWidth = 2;
                ctx.strokeRect(20, 20, W - 40, H - 40);
                ctx.strokeRect(24, 24, W - 48, H - 48);
            }

            // 2. Draw Logo
            ctx.fillStyle = "#ffffff";
            ctx.font = "900 18px sans-serif";
            ctx.letterSpacing = "6px";
            ctx.fillText("SUBSCRIPT", 40, 60);

            // 3. Draw Plan details badge
            const accentColor = template === "neon" ? "#ccff00" : template === "ocean" ? "#00d2b4" : "#ffffff";
            const badgeBg = template === "neon" ? "rgba(204, 255, 0, 0.1)" : template === "ocean" ? "rgba(0, 210, 180, 0.1)" : "rgba(255, 255, 255, 0.1)";

            ctx.fillStyle = badgeBg;
            ctx.strokeStyle = accentColor + "30";
            ctx.lineWidth = 1;
            
            // Draw badge rounded rect
            const badgeX = 40;
            const badgeY = 90;
            const badgeW = 100;
            const badgeH = 24;
            const r = 6;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, r);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = accentColor;
            ctx.font = "bold 9px sans-serif";
            ctx.letterSpacing = "1.5px";
            ctx.textAlign = "center";
            ctx.fillText("USDC NATIVE", badgeX + badgeW / 2, badgeY + 15);
            ctx.textAlign = "left"; // reset

            // 4. Draw Plan Name, shrinking long names so they stay inside the card.
            ctx.fillStyle = "#ffffff";
            ctx.letterSpacing = "1px";
            const planTitle = plan.name.toUpperCase();
            let planTitleSize = 36;
            do {
                ctx.font = `900 ${planTitleSize}px sans-serif`;
                planTitleSize -= 1;
            } while (ctx.measureText(planTitle).width > W - 80 && planTitleSize > 20);
            ctx.fillText(planTitle, 40, 160);

            // 5. Draw Price Label & Price
            ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
            ctx.font = "bold 11px sans-serif";
            ctx.letterSpacing = "2px";
            ctx.fillText("SUBSCRIPTION PRICE", 40, 210);

            ctx.fillStyle = accentColor;
            ctx.font = "900 48px sans-serif";
            ctx.letterSpacing = "0px";
            ctx.fillText(`$${formattedAmount}`, 40, 265);
            
            ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
            ctx.font = "bold 18px sans-serif";
            ctx.fillText(`USDC / ${formattedPeriod}`, 45 + ctx.measureText(`$${formattedAmount}`).width, 260);

            // 6. Draw Details Grid. Never include payout or merchant wallet addresses on a
            // promotional card; the hosted subscribe URL resolves the merchant safely.
            const detailY = 310;
            // Draw separating line
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(40, detailY);
            ctx.lineTo(W - 40, detailY);
            ctx.stroke();

            // Col 1: Billing Period
            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            ctx.font = "bold 10px sans-serif";
            ctx.letterSpacing = "1px";
            ctx.fillText("BILLING PERIOD", 40, detailY + 25);

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 14px sans-serif";
            ctx.fillText(`Every ${formattedPeriod}`, 40, detailY + 45);

            // Col 2: Hosted checkout assurance
            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            ctx.font = "bold 10px sans-serif";
            ctx.letterSpacing = "1px";
            ctx.fillText("CHECKOUT", W / 2 + 10, detailY + 25);

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 14px sans-serif";
            ctx.fillText("Hosted by SubScript", W / 2 + 10, detailY + 45);

            // Optional merchant-authored summary.
            if (plan.description) {
                const summary = plan.description.length > 74
                    ? `${plan.description.slice(0, 71).trimEnd()}…`
                    : plan.description;
                ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
                ctx.font = "11px sans-serif";
                ctx.letterSpacing = "0.1px";
                ctx.fillText(summary, 40, 385);
            }

            // 7. Draw Features List
            const featureY = plan.description ? 430 : 405;
            ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            ctx.font = "bold 10px sans-serif";
            ctx.letterSpacing = "1px";
            ctx.fillText("PLAN FEATURES & BENEFITS", 40, featureY);

            // Bullet points
            ctx.font = "13px sans-serif";
            ctx.letterSpacing = "0.2px";
            
            features.forEach((feature, idx) => {
                const itemY = featureY + 25 + idx * 30;
                // Draw small bullet icon
                ctx.fillStyle = accentColor;
                ctx.beginPath();
                ctx.arc(46, itemY - 4, 3, 0, Math.PI * 2);
                ctx.fill();

                // Draw feature text
                ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                ctx.fillText(feature, 62, itemY);
            });

            // 8. Draw Right Graphic (abstract shape matching template)
            const graphX = W - 150;
            const graphY = 200;
            
            if (template === "neon") {
                // Glowing Shield
                ctx.shadowColor = accentColor;
                ctx.shadowBlur = 15;
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 3;
                
                ctx.beginPath();
                ctx.moveTo(graphX, graphY - 30);
                ctx.lineTo(graphX + 25, graphY - 15);
                ctx.lineTo(graphX + 25, graphY + 15);
                ctx.quadraticCurveTo(graphX + 25, graphY + 35, graphX, graphY + 45);
                ctx.quadraticCurveTo(graphX - 25, graphY + 35, graphX - 25, graphY + 15);
                ctx.lineTo(graphX - 25, graphY - 15);
                ctx.closePath();
                ctx.stroke();
                
                // Draw checkmark inside
                ctx.beginPath();
                ctx.moveTo(graphX - 10, graphY + 2);
                ctx.lineTo(graphX - 2, graphY + 10);
                ctx.lineTo(graphX + 10, graphY - 5);
                ctx.stroke();

                ctx.shadowBlur = 0; // reset
            } else if (template === "ocean") {
                // Ocean Glow graphic (spheres / particles)
                ctx.fillStyle = accentColor;
                ctx.strokeStyle = "rgba(0, 210, 180, 0.4)";
                ctx.lineWidth = 1.5;

                // Center sphere
                ctx.beginPath();
                ctx.arc(graphX, graphY, 20, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Orbiting lines and small spheres
                const angles = [0, Math.PI * 0.65, Math.PI * 1.3];
                angles.forEach((ang) => {
                    const sx = graphX + Math.cos(ang) * 45;
                    const sy = graphY + Math.sin(ang) * 45;
                    ctx.beginPath();
                    ctx.moveTo(graphX, graphY);
                    ctx.lineTo(sx, sy);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
                    ctx.fill();
                });
            } else {
                // Stark Minimal graphic
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.strokeRect(graphX - 25, graphY - 25, 50, 50);
                ctx.strokeRect(graphX - 10, graphY - 10, 50, 50);
            }

            // 9. Draw Footer Banner (White card at the bottom). Taller than before so the QR can
            // dominate it — the card's whole job is to be scanned, so the code gets the space.
            const footerH = 176;
            const footerY = H - footerH - 34;
            const footerW = W - 80;
            const footerX = 40;
            const footerR = 16;

            // Draw white footer block
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.roundRect(footerX, footerY, footerW, footerH, footerR);
            ctx.fill();

            // Footer Text
            ctx.fillStyle = "#0c0d12";
            ctx.font = "bold 14px sans-serif";
            ctx.letterSpacing = "0.2px";
            ctx.fillText("Scan to subscribe securely.", footerX + 24, footerY + 56);

            ctx.fillStyle = "rgba(12, 13, 18, 0.6)";
            ctx.font = "bold 9px sans-serif";
            ctx.letterSpacing = "1px";
            ctx.fillText("POWERED BY SUBSCRIPT PROTOCOL", footerX + 24, footerY + 86);

            ctx.fillStyle = "#00d2b4";
            ctx.font = "900 11px sans-serif";
            ctx.fillText("NO CREDIT CARD NEEDED", footerX + 24, footerY + 112);

            // 10. Draw QR Code — large (150px) with a white quiet zone, rendered from a 320px source
            // so it stays crisp at this size. Bigger = easier to scan from across a room / on a phone.
            const qrCanvas = document.getElementById("plan-share-qr-canvas") as HTMLCanvasElement;
            if (qrCanvas) {
                const qrDrawSize = 150;
                ctx.drawImage(
                    qrCanvas,
                    footerX + footerW - qrDrawSize - 14,
                    footerY + (footerH - qrDrawSize) / 2,
                    qrDrawSize,
                    qrDrawSize,
                );
            }

            // 11. Trigger Download
            const dataUrl = canvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = `${plan.name.replace(/\s+/g, "_").toLowerCase()}_share_card.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error("Failed to generate and download share card PNG:", err);
        } finally {
            setDownloading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/75 backdrop-blur-md z-50"
                    />

                    {/* Modal Window */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto font-sans"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="share-subscription-title"
                    >
                        <div
                            className="bg-[#0b0c0f] border border-white/10 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl relative flex flex-col md:flex-row h-auto md:h-[620px]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Hidden canvas for PNG export */}
                            <canvas ref={canvasRef} className="hidden" />

                            {/* Left Side: Customization & Actions (Scrollable if needed) */}
                            <div className="flex-1 p-6 md:p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto">
                                <div>
                                    <div className="flex items-center justify-between mb-6">
                                        <div>
                                            <h2 id="share-subscription-title" className="text-base font-black uppercase tracking-wider text-white">Share Subscription</h2>
                                            <p className="text-[10px] text-white/40 mt-1 uppercase tracking-wider font-semibold">Promote your subscription plan</p>
                                        </div>
                                        <button
                                            onClick={onClose}
                                            className="md:hidden p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Features Customization Inputs */}
                                    <div className="space-y-4 mb-6">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-[#00d2b4]">Customize Features List</h3>
                                        <div className="space-y-2">
                                            {features.map((feature, idx) => (
                                                <div key={idx} className="relative">
                                                    <span className="absolute left-3 top-3 text-[9px] font-black text-white/35">#{idx + 1}</span>
                                                    <input
                                                        type="text"
                                                        value={feature}
                                                        onChange={(e) => handleFeatureChange(idx, e.target.value)}
                                                        placeholder={`Feature Benefit #${idx + 1}`}
                                                        maxLength={40}
                                                        className="w-full rounded-xl bg-black/40 border border-white/10 pl-9 pr-4 py-2 text-xs text-white placeholder-white/20 focus:border-[#00d2b4] focus:outline-none transition"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Choose Template Slider */}
                                    <div className="space-y-3 mb-6">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-[#00d2b4]">Select Card Template</h3>
                                        <div className="grid grid-cols-3 gap-2">
                                            {(["neon", "ocean", "stark"] as TemplateId[]).map((temp) => (
                                                <button
                                                    key={temp}
                                                    type="button"
                                                    onClick={() => setTemplate(temp)}
                                                    className={`py-2 px-3 rounded-xl border text-[9px] font-bold uppercase tracking-wider transition ${
                                                        template === temp
                                                            ? "bg-[#00d2b4]/10 border-[#00d2b4] text-[#00d2b4]"
                                                            : "bg-white/[0.02] border-white/5 text-white/50 hover:text-white hover:border-white/10"
                                                    }`}
                                                >
                                                    {temp === "neon" ? "Cyber Neon" : temp === "ocean" ? "Ocean Flow" : "Stark Modern"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Sharing actions */}
                                <div className="space-y-4 pt-4 border-t border-white/5">
                                    {/* Social Intents */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleShareX}
                                            className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                                        >
                                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                            </svg>
                                            Share X
                                        </button>
                                        <button
                                            onClick={handleShareTelegram}
                                            className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                                        >
                                            <Send className="w-3.5 h-3.5" />
                                            Telegram
                                        </button>
                                        <button
                                            onClick={handleShareWhatsApp}
                                            className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                                        >
                                            <Share2 className="w-3.5 h-3.5" />
                                            WhatsApp
                                        </button>
                                    </div>

                                    {/* Copy & Download actions */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleCopy}
                                            className="flex-1 py-3.5 bg-black/40 border border-white/10 hover:bg-black/60 text-white font-bold rounded-2xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                        >
                                            {copied ? <Check className="w-3.5 h-3.5 text-[#00d2b4]" /> : <Copy className="w-3.5 h-3.5 text-white/50" />}
                                            {copied ? "Link Copied" : "Copy Subscribe Link"}
                                        </button>
                                        <button
                                            onClick={handleDownload}
                                            disabled={downloading}
                                            className="flex-1 py-3.5 bg-gradient-to-r from-[#00d2b4] to-emerald-400 hover:brightness-110 disabled:opacity-50 text-black font-extrabold rounded-2xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.15)]"
                                        >
                                            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                            {downloading ? "Exporting..." : "Download Card"}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Right Side: Visual Share Card Preview */}
                            <div className="w-full md:w-[400px] bg-black p-6 md:p-8 flex flex-col justify-center items-center relative overflow-hidden shrink-0 border-t md:border-t-0 md:border-l border-white/10">
                                {/* Close Button (Top right, desktop only) */}
                                <button
                                    onClick={onClose}
                                    className="hidden md:block absolute top-6 right-6 p-2 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all"
                                >
                                    <X className="w-4 h-4" />
                                </button>

                                {/* Pre-rendered QRCodeCanvas hidden in DOM for canvas usage */}
                                <div className="hidden">
                                    <QRCode
                                        id="plan-share-qr-canvas"
                                        value={subscribeUrl}
                                        size={320}
                                        ecLevel="H"
                                        bgColor="#ffffff"
                                        fgColor="#0c0d12"
                                        qrStyle="dots"
                                        eyeRadius={[
                                            [18, 18, 0, 18],
                                            [18, 18, 18, 0],
                                            [18, 0, 18, 18]
                                        ]}
                                        logoImage="/logo.png"
                                        logoWidth={64}
                                        logoHeight={64}
                                        removeQrCodeBehindLogo={true}
                                        logoPadding={3}
                                    />
                                </div>

                                {/* Poster Preview Box */}
                                <div
                                    className={`w-[290px] h-[386px] rounded-3xl border relative flex flex-col justify-between p-5 overflow-hidden shadow-2xl transition-all duration-500 ${
                                        template === "neon"
                                            ? "bg-[#090a0d] border-white/10 shadow-[0_15px_30px_rgba(0,0,0,0.8)]"
                                            : template === "ocean"
                                            ? "bg-gradient-to-b from-[#0b1528] to-[#040810] border-[#00d2b4]/20 shadow-[0_15px_30px_rgba(0,210,180,0.06)]"
                                            : "bg-[#121212] border-white/20 shadow-[0_15px_30px_rgba(0,0,0,0.8)]"
                                    }`}
                                >
                                    {/* Background decorative templates */}
                                    {template === "neon" && (
                                        <>
                                            {/* Top-Right Neon yellow-green glow */}
                                            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-[#ccff00]/10 blur-xl pointer-events-none" />
                                            {/* Bottom-Left Cyan glow */}
                                            <div className="absolute -bottom-10 -left-10 w-28 h-28 rounded-full bg-[#00d2b4]/10 blur-xl pointer-events-none" />
                                            {/* Cyber Grid Lines */}
                                            <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(204,255,0,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(204,255,0,0.2) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                                        </>
                                    )}
                                    {template === "ocean" && (
                                        <>
                                            {/* Center Cyan Radial Glow */}
                                            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-[#00d2b4]/15 blur-2xl pointer-events-none" />
                                            {/* Orbiting Ring */}
                                            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full border border-[#00d2b4]/5 pointer-events-none" />
                                            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full border border-[#00d2b4]/5 pointer-events-none" />
                                        </>
                                    )}

                                    {/* Preview Content */}
                                    <div className="z-10 space-y-4">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">SubScript</h4>
                                                <span className={`inline-block text-[7px] font-extrabold px-1.5 py-0.5 rounded border mt-1 tracking-wider ${
                                                    template === "neon"
                                                        ? "bg-[#ccff00]/10 border-[#ccff00]/20 text-[#ccff00]"
                                                        : template === "ocean"
                                                        ? "bg-[#00d2b4]/10 border-[#00d2b4]/20 text-[#00d2b4]"
                                                        : "bg-white/10 border-white/20 text-white"
                                                }`}>
                                                    USDC NATIVE
                                                </span>
                                            </div>

                                            {/* Graphic Illustration */}
                                            <div className="shrink-0 scale-75 -mt-1 -mr-1">
                                                {template === "neon" ? (
                                                    <div className="w-10 h-10 rounded-xl bg-[#ccff00]/10 border border-[#ccff00]/20 flex items-center justify-center text-[#ccff00] shadow-[0_0_15px_rgba(204,255,0,0.15)]">
                                                        <ShieldCheck className="w-5 h-5" />
                                                    </div>
                                                ) : template === "ocean" ? (
                                                    <div className="w-10 h-10 rounded-xl bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center text-[#00d2b4] shadow-[0_0_15px_rgba(0,210,180,0.15)]">
                                                        <Zap className="w-5 h-5" />
                                                    </div>
                                                ) : (
                                                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/20 flex items-center justify-center text-white">
                                                        <Layers className="w-5 h-5" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-base font-black uppercase text-white truncate tracking-tight">{plan.name}</h3>
                                            <div className="mt-1 flex items-baseline gap-1">
                                                <span className={`text-2xl font-black ${
                                                    template === "neon" ? "text-[#ccff00]" : template === "ocean" ? "text-[#00d2b4]" : "text-white"
                                                }`}>
                                                    ${formattedAmount}
                                                </span>
                                                <span className="text-[10px] text-white/55 font-bold">
                                                    USDC / {formattedPeriod}
                                                </span>
                                            </div>
                                            {plan.description && (
                                                <p className="mt-2 line-clamp-2 text-[8px] leading-relaxed text-white/50">
                                                    {plan.description}
                                                </p>
                                            )}
                                        </div>

                                        {/* Separator */}
                                        <div className="h-[1px] bg-white/10 w-full" />

                                        {/* Features List Preview */}
                                        <div className="space-y-1.5">
                                            <p className="text-[8px] font-bold text-white/35 uppercase tracking-wider">Features Include</p>
                                            <ul className="space-y-1 text-[9px] text-white/80 font-medium">
                                                {features.map((feature, idx) => (
                                                    <li key={idx} className="flex items-center gap-1.5 truncate">
                                                        <span className={`w-1 h-1 rounded-full shrink-0 ${
                                                            template === "neon" ? "bg-[#ccff00]" : template === "ocean" ? "bg-[#00d2b4]" : "bg-white"
                                                        }`} />
                                                        <span className="truncate">{feature || `Benefit #${idx + 1}`}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>

                                    {/* Bottom White Card Footer */}
                                    <div className="bg-white rounded-2xl p-2.5 flex items-center justify-between gap-2 z-10 shadow-lg">
                                        <div className="space-y-1 max-w-[118px]">
                                            <p className="text-[8px] font-bold text-black leading-tight">Scan to subscribe securely.</p>
                                            <p className="text-[6px] font-black text-black/35 tracking-wider uppercase leading-tight">Powered by SubScript</p>
                                            <p className="text-[6.5px] font-extrabold text-[#00d2b4] leading-tight">NO CREDIT CARD NEEDED</p>
                                        </div>
                                        {/* QR Code Canvas */}
                                        <div className="bg-white p-1 rounded-lg border border-black/5 shrink-0 shadow-inner">
                                            <QRCode
                                                value={subscribeUrl}
                                                size={92}
                                                ecLevel="H"
                                                bgColor="#ffffff"
                                                fgColor="#0c0d12"
                                                qrStyle="dots"
                                                eyeRadius={[
                                                    [5, 5, 0, 5],
                                                    [5, 5, 5, 0],
                                                    [5, 0, 5, 5]
                                                ]}
                                                logoImage="/logo.png"
                                                logoWidth={18}
                                                logoHeight={18}
                                                removeQrCodeBehindLogo={true}
                                                logoPadding={1.5}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Slider Page Indicators */}
                                <div className="flex gap-1.5 mt-5">
                                    {(["neon", "ocean", "stark"] as TemplateId[]).map((temp) => (
                                        <button
                                            key={temp}
                                            type="button"
                                            onClick={() => setTemplate(temp)}
                                            className={`h-1.5 rounded-full transition-all duration-300 ${
                                                template === temp ? "w-4 bg-[#00d2b4]" : "w-1.5 bg-white/20"
                                            }`}
                                            aria-label={`Switch to template ${temp}`}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
