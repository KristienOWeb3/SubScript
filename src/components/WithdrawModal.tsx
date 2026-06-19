"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, ShieldCheck, ArrowRight, Loader2, Upload, FileText, CheckCircle2, Lock } from "lucide-react";
import { ethers } from "ethers";
import Link from "next/link";

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    vaultBalance: number;
    connectedAddress: string;
    payoutDestination: string | null;
    onConfirmWithdraw: (targetAddress: string) => Promise<void>;
    isWithdrawing: boolean;
    isPremium?: boolean;
}

export default function WithdrawModal({
    isOpen,
    onClose,
    vaultBalance,
    connectedAddress,
    payoutDestination,
    onConfirmWithdraw,
    isWithdrawing,
    isPremium = false,
}: WithdrawModalProps) {
    const [payoutMode, setPayoutMode] = useState<"single" | "batch">("single");
    const [destinationType, setDestinationType] = useState<"connected" | "configured" | "custom">("connected");
    const [customAddress, setCustomAddress] = useState("");
    const [confirmCustomAddress, setConfirmCustomAddress] = useState("");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    /* Manual entry state for batch mode */
    const [batchInputMode, setBatchInputMode] = useState<'csv' | 'manual'>('csv');
    const [manualRows, setManualRows] = useState<{address: string; amount: string}[]>([{address: '', amount: ''}, {address: '', amount: ''}]);

    /* Batch payout state */
    const [batchText, setBatchText] = useState("");
    const [batchRecipients, setBatchRecipients] = useState<{ address: string; amount: string }[]>([]);
    const [batchTotalUsdc, setBatchTotalUsdc] = useState(0);
    const [batchTotalMicro, setBatchTotalMicro] = useState(BigInt(0));
    const [invalidRows, setInvalidRows] = useState(0);
    const [combinedRows, setCombinedRows] = useState(0);
    const [isBatchExecuting, setIsBatchExecuting] = useState(false);
    const [batchSuccessResult, setBatchSuccessResult] = useState<any | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    /* Parse CSV or raw text list of recipients */
    const processBatchText = (text: string) => {
        setErrorMsg(null);
        setBatchSuccessResult(null);
        const lines = text.split(/\r?\n/);
        const recipientsMap = new Map<string, bigint>();
        let invalidCount = 0;
        let combinedCount = 0;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            const parts = line.split(/[;,\t\s]+/);
            if (parts.length < 2) {
                invalidCount++;
                continue;
            }

            const rawAddr = parts[0].trim();
            const rawAmt = parts[1].trim();

            if (!rawAddr.startsWith("0x") || rawAddr.length !== 42 || !ethers.isAddress(rawAddr)) {
                invalidCount++;
                continue;
            }

            const normalizedAddr = rawAddr.toLowerCase();
            const amtFloat = parseFloat(rawAmt);
            if (isNaN(amtFloat) || amtFloat <= 0) {
                invalidCount++;
                continue;
            }

            /* Convert to micro-USDC (6 decimals) */
            const amtMicro = BigInt(Math.round(amtFloat * 1000000));
            if (recipientsMap.has(normalizedAddr)) {
                recipientsMap.set(normalizedAddr, recipientsMap.get(normalizedAddr)! + amtMicro);
                combinedCount++;
            } else {
                recipientsMap.set(normalizedAddr, amtMicro);
            }
        }

        const list = Array.from(recipientsMap.entries()).map(([address, amount]) => ({
            address,
            amount: amount.toString()
        }));

        const total = Array.from(recipientsMap.values()).reduce((acc, val) => acc + val, BigInt(0));

        setBatchRecipients(list);
        setBatchTotalMicro(total);
        setBatchTotalUsdc(Number(total) / 1000000);
        setInvalidRows(invalidCount);
        setCombinedRows(combinedCount);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        setBatchText(text);
        processBatchText(text);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        setErrorMsg(null);
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 200 * 1024) {
            setErrorMsg("File size exceeds 200KB limit.");
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            setBatchText(text);
            processBatchText(text);
        };
        reader.readAsText(file);
    };

    const triggerFileSelect = () => {
        fileInputRef.current?.click();
    };

    const handleSingleConfirm = async () => {
        setErrorMsg(null);
        let target = "";

        if (destinationType === "connected") {
            target = connectedAddress;
        } else if (destinationType === "configured") {
            target = payoutDestination || "";
            if (!target) {
                setErrorMsg("No payout destination address configured on-chain.");
                return;
            }
        } else {
            target = customAddress.trim();
            if (!target.startsWith("0x") || target.length !== 42 || !ethers.isAddress(target)) {
                setErrorMsg("Please enter a valid 42-character Ethereum address (starting with 0x).");
                return;
            }
            if (target.toLowerCase() !== confirmCustomAddress.trim().toLowerCase()) {
                setErrorMsg("Confirmation address does not match. Please verify both inputs.");
                return;
            }
        }

        if (vaultBalance < 1.0) {
            setErrorMsg("Minimum withdrawal amount is 1.00 USDC.");
            return;
        }

        try {
            await onConfirmWithdraw(target);
        } catch (err: any) {
            setErrorMsg(err.message || "Withdrawal execution failed.");
        }
    };

    const handleBatchConfirm = async () => {
        setErrorMsg(null);
        setBatchSuccessResult(null);

        if (batchRecipients.length === 0) {
            setErrorMsg("Please specify at least one valid recipient.");
            return;
        }

        if (batchTotalUsdc > vaultBalance) {
            setErrorMsg("Insufficient funds: Total batch amount exceeds your vault balance.");
            return;
        }

        setIsBatchExecuting(true);

        try {
            const idempotencyKey = `batch-payout-ui-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            const response = await fetch("/api/premium/withdraw/batch", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    recipients: batchRecipients,
                    idempotencyKey
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Batch execution failed.");
            }

            setBatchSuccessResult(data);
            setBatchText("");
            setBatchRecipients([]);
            setBatchTotalMicro(BigInt(0));
            setBatchTotalUsdc(0);
            setCombinedRows(0);
            setInvalidRows(0);

        } catch (err: any) {
            setErrorMsg(err.message || "Batch payout failed.");
        } finally {
            setIsBatchExecuting(false);
        }
    };

    const resetStates = () => {
        setErrorMsg(null);
        setDestinationType("connected");
        setCustomAddress("");
        setConfirmCustomAddress("");
        setBatchText("");
        setBatchRecipients([]);
        setBatchTotalMicro(BigInt(0));
        setBatchTotalUsdc(0);
        setCombinedRows(0);
        setInvalidRows(0);
        setBatchSuccessResult(null);
        setPayoutMode("single");
        onClose();
    };

    const hasConfiguredPayout = !!payoutDestination && payoutDestination !== "0x0000000000000000000000000000000000000000";

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={resetStates}
                        className="fixed inset-0 bg-black/80 backdrop-blur-md"
                    />

                    {/* Modal container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", duration: 0.5 }}
                        className="relative w-full max-w-lg bg-[#0a0a0c] border border-white/5 rounded-[32px] p-6 sm:p-8 shadow-2xl overflow-hidden z-10 text-white"
                    >
                        {/* Background glowing glow */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-500/5 rounded-full blur-[80px] pointer-events-none" />

                        {/* Header */}
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center">
                                    <Wallet className="w-4 h-4 text-red-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold uppercase tracking-wider">Settlement Portal</h3>
                                    <p className="text-[10px] text-white/40 font-mono mt-0.5">Private Payout Routing</p>
                                </div>
                            </div>
                            <button
                                onClick={resetStates}
                                className="p-1.5 hover:bg-white/5 border border-transparent hover:border-white/10 rounded-xl transition-all text-white/50 hover:text-white"
                            >
                                <X className="w-4.5 h-4.5" />
                            </button>
                        </div>

                        {/* Vault Balance Display */}
                        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 mb-5 text-center">
                            <p className="text-[10px] text-white/35 uppercase font-bold tracking-widest leading-none mb-1.5">Claimable Balance</p>
                            <p className="text-2xl font-black text-white leading-none">
                                ${vaultBalance.toFixed(2)}
                                <span className="text-[10px] text-white/40 font-normal ml-1">USDC</span>
                            </p>
                        </div>

                        {/* Tab Switcher */}
                        <div className="flex bg-white/[0.02] border border-white/5 p-1 rounded-xl mb-6">
                            <button
                                type="button"
                                onClick={() => { setPayoutMode("single"); setErrorMsg(null); setBatchSuccessResult(null); }}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                                    payoutMode === "single"
                                        ? "bg-white/5 border border-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/70"
                                }`}
                            >
                                Single Withdrawal
                            </button>
                            <button
                                type="button"
                                onClick={() => { setPayoutMode("batch"); setErrorMsg(null); setBatchSuccessResult(null); }}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                                    payoutMode === "batch"
                                        ? "bg-white/5 border border-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/70"
                                }`}
                            >
                                Batch Payouts (CSV)
                            </button>
                        </div>

                        {payoutMode === "single" ? (
                            /* Single Withdrawal Interface */
                            <div>
                                {/* Destination Picker */}
                                <div className="space-y-3 mb-6 font-sans text-xs">
                                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1.5">Select Payout Target</p>
                                    
                                    <button
                                        type="button"
                                        onClick={() => { setDestinationType("connected"); setErrorMsg(null); }}
                                        className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                            destinationType === "connected"
                                                ? "border-[#00d2b4]/30 bg-[#00d2b4]/5 text-white"
                                                : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                        }`}
                                    >
                                        <div>
                                            <p className="font-semibold mb-0.5">Connected Merchant Wallet</p>
                                            <p className="text-[10px] font-mono opacity-50">{connectedAddress ? `${connectedAddress.slice(0, 10)}...${connectedAddress.slice(-8)}` : "None connected"}</p>
                                        </div>
                                        <ShieldCheck className={`w-4 h-4 ${destinationType === "connected" ? "text-[#00d2b4]" : "opacity-0"}`} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => { setDestinationType("configured"); setErrorMsg(null); }}
                                        disabled={!hasConfiguredPayout}
                                        className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                            !hasConfiguredPayout
                                                ? "opacity-40 cursor-not-allowed border-white/5 bg-white/[0.01]"
                                                : destinationType === "configured"
                                                    ? "border-[#00d2b4]/30 bg-[#00d2b4]/5 text-white"
                                                    : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                        }`}
                                    >
                                        <div>
                                            <p className="font-semibold mb-0.5">On-chain Payout Destination</p>
                                            <p className="text-[10px] font-mono opacity-50">
                                                {hasConfiguredPayout 
                                                    ? `${payoutDestination!.slice(0, 10)}...${payoutDestination!.slice(-8)}` 
                                                    : "No payout destination configured"
                                                }
                                            </p>
                                        </div>
                                        <ShieldCheck className={`w-4 h-4 ${destinationType === "configured" ? "text-[#00d2b4]" : "opacity-0"}`} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => { setDestinationType("custom"); setErrorMsg(null); }}
                                        className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                            destinationType === "custom"
                                                ? "border-[#00d2b4]/30 bg-[#00d2b4]/5 text-white"
                                                : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                        }`}
                                    >
                                        <div>
                                            <p className="font-semibold mb-0.5">Custom Payout Wallet Address</p>
                                            <p className="text-[10px] opacity-50">Route your settlement privately to any external wallet</p>
                                        </div>
                                        <ShieldCheck className={`w-4 h-4 ${destinationType === "custom" ? "text-[#00d2b4]" : "opacity-0"}`} />
                                    </button>

                                    <AnimatePresence>
                                        {destinationType === "custom" && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden space-y-2.5"
                                            >
                                                <input
                                                    type="text"
                                                    placeholder="Enter target wallet address (0x...)"
                                                    value={customAddress}
                                                    onChange={(e) => { setCustomAddress(e.target.value); setErrorMsg(null); }}
                                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4] transition-colors font-mono"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Confirm target wallet address (0x...)"
                                                    value={confirmCustomAddress}
                                                    onChange={(e) => { setConfirmCustomAddress(e.target.value); setErrorMsg(null); }}
                                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4] transition-colors font-mono"
                                                />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {vaultBalance < 1.0 && (
                                    <p className="text-amber-500 text-[10px] mb-4 font-semibold">Minimum withdrawal amount is 1.00 USDC.</p>
                                )}
                                {errorMsg && (
                                    <p className="text-red-400 text-[10px] mb-4 font-mono font-semibold">{errorMsg}</p>
                                )}

                                <button
                                    type="button"
                                    onClick={handleSingleConfirm}
                                    disabled={isWithdrawing || vaultBalance < 1.0}
                                    className="w-full py-3.5 bg-gradient-to-r from-red-500 to-pink-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                                >
                                    {isWithdrawing ? (
                                        <>
                                            Executing Private Withdrawal...
                                        </>
                                    ) : (
                                        <>
                                            Confirm Private Payout <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </div>
                        ) : (
                            /* Batch Payout Interface */
                            <div>
                                {!isPremium ? (
                                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-xl min-h-[300px] flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden bg-[#0a0a0c]/90 backdrop-blur-md z-20">
                                        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl">
                                            <Lock className="w-6 h-6" />
                                        </div>
                                        <div className="space-y-2">
                                            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Privacy Premium Feature</h3>
                                            <p className="text-[10px] text-white/55 max-w-xs leading-relaxed">
                                                High-throughput Batch Payouts via CSV upload are exclusive to the Privacy Premium tier. Upgrade your account to unlock batch withdrawals.
                                            </p>
                                        </div>
                                        <Link
                                            href="/dashboard/upgrade"
                                            onClick={resetStates}
                                            className="px-6 py-2.5 bg-[#d4a853] hover:brightness-105 text-black rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg shadow-[#d4a853]/15 text-center"
                                        >
                                            Upgrade Now
                                        </Link>
                                    </div>
                                ) : (
                                    <div>
                                        {/* Batch Input Mode Toggle */}
                                        <div className="flex items-center gap-2 mb-4">
                                            <button
                                                onClick={() => setBatchInputMode('csv')}
                                                className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-2 rounded-xl border transition-all ${
                                                    batchInputMode === 'csv'
                                                        ? 'bg-[#00d2b4]/10 border-[#00d2b4]/30 text-[#00d2b4]'
                                                        : 'bg-white/[0.02] border-white/5 text-white/40 hover:text-white/60'
                                                }`}
                                            >
                                                CSV Upload
                                            </button>
                                            <button
                                                onClick={() => setBatchInputMode('manual')}
                                                className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-2 rounded-xl border transition-all ${
                                                    batchInputMode === 'manual'
                                                        ? 'bg-[#00d2b4]/10 border-[#00d2b4]/30 text-[#00d2b4]'
                                                        : 'bg-white/[0.02] border-white/5 text-white/40 hover:text-white/60'
                                                }`}
                                            >
                                                Manual Entry
                                            </button>
                                        </div>

                                        {batchInputMode === 'manual' ? (
                                            <div className="space-y-3 mb-5">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Recipients ({manualRows.length})</span>
                                                    <button
                                                        onClick={() => setManualRows(prev => [...prev, {address: '', amount: ''}])}
                                                        className="text-[10px] text-[#00d2b4] font-bold hover:text-[#00d2b4]/80 transition-colors"
                                                    >
                                                        + Add Row
                                                    </button>
                                                </div>
                                                {manualRows.map((row, idx) => (
                                                    <div key={idx} className="flex gap-2 items-center">
                                                        <input
                                                            type="text"
                                                            placeholder="0x... recipient address"
                                                            value={row.address}
                                                            onChange={(e) => {
                                                                const updated = [...manualRows];
                                                                updated[idx].address = e.target.value;
                                                                setManualRows(updated);
                                                            }}
                                                            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4]/30 font-mono"
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="Amount (USDC)"
                                                            value={row.amount}
                                                            onChange={(e) => {
                                                                const updated = [...manualRows];
                                                                updated[idx].amount = e.target.value;
                                                                setManualRows(updated);
                                                            }}
                                                            className="w-28 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4]/30"
                                                        />
                                                        {manualRows.length > 1 && (
                                                            <button
                                                                onClick={() => setManualRows(prev => prev.filter((_, i) => i !== idx))}
                                                                className="text-white/20 hover:text-red-400 transition-colors p-1"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={() => {
                                                        const text = manualRows
                                                            .filter(r => r.address && r.amount)
                                                            .map(r => `${r.address},${r.amount}`)
                                                            .join('\n');
                                                        setBatchText(text);
                                                        processBatchText(text);
                                                    }}
                                                    className="w-full py-2.5 bg-[#00d2b4]/10 border border-[#00d2b4]/30 text-[#00d2b4] text-[10px] font-bold uppercase tracking-wider rounded-xl hover:bg-[#00d2b4]/20 transition-all"
                                                >
                                                    Process Recipients
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-4 mb-5">
                                                <div className="flex justify-between items-center">
                                                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Recipients & Amounts (CSV)</p>
                                                    <button
                                                        type="button"
                                                        onClick={triggerFileSelect}
                                                        className="flex items-center gap-1.5 text-[10px] text-red-400 hover:text-red-300 font-bold uppercase transition"
                                                    >
                                                        <Upload className="w-3.5 h-3.5" /> Upload CSV File
                                                    </button>
                                                    <input
                                                        type="file"
                                                        ref={fileInputRef}
                                                        onChange={handleFileUpload}
                                                        accept=".csv,.txt"
                                                        className="hidden"
                                                    />
                                                </div>

                                                <textarea
                                                    rows={5}
                                                    placeholder={"0xaddress1, 10.50\n0xaddress2, 25.00"}
                                                    value={batchText}
                                                    onChange={handleTextChange}
                                                    className="w-full bg-black border border-white/10 rounded-2xl p-4 text-xs font-mono text-white placeholder-white/15 focus:outline-none focus:border-red-500 transition-colors"
                                                />
                                                <p className="text-[9px] text-white/30 font-mono leading-normal mt-0.5">Format: one entry per line, comma or space separated. Example: 0x71C...8976F, 12.34</p>
                                            </div>
                                        )}

                                        {/* Batch Summary Panel */}
                                        {batchRecipients.length > 0 && (
                                            <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-4 mb-5 space-y-2.5 font-sans text-xs">
                                                <div className="flex justify-between">
                                                    <span className="text-white/40">Total Recipients:</span>
                                                    <span className="font-bold text-white">{batchRecipients.length}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-white/40">Total Payout Amount:</span>
                                                    <span className="font-bold text-red-400">${batchTotalUsdc.toFixed(2)} USDC</span>
                                                </div>
                                                {(invalidRows > 0 || combinedRows > 0) && (
                                                    <div className="pt-2 border-t border-white/5 flex gap-3 text-[9px] font-mono">
                                                        {combinedRows > 0 && (
                                                            <span className="text-amber-400 font-semibold">{combinedRows} duplicate entries merged</span>
                                                        )}
                                                        {invalidRows > 0 && (
                                                            <span className="text-red-400 font-semibold">{invalidRows} invalid rows ignored</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Success Receipt */}
                                        {batchSuccessResult && (
                                            <div className="bg-[#10b981]/5 border border-[#10b981]/15 rounded-2xl p-4 mb-5 text-xs text-white/80 space-y-2 flex flex-col items-center">
                                                <CheckCircle2 className="w-8 h-8 text-[#10b981] mb-1" />
                                                <p className="font-bold text-[#10b981] text-sm text-center">Batch Payout Executed!</p>
                                                <div className="w-full space-y-1.5 pt-2 border-t border-[#10b981]/10">
                                                    <div className="flex justify-between">
                                                        <span className="text-white/40">Batch Status:</span>
                                                        <span className="font-bold uppercase text-[#10b981]">{batchSuccessResult.status}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-white/40">Sent:</span>
                                                        <span>{batchSuccessResult.successfulCount} transfers</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-white/40">Failed:</span>
                                                        <span>{batchSuccessResult.failedCount} transfers</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {errorMsg && (
                                            <p className="text-red-400 text-[10px] mb-4 font-mono font-semibold">{errorMsg}</p>
                                        )}

                                        <button
                                            type="button"
                                            onClick={handleBatchConfirm}
                                            disabled={isBatchExecuting || batchRecipients.length === 0 || batchTotalUsdc > vaultBalance}
                                            className="w-full py-3.5 bg-gradient-to-r from-red-500 to-pink-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                                        >
                                            {isBatchExecuting ? (
                                                <>
                                                    Processing Batch Transfers...
                                                </>
                                            ) : (
                                                <>
                                                    Confirm Batch Payout <ArrowRight className="w-4 h-4" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
