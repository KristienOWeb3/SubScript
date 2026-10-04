"use client";

import { useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef, useId, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, animate } from "framer-motion";
import {
    X,
    Copy,
    Check,
    QrCode,
    Loader2,
    ArrowLeft,
    CheckCircle2,
    ArrowRight,
    AlertCircle,
} from "lucide-react";
import { Globe, Building2 } from "@/components/icons";
import { QRCode } from "react-qrcode-logo";
import { createPublicClient, formatUnits, http } from "viem";
import { activeArcChain } from "@/lib/wagmi";
import {
    USDC_NATIVE_GAS_ADDRESS,
    ARC_CCTP_ENABLED,
    CCTP_CONFIG,
    ARC_CCTP_DOMAIN_ID,
    ARC_TESTNET_CHAIN_ID,
    ARC_MAINNET_CHAIN_ID,
    SOLANA_CCTP_CONFIG,
    isProd,
} from "@/lib/contracts/constants";
import { ChainLogo } from "@/components/ChainLogo";
import ArcOnramp from "@/components/ArcOnramp";

const EASE = "cubic-bezier(.16,1,.3,1)";
const EASE_EXP = "cubic-bezier(.32,.72,0,1)";
const EASE_CLOSE = "cubic-bezier(.45,0,.1,1)";

function DepositMethodPanel({ method, mobile, children }: {
    method: "crypto" | "onramp";
    mobile: boolean;
    children: ReactNode;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const height = useMotionValue<number | string>("auto");
    const heightInitialized = useRef(false);
    const reduceMotion = useReducedMotion();
    const direction = method === "onramp" ? 1 : -1;

    useLayoutEffect(() => {
        const content = contentRef.current;
        if (!content || mobile) return;
        let stopAnimation: (() => void) | undefined;
        let targetHeight: number | undefined;
        const measure = () => {
            const nextHeight = content.offsetHeight;
            if (nextHeight === targetHeight) return;
            targetHeight = nextHeight;
            stopAnimation?.();
            if (!heightInitialized.current || reduceMotion) {
                height.set(nextHeight);
                heightInitialized.current = true;
            } else {
                const animation = animate(height, nextHeight, { duration: 0.44, ease: [0.16, 1, 0.3, 1] });
                stopAnimation = () => animation.stop();
            }
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        return () => { observer.disconnect(); stopAnimation?.(); };
    }, [method, mobile, reduceMotion, height]);

    return (
        <motion.div
            data-testid="deposit-method-container"
            style={{ position: "relative", overflow: "hidden", minHeight: 0, flex: mobile ? 1 : undefined, height: mobile ? undefined : height }}
        >
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                <motion.div
                    key={method}
                    data-testid="deposit-method-panel"
                    data-method={method}
                    custom={direction}
                    initial={reduceMotion ? false : { opacity: 0, x: direction * 28, filter: "blur(10px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)", pointerEvents: "auto" }}
                    exit="leave"
                    variants={{ leave: (dir: number) => ({ opacity: 0, x: reduceMotion ? 0 : -dir * 28, filter: reduceMotion ? "blur(0px)" : "blur(10px)", pointerEvents: "none" }) }}
                    transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                        position: mobile ? "absolute" : "relative",
                        inset: mobile ? 0 : undefined,
                    }}
                >
                    {/* popLayout owns its child's ref; measure an inner element instead. */}
                    <div ref={contentRef} style={{ display: "flex", flexDirection: "column", gap: mobile ? 12 : 16, height: mobile ? "100%" : undefined }}>
                        {children}
                    </div>
                </motion.div>
            </AnimatePresence>
        </motion.div>
    );
}

const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;

/* Read-only clients for origin chains, built lazily from CCTP_CONFIG. */
const originClientCache = new Map<number, ReturnType<typeof createPublicClient>>();
function originPublicClient(originChainId: number) {
    const cached = originClientCache.get(originChainId);
    if (cached) return cached;
    const rpc = CCTP_CONFIG[originChainId]?.defaultRpc;
    if (!rpc) throw new Error(`No RPC configured for chain ${originChainId}.`);
    const client = createPublicClient({ transport: http(rpc) });
    originClientCache.set(originChainId, client);
    return client;
}

export interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    isEmbeddedWallet?: boolean;
    isTier1?: boolean;
    depositAddress: string;
    onSuccess?: () => void;
    isMobile?: boolean;
}

type DepositStep = "chains" | "address";

