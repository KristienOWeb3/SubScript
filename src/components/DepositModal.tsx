"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, ArrowRight, Wallet, QrCode, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { useAccount, useSwitchChain } from "wagmi";
import { useRouter } from "next/navigation";
import { createPublicClient, http, parseUnits, formatUnits, bytesToHex, keccak256 } from "viem";
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
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
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
    executeContractWrite: (params: {
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
    const router = useRouter();
    const [copied, setCopied] = useState(false);
    const [depositStep, setDepositStep] = useState<"approve" | "transfer">("approve");
    const [secret, setSecret] = useState<string | null>(null);
    const [commitmentHash, setCommitmentHash] = useState<string | null>(null);
    const [txLoading, setTxLoading] = useState(false);
    const [txStatus, setTxStatus] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    const [usdcBalance, setUsdcBalance] = useState("0.00");
    const [lastActive, setLastActive] = useState(Date.now());
    const [pollingTimeout, setPollingTimeout] = useState(false);

    const { chainId, isConnected } = useAccount();
    const { switchChain } = useSwitchChain();

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
        setLastActive(Date.now());
        setPollingTimeout(false);
        await fetchBalance();
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

    const handleApprove = async () => {
        if (!agreed) {
            console.error("Terms not agreed.");
            return;
        }
        if (isPrivacyDepositUnavailable) {
            setTxError("Privacy deposit routing is coming soon. This contract path is not deployed yet, so SubScript will not ask you to sign a transaction that would fail.");
            return;
        }
        if (!isConnected && !isEmbeddedWallet) {
            console.error("Wallet not connected.");
            return;
        }

        if (chainId !== 5042002 && !isEmbeddedWallet) {
            console.log("Not on Arc Testnet. Triggering switch to chain 5042002...");
            switchChain?.({ chainId: 5042002 });
            return;
        }

        setTxLoading(true);
        setTxStatus("Preparing approval...");
        setTxError(null);

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
            const hash = await executeContractWrite({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [SUBSCRIPT_ROUTER_ADDRESS, amount],
            });

            setTxStatus("Confirming approval...");
            let receipt;
            try {
                receipt = await publicClient.waitForTransactionReceipt({ 
                    hash: hash as `0x${string}`,
                    timeout: 60_000,
                });
            } catch (waitErr) {
                console.warn("waitForTransactionReceipt failed for approval, checking manually:", waitErr);
                try {
                    receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
                } catch (recErr) {
                    console.error("Failed to get approval receipt manually:", recErr);
                    throw waitErr;
                }
            }

            if (receipt && receipt.status === "reverted") {
                throw new Error("Approval transaction reverted on-chain.");
            }

            setDepositStep("transfer");
        } catch (err: any) {
            console.error("Approval failed:", err);
            setTxError(err.message || "Approval failed");
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
        if (isPrivacyDepositUnavailable) {
            setTxError("Privacy deposit routing is coming soon. Use regular Arc USDC payment flows until the depositAndCommit contract is deployed.");
            return;
        }
        if (!isConnected && !isEmbeddedWallet) {
            console.error("Wallet not connected.");
            return;
        }

        if (chainId !== 5042002 && !isEmbeddedWallet) {
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
        setTxError(null);

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
            const hash = await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "depositAndCommit",
                args: [commitmentHash as `0x${string}`, amount],
            });

            setTxStatus("Confirming transfer...");
            let receipt;
            try {
                receipt = await publicClient.waitForTransactionReceipt({ 
                    hash: hash as `0x${string}`,
                    timeout: 60_000,
                });
            } catch (waitErr) {
                console.warn("waitForTransactionReceipt failed for transfer, checking manually:", waitErr);
                try {
                    receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
                } catch (recErr) {
                    console.error("Failed to get transfer receipt manually:", recErr);
                    throw waitErr;
                }
            }

            if (receipt && receipt.status === "reverted") {
                throw new Error("Transaction reverted on-chain.");
            }

            /* Force immediate state refetch of ZK balance and Next.js page state refresh */
            await fetchBalance();
            router.refresh();

            resetAndClose();
            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error("Transfer failed:", err);
            setTxError(err.message || "Transfer failed");
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
        setTxError(null);
        onClose();
    };

    const isLoading = txLoading;
    const isWrongNetwork = chainId !== 5042002 && !isEmbeddedWallet;
    const isPrivacyDepositUnavailable = true;

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
                            className="bg-dark-charcoal border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                                <h2 className="text-lg font-bold text-white">Deposit USDC</h2>
                                <button
                                    onClick={resetAndClose}
                                    className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                    aria-label="Close modal"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-5">
                                <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-4 text-[10px] text-white/70 leading-relaxed font-sans space-y-1.5">
                                    <p className="font-bold text-white uppercase tracking-wider text-[9px] text-[#00d2b4]">
                                        About this deposit
                                    </p>
                                    <p>
                                        Privacy deposit routing is not live yet. We will enable this once the matching depositAndCommit contract is deployed on Arc.
                                    </p>
                                    <div className="flex items-center gap-2 pt-1.5 border-t border-white/5 mt-1.5">
                                        <input
                                            type="checkbox"
                                            id="agree-checkbox"
                                            checked={agreed}
                                            onChange={(e) => setAgreed(e.target.checked)}
                                            className="rounded border-white/10 bg-black text-[#00d2b4] focus:ring-0 cursor-pointer w-3 h-3"
                                        />
                                        <label htmlFor="agree-checkbox" className="text-[9px] text-white/50 cursor-pointer select-none leading-none">
                                            I agree to the <Link href="/terms" target="_blank" className="text-[#00d2b4] underline">Terms</Link> and authorize this transaction.
                                        </label>
                                    </div>
                                </div>

                                 {isEmbeddedWallet && parseFloat(usdcBalance) === 0 ? (
                                     <div className="text-center">
                                         <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#00d2b4]/10 text-[#00d2b4] rounded-full text-xs font-medium mb-3">
                                             <QrCode className="w-3.5 h-3.5" />
                                             Embedded Wallet
                                         </div>

                                         <p className="text-white/70 text-xs mb-3">
                                             Top up your SubScript balance by sending USDC to this
                                             address on <span className="text-white font-medium">Base</span>.
                                         </p>

                                         {/* Current Balance Indicator with manual Refresh */}
                                         <div className="text-center px-3 py-2 bg-white/[0.03] border border-white/5 rounded-xl mb-4 flex items-center justify-between">
                                             <div className="text-left">
                                                 <p className="text-[9px] text-white/35 uppercase font-bold tracking-widest leading-none mb-1">Current Balance</p>
                                                 <div className="flex items-baseline gap-1">
                                                     <span className="text-base font-bold text-white tracking-tight">
                                                         ${usdcBalance}
                                                     </span>
                                                     <span className="text-[10px] text-white/50 font-normal">USDC</span>
                                                 </div>
                                             </div>
                                             <div className="flex items-center gap-1.5">
                                                 {pollingTimeout ? (
                                                     <span className="text-[9px] text-yellow-500/70 font-medium">Polling paused</span>
                                                 ) : (
                                                     <span className="flex h-1.5 w-1.5 relative">
                                                         <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d2b4] opacity-75"></span>
                                                         <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00d2b4]"></span>
                                                     </span>
                                                 )}
                                                 <button
                                                     onClick={handleRefresh}
                                                     disabled={!agreed}
                                                     className="p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all flex items-center justify-center disabled:opacity-30"
                                                     title="Refresh balance"
                                                 >
                                                     <Loader2 className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                                                 </button>
                                             </div>
                                         </div>

                                         <div className={`p-3 rounded-xl inline-block mb-4 transition-all duration-300 relative ${agreed ? "bg-white" : "bg-white/5 filter blur-[6px] pointer-events-none"}`}>
                                             <QRCodeSVG
                                                 value={depositAddress}
                                                 size={130}
                                                 level="H"
                                                 includeMargin={false}
                                             />
                                             {!agreed && (
                                                 <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/70 bg-black/40 rounded-xl">
                                                     Agree to terms to view QR
                                                 </div>
                                             )}
                                         </div>

                                         <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                             <p className="text-[10px] text-white/50 uppercase tracking-wide mb-1">
                                                 Your Deposit Address
                                             </p>
                                             <div className="flex items-center gap-2">
                                                 <code className="flex-1 text-xs text-white font-mono break-all text-left">
                                                     {depositAddress}
                                                 </code>
                                                 <button
                                                     onClick={handleCopy}
                                                     disabled={!agreed}
                                                     className="p-1.5 text-[#00d2b4] hover:bg-[#00d2b4]/10 rounded-lg transition-colors shrink-0 disabled:opacity-30 disabled:pointer-events-none"
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
                                                 className="text-[#00d2b4] text-xs mt-3"
                                             >
                                                 Address copied to clipboard
                                             </motion.p>
                                         )}
                                     </div>
                                 ) : (
                                     <div>
                                         <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#00d2b4]/10 text-[#00d2b4] rounded-full text-xs font-medium mb-3">
                                             <Wallet className="w-3.5 h-3.5" />
                                             {isEmbeddedWallet ? "Embedded Wallet (Funded)" : "External Wallet"}
                                         </div>

                                         {/* Current Balance Indicator */}
                                         <div className="text-center px-3 py-2 bg-white/[0.03] border border-white/5 rounded-xl mb-4 flex items-center justify-between">
                                             <div className="text-left">
                                                 <p className="text-[9px] text-white/35 uppercase font-bold tracking-widest leading-none mb-1">Current Balance</p>
                                                 <div className="flex items-baseline gap-1">
                                                     <span className="text-base font-bold text-white tracking-tight">
                                                         ${usdcBalance}
                                                     </span>
                                                     <span className="text-[10px] text-white/50 font-normal">USDC</span>
                                                 </div>
                                             </div>
                                             <button
                                                 onClick={handleRefresh}
                                                 disabled={!agreed}
                                                 className="p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all flex items-center justify-center disabled:opacity-30"
                                                 title="Refresh balance"
                                             >
                                                 <Loader2 className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                                             </button>
                                         </div>

                                         <div className="flex items-center gap-2 mb-4 text-xs">
                                             <div
                                                 className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors ${depositStep === "approve"
                                                     ? "bg-[#00d2b4] text-[#111111] font-semibold"
                                                     : "bg-white/5 text-white/50"
                                                     }`}
                                             >
                                                 <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
                                                     1
                                                 </span>
                                                 Approve
                                             </div>
                                             <ArrowRight className="w-3 h-3 text-white/30" />
                                             <div
                                                 className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors ${depositStep === "transfer"
                                                     ? "bg-[#00d2b4] text-[#111111] font-semibold"
                                                     : "bg-white/5 text-white/50"
                                                     }`}
                                             >
                                                 <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
                                                     2
                                                 </span>
                                                 Transfer
                                             </div>
                                         </div>

                                         {depositStep === "approve" ? (
                                             <div>
                                                 <p className="text-white/70 text-xs mb-4">
                                                     First, approve SubScript to spend your USDC. This is
                                                     a one-time approval.
                                                 </p>

                                                 <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-4">
                                                     <label className="text-[10px] text-white/50 uppercase tracking-wide">
                                                         Amount to Deposit
                                                     </label>
                                                     <div className="flex items-baseline gap-2 mt-1">
                                                         <input
                                                             type="text"
                                                             value="1.00"
                                                             readOnly
                                                             className="flex-1 bg-transparent text-xl font-bold text-white outline-none cursor-not-allowed border-0 p-0 focus:ring-0"
                                                         />
                                                         <span className="text-xs text-white/60 font-medium">
                                                             USDC
                                                         </span>
                                                     </div>
                                                 </div>

                                                 <button
                                                     onClick={handleApprove}
                                                     disabled={isLoading || !agreed || isPrivacyDepositUnavailable}
                                                     className="w-full py-2.5 bg-[#00d2b4] text-[#111111] font-semibold rounded-xl
                                                              hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                                                              transition-all duration-200 flex items-center justify-center gap-2 text-xs uppercase tracking-wider font-bold"
                                                 >
                                                     {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                                                     {isWrongNetwork 
                                                         ? "Switch to Arc Testnet" 
                                                         : isLoading 
                                                             ? (txStatus || "Processing...") 
                                                             : isPrivacyDepositUnavailable
                                                                 ? "Privacy Deposit Coming Soon"
                                                                 : "Approve $1 USDC"}
                                                 </button>
                                             </div>
                                         ) : (
                                             <div>
                                                 <p className="text-white/70 text-xs mb-4">
                                                     Great! Now confirm the transfer to complete your
                                                     deposit.
                                                 </p>

                                                 <div className="bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-xl p-3 mb-4">
                                                     <div className="flex items-center justify-between text-xs">
                                                         <span className="text-white/70">
                                                             You&apos;re depositing
                                                         </span>
                                                         <span className="text-base font-bold text-white">
                                                             1.00 USDC
                                                         </span>
                                                     </div>
                                                 </div>

                                                 <button
                                                     onClick={handleTransfer}
                                                     disabled={isLoading || isPrivacyDepositUnavailable}
                                                     className="w-full py-2.5 bg-[#00d2b4] text-[#111111] font-semibold rounded-xl
                                                              hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                                                              transition-all duration-200 flex items-center justify-center gap-2 text-xs uppercase tracking-wider font-bold"
                                                 >
                                                     {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                                                     {isWrongNetwork 
                                                         ? "Switch to Arc Testnet" 
                                                         : isLoading 
                                                             ? (txStatus || "Processing...") 
                                                             : isPrivacyDepositUnavailable
                                                                 ? "Privacy Deposit Coming Soon"
                                                                 : "Deposit $1 USDC"}
                                                 </button>
                                             </div>
                                         )}

                                          {txError && (
                                             <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex flex-col gap-1 text-left">
                                                 <span className="text-red-400 text-[10px] font-semibold uppercase tracking-wide">
                                                     Transaction Failed
                                                 </span>
                                                 <p className="text-red-200 text-[10px] font-mono break-all leading-relaxed whitespace-pre-wrap">
                                                     {txError}
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
