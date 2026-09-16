"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { QRCode } from "react-qrcode-logo";
import { createPublicClient, formatUnits, http } from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
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

const publicClient = createPublicClient({
    chain: activeArcChain,
    transport: arcHttp(),
});

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
}: DepositModalProps) {
    const [step, setStep] = useState<DepositStep>("chains");
    const [selectedChainId, setSelectedChainId] = useState<number>(() => activeArcChain.id);

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
    const [usdcBalance, setUsdcBalance] = useState("0.00");
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

    const fetchBalance = useCallback(async () => {
        if (!depositAddress || depositAddress === "0xYOUR_CONNECTED_WALLET_ADDRESS") return;
        try {
            const balanceRaw = await publicClient.readContract({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [depositAddress as `0x${string}`],
            });
            setUsdcBalance(parseFloat(formatUnits(balanceRaw as bigint, 6)).toFixed(2));
        } catch (err) {
            console.error("Failed to read balance in modal:", err);
        }
    }, [depositAddress]);

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
                            void fetchBalance();
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
    }, [isOpen, selectedChain, derivedAddress, bridgeStatus, activeIntentId, fetchBalance, onSuccess]);

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
        setSelectedChainId(activeArcChain.id);
        setBridgeStatus("idle");
        setBridgeError(null);
        setDerivedAddress(null);
        setActiveIntentId(null);
        fetchBalance();
    }, [isOpen, fetchBalance]);

    useEffect(() => {
        if (isOpen && !selectedChain.isArc) {
            fetchOriginBalance();
        }
    }, [isOpen, selectedChain, fetchOriginBalance]);

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

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={resetAndClose}
                        className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 15 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 15 }}
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 font-sans"
                    >
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="deposit-modal-title"
                            data-modal="deposit"
                            className="deposit-modal bg-[#FFFFF0] dark:bg-[#18191c] border border-black/15 dark:border-white/15 rounded-3xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl relative text-[#082824] dark:text-[#f4f4f5]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Fixed Modal Header */}
                            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-black/10 dark:border-white/10 shrink-0 bg-[#FFFFF0]/95 dark:bg-[#18191c]/95 backdrop-blur-md">
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
                                            ? "Select Network"
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
                                        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#222327] p-4 text-left shadow-sm">
                                            <p className="text-[10px] font-black uppercase tracking-wider text-[#082824]/60 dark:text-white/60">Current Balance</p>
                                            <div className="flex items-baseline gap-2 mt-1">
                                                <span className="text-2xl font-black text-[#082824] dark:text-white font-mono">{usdcBalance}</span>
                                                <span className="text-xs font-bold text-[#082824]/70 dark:text-white/70">USDC on Arc</span>
                                            </div>
                                        </div>

                                        <div className="text-left">
                                            <p className="text-xs text-[#082824]/70 dark:text-white/70 leading-relaxed font-medium">
                                                Select the network where you currently have USDC. Arc Network settles deposits directly with 0% protocol fee:
                                            </p>
                                        </div>

                                        <div className="space-y-2">
                                            {supportedChains.map((chain) => {
                                                const isArc = chain.isArc;
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
                                                        disabled={!isTier1}
                                                        onClick={() => {
                                                            if (!isTier1) return;
                                                            setSelectedChainId(chain.chainId);
                                                            setStep("address");
                                                            if (!chain.isArc) {
                                                                registerIntent(chain.chainId);
                                                            }
                                                        }}
                                                        className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition shadow-sm group ${
                                                            !isTier1
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
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
                                                                {chain.badge}
                                                            </span>
                                                            <ArrowRight className="h-3.5 w-3.5 text-[#082824]/30 dark:text-white/40 group-hover:text-[#082824] dark:group-hover:text-white group-hover:translate-x-0.5 transition" />
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
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
                                                        logoImage="/logo.png"
                                                        logoWidth={26}
                                                        logoHeight={26}
                                                        removeQrCodeBehindLogo={true}
                                                        logoPadding={2}
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
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