export interface SupportedDepositChain {
    chainId: number;
    name: string;
    shortName: string;
    feePercentage: string;
    isArc: boolean;
    isL1?: boolean;
    usdc: string;
    tokenMessenger?: string | null;
    domain?: number;
    badge: string;
    subtext: string;
    disabled?: boolean;
}

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet = false,
    isTier1 = true,
    depositAddress,
    onSuccess,
    isMobile,
}: DepositModalProps) {
    const [isMobileScreen, setIsMobileScreen] = useState(() => typeof window !== "undefined" ? window.innerWidth <= 600 : false);
    useEffect(() => {
        const check = () => setIsMobileScreen(window.innerWidth <= 600);
        check();
        window.addEventListener("resize", check);
        return () => window.removeEventListener("resize", check);
    }, []);
    const effectiveIsMobile = isMobile !== undefined ? isMobile : isMobileScreen;

    const sheetRef = useRef<HTMLDivElement | null>(null);
    const pageRef = useRef<HTMLDivElement | null>(null);
    const scrimRef = useRef<HTMLDivElement | null>(null);
    const tintRef = useRef<HTMLDivElement | null>(null);

    const [step, setStep] = useState<DepositStep>("chains");
    const [depositMethod, setDepositMethod] = useState<"crypto" | "onramp">("crypto");
    const methodPillId = useId();
    const reduceMotion = useReducedMotion();
    const [selectedChainId, setSelectedChainId] = useState<number>(() => activeArcChain.id);
    const closingRef = useRef(false);
    const swappingRef = useRef(false);
    const animateDeposit = useCallback((element: HTMLElement, frames: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions) =>
        element.animate(frames, reduceMotion ? { ...options, duration: 1, delay: 0 } : options), [reduceMotion]);

    /* Full list of chains supporting deposits: Arc native (active) + CCTP chains (Coming soon) */
    const supportedChains = useMemo<SupportedDepositChain[]>(() => {
        const arcChain: SupportedDepositChain = {
            chainId: activeArcChain.id,
            name: activeArcChain.name,
            shortName: "Arc Network",
            feePercentage: "0% Fee",
            isArc: true,
            isL1: false,
            usdc: USDC_NATIVE_GAS_ADDRESS,
            tokenMessenger: null,
            domain: ARC_CCTP_DOMAIN_ID,
            badge: "0% Fee · Instant",
            subtext: "Native Arc Settlement (Recommended)",
            disabled: false,
        };

        // When ARC_CCTP_ENABLED ? Object.entries(CCTP_CONFIG) : [] is evaluated,
        // all CCTP routes are listed with "Coming soon" badge for now as requested.
        const _activeCctpChains = ARC_CCTP_ENABLED ? Object.entries(CCTP_CONFIG) : [];

        const otherChains: SupportedDepositChain[] = [
            {
                chainId: 1,
                name: "Ethereum",
                shortName: "Ethereum",
                feePercentage: "1% Fee",
                isArc: false,
                isL1: true,
                usdc: CCTP_CONFIG[1]?.usdc || "",
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
            {
                chainId: 8453,
                name: "Base",
                shortName: "Base",
                feePercentage: "0.5% Fee",
                isArc: false,
                usdc: CCTP_CONFIG[8453]?.usdc || "",
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
            {
                chainId: 42161,
                name: "Arbitrum One",
                shortName: "Arbitrum",
                feePercentage: "0.5% Fee",
                isArc: false,
                usdc: CCTP_CONFIG[42161]?.usdc || "",
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
            {
                chainId: 10,
                name: "OP Mainnet",
                shortName: "Optimism",
                feePercentage: "0.5% Fee",
                isArc: false,
                usdc: CCTP_CONFIG[10]?.usdc || "",
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
            {
                chainId: 137,
                name: "Polygon",
                shortName: "Polygon",
                feePercentage: "0.5% Fee",
                isArc: false,
                usdc: CCTP_CONFIG[137]?.usdc || "",
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
            {
                chainId: 43114,
                name: "Avalanche",
                shortName: "Avalanche",
                feePercentage: "0.5% Fee",
                isArc: false,
                usdc: CCTP_CONFIG[43114]?.usdc || "",
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
            {
                chainId: 501,
                name: "Solana",
                shortName: "Solana",
                feePercentage: "0.5% Fee",
                isArc: false,
                usdc: SOLANA_CCTP_CONFIG.usdcMint,
                badge: "Coming soon",
                subtext: "Circle CCTP Bridge",
                disabled: true,
            },
        ];

        return [arcChain, ...otherChains];
    }, []);

    const selectedChain = useMemo(() => {
        return supportedChains.find((c) => c.chainId === selectedChainId) || supportedChains[0];
    }, [supportedChains, selectedChainId]);

    const [copied, setCopied] = useState(false);
    const [copiedContract, setCopiedContract] = useState(false);
    const [originBalance, setOriginBalance] = useState("0.00");
    const [loadingOriginBalance, setLoadingOriginBalance] = useState(false);

    /* Auto-bridge state: derived deposit address for CCTP chains */
    const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
    const [activeIntentId, setActiveIntentId] = useState<string | null>(null);
    const [loadingIntent, setLoadingIntent] = useState(false);
    const [bridgeStatus, setBridgeStatus] = useState<
        "idle" | "waiting" | "detected" | "bridging" | "completed" | "error"
    >("idle");
    const [bridgeError, setBridgeError] = useState<string | null>(null);

    /* Live, gas-aware route availability, polled while the modal is open. Cross-chain deposit routes
       are still "Coming soon" (below), so today this only confirms the Arc route; it activates the
       "Unavailable ⛽" badge automatically once a cross-chain deposit route is enabled. */
    const [routeGasStatus, setRouteGasStatus] = useState<Record<string, { available: boolean; status: string }> | null>(null);

    /* The address shown depends on whether the user selected Arc (own address) or a CCTP chain
       (server-derived deposit address). */
    const displayAddress = selectedChain.isArc ? depositAddress : (derivedAddress || depositAddress);

    /* When user selects a CCTP chain and moves to the address step, register an intent. */
    const registerIntent = useCallback(async (chainId: number) => {
        setLoadingIntent(true);
        setBridgeStatus("idle");
        setBridgeError(null);
        setDerivedAddress(null);
        setActiveIntentId(null);
        try {
            const res = await fetch("/api/user/cctp/intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ originChainId: chainId }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Server said ${res.status}`);
            }
            const data = await res.json();
            setDerivedAddress(data.depositAddress);
            setActiveIntentId(data.intentId || null);
            setBridgeStatus("waiting");
        } catch (error: any) {
            setBridgeError(error.message || "Couldn't set up your deposit address.");
            setBridgeStatus("error");
        } finally {
            setLoadingIntent(false);
        }
    }, []);

    /* Poll bridge status every 15 seconds while the modal is open on a CCTP chain. */
    useEffect(() => {
        if (!isOpen || selectedChain.isArc || !derivedAddress || bridgeStatus === "completed") return;

        const poll = async () => {
            try {
                // First check intent status to avoid setting "detected" on completed/bridging deposits
                const intentRes = await fetch("/api/user/cctp/intent", {
                    signal: AbortSignal.timeout(5000),
                }).catch(() => null);

                let isAlreadyBridgingOrDone = false;
                if (intentRes && intentRes.ok) {
                    const intentData = await intentRes.json().catch(() => ({}));
                    const intentsList = Array.isArray(intentData.intents) ? intentData.intents : [];
                    const matched = activeIntentId
                        ? intentsList.find((i: any) => i.id === activeIntentId)
                        : intentsList.find(
                            (i: any) =>
                                i.chainId === selectedChain.chainId &&
                                (i.intentStatus === "matched" || (i.depositAddress && derivedAddress && i.depositAddress.toLowerCase() === derivedAddress.toLowerCase()))
                          );

                    if (matched) {
                        if (matched.bridgeStatus === "completed") {
                            isAlreadyBridgingOrDone = true;
                            setBridgeStatus("completed");
                            setOriginBalance("0.00");
                            if (onSuccess) onSuccess();
                            return;
                        } else if (matched.bridgeStatus === "pending_attestation" || matched.bridgeStatus === "minting") {
                            isAlreadyBridgingOrDone = true;
                            setBridgeStatus("bridging");
                        }
                    }
                }

                const res = await fetch(`/api/user/cctp/scan?address=${encodeURIComponent(derivedAddress)}`, {
                    signal: AbortSignal.timeout(5000),
                }).catch(() => null);
                if (res && res.ok) {
                    const data = await res.json().catch(() => ({}));
                    const chainBal = Array.isArray(data.balances)
                        ? data.balances.find((b: any) => b.chainId === selectedChain.chainId)
                        : null;
                    if (chainBal) {
                        const balNum = parseFloat(chainBal.balanceUsdc || "0");
                        setOriginBalance(chainBal.balanceUsdc || "0.00");
                        if (balNum > 0 && !isAlreadyBridgingOrDone) {
                            setBridgeStatus("detected");
                        }
                    }
                }
            } catch {
                /* Polling failure is not critical, retry next tick. */
            }
        };

        poll();
        const interval = setInterval(poll, 15_000);
        return () => clearInterval(interval);
    }, [isOpen, selectedChain, derivedAddress, bridgeStatus, activeIntentId, onSuccess]);

    const fetchOriginBalance = useCallback(async () => {
        if (
            !depositAddress ||
            depositAddress === "0xYOUR_CONNECTED_WALLET_ADDRESS" ||
            selectedChain.isArc ||
            !selectedChain.usdc
        ) {
            setOriginBalance("0.00");
            return;
        }
        if (bridgeStatus === "completed") {
            setOriginBalance("0.00");
            return;
        }
        setLoadingOriginBalance(true);
        const scanAddr = derivedAddress || depositAddress;
        try {
            const res = await fetch(`/api/user/cctp/scan?address=${encodeURIComponent(scanAddr)}`, {
                signal: AbortSignal.timeout(5000),
            }).catch(() => null);
            if (res && res.ok) {
                const data = await res.json().catch(() => ({}));
                const chainBal = Array.isArray(data.balances)
                    ? data.balances.find((b: any) => b.chainId === selectedChain.chainId)
                    : null;
                if (chainBal) {
                    setOriginBalance(chainBal.balanceUsdc || "0.00");
                    return;
                }
            }
            // Client-side fallback read
            const client = originPublicClient(selectedChain.chainId);
            const bal = await client.readContract({
                address: selectedChain.usdc as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [scanAddr as `0x${string}`],
            });
            setOriginBalance(parseFloat(formatUnits(bal as bigint, 6)).toFixed(2));
        } catch {
            setOriginBalance("0.00");
        } finally {
            setLoadingOriginBalance(false);
        }
    }, [depositAddress, derivedAddress, selectedChain, bridgeStatus]);

    useEffect(() => {
        if (!isOpen) return;
        setStep("chains");
        setDepositMethod("crypto");
        setSelectedChainId(activeArcChain.id);
        setBridgeStatus("idle");
        setBridgeError(null);
        setDerivedAddress(null);
        setActiveIntentId(null);
    }, [isOpen, depositAddress]);

    useEffect(() => {
        if (isOpen && !selectedChain.isArc) {
            fetchOriginBalance();
        }
    }, [isOpen, selectedChain, fetchOriginBalance]);

    /* Poll live route availability while open. Gated on ARC_CCTP_ENABLED so it never probes on
       mainnet, where every cross-chain deposit route is switched off. Best-effort: a miss keeps the
       last-known status. */
    useEffect(() => {
        if (!isOpen || !ARC_CCTP_ENABLED) return;
        let cancelled = false;
        const fetchStatus = async () => {
            try {
                const res = await fetch("/api/cctp/routes-status?direction=inbound_deposit", {
                    signal: AbortSignal.timeout(5000),
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (cancelled || !Array.isArray(data?.routes)) return;
                const next: Record<string, { available: boolean; status: string }> = {};
                for (const route of data.routes) {
                    if (route && typeof route.id === "string") {
                        next[route.id] = { available: Boolean(route.available), status: String(route.status ?? "") };
                    }
                }
                setRouteGasStatus(next);
            } catch {
                /* Keep the last-known status; the next tick retries. */
            }
        };
        fetchStatus();
        const interval = setInterval(fetchStatus, 30_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isOpen]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(displayAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyContract = async () => {
        if (!selectedChain.usdc) return;
        await navigator.clipboard.writeText(selectedChain.usdc);
        setCopiedContract(true);
        setTimeout(() => setCopiedContract(false), 2000);
    };

    const resetAndClose = () => {
        setCopied(false);
        setActiveIntentId(null);
        setBridgeStatus("idle");
        onClose();
    };

    /* ── BAR-TO-SHEET MORPH: Open Animation ── */
    useEffect(() => {
        if (!isOpen || !effectiveIsMobile) return;
        closingRef.current = false;
        swappingRef.current = false;
        setStep("chains");

        const sh = sheetRef.current;
        const pg = pageRef.current;
        const tint = tintRef.current;
        const sc = scrimRef.current;
        if (!sh || !pg) return;

        sh.style.display = "block";

        const barEl = (document.getElementById("mobile-nav-capsule") || document.querySelector("aside[aria-label='Mobile navigation bar'] nav")) as HTMLElement | null;
        const walEl = (document.getElementById("mobile-nav-payments-btn") || document.getElementById("wal")) as HTMLElement | null;
        const previousBarVisibility = barEl?.style.visibility ?? "";
        let ghostBar: HTMLElement | null = null;
        let walletAnimation: Animation | null = null;

        if (sc) sc.style.pointerEvents = "auto";

        const FULL = "inset(0px 0px 0px 0px round 28px 28px 0px 0px)";

        if (barEl) {
            const b = barEl.getBoundingClientRect();
            const s = sh.getBoundingClientRect();
            const g = {
                T: b.top - s.top,
                R: s.right - b.right,
                B: s.bottom - b.bottom,
                L: b.left - s.left,
                r: b.height / 2,
                w: b.width,
                h: b.height,
            };
            const cp = `inset(${g.T}px ${g.R}px ${g.B}px ${g.L}px round ${g.r}px)`;

            const gh = barEl.cloneNode(true) as HTMLElement;
            ghostBar = gh;
            gh.id = "ghost-bottom-bar-deposit";
            gh.style.position = "absolute";
            gh.style.pointerEvents = "none";
            gh.style.zIndex = "6";
            gh.style.left = `${g.L}px`;
            gh.style.top = `${g.T}px`;
            gh.style.width = `${g.w}px`;
            gh.style.height = `${g.h}px`;
            gh.style.right = "auto";
            gh.style.bottom = "auto";
            sh.appendChild(gh);

            barEl.style.visibility = "hidden";
            if (sc) sc.style.pointerEvents = "auto";

            // Morph capsule into sheet (480ms)
            animateDeposit(sh, [
                { clipPath: cp, filter: "blur(0px)" },
                { filter: "blur(2.5px)", offset: 0.35 },
                { clipPath: FULL, filter: "blur(0px)" },
            ], { duration: 480, easing: EASE_EXP, fill: "forwards" });

            if (tint) animateDeposit(tint, { opacity: [1, 0] }, { duration: 340, easing: "ease-out", fill: "forwards" });
            animateDeposit(gh, { opacity: [1, 0], filter: ["blur(0px)", "blur(7px)"] }, { duration: 220, easing: "ease-out", fill: "forwards" }).onfinish = () => gh.remove();

            animateDeposit(pg, [
                { opacity: 0, transform: "translateY(20px)", filter: "blur(10px)" },
                { opacity: 1, transform: "none", filter: "blur(0px)" },
            ], { duration: 420, delay: 120, easing: EASE_EXP, fill: "backwards" });

            // Disappear Payments button
            if (walEl) {
                walletAnimation = animateDeposit(walEl, [
                    { opacity: 1, transform: "none", filter: "blur(0px)" },
                    { opacity: 0, transform: "scale(.8) translateY(10px)", filter: "blur(6px)" },
                ], { duration: 240, easing: "ease-out", fill: "forwards" });
            }

            if (sc) animateDeposit(sc, { opacity: [0, 1] }, { duration: 360, fill: "forwards" });
        } else {
            sh.style.clipPath = FULL;
            animateDeposit(sh, [
                { transform: "translateY(100%)", filter: "blur(8px)" },
                { transform: "translateY(0%)", filter: "blur(0px)" },
            ], { duration: 420, easing: EASE, fill: "forwards" });
            if (sc) animateDeposit(sc, { opacity: [0, 1] }, { duration: 300, fill: "forwards" });
        }

        return () => {
            [sh, pg, tint, sc].forEach((element) => element?.getAnimations().forEach((animation) => animation.cancel()));
            walletAnimation?.cancel();
            ghostBar?.remove();
            if (barEl) barEl.style.visibility = previousBarVisibility;
        };
    }, [isOpen, effectiveIsMobile, animateDeposit]);

    /* ── BAR-TO-SHEET MORPH: Close Animation ── */
    const handleMobileClose = async () => {
        if (closingRef.current || swappingRef.current || bridgeStatus === "bridging") return;
        closingRef.current = true;
        try {
            const sh = sheetRef.current;
            const pg = pageRef.current;
            const tint = tintRef.current;
            const sc = scrimRef.current;
            const barEl = (document.getElementById("mobile-nav-capsule") || document.querySelector("aside[aria-label='Mobile navigation bar'] nav")) as HTMLElement | null;
            const walEl = (document.getElementById("mobile-nav-payments-btn") || document.getElementById("wal")) as HTMLElement | null;
            const FULL = "inset(0px 0px 0px 0px round 28px 28px 0px 0px)";

            if (sh && pg && barEl) {
                const b = barEl.getBoundingClientRect();
                const s = sh.getBoundingClientRect();
                const g = {
                    T: b.top - s.top,
                    R: s.right - b.right,
                    B: s.bottom - b.bottom,
                    L: b.left - s.left,
                    r: b.height / 2,
                    w: b.width,
                    h: b.height,
                };
                const cp = `inset(${g.T}px ${g.R}px ${g.B}px ${g.L}px round ${g.r}px)`;

                const gh = barEl.cloneNode(true) as HTMLElement;
                gh.id = "ghost-bottom-bar-deposit-close";
                gh.style.position = "absolute";
                gh.style.pointerEvents = "none";
                gh.style.zIndex = "6";
                gh.style.left = `${g.L}px`;
                gh.style.top = `${g.T}px`;
                gh.style.width = `${g.w}px`;
                gh.style.height = `${g.h}px`;
                gh.style.right = "auto";
                gh.style.bottom = "auto";
                gh.style.opacity = "0";
                sh.appendChild(gh);

                animateDeposit(pg, [
                    { opacity: 1, transform: "none", filter: "blur(0px)" },
                    { opacity: 0, transform: "translateY(16px)", filter: "blur(8px)" },
                ], { duration: 200, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" });

                animateDeposit(gh, [
                    { opacity: 0, filter: "blur(6px)" },
                    { opacity: 1, filter: "blur(0px)" },
                ], { duration: 240, delay: 240, easing: "ease-out", fill: "forwards" });

                if (tint) animateDeposit(tint, { opacity: [0, 1] }, { duration: 280, delay: 100, fill: "forwards" });
                if (sc) animateDeposit(sc, { opacity: [1, 0] }, { duration: 380, fill: "forwards" });
                const dash = document.querySelector(".user-dashboard-content, .user-dashboard-redesign, main") as HTMLElement | null;
                if (dash) {
                    dash.getAnimations().forEach((a) => a.cancel());
                    dash.style.transform = "";
                }

                await animateDeposit(sh, [
                    { clipPath: FULL, filter: "blur(0px)" },
                    { filter: "blur(2.5px)", offset: 0.55 },
                    { clipPath: cp, filter: "blur(0px)" },
                ], { duration: 440, easing: EASE_CLOSE, fill: "forwards" }).finished;

                barEl.style.visibility = "visible";
                [sh, pg, tint, sc].forEach((e) => e?.getAnimations().forEach((a) => a.cancel()));
                gh.remove();
                sh.style.display = "none";
                if (sc) sc.style.pointerEvents = "none";

                // Reappear Payments button
                if (walEl) {
                    animateDeposit(walEl, [
                        { opacity: 0, transform: "scale(.8) translateY(10px)", filter: "blur(6px)" },
                        { opacity: 1, transform: "none", filter: "blur(0px)" },
                    ], { duration: 320, easing: EASE, fill: "forwards" });
                }
            } else if (sh) {
                await animateDeposit(sh, [
                    { transform: "translateY(0%)", filter: "blur(0px)" },
                    { transform: "translateY(100%)", filter: "blur(8px)" },
                ], { duration: 320, easing: EASE_CLOSE, fill: "forwards" }).finished;
                sh.style.display = "none";
            }
            resetAndClose();
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        } finally {
            closingRef.current = false;
        }
    };

    /* ── STEP TRANSITION (CHAINS <-> ADDRESS) ── */
    const swapStep = async (nextStep: DepositStep, dir: number) => {
        if (closingRef.current || swappingRef.current) return;
        const pg = pageRef.current;
        const sh = sheetRef.current;
        if (!pg || !sh) {
            setStep(nextStep);
            return;
        }
        swappingRef.current = true;
        try {
            await animateDeposit(pg, [
                { opacity: 1, transform: "none", filter: "blur(0px)" },
                { opacity: 0, transform: `translateX(${-dir * 52}px) scale(.98)`, filter: "blur(12px)" },
            ], { duration: 280, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).finished;

            setStep(nextStep);
            pg.getAnimations().forEach((a) => a.cancel());

            animateDeposit(pg, [
                { opacity: 0, transform: `translateX(${dir * 52}px) scale(.98)`, filter: "blur(12px)" },
                { opacity: 1, transform: "none", filter: "blur(0px)" },
            ], { duration: 560, easing: EASE });
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        } finally {
            swappingRef.current = false;
        }
    };

    const fundingMethodTabs = (
        <div role="tablist" aria-label="Deposit method" className="flex gap-1.5 rounded-2xl bg-black/5 dark:bg-white/5 p-1 text-xs">
            <button
                type="button"
                role="tab"
                aria-selected={depositMethod === "crypto"}
                onClick={() => setDepositMethod("crypto")}
                className={`relative flex flex-1 items-center justify-center gap-1.5 py-2 font-bold rounded-xl transition ${
                    depositMethod === "crypto" ? "text-black dark:text-white" : "text-black/50 dark:text-white/50"
                }`}
            >
                {depositMethod === "crypto" && <motion.span layoutId={methodPillId} className="absolute inset-0 rounded-xl bg-white dark:bg-[#1D2129] shadow-sm" transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }} />}
                <Globe className="relative h-3.5 w-3.5" /><span className="relative">Deposit crypto</span>
            </button>
            <button
                type="button"
                role="tab"
                aria-label="Onramp"
                aria-selected={depositMethod === "onramp"}
                onClick={() => setDepositMethod("onramp")}
                className={`relative flex flex-1 items-center justify-center gap-1.5 py-2 font-bold rounded-xl transition ${
                    depositMethod === "onramp" ? "text-black dark:text-white" : "text-black/50 dark:text-white/50"
                }`}
            >
                {depositMethod === "onramp" && <motion.span layoutId={methodPillId} className="absolute inset-0 rounded-xl bg-white dark:bg-[#1D2129] shadow-sm" transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }} />}
                <Building2 className="relative h-3.5 w-3.5" /><span className="relative">Onramp</span>
                <span className="relative not-italic text-[8px] font-black uppercase bg-[#2775CA]/20 text-[#2775CA] dark:bg-[#2775CA]/30 dark:text-[#6A8BE8] px-1.5 py-0.5 rounded">Coming soon</span>
            </button>
        </div>
    );

    if (effectiveIsMobile && isOpen) {
        return (
            <div id="deposit-sheet-wrapper" className="fixed inset-0 z-[100] flex flex-col justify-end overflow-hidden pointer-events-none font-sans select-none">
                {/* Scrim Overlay */}
                <div
                    ref={scrimRef}
                    id="deposit-scrim-overlay"
                    onClick={handleMobileClose}
                    className="absolute inset-0 bg-[#2A302A]/70 pointer-events-none opacity-0 transition-opacity"
                />

                {/* Bottom Sheet Card */}
                <section
                    ref={sheetRef}
                    id="deposit-sheet-card"
                    data-modal="deposit"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="deposit-sheet-title"
                    className="pointer-events-auto relative w-full max-w-lg mx-auto bg-[#FDFEF3] dark:bg-[#15181F] text-[#111827] dark:text-[#F1F3F8] rounded-t-[28px] px-5 pt-3.5 pb-6 shadow-2xl overflow-hidden will-change-transform"
                    style={{
                        boxSizing: "border-box",
                        height: "min(720px, 94dvh)",
                        paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
                    }}
                >
                    {/* Bar Tint Layer during morph */}
                    <div
                        ref={tintRef}
                        id="deposit-sheet-bar-tint"
                        className="absolute inset-0 pointer-events-none z-10 opacity-0 bg-gradient-to-b from-[#B4D1EE] to-[#9EC2E7] dark:from-[#2E4D70] dark:to-[#243F5E]"
                    />

                    {/* Page Content Container */}
                    <div ref={pageRef} id="deposit-sheet-page-content" className="relative z-20 h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {/* Top Drag Handle */}
                        <div className="w-10 h-1 rounded-full bg-black/15 dark:bg-white/15 mx-auto mb-2" />

                        {step === "chains" ? (
                            /* ── STEP 1: SELECT NETWORK ── */
                            <div className="h-[calc(100%-12px)] min-h-0 flex flex-col">
                                <div className="flex flex-1 min-h-0 flex-col gap-3 [&>div:not(:last-child)]:shrink-0">
                                    <div className="flex items-center justify-between">
                                        <h2 id="deposit-sheet-title" className="text-xl font-black uppercase tracking-wider text-[#111827] dark:text-white">
                                            Deposit USDC
                                        </h2>
                                        <button
                                            type="button"
                                            onClick={handleMobileClose}
                                            aria-label="Close"
                                            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <p className="text-xs text-black/50 dark:text-white/50 -mt-1">
                                        Receive USDC on Arc Network instantly or bridge from other chains.
                                    </p>

                                    {fundingMethodTabs}

                                {!isTier1 && (
                                    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-left text-xs text-amber-800 dark:text-amber-200 space-y-1">
                                        <div className="flex items-center gap-1.5 font-bold">
                                            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                            <span>Tier 1 KYC Verification Required</span>
                                        </div>
                                        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                                            All accounts must be verified at Tier 1 (link your email) before depositing funds on SubScript.
                                        </p>
                                    </div>
                                )}

                                <DepositMethodPanel method={depositMethod} mobile>
                                {depositMethod === "onramp" ? (
                                    <ArcOnramp key={depositAddress} destinationAddress={depositAddress} disabled={!isTier1}
                                        onRefresh={() => onSuccess?.()} />
                                ) : (
                                    <>
                                <div className="text-left">
                                    <p className="text-xs text-black/60 dark:text-white/60 font-medium">
                                        Select the network where you currently have USDC:
                                    </p>
                                </div>

                                <div className="space-y-2 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                    {supportedChains.map((chain) => {
                                        const isArc = chain.isArc;
                                        const routeId = isArc ? "arc" : chain.chainId === 501 ? "solana" : String(chain.chainId);
                                        const gasStatus = routeGasStatus?.[routeId] ?? null;
                                        const gasDepleted = !isArc && !chain.disabled && (gasStatus === null || !gasStatus.available);
                                        if (chain.disabled) {
                                            return (
                                                <div
                                                    key={chain.chainId}
                                                    className="flex w-full items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3.5 text-left opacity-65 cursor-not-allowed select-none"
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <ChainLogo chain={chain.chainId === 501 ? "solana" : chain.chainId} size={28} className="h-7 w-7 shrink-0" />
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-bold text-black/80 dark:text-white/80 truncate">{chain.name}</span>
                                                            </div>
                                                            <p className="text-[10px] text-black/45 dark:text-white/45 truncate mt-0.5">{chain.subtext}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20">
                                                            {chain.badge}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <button
                                                key={chain.chainId}
                                                type="button"
                                                disabled={!isTier1 || gasDepleted}
                                                onClick={() => {
                                                    if (!isTier1 || gasDepleted) return;
                                                    setSelectedChainId(chain.chainId);
                                                    swapStep("address", 1);
                                                    if (!chain.isArc) {
                                                        registerIntent(chain.chainId);
                                                    }
                                                }}
                                                className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition shadow-sm group ${
                                                    !isTier1 || gasDepleted
                                                        ? "border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] opacity-50 cursor-not-allowed"
                                                        : "border-black/15 dark:border-white/15 bg-white dark:bg-[#1D2129] hover:border-[#2775CA] active:scale-[0.99]"
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <ChainLogo chain={chain.chainId} size={28} className="h-7 w-7 shrink-0" />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-black text-black dark:text-white truncate">{chain.name}</span>
                                                            {isArc && (
                                                                <span className="bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-[8px] font-black uppercase px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                                    Active · Native
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-black/50 dark:text-white/50 truncate mt-0.5">{chain.subtext}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                                        gasDepleted
                                                            ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20"
                                                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                                                    }`}>
                                                        {gasDepleted ? "Unavailable ⛽" : chain.badge}
                                                    </span>
                                                    <ArrowRight className="h-3.5 w-3.5 text-black/30 dark:text-white/40" />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                    </>
                                )}
                                </DepositMethodPanel>
                                </div>
                            </div>
                        ) : (
                            /* ── STEP 2: ADDRESS & QR CODE ── */
                            <div className="h-[calc(100%-12px)] min-h-fit flex flex-col gap-3.5 justify-between text-left">
                                <div className="flex flex-1 flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                disabled={bridgeStatus === "bridging"}
                                                onClick={() => swapStep("chains", -1)}
                                                className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition disabled:opacity-40"
                                                aria-label="Back to networks"
                                            >
                                                <ArrowLeft className="w-4 h-4" />
                                            </button>
                                            <h2 id="deposit-sheet-title" className="text-base font-black uppercase tracking-wider text-[#111827] dark:text-white">
                                                Deposit via {selectedChain.shortName}
                                            </h2>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={bridgeStatus === "bridging"}
                                            onClick={handleMobileClose}
                                            aria-label="Close"
                                            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition disabled:opacity-40"
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    {/* Selected Network Summary Pill */}
                                    <div className="flex items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] p-3 shadow-sm">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <ChainLogo chain={selectedChain.chainId} size={24} className="h-6 w-6 shrink-0" />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-black text-black dark:text-white truncate">{selectedChain.name}</span>
                                                    <span className="text-[9px] font-bold text-black/50 dark:text-white/50">({selectedChain.feePercentage})</span>
                                                </div>
                                                <p className="text-[10px] text-black/50 dark:text-white/50 truncate">
                                                    {selectedChain.isArc
                                                        ? "Instant settlement"
                                                        : bridgeStatus === "completed"
                                                        ? "Deposit confirmed on Arc"
                                                        : "Estimated ~15 mins via CCTP bridge"}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={bridgeStatus === "bridging"}
                                            onClick={() => swapStep("chains", -1)}
                                            className="text-[11px] font-bold text-[#2775CA] hover:underline px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition shrink-0 disabled:opacity-40"
                                        >
                                            Change
                                        </button>
                                    </div>

                                    {/* QR Code */}
                                    {(!loadingIntent || selectedChain.isArc) && (
                                        <div className="flex flex-1 items-center justify-center py-4">
                                            <div className="max-w-full p-3 bg-white border border-black/10 dark:border-white/15 rounded-2xl shadow-sm inline-block">
                                                <QRCode
                                                    value={displayAddress}
                                                    size={240}
                                                    style={{ maxWidth: "100%", height: "auto" }}
                                                    ecLevel="H"
                                                    bgColor="#ffffff"
                                                    fgColor="#000000"
                                                    qrStyle="dots"
                                                    logoImage="/logo-colored.png"
                                                    logoWidth={44}
                                                    logoHeight={44}
                                                    logoOpacity={1}
                                                    removeQrCodeBehindLogo={true}
                                                    logoPadding={2}
                                                    logoPaddingStyle="square"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Copy Address Box */}
                                    {(!loadingIntent || selectedChain.isArc) && (
                                        <div className="bg-white dark:bg-[#1D2129] border border-black/15 dark:border-white/15 rounded-2xl p-3 text-left shadow-sm">
                                            <div className="mb-1">
                                                <p className="text-[9px] text-black/50 dark:text-white/50 uppercase tracking-wider font-black">
                                                    {selectedChain.isArc ? "Your Arc Deposit Address" : "Deposit Address"}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 text-[11px] text-black dark:text-white font-mono break-all select-all font-semibold">
                                                    {displayAddress}
                                                </code>
                                                <button
                                                    type="button"
                                                    onClick={handleCopy}
                                                    className="p-2 text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-xl transition shrink-0 active:scale-95"
                                                    title="Copy address"
                                                    aria-label="Copy deposit address"
                                                >
                                                    {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {copied && (
                                    <p className="text-emerald-700 dark:text-emerald-300 text-[10px] font-black uppercase tracking-wider text-center">
                                        ✓ Address copied to clipboard!
                                    </p>
                                )}

                                {/* Token Contract Reference */}
                                {selectedChain.usdc && selectedChain.usdc !== "0x3600000000000000000000000000000000000000" && (
                                    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1D2129] p-2.5 text-[10px] flex items-center justify-between text-black/70 dark:text-white/70 shadow-sm">
                                        <span className="truncate">
                                            USDC on {selectedChain.shortName}: <code className="font-mono text-black dark:text-white font-bold">{selectedChain.usdc.slice(0, 8)}...{selectedChain.usdc.slice(-6)}</code>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleCopyContract}
                                            className="text-[10px] font-bold text-[#2775CA] hover:underline shrink-0 ml-2"
                                        >
                                            {copiedContract ? "Copied" : "Copy CA"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        );
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="deposit-modal-wrapper"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="dashboard-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 font-sans"
                >
                    <div
                        onClick={resetAndClose}
                        className="fixed inset-0 bg-black/75 -z-10"
                    />

                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="deposit-modal-title"
                        data-modal="deposit"
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="dashboard-modal-surface deposit-modal transform-gpu bg-[#FFFFF0] dark:bg-[#18191c] border border-black/15 dark:border-white/15 rounded-3xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl relative text-[#082824] dark:text-[#f4f4f5]"
                        onClick={(e) => e.stopPropagation()}
                    >
                            {/* Fixed Modal Header */}
                            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-black/10 dark:border-white/10 shrink-0 bg-[#FFFFF0] dark:bg-[#18191c]">
                                <div className="flex items-center gap-2">
                                    {step === "address" && bridgeStatus !== "bridging" && (
                                        <button
                                            type="button"
                                            onClick={() => setStep("chains")}
                                            className="p-1 -ml-1 text-[#082824]/60 dark:text-white/60 hover:text-[#082824] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition"
                                            aria-label="Back to networks"
                                        >
                                            <ArrowLeft className="w-4 h-4" />
                                        </button>
                                    )}
                                    <h2 id="deposit-modal-title" className="text-sm font-black uppercase tracking-wider text-[#082824] dark:text-[#f4f4f5]">
                                        {step === "chains"
                                            ? "Deposit USDC"
                                            : `Deposit via ${selectedChain.shortName}`}
                                    </h2>
                                </div>
                                <button
                                    onClick={resetAndClose}
                                    disabled={bridgeStatus === "bridging"}
                                    className="p-1.5 text-[#082824]/50 dark:text-white/50 hover:text-[#082824] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition disabled:opacity-40"
                                    aria-label="Close deposit dialog"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Scrollable Modal Body (No Cutout!) */}
                            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 custom-scrollbar text-[#082824] dark:text-[#f4f4f5]">
                                {/* STEP 1: CHAINS LIST */}
                                {step === "chains" && (
                                    <div className="space-y-4">
                                        {fundingMethodTabs}

                                        {!isTier1 && (
                                            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-left text-xs text-amber-800 dark:text-amber-200 space-y-1">
                                                <div className="flex items-center gap-1.5 font-bold">
                                                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                                    <span>Tier 1 KYC Verification Required</span>
                                                </div>
                                                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                                                    All accounts must be verified at Tier 1 (link your email) before depositing funds on SubScript.
                                                </p>
                                            </div>
                                        )}

                                        <DepositMethodPanel method={depositMethod} mobile={false}>
                                        {depositMethod === "onramp" ? (
                                            <ArcOnramp key={depositAddress} destinationAddress={depositAddress} disabled={!isTier1}
                                                onRefresh={() => onSuccess?.()} />
                                        ) : (
                                            <>
                                        <div className="text-left">
                                            <p className="text-xs text-[#082824]/70 dark:text-white/70 leading-relaxed font-medium">
                                                Select the network where you currently have USDC. Arc Network settles deposits directly with 0% protocol fee:
                                            </p>
                                        </div>

                                        <div className="space-y-2">
                                            {supportedChains.map((chain) => {
                                                const isArc = chain.isArc;
                                                const routeId = isArc ? "arc" : chain.chainId === 501 ? "solana" : String(chain.chainId);
                                                const gasStatus = routeGasStatus?.[routeId] ?? null;
                                                const gasDepleted = !isArc && !chain.disabled && (gasStatus === null || !gasStatus.available);
                                                if (chain.disabled) {
                                                    return (
                                                        <div
                                                            key={chain.chainId}
                                                            className="flex w-full items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3.5 text-left opacity-65 cursor-not-allowed select-none"
                                                            title={`${chain.name} deposit via Circle CCTP coming soon`}
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <ChainLogo chain={chain.chainId === 501 ? "solana" : chain.chainId} size={28} className="h-7 w-7 shrink-0" />
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs font-bold text-[#082824]/80 dark:text-white/80 truncate">{chain.name}</span>
                                                                    </div>
                                                                    <p className="text-[10px] text-[#082824]/50 dark:text-white/50 truncate mt-0.5">{chain.subtext}</p>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-2 shrink-0 ml-2">
                                                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20">
                                                                    {chain.badge}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <button
                                                        key={chain.chainId}
                                                        type="button"
                                                        disabled={!isTier1 || gasDepleted}
                                                        onClick={() => {
                                                            if (!isTier1 || gasDepleted) return;
                                                            setSelectedChainId(chain.chainId);
                                                            setStep("address");
                                                            if (!chain.isArc) {
                                                                registerIntent(chain.chainId);
                                                            }
                                                        }}
                                                        className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition shadow-sm group ${
                                                            !isTier1 || gasDepleted
                                                                ? "border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] opacity-50 cursor-not-allowed"
                                                                : "border-black/15 dark:border-white/15 bg-white dark:bg-[#222327] hover:border-[#2775CA] hover:bg-[#2775CA]/[0.02] dark:hover:bg-[#2775CA]/10"
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <ChainLogo chain={chain.chainId} size={28} className="h-7 w-7 shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-black text-[#082824] dark:text-[#f4f4f5] truncate">{chain.name}</span>
                                                                    {isArc && (
                                                                        <span className="bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-[8px] font-black uppercase px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                                            Active · Native
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[10px] text-[#082824]/60 dark:text-white/60 truncate mt-0.5">{chain.subtext}</p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 shrink-0 ml-2">
                                                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                                                gasDepleted
                                                                    ? "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20"
                                                                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                                                            }`}>
                                                                {gasDepleted ? "Unavailable ⛽" : chain.badge}
                                                            </span>
                                                            <ArrowRight className="h-3.5 w-3.5 text-[#082824]/30 dark:text-white/40 group-hover:text-[#082824] dark:group-hover:text-white group-hover:translate-x-0.5 transition" />
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                            </>
                                        )}
                                        </DepositMethodPanel>
                                    </div>
                                )}

                                {/* STEP 3: DEPOSIT ADDRESS & DETAILS */}
                                {step === "address" && (
                                    <div className="space-y-4 text-left">
                                        {/* Bridge Status Banner */}
                                        {!selectedChain.isArc && bridgeStatus !== "idle" && bridgeStatus !== "waiting" && (
                                            <div className={`space-y-1.5 rounded-2xl border p-4 ${
                                                bridgeStatus === "completed"
                                                    ? "border-emerald-500/40 bg-emerald-500/10"
                                                    : bridgeStatus === "error"
                                                    ? "border-red-500/40 bg-red-500/10"
                                                    : "border-[#2775CA]/40 bg-[#2775CA]/10"
                                            }`}>
                                                <div className="flex items-center gap-2">
                                                    {bridgeStatus === "completed" ? (
                                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                                    ) : bridgeStatus === "error" ? (
                                                        <X className="w-4 h-4 text-red-600 shrink-0" />
                                                    ) : (
                                                        <Loader2 className="w-4 h-4 animate-spin text-[#2775CA] shrink-0" />
                                                    )}
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-[#082824] dark:text-[#f4f4f5]">
                                                        {bridgeStatus === "detected" && "USDC detected · Preparing bridge..."}
                                                        {bridgeStatus === "bridging" && "Bridging to Arc... (~15 mins)"}
                                                        {bridgeStatus === "completed" && "✓ Deposited on Arc"}
                                                        {bridgeStatus === "error" && "Bridge error"}
                                                    </p>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[11px] leading-relaxed text-[#082824]/75 dark:text-white/75">
                                                        {bridgeStatus === "detected" && `${originBalance} USDC detected on ${selectedChain.shortName}. it's currently being moved to Arc. ETA: 15 minutes`}
                                                        {bridgeStatus === "bridging" && `Your USDC is being bridged from ${selectedChain.shortName} to Arc via Circle CCTP. This typically takes about 15 minutes.`}
                                                        {bridgeStatus === "completed" && "Your USDC has arrived on Arc and is ready to use."}
                                                        {bridgeStatus === "error" && (bridgeError || "Something went wrong. Please try again.")}
                                                    </p>
                                                    {bridgeStatus === "completed" && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setBridgeStatus("waiting");
                                                                setOriginBalance("0.00");
                                                                registerIntent(selectedChain.chainId);
                                                            }}
                                                            className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 underline hover:no-underline ml-2 shrink-0"
                                                        >
                                                            New Deposit
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Selected Network Summary Pill */}
                                        <div className="flex items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#222327] p-3 shadow-sm">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <ChainLogo chain={selectedChain.chainId} size={24} className="h-6 w-6 shrink-0" />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-black text-[#082824] dark:text-[#f4f4f5] truncate">{selectedChain.name}</span>
                                                        <span className="text-[9px] font-bold text-[#082824]/60 dark:text-white/60">({selectedChain.feePercentage})</span>
                                                    </div>
                                                    <p className="text-[10px] text-[#082824]/60 dark:text-white/60 truncate">
                                                        {selectedChain.isArc
                                                            ? "Instant settlement"
                                                            : bridgeStatus === "completed"
                                                            ? "Deposit confirmed on Arc"
                                                            : "Estimated ~15 mins via CCTP bridge"}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={bridgeStatus === "bridging"}
                                                onClick={() => setStep("chains")}
                                                className="text-[11px] font-bold text-[#2775CA] hover:underline px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition shrink-0 disabled:opacity-40"
                                            >
                                                Change
                                            </button>
                                        </div>

                                        {/* Live Balance on Deposit Address */}
                                        {!selectedChain.isArc && derivedAddress && (
                                            <div className="flex items-center justify-between p-3 rounded-2xl bg-white dark:bg-[#222327] border border-black/10 dark:border-white/10 text-xs shadow-sm">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <ChainLogo chain={selectedChain.chainId} size={16} className="h-4 w-4 shrink-0" />
                                                    <span className="text-[#082824]/70 dark:text-white/70 font-medium truncate">USDC on {selectedChain.shortName}:</span>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {loadingOriginBalance ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2775CA]" />
                                                    ) : (
                                                        <span className="font-mono font-bold text-[#082824] dark:text-white">
                                                            {bridgeStatus === "completed" ? "0.00" : originBalance} USDC
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Loading intent state */}
                                        {loadingIntent && !selectedChain.isArc && (
                                            <div className="flex items-center justify-center gap-2 py-4">
                                                <Loader2 className="w-4 h-4 animate-spin text-[#2775CA]" />
                                                <span className="text-xs text-[#082824]/70 dark:text-white/70 font-medium">Setting up deposit address...</span>
                                            </div>
                                        )}

                                        {/* Notice & Minimum Deposit Guidelines */}
                                        {(!loadingIntent || selectedChain.isArc) && (
                                            <div className="space-y-2">
                                                <p className="text-[11px] text-[#082824]/75 dark:text-white/75 leading-relaxed text-center">
                                                    {bridgeStatus === "completed" ? (
                                                        "Your deposit is confirmed and ready to use on Arc. Send USDC below to make an additional deposit."
                                                    ) : (
                                                        <>Send USDC on <strong className="text-[#082824] dark:text-white">{selectedChain.name}</strong> to {selectedChain.isArc ? "your" : "the"} deposit address below.{!selectedChain.isArc && " It will be automatically bridged to Arc."}</>
                                                    )}
                                                </p>
                                                {!selectedChain.isArc && (
                                                    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#222327] p-2.5 text-[11px] leading-snug text-[#082824]/80 dark:text-white/80 shadow-sm">
                                                        <div className="flex items-center gap-1.5 font-bold text-[#082824] dark:text-white text-[11px]">
                                                            <span>•</span>
                                                            <span>{selectedChain.isL1 ? "Minimum bridge: $10.00 USDC" : "Minimum bridge: $1.00 USDC"}</span>
                                                        </div>
                                                        <p className="mt-1 text-[10px] text-[#082824]/65 dark:text-white/65 pl-3">
                                                            {selectedChain.isL1
                                                                ? "Smaller deposits (e.g. $9) stay safely stored on-chain at your address until your total balance reaches $10 or more, which triggers auto-bridging."
                                                                : "Deposits accumulate safely on-chain until reaching $1 or more, then auto-bridge to Arc."}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* QR Code */}
                                        {(!loadingIntent || selectedChain.isArc) && (
                                            <div className="flex justify-center">
                                                <div className="p-3 bg-white border border-black/10 dark:border-white/15 rounded-2xl shadow-sm inline-block">
                                                    <QRCode
                                                        value={displayAddress}
                                                        size={135}
                                                        ecLevel="H"
                                                        bgColor="#ffffff"
                                                        fgColor="#000000"
                                                        qrStyle="dots"
                                                        logoImage="/logo-colored.png"
                                                        logoWidth={28}
                                                        logoHeight={28}
                                                        logoOpacity={1}
                                                        removeQrCodeBehindLogo={true}
                                                        logoPadding={2}
                                                        logoPaddingStyle="square"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Copy Address Box */}
                                        {(!loadingIntent || selectedChain.isArc) && (
                                            <div className="bg-white dark:bg-[#222327] border border-black/15 dark:border-white/15 rounded-2xl p-3.5 text-left shadow-sm">
                                                <div className="mb-1">
                                                    <p className="text-[9px] text-[#082824]/60 dark:text-white/60 uppercase tracking-wider font-black">
                                                        {selectedChain.isArc ? "Your Arc Deposit Address" : "Deposit Address"}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <code className="flex-1 text-[11px] text-[#082824] dark:text-[#f4f4f5] font-mono break-all select-all font-semibold">
                                                        {displayAddress}
                                                    </code>
                                                    <button
                                                        onClick={handleCopy}
                                                        className="p-2 text-[#082824] dark:text-white hover:bg-black/5 dark:hover:bg-white/10 rounded-xl transition shrink-0"
                                                        title="Copy address"
                                                        aria-label="Copy deposit address"
                                                    >
                                                        {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {copied && (
                                            <p className="text-emerald-700 dark:text-emerald-300 text-[10px] font-black uppercase tracking-wider text-center">
                                                ✓ Address copied to clipboard!
                                            </p>
                                        )}

                                        {/* Token Contract Reference */}
                                        {selectedChain.usdc && selectedChain.usdc !== "0x3600000000000000000000000000000000000000" && (
                                            <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#222327] p-2.5 text-[10px] flex items-center justify-between text-[#082824]/75 dark:text-white/75 shadow-sm">
                                                <span className="truncate">
                                                    USDC on {selectedChain.shortName}: <code className="font-mono text-[#082824] dark:text-white font-bold">{selectedChain.usdc.slice(0, 8)}...{selectedChain.usdc.slice(-6)}</code>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={handleCopyContract}
                                                    className="text-[10px] font-bold text-[#2775CA] hover:underline shrink-0 ml-2"
                                                >
                                                    {copiedContract ? "Copied" : "Copy CA"}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
