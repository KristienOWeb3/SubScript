"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, QrCode, Loader2, CreditCard, ExternalLink, ArrowRight, AlertTriangle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import { EXTERNAL_ONRAMP_PROVIDERS } from "@/lib/fiatOnramp";

function regionName(code: string | null | undefined): string | null {
    if (!code) return null;
    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
    } catch {
        return code;
    }
}

const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
    }
] as const;

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    isEmbeddedWallet: boolean;
    depositAddress: string;
    onSuccess?: () => void;
    executeContractWrite?: (params: {
        address: string;
        abi: any;
        functionName: string;
        args?: any[];
    }) => Promise<string>;
}

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet,
    depositAddress,
    onSuccess,
    executeContractWrite,
}: DepositModalProps) {
    const [copied, setCopied] = useState(false);
    const [usdcBalance, setUsdcBalance] = useState("0.00");
    const [refreshing, setRefreshing] = useState(false);
    const [lastActive, setLastActive] = useState(Date.now());
    const [pollingTimeout, setPollingTimeout] = useState(false);
    const [tab, setTab] = useState<"crypto" | "fiat">("crypto");
    const [country, setCountry] = useState<string | null>(null);

    /* Resolve the viewer's region (set by middleware) so the fiat tab can personalize its guidance. */
    useEffect(() => {
        if (!isOpen || country) return;
        fetch("/api/geo")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => data?.country && setCountry(data.country))
            .catch(() => {});
    }, [isOpen, country]);

    const fetchBalance = async () => {
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
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        setLastActive(Date.now());
        setPollingTimeout(false);
        await fetchBalance();
        setRefreshing(false);
        if (onSuccess) onSuccess();
    };

    useEffect(() => {
        if (!isOpen) return;

        setLastActive(Date.now());
        setPollingTimeout(false);
        fetchBalance();

        const interval = setInterval(async () => {
            const timeSinceActive = Date.now() - lastActive;
            if (timeSinceActive > 60000) {
                setPollingTimeout(true);
                clearInterval(interval);
                console.log("Inactivity timeout reached. Stopping USDC balance polling.");
            } else {
                await fetchBalance();
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [isOpen, depositAddress, lastActive]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(depositAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const resetAndClose = () => {
        setCopied(false);
        setRefreshing(false);
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
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans"
                    >
                        <div
                            className="bg-dark-charcoal border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                                <h2 className="text-sm font-black uppercase tracking-wider text-white">Deposit USDC</h2>
                                <button
                                    onClick={resetAndClose}
                                    className="p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-all"
                                    aria-label="Close modal"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Tab switch: crypto deposit vs fiat on-ramp guidance */}
                            <div className="px-5 pt-4">
                                <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1 text-[11px] font-black uppercase tracking-wider">
                                    <button
                                        onClick={() => setTab("crypto")}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${tab === "crypto" ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70"}`}
                                    >
                                        <QrCode className="w-3.5 h-3.5" /> Crypto
                                    </button>
                                    <button
                                        onClick={() => setTab("fiat")}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all ${tab === "fiat" ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70"}`}
                                    >
                                        <CreditCard className="w-3.5 h-3.5" /> Card / Bank
                                    </button>
                                </div>
                            </div>

                            {tab === "crypto" && (
                            <div className="p-5 flex flex-col items-center">
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#00d2b4]/10 text-[#00d2b4] rounded-full text-[10px] font-bold uppercase tracking-wider mb-3">
                                    <QrCode className="w-3.5 h-3.5" />
                                    {isEmbeddedWallet ? "Embedded Wallet Address" : "SubScript Wallet Address"}
                                </div>

                                <p className="text-white/70 text-center text-xs mb-4 leading-relaxed max-w-[280px]">
                                    Top up your SubScript balance by sending USDC directly to this address on <span className="text-white font-semibold">Base</span>.
                                </p>

                                {/* Current Balance Card */}
                                <div className="w-full px-4 py-3 bg-white/[0.03] border border-white/5 rounded-xl mb-4 flex items-center justify-between">
                                    <div className="text-left">
                                        <p className="text-[9px] text-white/35 uppercase font-bold tracking-widest leading-none mb-1">
                                            Current Balance
                                        </p>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-base font-bold text-white tracking-tight">
                                                ${usdcBalance}
                                            </span>
                                            <span className="text-[10px] text-white/50 font-normal">USDC</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!pollingTimeout && (
                                            <span className="flex h-1.5 w-1.5 relative">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d2b4] opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00d2b4]"></span>
                                            </span>
                                        )}
                                        <button
                                            onClick={handleRefresh}
                                            className="p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all flex items-center justify-center"
                                            title="Refresh balance"
                                        >
                                            <Loader2 className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                                        </button>
                                    </div>
                                </div>

                                {/* QR Code */}
                                <div className="p-3 bg-white rounded-xl inline-block mb-4 shadow-inner">
                                    <QRCodeSVG
                                        value={depositAddress}
                                        size={140}
                                        level="H"
                                        includeMargin={false}
                                    />
                                </div>

                                {/* Copy Address Box */}
                                <div className="w-full bg-white/5 border border-white/15 rounded-xl p-3">
                                    <p className="text-[9px] text-white/45 uppercase tracking-wider font-bold mb-1 text-left">
                                        Your Deposit Address
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 text-[11px] text-white font-mono break-all text-left select-all">
                                            {depositAddress}
                                        </code>
                                        <button
                                            onClick={handleCopy}
                                            className="p-1.5 text-[#00d2b4] hover:bg-[#00d2b4]/10 rounded-lg transition-colors shrink-0"
                                            title="Copy address"
                                        >
                                            {copied ? (
                                                <Check className="w-4 h-4" />
                                            ) : (
                                                <Copy className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {copied && (
                                    <motion.p
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="text-[#00d2b4] text-[10px] mt-2 font-semibold uppercase tracking-wider"
                                    >
                                        Address copied to clipboard
                                    </motion.p>
                                )}
                            </div>
                            )}

                            {tab === "fiat" && (
                            <div className="p-5 flex flex-col">
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#ccff00]/10 text-[#ccff00] rounded-full text-[10px] font-bold uppercase tracking-wider mb-3 self-center">
                                    <CreditCard className="w-3.5 h-3.5" />
                                    Buy USDC with Fiat
                                </div>

                                <p className="text-white/70 text-center text-xs mb-4 leading-relaxed">
                                    {`SubScript doesn't run a direct card/bank on-ramp${regionName(country) ? ` in ${regionName(country)}` : ""} yet. `}
                                    Buy <span className="text-white font-semibold">USDC</span> from a trusted provider and send it to your address below — Circle&apos;s CCTP bridges it to Arc even if it lands on another chain.
                                </p>

                                {/* Steps */}
                                <ol className="w-full space-y-2.5 mb-4">
                                    {[
                                        "Open a provider below and start a USDC purchase.",
                                        "Select USDC as the asset and paste your deposit address as the destination.",
                                        "Pick any supported chain — CCTP settles your USDC to Arc automatically.",
                                    ].map((step, i) => (
                                        <li key={i} className="flex items-start gap-2.5 text-[11px] text-white/70 leading-relaxed">
                                            <span className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#ccff00]/15 text-[#ccff00] text-[10px] font-black">{i + 1}</span>
                                            <span>{step}</span>
                                        </li>
                                    ))}
                                </ol>

                                {/* Providers */}
                                <div className="grid grid-cols-2 gap-2 mb-4">
                                    {EXTERNAL_ONRAMP_PROVIDERS.map((p) => (
                                        <a
                                            key={p.name}
                                            href={p.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group flex flex-col gap-0.5 px-3 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl hover:border-[#ccff00]/40 hover:bg-white/[0.06] transition-all"
                                        >
                                            <span className="flex items-center justify-between text-xs font-bold text-white">
                                                {p.name}
                                                <ExternalLink className="w-3 h-3 text-white/40 group-hover:text-[#ccff00]" />
                                            </span>
                                            {p.note && <span className="text-[9px] text-white/40 leading-tight">{p.note}</span>}
                                        </a>
                                    ))}
                                </div>

                                {/* Deposit address */}
                                <div className="w-full bg-white/5 border border-white/15 rounded-xl p-3 mb-3">
                                    <p className="text-[9px] text-white/45 uppercase tracking-wider font-bold mb-1 text-left">
                                        Send the USDC to your address
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 text-[11px] text-white font-mono break-all text-left select-all">
                                            {depositAddress}
                                        </code>
                                        <button
                                            onClick={handleCopy}
                                            className="p-1.5 text-[#ccff00] hover:bg-[#ccff00]/10 rounded-lg transition-colors shrink-0"
                                            title="Copy address"
                                        >
                                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                {/* USDC-only warning */}
                                <div className="w-full flex items-start gap-2 px-3 py-2.5 bg-amber-400/10 border border-amber-400/25 rounded-xl">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-amber-200/90 leading-relaxed">
                                        Always select <span className="font-bold">USDC</span>. Sending any other token or asset can result in permanently lost funds.
                                    </p>
                                </div>

                                <a
                                    href="https://www.circle.com/cross-chain-transfer-protocol"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 inline-flex items-center justify-center gap-1.5 text-[10px] text-white/45 hover:text-white/70 transition-colors self-center"
                                >
                                    How CCTP bridges your USDC to Arc <ArrowRight className="w-3 h-3" />
                                </a>
                            </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
