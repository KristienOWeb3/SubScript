"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, QrCode, Loader2, Globe, Wallet, ChevronDown, CheckCircle2, ArrowRight } from "lucide-react";
import { QRCode } from "react-qrcode-logo";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import {
    USDC_NATIVE_GAS_ADDRESS,
    CCTP_CONFIG,
    ARC_CCTP_DOMAIN_ID,
    BRIDGE_FEE_TREASURY_ADDRESS,
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
        outputs: [{ name: "", type: "uint256" }]
    },
    {
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [
            { name: "to", type: "address" },
            { name: "value", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    },
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    }
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
            { name: "minFinality", type: "uint32" }
        ],
        outputs: [{ name: "_nonce", type: "uint64" }]
    }
] as const;

const publicClient = createPublicClient({
    chain: activeArcChain,
    transport: arcHttp(),
});

/* Read-only clients for the origin chains, built lazily from the RPC in CCTP_CONFIG. The Arc client
   above cannot see an Ethereum or Base transaction, so waiting on an origin-chain receipt needs one
   of these. Only used for receipts, which needs no chain metadata, so `chain` is omitted. */
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

interface DepositModalProps {
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

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet = false,
    depositAddress,
    onSuccess,
    chainId,
    switchChainAsync,
    writeContractAsync,
    executeContractWrite,
}: DepositModalProps) {
    const [activeTab, setActiveTab] = useState<"menu" | "direct" | "cctp">("menu");
    const [copied, setCopied] = useState(false);
    const [usdcBalance, setUsdcBalance] = useState("0.00");
    const [refreshing, setRefreshing] = useState(false);

    // CCTP State
    const [selectedOriginChainId, setSelectedOriginChainId] = useState<number>(() => {
        const firstKey = Object.keys(CCTP_CONFIG)[0];
        return firstKey ? Number(firstKey) : 84532;
    });
    const [originMenuOpen, setOriginMenuOpen] = useState(false);
    const [cctpAmount, setCctpAmount] = useState("");
    const [cctpStatus, setCctpStatus] = useState<"idle" | "switching" | "paying_fee" | "approving" | "burning" | "registering" | "submitted" | "error">("idle");
    const [cctpMessage, setCctpMessage] = useState<string | null>(null);
    const [cctpError, setCctpError] = useState<string | null>(null);

    /* A burn we haven't managed to tell the backend about yet. The burn is irreversible and the keeper
       can't relay what it has never seen, so this survives a reload and the modal offers to finish
       registering instead of tempting a second burn. */
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

    const cctpChains = useMemo(() => {
        return Object.entries(CCTP_CONFIG).map(([cId, info]) => ({
            chainId: Number(cId),
            name: info.name,
            feeBps: info.feeBps,
            feePercentage: formatFeeBps(info.feeBps),
            isL1: Boolean((info as any).isL1),
            usdc: info.usdc,
            tokenMessenger: info.tokenMessenger,
            domain: info.domain,
            defaultRpc: info.defaultRpc,
        }));
    }, []);

    const selectedChainInfo = useMemo(() => {
        return cctpChains.find((c) => c.chainId === selectedOriginChainId) || cctpChains[0];
    }, [cctpChains, selectedOriginChainId]);

    const cctpQuote = useMemo(() => {
        if (!selectedChainInfo || !cctpAmount || isNaN(Number(cctpAmount)) || Number(cctpAmount) <= 0) return null;
        try {
            return calculateBridgeFee(
                parseUnits(cctpAmount.includes(".") ? `${cctpAmount.split(".")[0]}.${cctpAmount.split(".")[1].slice(0, 6)}` : cctpAmount, 6),
                selectedChainInfo.chainId,
                "inbound_deposit"
            );
        } catch {
            return null;
        }
    }, [selectedChainInfo, cctpAmount]);

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

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab("menu");
        setCctpStatus("idle");
        setCctpError(null);
        setCctpAmount("");
        fetchBalance();
    }, [isOpen, fetchBalance]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(depositAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    /**
     * Tells the backend about a burn so the keeper can relay it onto Arc. Retried, and the burn stays
     * parked in localStorage until it lands: an unregistered burn is money in flight that nothing is
     * watching.
     */
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
            /* Backs off, because the most common failure is the server checking for a fee transfer its
               RPC has not indexed yet. */
            await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
        }

        throw new Error(
            `Your USDC was sent but we couldn't record it (${lastError}). Reopen this screen to finish, or contact support with ${record.burnTxHash.slice(0, 10)}…`,
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
            setCctpError("Wallet actions not supported in this session. Please use Direct Deposit or connect an external browser wallet.");
            return;
        }
        if (!cctpQuote || !selectedChainInfo) {
            setCctpError("Enter a valid amount to deposit.");
            return;
        }

        const originClient = originPublicClient(selectedChainInfo.chainId);
        /* Every step waits to be mined before the next one starts. Firing them back to back looks
           faster but cannot work: depositForBurn pulls USDC through the allowance, so submitting it
           while the approve is still pending reverts the burn for lack of allowance. */
        const settle = async (hash: `0x${string}`, what: string) => {
            const receipt = await originClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
            if (receipt.status !== "success") throw new Error(`${what} failed on ${selectedChainInfo.name}.`);
            return receipt;
        };

        try {
            // Step 1: Switch network
            setCctpStatus("switching");
            setCctpMessage(`Switching wallet to ${selectedChainInfo.name}...`);
            if (chainId !== selectedChainInfo.chainId) {
                await switchChainAsync({ chainId: selectedChainInfo.chainId });
            }

            /* Step 2: pay the fee, before anything is burned. CCTP mints exactly what it burns, so a
               fee not taken here is never taken at all. Doing it first also means a revert costs the
               user nothing: no burn has happened yet. */
            let feeTxHash: `0x${string}` | undefined;
            if (cctpQuote.feeMicros > 0n) {
                setCctpStatus("paying_fee");
                setCctpMessage(`Collecting the ${cctpQuote.feePercentage} bridge fee...`);
                feeTxHash = await writeContractAsync({
                    address: selectedChainInfo.usdc as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: "transfer",
                    args: [BRIDGE_FEE_TREASURY_ADDRESS as `0x${string}`, cctpQuote.feeMicros],
                });
                setCctpMessage("Waiting for the fee to confirm...");
                await settle(feeTxHash!, "The fee payment");
            }

            /* Step 3: approve exactly the net. Approving the gross would leave the TokenMessenger able
               to pull the fee portion afterwards. */
            setCctpStatus("approving");
            setCctpMessage(`Approving ${formatMicros(cctpQuote.netMicros)} USDC on ${selectedChainInfo.name}...`);
            const approveTxHash = await writeContractAsync({
                address: selectedChainInfo.usdc as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [selectedChainInfo.tokenMessenger as `0x${string}`, cctpQuote.netMicros],
            });
            setCctpMessage("Waiting for the approval to confirm...");
            await settle(approveTxHash, "The approval");

            // Step 4: Burn net amount
            setCctpStatus("burning");
            setCctpMessage(`Sending ${formatMicros(cctpQuote.netMicros)} USDC to Arc...`);
            const burnTxHash = await writeContractAsync({
                address: selectedChainInfo.tokenMessenger as `0x${string}`,
                abi: TOKEN_MESSENGER_ABI,
                functionName: "depositForBurn",
                args: [
                    cctpQuote.netMicros,
                    ARC_CCTP_DOMAIN_ID,
                    toBytes32Address(depositAddress),
                    selectedChainInfo.usdc as `0x${string}`,
                    ANY_DESTINATION_CALLER,
                    0n,
                    CCTP_FINALITY_STANDARD,
                ],
            });
            setCctpMessage("Waiting for the transfer to confirm...");
            await settle(burnTxHash, "The transfer");

            /* Park the burn locally before telling the backend. From here the money has left the origin
               chain and only our keeper can deliver it, so a reload has to be able to finish
               registering rather than stranding it. */
            const record = {
                burnTxHash,
                feeTxHash,
                originChainId: selectedChainInfo.chainId,
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
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans"
                    >
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="deposit-modal-title"
                            className="bg-[#FFFFF0] border border-black/15 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl relative text-black"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-black/10">
                                <h2 id="deposit-modal-title" className="text-sm font-bold uppercase tracking-wider text-[#082824]">
                                    {activeTab === "menu" ? "Deposit USDC" : activeTab === "direct" ? "Receive on Arc" : "Cross-Chain Deposit"}
                                </h2>
                                <button
                                    onClick={resetAndClose}
                                    disabled={cctpInProgress}
                                    className="p-1.5 text-black/60 hover:text-black hover:bg-black/5 rounded-full transition-all disabled:opacity-40"
                                    aria-label="Close deposit dialog"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Sub-tabs if not on menu */}
                            {activeTab !== "menu" && (
                                <div className="px-6 pt-3">
                                    <div className="grid grid-cols-2 gap-1 bg-black/5 p-1 rounded-2xl border border-black/10">
                                        <button
                                            type="button"
                                            disabled={cctpInProgress}
                                            onClick={() => setActiveTab("direct")}
                                            className={`py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition ${
                                                activeTab === "direct" ? "bg-[#353935] text-white shadow-sm" : "text-black/60 hover:text-black"
                                            }`}
                                        >
                                            Arc Direct (Free)
                                        </button>
                                        <button
                                            type="button"
                                            disabled={cctpInProgress}
                                            onClick={() => setActiveTab("cctp")}
                                            className={`py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition ${
                                                activeTab === "cctp" ? "bg-[#353935] text-white shadow-sm" : "text-black/60 hover:text-black"
                                            }`}
                                        >
                                            Circle CCTP
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="p-6 text-black">
                                {activeTab === "menu" && (
                                    <div className="space-y-4">
                                        {/* Fees Overview Card */}
                                        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-left space-y-1.5">
                                            <p className="text-[9px] font-black uppercase tracking-wider text-amber-950">Deposit Fee Structure</p>
                                            <p className="text-xs text-black/80 leading-relaxed">
                                                • <strong>Arc Network</strong>: <strong>0% fee (Free)</strong> · Instant<br />
                                                • <strong>EVM Chains (Base, Arbitrum, OP, Polygon)</strong>: <strong>0.5% fee</strong><br />
                                                • <strong>Ethereum Mainnet / ERC20</strong>: <strong>1.0% fee</strong>
                                            </p>
                                        </div>

                                        <div className="space-y-2.5 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setActiveTab("direct")}
                                                className="flex w-full items-center gap-3.5 rounded-2xl border border-black/15 bg-white p-3.5 text-left hover:bg-black/5 transition shadow-sm group"
                                            >
                                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#353935] text-white group-hover:scale-105 transition shrink-0">
                                                    <Wallet className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-xs font-black uppercase tracking-wider text-black">Receive on Arc</h4>
                                                    <p className="text-[10px] text-black/60 mt-0.5">Show address & QR code. <strong>No fee (0%)</strong></p>
                                                </div>
                                                <ArrowRight className="h-4 w-4 text-black/40 group-hover:translate-x-1 transition shrink-0" />
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => setActiveTab("cctp")}
                                                className="flex w-full items-center gap-3.5 rounded-2xl border border-black/15 bg-white p-3.5 text-left hover:bg-black/5 transition shadow-sm group"
                                            >
                                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2775CA] text-white group-hover:scale-105 transition shrink-0">
                                                    <Globe className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-xs font-black uppercase tracking-wider text-black">Deposit from another chain</h4>
                                                    <p className="text-[10px] text-black/60 mt-0.5">Circle CCTP · 0.5% on L2s / 1% on Ethereum</p>
                                                </div>
                                                <ArrowRight className="h-4 w-4 text-black/40 group-hover:translate-x-1 transition shrink-0" />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "direct" && (
                                    <div className="flex flex-col items-center text-center space-y-3">
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#2775CA]/10 text-[#2775CA] rounded-full text-[10px] font-black uppercase tracking-wider">
                                            <QrCode className="w-3.5 h-3.5" />
                                            {isEmbeddedWallet ? "Embedded Arc Address" : "SubScript Arc Address"}
                                        </div>

                                        <p className="text-xs text-black/70 leading-relaxed">
                                            Send native USDC on <span className="font-bold text-black">{activeArcChain.name}</span>. <br />
                                            <span className="text-emerald-700 font-bold">No deposit fee.</span>
                                        </p>

                                        {/* QR Code */}
                                        <div className="p-3 bg-white border border-black/10 rounded-2xl shadow-sm">
                                            <QRCode
                                                value={depositAddress}
                                                size={130}
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

                                        {/* Copy Address Box */}
                                        <div className="w-full bg-white border border-black/15 rounded-2xl p-3 text-left">
                                            <p className="text-[9px] text-black/50 uppercase tracking-wider font-bold mb-1">
                                                Your Deposit Address
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 text-[11px] text-black font-mono break-all select-all">
                                                    {depositAddress}
                                                </code>
                                                <button
                                                    onClick={handleCopy}
                                                    className="p-1.5 text-[#082824] hover:bg-black/5 rounded-lg transition shrink-0"
                                                    title="Copy address"
                                                    aria-label="Copy deposit address"
                                                >
                                                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </div>

                                        {copied && (
                                            <p className="text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                                                Address copied to clipboard!
                                            </p>
                                        )}
                                    </div>
                                )}

                                {activeTab === "cctp" && (
                                    <div className="space-y-4 text-left">
                                        {/* An already-burned deposit we never managed to record. Shown above
                                            everything else because starting a second burn would be the wrong
                                            move, and it is the only thing on this pane that needs doing. */}
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

                                        {cctpStatus === "idle" || cctpStatus === "error" ? (
                                            <>
                                                {/* Source Chain Selector */}
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-black uppercase tracking-wider text-black/60">Source Network</span>
                                                    <div className="relative">
                                                        <button
                                                            type="button"
                                                            disabled={cctpInProgress}
                                                            onClick={() => setOriginMenuOpen(!originMenuOpen)}
                                                            className="flex w-full items-center justify-between rounded-2xl border border-black/15 bg-white px-4 py-2.5 text-xs font-bold text-black shadow-sm disabled:opacity-60"
                                                        >
                                                            <div className="flex items-center gap-2.5">
                                                                <ChainLogo chain={selectedChainInfo.chainId} size={22} className="h-5 w-5" />
                                                                <div className="flex flex-col text-left">
                                                                    <span>{selectedChainInfo.name}</span>
                                                                    <span className="text-[10px] font-normal text-black/50">
                                                                        Fee: {selectedChainInfo.feePercentage} · Arrives in ~5 mins
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <ChevronDown className="h-4 w-4 text-black/40" />
                                                        </button>

                                                        {originMenuOpen && (
                                                            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl">
                                                                {cctpChains.map((chain) => (
                                                                    <button
                                                                        key={chain.chainId}
                                                                        type="button"
                                                                        disabled={cctpInProgress}
                                                                        onClick={() => {
                                                                            setSelectedOriginChainId(chain.chainId);
                                                                            setOriginMenuOpen(false);
                                                                        }}
                                                                        className={`flex w-full items-center justify-between p-2 rounded-xl text-xs transition ${
                                                                            chain.chainId === selectedChainInfo.chainId
                                                                                ? "bg-[#2775CA]/10 font-bold text-[#2775CA]"
                                                                                : "hover:bg-black/5 text-black"
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                                            <ChainLogo chain={chain.chainId} size={20} className="h-5 w-5" />
                                                                            <div className="min-w-0 text-left">
                                                                                <div className="truncate">{chain.name}</div>
                                                                                <div className="text-[10px] font-normal text-black/50">{chain.feePercentage} fee</div>
                                                                            </div>
                                                                        </div>
                                                                        {chain.chainId === selectedChainInfo.chainId && (
                                                                            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2775CA]" />
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Deposit Amount Input */}
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-black uppercase tracking-wider text-black/60">Amount to Deposit (USDC)</span>
                                                    <div className="relative">
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
                                                            className="w-full rounded-2xl border border-black/15 bg-white px-4 py-2.5 font-mono text-xs text-black shadow-sm focus:border-[#2775CA] focus:outline-none disabled:bg-black/5 disabled:cursor-not-allowed"
                                                        />
                                                    </div>
                                                </div>

                                                {/* Live Fee Breakdown */}
                                                {cctpQuote && (
                                                    <div className="rounded-2xl border border-black/10 bg-white p-3 space-y-1.5 text-xs shadow-sm">
                                                        <div className="flex justify-between text-black/70">
                                                            <span>You deposit</span>
                                                            <span className="font-mono font-bold">{formatMicros(cctpQuote.grossMicros)} USDC</span>
                                                        </div>
                                                        <div className="flex justify-between text-amber-800">
                                                            <span>Bridge fee ({cctpQuote.feePercentage})</span>
                                                            <span className="font-mono font-bold">-{formatMicros(cctpQuote.feeMicros, 4)} USDC</span>
                                                        </div>
                                                        <div className="flex justify-between border-t border-black/10 pt-1.5 font-bold text-black">
                                                            <span>Will arrive on Arc</span>
                                                            <span className="font-mono text-[#2775CA]">{formatMicros(cctpQuote.netMicros, 4)} USDC</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {cctpError && (
                                                    <p className="text-xs text-red-700 bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl">
                                                        {cctpError}
                                                    </p>
                                                )}

                                                <button
                                                    type="button"
                                                    disabled={cctpInProgress || !cctpQuote}
                                                    onClick={handleStartCctpDeposit}
                                                    className="w-full py-3 rounded-2xl bg-[#2775CA] text-white font-bold text-xs shadow-sm hover:bg-[#1f62ab] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    Deposit {cctpAmount ? `${cctpAmount} USDC` : ""}
                                                </button>
                                            </>
                                        ) : cctpStatus === "submitted" ? (
                                            <div className="py-6 flex flex-col items-center text-center space-y-3">
                                                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
                                                <h4 className="text-sm font-bold text-black">Deposit Initiated!</h4>
                                                <p className="text-xs text-black/60 leading-relaxed">
                                                    USDC on {selectedChainInfo.name} received, moving to Arc.. (Please wait for 5 minutes). You can close this window.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCctpStatus("idle");
                                                        setActiveTab("menu");
                                                    }}
                                                    className="mt-2 px-5 py-2 rounded-xl bg-[#353935] text-white text-xs font-bold"
                                                >
                                                    Done
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="py-6 flex flex-col items-center text-center space-y-4">
                                                <Loader2 className="w-10 h-10 animate-spin text-[#2775CA]" />
                                                <div>
                                                    <h4 className="text-sm font-bold text-black uppercase tracking-wider">Processing Deposit</h4>
                                                    <p className="text-xs text-black/60 mt-1">{cctpMessage}</p>
                                                </div>
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

