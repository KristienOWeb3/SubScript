"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, ArrowRight, Wallet, QrCode, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { createPublicClient, http, parseUnits, bytesToHex, keccak256 } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { SUBSCRIPT_ROUTER_ADDRESS, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";
import routerAbi from "@/lib/contracts/abi.json";

const ERC20_ABI = [
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    }
] as const;

const ROUTER_ABI = routerAbi;

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
}

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet,
    depositAddress,
    onSuccess,
}: DepositModalProps) {
    const [copied, setCopied] = useState(false);
    const [depositStep, setDepositStep] = useState<"approve" | "transfer">("approve");
    const [secret, setSecret] = useState<string | null>(null);
    const [commitmentHash, setCommitmentHash] = useState<string | null>(null);
    const [txLoading, setTxLoading] = useState(false);
    const [txStatus, setTxStatus] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);

    const { chainId, isConnected } = useAccount();
    const { switchChain } = useSwitchChain();
    const { writeContractAsync, isPending, isError, error } = useWriteContract();

    const handleCopy = async () => {
        await navigator.clipboard.writeText(depositAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleApprove = async () => {
        if (!agreed) {
            console.error("Terms not agreed.");
            return;
        }
        if (!isConnected) {
            console.error("Wallet not connected.");
            return;
        }

        if (chainId !== 5042002) {
            console.log("Not on Arc Testnet. Triggering switch to chain 5042002...");
            switchChain?.({ chainId: 5042002 });
            return;
        }

        setTxLoading(true);
        setTxStatus("Preparing approval...");

        try {
            let currentSecret = secret;
            let currentCommitmentHash = commitmentHash;

            if (!currentCommitmentHash) {
                const secBytes = new Uint8Array(32);
                crypto.getRandomValues(secBytes);
                const secHex = bytesToHex(secBytes);
                const comHash = keccak256(secHex);

                setSecret(secHex);
                setCommitmentHash(comHash);
                currentSecret = secHex;
                currentCommitmentHash = comHash;
            }

            const amount = parseUnits("1", 6);
            const merchantAddress = (!depositAddress || depositAddress === "0xYOUR_CONNECTED_WALLET_ADDRESS")
                ? "0xa84d917c48f05bffbe353d29e316b9fa096314f7"
                : depositAddress;

            console.log("Before writeContract (approve):", {
                amount: amount.toString(),
                merchantAddress,
                commitmentHash: currentCommitmentHash,
            });

            if (amount === undefined || merchantAddress === undefined || currentCommitmentHash === undefined) {
                console.error("Error: One or more arguments for approve are undefined:", {
                    amount,
                    merchantAddress,
                    commitmentHash: currentCommitmentHash,
                });
                throw new Error("Parameters cannot be undefined");
            }

            setTxStatus("Waiting for signature...");
            const hash = await writeContractAsync({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [SUBSCRIPT_ROUTER_ADDRESS, amount],
            });

            setTxStatus("Confirming approval...");
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log("Approval transaction confirmed:", receipt);

            setDepositStep("transfer");
        } catch (err) {
            console.error("Approval failed:", err);
        } finally {
            setTxLoading(false);
            setTxStatus(null);
        }
    };

    const handleTransfer = async () => {
        if (!agreed) {
            console.error("Terms not agreed.");
            return;
        }
        if (!isConnected) {
            console.error("Wallet not connected.");
            return;
        }

        if (chainId !== 5042002) {
            console.log("Not on Arc Testnet. Triggering switch to chain 5042002...");
            switchChain?.({ chainId: 5042002 });
            return;
        }

        if (!commitmentHash) {
            console.error("Commitment hash is missing.");
            return;
        }

        setTxLoading(true);
        setTxStatus("Preparing transfer...");

        try {
            const amount = parseUnits("1", 6);
            const merchantAddress = (!depositAddress || depositAddress === "0xYOUR_CONNECTED_WALLET_ADDRESS")
                ? "0xa84d917c48f05bffbe353d29e316b9fa096314f7"
                : depositAddress;

            console.log("Before writeContract (depositAndCommit):", {
                amount: amount.toString(),
                merchantAddress,
                commitmentHash,
            });

            if (amount === undefined || merchantAddress === undefined || commitmentHash === undefined) {
                console.error("Error: One or more arguments for depositAndCommit are undefined:", {
                    amount,
                    merchantAddress,
                    commitmentHash,
                });
                throw new Error("Parameters cannot be undefined");
            }

            setTxStatus("Waiting for signature...");
            const hash = await writeContractAsync({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "depositAndCommit",
                args: [commitmentHash as `0x${string}`, amount],
            });

            setTxStatus("Confirming transfer...");
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            resetAndClose();
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error("Transfer failed:", err);
        } finally {
            setTxLoading(false);
            setTxStatus(null);
        }
    };

    const resetAndClose = () => {
        setDepositStep("approve");
        setSecret(null);
        setCommitmentHash(null);
        setTxLoading(false);
        setTxStatus(null);
        setAgreed(false);
        onClose();
    };

    const isLoading = isPending || txLoading;
    const isWrongNetwork = chainId !== 5042002;

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
                        className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    >
                        <div
                            className="bg-dark-charcoal border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                                <h2 className="text-xl font-bold text-white">Deposit USDC</h2>
                                <button
                                    onClick={resetAndClose}
                                    className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                    aria-label="Close modal"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6">
                                <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-5 text-[11px] text-white/70 leading-relaxed font-sans space-y-2">
                                    <p className="font-bold text-white uppercase tracking-wider text-[10px] text-leetcode-teal">
                                        About this deposit
                                    </p>
                                    <p>
                                        This deposit is a sandbox protocol commitment of $1.00 USDC to secure recurring subscription transactions. By depositing, you lock these funds under the SubScript Smart Contract.
                                    </p>
                                    <div className="flex items-start gap-2 pt-2 border-t border-white/5 mt-2">
                                        <input
                                            type="checkbox"
                                            id="agree-checkbox"
                                            checked={agreed}
                                            onChange={(e) => setAgreed(e.target.checked)}
                                            className="mt-0.5 rounded border-white/10 bg-black text-[#00d2b4] focus:ring-0 cursor-pointer"
                                        />
                                        <label htmlFor="agree-checkbox" className="text-[10px] text-white/50 cursor-pointer select-none leading-snug">
                                            I agree to the <Link href="/terms" target="_blank" className="text-leetcode-teal underline hover:text-white transition">Terms of Service</Link> and <Link href="/privacy" target="_blank" className="text-leetcode-teal underline hover:text-white transition">Privacy Policy</Link>, and authorize this transaction.
                                        </label>
                                    </div>
                                </div>

                                {isEmbeddedWallet ? (
                                    <div className="text-center">
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-leetcode-teal/10 text-leetcode-teal rounded-full text-sm font-medium mb-6">
                                            <QrCode className="w-4 h-4" />
                                            Embedded Wallet
                                        </div>

                                        <p className="text-white/70 text-sm mb-6">
                                            Top up your SubScript balance by sending USDC to this
                                            address on <span className="text-white font-medium">Base</span>.
                                        </p>

                                        <div className={`p-4 rounded-xl inline-block mb-6 transition-all duration-300 relative ${agreed ? "bg-white" : "bg-white/5 filter blur-[6px] pointer-events-none"}`}>
                                            <QRCodeSVG
                                                value={depositAddress}
                                                size={180}
                                                level="H"
                                                includeMargin={false}
                                            />
                                            {!agreed && (
                                                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white/70 bg-black/40 rounded-xl">
                                                    Agree to terms to view QR
                                                </div>
                                            )}
                                        </div>

                                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                            <p className="text-xs text-white/50 uppercase tracking-wide mb-2">
                                                Your Deposit Address
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 text-sm text-white font-mono break-all">
                                                    {depositAddress}
                                                </code>
                                                <button
                                                    onClick={handleCopy}
                                                    disabled={!agreed}
                                                    className="p-2 text-leetcode-teal hover:bg-leetcode-teal/10 rounded-lg transition-colors shrink-0 disabled:opacity-30 disabled:pointer-events-none"
                                                    title="Copy address"
                                                >
                                                    {copied ? (
                                                        <Check className="w-5 h-5" />
                                                    ) : (
                                                        <Copy className="w-5 h-5" />
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {copied && (
                                            <motion.p
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="text-leetcode-teal text-sm mt-4"
                                            >
                                                Address copied to clipboard
                                            </motion.p>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-full text-sm font-medium mb-6">
                                            <Wallet className="w-4 h-4" />
                                            External Wallet
                                        </div>

                                        <div className="flex items-center gap-3 mb-8">
                                            <div
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${depositStep === "approve"
                                                    ? "bg-leetcode-teal text-white"
                                                    : "bg-white/5 text-white/50"
                                                    }`}
                                            >
                                                <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
                                                    1
                                                </span>
                                                Approve
                                            </div>
                                            <ArrowRight className="w-4 h-4 text-white/30" />
                                            <div
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${depositStep === "transfer"
                                                    ? "bg-leetcode-teal text-white"
                                                    : "bg-white/5 text-white/50"
                                                    }`}
                                            >
                                                <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
                                                    2
                                                </span>
                                                Transfer
                                            </div>
                                        </div>

                                        {depositStep === "approve" ? (
                                            <div>
                                                <p className="text-white/70 text-sm mb-6">
                                                    First, approve SubScript to spend your USDC. This is
                                                    a one-time approval.
                                                </p>

                                                <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
                                                    <label className="text-xs text-white/50 uppercase tracking-wide">
                                                        Amount to Deposit
                                                    </label>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <input
                                                            type="text"
                                                            value="1.00"
                                                            readOnly
                                                            className="flex-1 bg-transparent text-2xl font-bold text-white outline-none cursor-not-allowed"
                                                        />
                                                        <span className="text-white/60 font-medium">
                                                            USDC
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={handleApprove}
                                                    disabled={isLoading || !agreed}
                                                    className="w-full py-3 bg-leetcode-teal text-white font-semibold rounded-xl
                                                             hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                                                             transition-all duration-200 flex items-center justify-center gap-2"
                                                >
                                                    {isLoading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                                                    {isWrongNetwork 
                                                        ? "Switch to Arc Testnet" 
                                                        : isLoading 
                                                            ? (txStatus || "Processing...") 
                                                            : "Approve $1 USDC"}
                                                </button>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-white/70 text-sm mb-6">
                                                    Great! Now confirm the transfer to complete your
                                                    deposit.
                                                </p>

                                                <div className="bg-leetcode-teal/10 border border-leetcode-teal/20 rounded-xl p-4 mb-6">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-white/70">
                                                            You&apos;re depositing
                                                        </span>
                                                        <span className="text-xl font-bold text-white">
                                                            1.00 USDC
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={handleTransfer}
                                                    disabled={isLoading}
                                                    className="w-full py-3 bg-leetcode-teal text-white font-semibold rounded-xl
                                                             hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                                                             transition-all duration-200 flex items-center justify-center gap-2"
                                                >
                                                    {isLoading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                                                    {isWrongNetwork 
                                                        ? "Switch to Arc Testnet" 
                                                        : isLoading 
                                                            ? (txStatus || "Processing...") 
                                                            : "Deposit $1 USDC"}
                                                </button>
                                            </div>
                                        )}

                                        {isError && error && (
                                            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex flex-col gap-1.5 text-left">
                                                <span className="text-red-400 text-xs font-semibold uppercase tracking-wide">
                                                    Transaction Failed
                                                </span>
                                                <p className="text-red-200 text-xs font-mono break-all leading-relaxed whitespace-pre-wrap">
                                                    {error.message}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <p className="text-[10px] text-white/30 text-center mt-6">
                                    By depositing, you agree to our{" "}
                                    <Link href="/terms" target="_blank" className="underline hover:text-white/60 transition">Terms of Service</Link>{" "}
                                    and{" "}
                                    <Link href="/privacy" target="_blank" className="underline hover:text-white/60 transition">Privacy Policy</Link>.
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
