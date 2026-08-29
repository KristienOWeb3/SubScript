"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    Copy,
    Check,
    QrCode,
    Loader2,
    Globe,
    Building2,
    ArrowLeft,
    CheckCircle2,
    ArrowRight,
    ExternalLink,
    Sparkles,
    Wallet,
} from "lucide-react";
import { QRCode } from "react-qrcode-logo";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import {
    USDC_NATIVE_GAS_ADDRESS,
    CCTP_CONFIG,
    ARC_CCTP_DOMAIN_ID,
    BRIDGE_FEE_TREASURY_ADDRESS,
    ARC_TESTNET_CHAIN_ID,
    ARC_MAINNET_CHAIN_ID,
    isProd,
} from "@/lib/contracts/constants";
import { calculateBridgeFee, formatMicros, formatFeeBps } from "@/lib/cctp/feeEngine";
import { ChainLogo } from "@/components/ChainLogo";

const ANY_DESTINATION_CALLER = `0x${"0".repeat(64)}` as `0x${string}`;
const CCTP_FINALITY_STANDARD = 2000;

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

const TOKEN_MESSENGER_ABI = [
    {
        type: "function",
        name: "depositForBurn",
        stateMutability: "nonpayable",
        inputs: [
            { name: "amount", type: "uint256" },
            { name: "destinationDomain", type: "uint32" },
            { name: "mintRecipient", type: "bytes32" },
            { name: "burnToken", type: "address" },
            { name: "destinationCaller", type: "bytes32" },
            { name: "maxFee", type: "uint256" },
            { name: "minFinality", type: "uint32" },
        ],
        outputs: [{ name: "_nonce", type: "uint64" }],
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

function toBytes32Address(address: string): `0x${string}` {
    const clean = address.toLowerCase().replace(/^0x/, "");
    return `0x${clean.padStart(64, "0")}` as `0x${string}`;
}

export interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    isEmbeddedWallet?: boolean;
    depositAddress: string;
    onSuccess?: () => void;
    chainId?: number;
    switchChainAsync?: (params: { chainId: number }) => Promise<unknown>;
    writeContractAsync?: (params: any) => Promise<`0x${string}`>;
    executeContractWrite?: (params: {
        address: string;
        abi: any;
        functionName: string;
        args?: any[];
    }) => Promise<string>;
}

type DepositStep = "method" | "bank_info" | "chains" | "address";

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet = false,
    depositAddress,
    onSuccess,
    chainId,
    switchChainAsync,
    writeContractAsync,
}: DepositModalProps) {
    const [step, setStep] = useState<DepositStep>("method");
    const [selectedChainId, setSelectedChainId] = useState<number>(() => activeArcChain.id);
    const [depositMode, setDepositMode] = useState<"address" | "connected">("address");

    const [copied, setCopied] = useState(false);
    const [copiedContract, setCopiedContract] = useState(false);
    const [usdcBalance, setUsdcBalance] = useState("0.00");
    const [originBalance, setOriginBalance] = useState("0.00");
    const [loadingOriginBalance, setLoadingOriginBalance] = useState(false);

    // CCTP Interactive Deposit State
    const [cctpAmount, setCctpAmount] = useState("");
    const [cctpStatus, setCctpStatus] = useState<
        "idle" | "switching" | "paying_fee" | "approving" | "burning" | "registering" | "submitted" | "error"
    >("idle");
    const [cctpMessage, setCctpMessage] = useState<string | null>(null);
    const [cctpError, setCctpError] = useState<string | null>(null);

    /* Irreversible burn recovery record stored in localStorage until acknowledged by backend keeper */
    const [pendingRegistration, setPendingRegistration] = useState<{
        burnTxHash: `0x${string}`;
        feeTxHash?: `0x${string}`;
        originChainId: number;
        grossAmountMicros: string;
        amount: string;
    } | null>(null);

    const recoveryKey = depositAddress ? `subscript:cctp-recovery:${depositAddress.toLowerCase()}` : null;

    useEffect(() => {
        if (!isOpen || !recoveryKey) return;
        try {
            const stored = window.localStorage.getItem(recoveryKey);
            setPendingRegistration(stored ? JSON.parse(stored) : null);
        } catch {
            setPendingRegistration(null);
        }
    }, [isOpen, recoveryKey]);

    const cctpInProgress = !["idle", "submitted", "error"].includes(cctpStatus);

    /* Full list of EVM chains supporting CCTP + Arc native */
    const supportedChains = useMemo(() => {
        const arcChain = {
            chainId: activeArcChain.id,
            name: activeArcChain.name,
            shortName: "Arc Network",
            feeBps: 0,
            feePercentage: "0% Fee",
            isArc: true,
            isL1: false,
            usdc: USDC_NATIVE_GAS_ADDRESS,
            tokenMessenger: null,
            domain: ARC_CCTP_DOMAIN_ID,
            badge: "0% Fee · Instant",
            subtext: "Native Arc Settlement (Recommended)",
        };

        const evmChains = Object.entries(CCTP_CONFIG).map(([cId, info]) => {
            const id = Number(cId);
            const isL1 = Boolean(info.isL1);
            return {
                chainId: id,
                name: info.name,
                shortName: info.name.replace(" Sepolia", "").replace(" Mainnet", ""),
                feeBps: info.feeBps,
                feePercentage: formatFeeBps(info.feeBps),
                isArc: false,
                isL1,
                usdc: info.usdc,
                tokenMessenger: info.tokenMessenger,
                domain: info.domain,
                badge: `${formatFeeBps(info.feeBps)} Fee`,
                subtext: isL1 ? "Ethereum L1 · Circle CCTP" : `${info.name} · Circle CCTP`,
            };
        });

        return [arcChain, ...evmChains];
    }, []);

    const selectedChain = useMemo(() => {
        return supportedChains.find((c) => c.chainId === selectedChainId) || supportedChains[0];
    }, [supportedChains, selectedChainId]);

    const cctpQuote = useMemo(() => {
        if (!cctpAmount || isNaN(Number(cctpAmount)) || Number(cctpAmount) <= 0 || selectedChain.isArc) {
            return null;
        }
        try {
            return calculateBridgeFee(
                (BigInt(Math.floor(Number(cctpAmount) * 1_000_000))).toString(),
                selectedChain.chainId,
                "inbound_deposit"
            );
        } catch {
            return null;
        }
    }, [selectedChain, cctpAmount]);

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
        setLoadingOriginBalance(true);
        try {
            const res = await fetch(`/api/user/cctp/scan?address=${encodeURIComponent(depositAddress)}`, {
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
                args: [depositAddress as `0x${string}`],
            });
            setOriginBalance(parseFloat(formatUnits(bal as bigint, 6)).toFixed(2));
        } catch {
            setOriginBalance("0.00");
        } finally {
            setLoadingOriginBalance(false);
        }
    }, [depositAddress, selectedChain]);

    useEffect(() => {
        if (!isOpen) return;
        setStep("method");
        setSelectedChainId(activeArcChain.id);
        setCctpStatus("idle");
        setCctpError(null);
        setCctpAmount("");
        fetchBalance();
    }, [isOpen, fetchBalance]);

    useEffect(() => {
        if (isOpen && !selectedChain.isArc) {
            fetchOriginBalance();
        }
    }, [isOpen, selectedChain, fetchOriginBalance]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(depositAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyContract = async () => {
        if (!selectedChain.usdc) return;
        await navigator.clipboard.writeText(selectedChain.usdc);
        setCopiedContract(true);
        setTimeout(() => setCopiedContract(false), 2000);
    };

    const registerDeposit = async (record: NonNullable<typeof pendingRegistration>) => {
        setCctpStatus("registering");
        setCctpMessage("Handing the deposit to Circle and the Arc relayer...");

        let lastError = "";
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await fetch("/api/user/cctp/deposit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        originChainId: record.originChainId,
                        grossAmountMicros: record.grossAmountMicros,
                        burnTxHash: record.burnTxHash,
                        feeTxHash: record.feeTxHash,
                    }),
                });
                if (res.ok) {
                    if (recoveryKey) window.localStorage.removeItem(recoveryKey);
                    setPendingRegistration(null);
                    setCctpStatus("submitted");
                    setCctpMessage(null);
                    setCctpAmount("");
                    if (onSuccess) onSuccess();
                    return;
                }
                const data = await res.json().catch(() => ({}));
                lastError = data.error || `Server said ${res.status}`;
            } catch (error: any) {
                lastError = error?.message || "Network error";
            }
            await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
        }

        throw new Error(
            `Your USDC was sent but we couldn't record it (${lastError}). Reopen this screen to finish, or contact support with ${record.burnTxHash.slice(0, 10)}…`
        );
    };

    const handleResumeRegistration = async () => {
        if (!pendingRegistration) return;
        setCctpError(null);
        try {
            await registerDeposit(pendingRegistration);
        } catch (error: any) {
            setCctpStatus("error");
            setCctpError(error.message || "We couldn't record that deposit.");
        }
    };

    const handleStartCctpDeposit = async () => {
        setCctpError(null);
        if (!writeContractAsync || !switchChainAsync) {
            setCctpError("Wallet actions not supported in this session. Please send USDC directly to your EVM address above.");
            return;
        }
        if (!cctpQuote || selectedChain.isArc) {
            setCctpError("Enter a valid amount to deposit.");
            return;
        }

        const originClient = originPublicClient(selectedChain.chainId);
        const settle = async (hash: `0x${string}`, what: string) => {
            const receipt = await originClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
            if (receipt.status !== "success") throw new Error(`${what} failed on ${selectedChain.name}.`);
            return receipt;
        };

        try {
            // Step 1: Switch network
            setCctpStatus("switching");
            setCctpMessage(`Switching wallet to ${selectedChain.name}...`);
            if (chainId !== selectedChain.chainId) {
                await switchChainAsync({ chainId: selectedChain.chainId });
            }

            // Step 2: Pay protocol bridge fee
            let feeTxHash: `0x${string}` | undefined;
            if (cctpQuote.feeMicros > 0n) {
                setCctpStatus("paying_fee");
                setCctpMessage(`Collecting the ${cctpQuote.feePercentage} bridge fee...`);
                feeTxHash = await writeContractAsync({
                    address: selectedChain.usdc as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: "transfer",
                    args: [BRIDGE_FEE_TREASURY_ADDRESS as `0x${string}`, cctpQuote.feeMicros],
                });
                setCctpMessage("Waiting for the fee to confirm...");
                await settle(feeTxHash!, "The fee payment");
            }

            // Step 3: Approve net amount
            setCctpStatus("approving");
            setCctpMessage(`Approving ${formatMicros(cctpQuote.netMicros)} USDC on ${selectedChain.name}...`);
            const approveTxHash = await writeContractAsync({
                address: selectedChain.usdc as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [selectedChain.tokenMessenger as `0x${string}`, cctpQuote.netMicros],
            });
            setCctpMessage("Waiting for the approval to confirm...");
            await settle(approveTxHash, "The approval");

            // Step 4: Burn net amount via CCTP
            setCctpStatus("burning");
            setCctpMessage(`Sending ${formatMicros(cctpQuote.netMicros)} USDC to Arc...`);
            const burnTxHash = await writeContractAsync({
                address: selectedChain.tokenMessenger as `0x${string}`,
                abi: TOKEN_MESSENGER_ABI,
                functionName: "depositForBurn",
                args: [
                    cctpQuote.netMicros,
                    ARC_CCTP_DOMAIN_ID,
                    toBytes32Address(depositAddress),
                    selectedChain.usdc as `0x${string}`,
                    ANY_DESTINATION_CALLER,
                    0n,
                    CCTP_FINALITY_STANDARD,
                ],
            });
            setCctpMessage("Waiting for the transfer to confirm...");
            await settle(burnTxHash, "The transfer");

            // Save burn locally
            const record = {
                burnTxHash,
                feeTxHash,
                originChainId: selectedChain.chainId,
                grossAmountMicros: cctpQuote.grossMicros.toString(),
                amount: cctpAmount,
            };
            if (recoveryKey) window.localStorage.setItem(recoveryKey, JSON.stringify(record));
            setPendingRegistration(record);

            // Step 5: Register deposit with backend keeper
            await registerDeposit(record);
        } catch (err: any) {
            console.error("CCTP deposit error:", err);
            setCctpStatus("error");
            if (err.message?.includes("User rejected the request")) {
                setCctpError("Signature rejected, so nothing was sent.");
            } else {
                setCctpError(err.message || "Failed to complete cross-chain deposit.");
            }
        }
    };

    const resetAndClose = () => {
        if (cctpInProgress) return;
        setCopied(false);
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
                        initial={{ opacity: 0, scale: 0.96, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 16 }}
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 font-sans"
                    >
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="deposit-modal-title"
                            className="bg-[#FFFFF0] border border-black/15 rounded-3xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl relative text-black"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Fixed Modal Header */}
                            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-black/10 shrink-0 bg-white/80 backdrop-blur-md">
                                <div className="flex items-center gap-2">
                                    {step !== "method" && !cctpInProgress && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (step === "address") setStep("chains");
                                                else setStep("method");
                                            }}
                                            className="p-1 -ml-1 text-black/60 hover:text-black hover:bg-black/5 rounded-full transition"
                                            aria-label="Back"
                                        >
                                            <ArrowLeft className="w-4 h-4" />
                                        </button>
                                    )}
                                    <h2 id="deposit-modal-title" className="text-sm font-black uppercase tracking-wider text-[#082824]">
                                        {step === "method"
                                            ? "Deposit Funds"
                                            : step === "bank_info"
                                            ? "Local Bank Deposit"
                                            : step === "chains"
                                            ? "Select Network"
                                            : `Deposit via ${selectedChain.shortName}`}
                                    </h2>
                                </div>
                                <button
                                    onClick={resetAndClose}
                                    disabled={cctpInProgress}
                                    className="p-1.5 text-black/50 hover:text-black hover:bg-black/5 rounded-full transition disabled:opacity-40"
                                    aria-label="Close deposit dialog"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Scrollable Modal Body (No Cutout!) */}
                            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 custom-scrollbar text-black">
                                {/* STEP 1: METHOD SELECTION */}
                                {step === "method" && (
                                    <div className="space-y-4">
                                        <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-left">
                                            <p className="text-[10px] font-black uppercase tracking-wider text-black/50">Current Balance</p>
                                            <div className="flex items-baseline gap-2 mt-1">
                                                <span className="text-2xl font-black text-black font-mono">{usdcBalance}</span>
                                                <span className="text-xs font-bold text-black/60">USDC on Arc</span>
                                            </div>
                                        </div>

                                        <p className="text-xs text-black/70 text-left font-medium">
                                            Select how you would like to deposit funds into your SubScript account:
                                        </p>

                                        <div className="space-y-3">
                                            {/* Option 1: USDC (On-chain) */}
                                            <button
                                                type="button"
                                                onClick={() => setStep("chains")}
                                                className="flex w-full items-center gap-3.5 rounded-2xl border border-black/15 bg-white p-4 text-left hover:border-black/30 hover:bg-black/[0.02] transition shadow-sm group"
                                            >
                                                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2775CA] text-white group-hover:scale-105 transition shrink-0 shadow-sm">
                                                    <Globe className="h-6 w-6" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="text-xs font-black uppercase tracking-wider text-black">USDC (On-chain)</h4>
                                                        <span className="bg-emerald-500/10 text-emerald-700 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-emerald-500/20">
                                                            Active
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-black/60 mt-1 leading-snug">
                                                        Deposit from <strong>Arc Network (0% fee)</strong> or any CCTP EVM chain (Base, Arbitrum, Ethereum, OP, Polygon).
                                                    </p>
                                                </div>
                                                <ArrowRight className="h-4 w-4 text-black/40 group-hover:translate-x-1 transition shrink-0" />
                                            </button>

                                            {/* Option 2: Local Bank (Coming Soon) */}
                                            <button
                                                type="button"
                                                onClick={() => setStep("bank_info")}
                                                className="flex w-full items-center gap-3.5 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-left hover:bg-black/[0.04] transition group"
                                            >
                                                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-black/10 text-black/60 group-hover:scale-105 transition shrink-0">
                                                    <Building2 className="h-6 w-6" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="text-xs font-black uppercase tracking-wider text-black/80">Local Bank Transfer</h4>
                                                        <span className="bg-amber-500/10 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-500/20">
                                                            Coming Soon
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-black/50 mt-1 leading-snug">
                                                        Direct fiat on-ramp to USDC via bank transfer (in private testing).
                                                    </p>
                                                </div>
                                                <ArrowRight className="h-4 w-4 text-black/30 group-hover:translate-x-1 transition shrink-0" />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 1B: BANK INFO (COMING SOON) */}
                                {step === "bank_info" && (
                                    <div className="py-6 text-center space-y-4">
                                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 border border-amber-500/20">
                                            <Building2 className="h-7 w-7" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-black uppercase tracking-wider text-black">Local Bank Transfers (Coming Soon)</h4>
                                            <p className="text-xs text-black/60 mt-2 leading-relaxed max-w-xs mx-auto">
                                                Direct bank account deposits and fiat on-ramping are currently in private compliance testing.
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-black/10 bg-white p-3.5 text-left text-xs text-black/70 space-y-1.5 shadow-sm">
                                            <p className="font-bold text-black flex items-center gap-1.5">
                                                <Sparkles className="w-3.5 h-3.5 text-[#2775CA]" /> What you can do right now:
                                            </p>
                                            <p className="text-[11px] leading-relaxed text-black/65">
                                                Deposit USDC directly on <strong>Arc Network</strong> (free) or from <strong>Base, Arbitrum, Ethereum, OP, or Polygon</strong> with automated CCTP bridging.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setStep("chains")}
                                            className="w-full py-3 rounded-2xl bg-[#2775CA] text-white font-bold text-xs shadow-sm hover:bg-[#1f62ab] transition"
                                        >
                                            Deposit USDC On-Chain
                                        </button>
                                    </div>
                                )}

                                {/* STEP 2: EVM CHAINS LIST */}
                                {step === "chains" && (
                                    <div className="space-y-3.5">
                                        <div className="text-left">
                                            <p className="text-xs text-black/70 leading-relaxed">
                                                Select the network where you currently have USDC. All supported EVM chains bridge directly to your SubScript balance:
                                            </p>
                                        </div>

                                        <div className="space-y-2">
                                            {supportedChains.map((chain) => {
                                                const isArc = chain.isArc;
                                                const isL1 = chain.isL1;
                                                return (
                                                    <button
                                                        key={chain.chainId}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedChainId(chain.chainId);
                                                            setStep("address");
                                                        }}
                                                        className="flex w-full items-center justify-between rounded-2xl border border-black/15 bg-white p-3.5 text-left hover:border-[#2775CA] hover:bg-[#2775CA]/[0.02] transition shadow-sm group"
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <ChainLogo chain={chain.chainId} size={28} className="h-7 w-7 shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-black text-black truncate">{chain.name}</span>
                                                                    {isArc && (
                                                                        <span className="bg-emerald-500/10 text-emerald-800 text-[8px] font-black uppercase px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                                            Native
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[10px] text-black/55 truncate mt-0.5">{chain.subtext}</p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 shrink-0 ml-2">
                                                            <span
                                                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                                                    isArc
                                                                        ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                                                                        : isL1
                                                                        ? "bg-amber-500/10 text-amber-800 border-amber-500/20"
                                                                        : "bg-[#2775CA]/10 text-[#2775CA] border-[#2775CA]/20"
                                                                }`}
                                                            >
                                                                {chain.badge}
                                                            </span>
                                                            <ArrowRight className="h-3.5 w-3.5 text-black/30 group-hover:text-black group-hover:translate-x-0.5 transition" />
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-left">
                                            <p className="text-[10px] text-amber-950 leading-relaxed font-sans">
                                                💡 <strong>Same EVM Address:</strong> Your deposit address is identical on every EVM chain. Funds sent from another chain will automatically bridge to Arc via CCTP.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3: DEPOSIT ADDRESS & DETAILS */}
                                {step === "address" && (
                                    <div className="space-y-4 text-left">
                                        {/* Unfinished deposit recovery banner */}
                                        {pendingRegistration && cctpStatus !== "registering" && (
                                            <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                                                <p className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                                                    Unfinished deposit
                                                </p>
                                                <p className="text-[11px] leading-relaxed text-black/75">
                                                    {pendingRegistration.amount} USDC already left{" "}
                                                    {CCTP_CONFIG[pendingRegistration.originChainId]?.name || "the origin chain"}, but we
                                                    never managed to record it. Finish here and it will land on Arc. Don&apos;t send again.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={handleResumeRegistration}
                                                    className="mt-1 w-full rounded-xl bg-amber-600 py-2.5 text-[11px] font-bold text-white transition hover:bg-amber-700"
                                                >
                                                    Finish this deposit
                                                </button>
                                            </div>
                                        )}

                                        {/* Selected Network Summary Pill */}
                                        <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white p-3 shadow-sm">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <ChainLogo chain={selectedChain.chainId} size={24} className="h-6 w-6 shrink-0" />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-black text-black truncate">{selectedChain.name}</span>
                                                        <span className="text-[9px] font-bold text-black/50">({selectedChain.feePercentage})</span>
                                                    </div>
                                                    <p className="text-[10px] text-black/50 truncate">
                                                        {selectedChain.isArc ? "Instant settlement" : "~5 mins via CCTP bridge"}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={cctpInProgress}
                                                onClick={() => setStep("chains")}
                                                className="text-[11px] font-bold text-[#2775CA] hover:underline px-2 py-1 rounded-lg hover:bg-black/5 transition shrink-0"
                                            >
                                                Change
                                            </button>
                                        </div>

                                        {/* Live Balance on Origin Chain */}
                                        {!selectedChain.isArc && (
                                            <div className="flex items-center justify-between p-3 rounded-2xl bg-black/[0.03] border border-black/10 text-xs">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <ChainLogo chain={selectedChain.chainId} size={16} className="h-4 w-4 shrink-0" />
                                                    <span className="text-black/70 font-medium truncate">Your USDC on {selectedChain.shortName}:</span>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {loadingOriginBalance ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2775CA]" />
                                                    ) : (
                                                        <span className="font-mono font-bold text-black">{originBalance} USDC</span>
                                                    )}
                                                    {parseFloat(originBalance) > 0 && (
                                                        <button
                                                            type="button"
                                                            disabled={cctpInProgress}
                                                            onClick={() => {
                                                                setDepositMode("connected");
                                                                setCctpAmount(originBalance);
                                                            }}
                                                            className="text-[10px] font-bold text-white bg-[#2775CA] hover:bg-[#1f62ab] px-2 py-0.5 rounded-lg transition shadow-sm"
                                                        >
                                                            Move to Arc
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Notice on EVM Address Identity */}
                                        <p className="text-[11px] text-black/65 leading-relaxed text-center">
                                            Send USDC on <strong className="text-black">{selectedChain.name}</strong> to your EVM deposit address below.
                                        </p>

                                        {/* QR Code */}
                                        <div className="flex justify-center">
                                            <div className="p-3 bg-white border border-black/10 rounded-2xl shadow-sm inline-block">
                                                <QRCode
                                                    value={depositAddress}
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

                                        {/* Copy Address Box */}
                                        <div className="bg-white border border-black/15 rounded-2xl p-3.5 text-left shadow-sm">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-[9px] text-black/50 uppercase tracking-wider font-black">
                                                    Your EVM Deposit Address
                                                </p>
                                                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-500/10 px-1.5 py-0.2 rounded">
                                                    Same across all EVMs
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 text-[11px] text-black font-mono break-all select-all font-semibold">
                                                    {depositAddress}
                                                </code>
                                                <button
                                                    onClick={handleCopy}
                                                    className="p-2 text-[#082824] hover:bg-black/5 rounded-xl transition shrink-0"
                                                    title="Copy address"
                                                    aria-label="Copy deposit address"
                                                >
                                                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </div>

                                        {copied && (
                                            <p className="text-emerald-700 text-[10px] font-black uppercase tracking-wider text-center">
                                                ✓ Address copied to clipboard!
                                            </p>
                                        )}

                                        {/* Token Contract Reference */}
                                        {selectedChain.usdc && selectedChain.usdc !== "0x3600000000000000000000000000000000000000" && (
                                            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2.5 text-[10px] flex items-center justify-between text-black/70">
                                                <span className="truncate">
                                                    USDC on {selectedChain.shortName}: <code className="font-mono text-black font-bold">{selectedChain.usdc.slice(0, 8)}...{selectedChain.usdc.slice(-6)}</code>
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

                                        {/* Optional In-App Wallet Deposit Section */}
                                        {!selectedChain.isArc && writeContractAsync && (
                                            <div className="pt-2 border-t border-black/10 space-y-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setDepositMode(depositMode === "connected" ? "address" : "connected")}
                                                    className="text-xs font-bold text-[#2775CA] hover:underline flex items-center gap-1.5"
                                                >
                                                    <Wallet className="w-3.5 h-3.5" />
                                                    {depositMode === "connected"
                                                        ? "Hide in-browser wallet deposit"
                                                        : `Or deposit directly with connected wallet on ${selectedChain.shortName}`}
                                                </button>

                                                {depositMode === "connected" && (
                                                    <div className="space-y-3 p-3.5 rounded-2xl bg-white border border-black/10 shadow-sm">
                                                        {cctpStatus === "idle" || cctpStatus === "error" ? (
                                                            <>
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-[9px] font-black uppercase tracking-wider text-black/60">
                                                                            Amount to Deposit (USDC)
                                                                        </label>
                                                                        {parseFloat(originBalance) > 0 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setCctpAmount(originBalance)}
                                                                                className="text-[9px] font-bold text-[#2775CA] hover:underline"
                                                                            >
                                                                                MAX ({originBalance})
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <input
                                                                        type="number"
                                                                        step="any"
                                                                        disabled={cctpInProgress}
                                                                        value={cctpAmount}
                                                                        onChange={(e) => {
                                                                            setCctpAmount(e.target.value);
                                                                            setCctpError(null);
                                                                        }}
                                                                        placeholder="0.00"
                                                                        className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 font-mono text-xs text-black shadow-sm focus:border-[#2775CA] focus:outline-none disabled:bg-black/5 disabled:cursor-not-allowed"
                                                                    />
                                                                </div>

                                                                {cctpQuote && (
                                                                    <div className="rounded-xl border border-black/10 bg-black/[0.02] p-2.5 space-y-1 text-[11px]">
                                                                        <div className="flex justify-between text-black/70">
                                                                            <span>Deposit amount</span>
                                                                            <span className="font-mono font-bold">{formatMicros(cctpQuote.grossMicros)} USDC</span>
                                                                        </div>
                                                                        <div className="flex justify-between text-amber-800">
                                                                            <span>Bridge fee ({cctpQuote.feePercentage})</span>
                                                                            <span className="font-mono font-bold">-{formatMicros(cctpQuote.feeMicros, 4)} USDC</span>
                                                                        </div>
                                                                        <div className="flex justify-between border-t border-black/10 pt-1 font-bold text-black">
                                                                            <span>Arrives on Arc</span>
                                                                            <span className="font-mono text-[#2775CA]">{formatMicros(cctpQuote.netMicros, 4)} USDC</span>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {cctpError && (
                                                                    <p className="text-xs text-red-700 bg-red-500/10 border border-red-500/20 p-2 rounded-lg">
                                                                        {cctpError}
                                                                    </p>
                                                                )}

                                                                <button
                                                                    type="button"
                                                                    disabled={cctpInProgress || !cctpQuote}
                                                                    onClick={handleStartCctpDeposit}
                                                                    className="w-full py-2.5 rounded-xl bg-[#2775CA] text-white font-bold text-xs shadow-sm hover:bg-[#1f62ab] transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    Deposit {cctpAmount ? `${cctpAmount} USDC` : ""} from {selectedChain.shortName}
                                                                </button>
                                                            </>
                                                        ) : cctpStatus === "submitted" ? (
                                                            <div className="py-4 text-center space-y-2">
                                                                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                                                                <h4 className="text-xs font-bold text-black">Deposit Initiated!</h4>
                                                                <p className="text-[11px] text-black/60">
                                                                    USDC on {selectedChain.name} received, moving to arc.. (Please wait for 5 minutes).
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <div className="py-4 text-center space-y-2">
                                                                <Loader2 className="w-7 h-7 animate-spin text-[#2775CA] mx-auto" />
                                                                <p className="text-xs text-black/70 font-medium">{cctpMessage}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
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
