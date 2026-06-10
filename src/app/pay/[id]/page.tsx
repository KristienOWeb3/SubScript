"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useWriteContract, useBalance, useWaitForTransactionReceipt } from "wagmi";
import { injected } from "wagmi/connectors";
import { formatUnits } from "viem";
import { 
    Loader2, CheckCircle, AlertTriangle, 
    Wallet, ExternalLink, ArrowRight, Lock
} from "lucide-react";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { 
    SUBSCRIPT_ROUTER_ADDRESS, 
    USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";

export default function PublicPayPage() {
    const params = useParams();
    const id = params?.id as string;

    const { address, isConnected } = useAccount();
    const { connect, connectors, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();

    const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [verifiedHash, setVerifiedHash] = useState<string | null>(null);

    const { data: balanceData } = useBalance({
        address: address,
        token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
    });

    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash: txHash,
    });

    const [linkData, setLinkData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isPaying, setIsPaying] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
    const [verificationError, setVerificationError] = useState<string | null>(null);
    const [successTxHash, setSuccessTxHash] = useState<string | null>(null);

    const requiredAmount = linkData ? BigInt(linkData.amount_usdc) : BigInt(0);
    const isInsufficientBalance = isConnected && balanceData && balanceData.value < requiredAmount;

    useEffect(() => {
        if (!id) return;
        const fetchLinkDetails = async () => {
            try {
                const res = await fetch(`/api/payment-links/${id}`);
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || "Failed to load payment link");
                }
                setLinkData(data.link);
            } catch (err: any) {
                setError(err.message || "Something went wrong");
            } finally {
                setIsLoading(false);
            }
        };
        fetchLinkDetails();
    }, [id]);

    const handleConnect = () => {
        connect({ connector: injected() });
    };

    const handlePay = async () => {
        if (!linkData || !address) return;
        setVerificationError(null);
        setVerificationStatus(null);
        setIsPaying(true);

        try {
            const hash = await writeContractAsync({
                address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
                abi: USDC_ERC20_ABI,
                functionName: "transfer",
                args: ["0x6946B7746c2968B195BD15319D25F67E587CAe3C", BigInt(linkData.amount_usdc)],
            });

            setTxHash(hash);
            setSuccessTxHash(hash);
            setIsVerifying(true);
            setVerificationStatus("Transaction submitted. Waiting for confirmation on the Arc Network...");

        } catch (err: any) {
            setVerificationError(err.message || "Payment transaction failed");
            setIsPaying(false);
            setIsVerifying(false);
        }
    };

    useEffect(() => {
        if (isConfirmed && txHash && linkData && address && verifiedHash !== txHash) {
            setVerifiedHash(txHash);
            
            const verifyPayment = async () => {
                try {
                    /* Submit verification job */
                    const verifyRes = await fetch("/api/payment-links/verify", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            txHash,
                            paymentLinkId: linkData.id,
                            payerAddress: address || ""
                        })
                    });

                    if (!verifyRes.ok) {
                        const verifyData = await verifyRes.json();
                        throw new Error(verifyData.error || "Failed to initiate verification");
                    }

                    /* Subscribe to real-time status stream via SSE */
                    const eventSource = new EventSource(`/api/payment-links/verify/status?txHash=${txHash}`);
                    
                    eventSource.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.status === "PENDING_CONFIRMATIONS") {
                                setVerificationStatus(`Confirming: Received ${data.confirmations} block confirmations...`);
                            } else if (data.status === "VERIFYING") {
                                setVerificationStatus("Transaction confirmed. Verifying parameters...");
                            } else if (data.status === "CONFIRMED") {
                                setVerificationStatus("Payment confirmed and settled successfully!");
                                setIsVerifying(false);
                                setIsPaying(false);
                                eventSource.close();
                            } else if (data.status === "FAILED") {
                                setVerificationError(data.errorMessage || "Payment verification failed");
                                setIsVerifying(false);
                                setIsPaying(false);
                                eventSource.close();
                            }
                        } catch (e) {
                            console.error("Error parsing event data:", e);
                        }
                    };

                    eventSource.onerror = (err) => {
                        console.error("EventSource connection error:", err);
                        eventSource.close();
                        setVerificationError("Real-time stream disconnected. Please verify on explorer.");
                        setIsVerifying(false);
                        setIsPaying(false);
                    };

                } catch (err: any) {
                    setVerificationError(err.message || "Payment verification failed");
                    setIsPaying(false);
                    setIsVerifying(false);
                }
            };

            verifyPayment();
        }
    }, [isConfirmed, txHash, linkData, address, verifiedHash]);

    return (
        <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4] flex items-center justify-center p-6 relative font-sans">
            <AnimatedGradientBg />
            
            <div className="relative z-10 w-full max-w-md">
                {/* Brand Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">checkout</span>
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
                </div>

                {isLoading ? (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
                        <p className="text-xs text-white/40 uppercase tracking-wider mt-4">Loading purchase details...</p>
                    </div>
                ) : error ? (
                    <div className="liquid-glass border border-red-500/20 rounded-3xl p-8 shadow-2xl bg-red-500/[0.02] flex flex-col items-center justify-center text-center gap-6 py-12">
                        <div className="p-4 rounded-3xl bg-red-500/10 border border-red-500/20 text-red-400">
                            <AlertTriangle className="w-10 h-10" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-base font-bold text-white uppercase tracking-wider">Checkout Error</h2>
                            <p className="text-xs text-white/50 leading-relaxed max-w-xs">
                                {error}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40">
                        {/* Status / Expiration Badge */}
                        {linkData.expires_at && (
                            <div className="flex justify-end">
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">
                                    Expires: {new Date(linkData.expires_at).toLocaleDateString()}
                                </span>
                            </div>
                        )}

                        {/* Product Information */}
                        <div className="space-y-2">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">You are paying for</span>
                            <h2 className="text-2xl font-extrabold text-white tracking-tight">{linkData.title}</h2>
                            {linkData.description && (
                                <p className="text-xs text-white/50 leading-relaxed font-sans">{linkData.description}</p>
                            )}
                        </div>

                        {/* Amount Panel */}
                        <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex justify-between items-center">
                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Amount Due</span>
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-[#00d2b4] tracking-tight">
                                    ${(Number(linkData.amount_usdc) / 1000000).toFixed(2)}
                                </p>
                                <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest font-mono">USDC (Arc Network)</p>
                            </div>
                        </div>

                        {/* Wallet Section */}
                        {!isConnected ? (
                            <div className="space-y-4">
                                <p className="text-[10px] text-white/40 text-center leading-relaxed font-sans">
                                    Connect your browser wallet (e.g. MetaMask, Rabby) on the Arc Testnet to complete the payment.
                                </p>
                                <button
                                    onClick={handleConnect}
                                    className="w-full py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                >
                                    <Wallet className="w-4 h-4" />
                                    Connect Wallet
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Wallet Info */}
                                <div className="flex flex-col gap-1.5 border-t border-b border-white/5 py-3 text-[10px] font-mono text-white/40">
                                    <div className="flex items-center justify-between">
                                        <span>Payer: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""}</span>
                                        <button type="button" onClick={() => disconnect()} className="hover:text-white transition-colors uppercase font-bold">Disconnect</button>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-white/60">
                                        <span>Available Balance:</span>
                                        <span className="font-bold text-[#00d2b4]">
                                            {balanceData ? `${parseFloat(balanceData.formatted).toFixed(2)} USDC` : "0.00 USDC"}
                                        </span>
                                    </div>
                                </div>

                                {verificationStatus ? (
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                                        {isVerifying ? (
                                            <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                                        ) : (
                                            <CheckCircle className="w-8 h-8 text-emerald-400" />
                                        )}
                                        <p className="text-xs font-semibold text-white/80 leading-relaxed">{verificationStatus}</p>
                                        {successTxHash && (
                                            <a 
                                                href={`https://explorer.testnet.arc.network/tx/${successTxHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[9px] font-mono text-[#00d2b4] hover:underline flex items-center gap-1"
                                            >
                                                View Tx on Explorer <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {verificationError && (
                                            <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl text-left">
                                                <span className="text-red-400 text-[9px] font-bold uppercase tracking-wide block">Payment Failed</span>
                                                <p className="text-red-200/70 text-[10px] font-mono mt-1 leading-normal break-words">{verificationError}</p>
                                            </div>
                                        )}
                                        
                                        {isInsufficientBalance ? (
                                            <button
                                                type="button"
                                                disabled={true}
                                                className="w-full py-4 border border-red-500/20 bg-red-500/[0.02] text-red-400 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-not-allowed"
                                            >
                                                Insufficient USDC Balance
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handlePay}
                                                disabled={isPaying || isConfirming}
                                                className="w-full py-4 bg-gradient-to-r from-[#00d2b4] to-blue-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                            >
                                                {(isPaying || isConfirming) ? (
                                                    <>
                                                        <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                                                    </>
                                                ) : (
                                                    <>
                                                        Pay ${(Number(linkData.amount_usdc) / 1000000).toFixed(2)} USDC <ArrowRight className="w-4 h-4" />
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Footer Security Note */}
                        <div className="pt-2 flex items-center justify-center gap-1.5 text-[9px] text-white/30 font-sans">
                            <Lock className="w-3 h-3" /> Securely routed via SubScript Router protocol
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
