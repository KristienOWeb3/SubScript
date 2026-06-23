"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useWriteContract, useBalance, useWaitForTransactionReceipt, useChainId, useSwitchChain, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { 
    Loader2, CheckCircle, AlertTriangle, AlertCircle,
    Wallet, ExternalLink, ArrowRight, Lock, Zap, QrCode, Shield, ShieldAlert
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { 
    SUBSCRIPT_ROUTER_ADDRESS, 
    USDC_NATIVE_GAS_ADDRESS,
    ARC_TESTNET_CHAIN_ID,
    CCTP_CONFIG,
    ARC_CCTP_DOMAIN_ID,
    isProd
} from "@/lib/contracts/constants";
import { USDC_ERC20_ABI } from "@/lib/contracts/abis";
import { ROUTER_DEPOSIT_ABI, isReceiptId, receiptUrl } from "@/lib/arc/memo";

export interface PublicPayClientProps {
    id: string;
    initialLinkData?: any;
    displayCurrency?: string;
    displayAmount?: number;
    exchangeRate?: number;
}

export default function PublicPayClient({ 
    id, 
    initialLinkData,
    displayCurrency = "USD",
    displayAmount,
    exchangeRate = 1.0
}: PublicPayClientProps) {
    const router = useRouter();
    const routedIntentRef = useRef<string | null>(null);
    const getFiatSymbol = (currency: string) => {
        switch (currency.toUpperCase()) {
            case "EUR": return "€";
            case "GBP": return "£";
            case "JPY": return "¥";
            case "NGN": return "₦";
            case "INR": return "₹";
            default: return "$";
        }
    };
    const fiatSymbol = getFiatSymbol(displayCurrency);
    const { address, isConnected } = useAccount();
    const { connect, connectors, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();
    const chainId = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const publicClient = usePublicClient();

    const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [verifiedHash, setVerifiedHash] = useState<string | null>(null);
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [showQrCode, setShowQrCode] = useState(false);
    const [checkoutUrl, setCheckoutUrl] = useState("");
    const [merchantVerified, setMerchantVerified] = useState<boolean | null>(null);
    const [showUnverifiedWarning, setShowUnverifiedWarning] = useState(false);
    const [unverifiedAccepted, setUnverifiedAccepted] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setCheckoutUrl(window.location.href);
        }
    }, [id]);

    const { data: balanceData } = useBalance({
        address: address,
        token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
    });

    const { data: txReceipt, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash: txHash,
    });

    const [linkData, setLinkData] = useState<any>(initialLinkData);
    const [isLoading, setIsLoading] = useState(!initialLinkData);
    const [error, setError] = useState<string | null>(null);
    const isLinkExhausted = linkData?.max_uses != null && linkData.use_count >= linkData.max_uses;

    /* Derived variables */
    const isUserRequest = linkData?.merchant_name_snapshot === "SubScript user request" ||
        linkData?.external_reference?.startsWith("peer-request:") ||
        linkData?.external_reference?.startsWith("dm-peer-request:");

    const [isPaying, setIsPaying] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
    const [verificationError, setVerificationError] = useState<string | null>(null);
    const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
    const [receiptId, setReceiptId] = useState<string | null>(null);
    const [shareableReceiptUrl, setShareableReceiptUrl] = useState<string | null>(null);
    const [payerRole, setPayerRole] = useState<string | null>(null);
    const [isRoleMismatch, setIsRoleMismatch] = useState(false);

    /* Inbox DM creation states */
    const [isCreatingDm, setIsCreatingDm] = useState(false);
    const [dmError, setDmError] = useState<string | null>(null);

    /* Detect an existing SubScript session so we can offer "go to DMs" instead of
       forcing a fresh wallet connection. */
    const [sessionInfo, setSessionInfo] = useState<{ loggedIn: boolean; wallet?: string; email?: string | null; role?: string | null } | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetch("/api/auth/session")
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setSessionInfo(data); })
            .catch(() => { if (!cancelled) setSessionInfo(null); });
        return () => { cancelled = true; };
    }, []);

    /* Returning-payer email prompt: a wallet that already has a SubScript account but
       no email on file must supply one at checkout (it's required for receipts). */
    const [payerNeedsEmail, setPayerNeedsEmail] = useState(false);
    const [payerEmailInput, setPayerEmailInput] = useState("");
    const [payerEmailError, setPayerEmailError] = useState<string | null>(null);
    useEffect(() => {
        if (!address) {
            setPayerNeedsEmail(false);
            return;
        }
        let cancelled = false;
        fetch(`/api/payer-status?address=${address}`)
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setPayerNeedsEmail(Boolean(data?.exists) && !data?.hasEmail); })
            .catch(() => { if (!cancelled) setPayerNeedsEmail(false); });
        return () => { cancelled = true; };
    }, [address]);

    /* De-duplicate discovered wallet connectors (EIP-6963 can surface several). */
    const walletConnectors = (() => {
        const seen = new Set<string>();
        return connectors.filter((connector) => {
            const key = connector.name || connector.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    })();
    const hasInjectedProvider = typeof window !== "undefined" && Boolean((window as any).ethereum);
    const noWalletDetected = typeof window !== "undefined" && !hasInjectedProvider && walletConnectors.length <= 1;

    const handleGoToDms = async () => {
        if (!linkData?.id) return;
        setIsCreatingDm(true);
        setDmError(null);
        try {
            const dmRes = await fetch(`/api/payment-links/${linkData.id}/dm`, { method: "POST" });
            const dmData = await dmRes.json().catch(() => ({}));
            if (!dmRes.ok) {
                throw new Error(dmData.error || "Could not create SubScript DM");
            }
            router.push(dmData.dashboardUrl || `/user?tab=inbox&intent=${linkData.id}`);
        } catch (err: any) {
            setDmError(err.message || "Failed to initiate DM session. Please try again.");
            setIsCreatingDm(false);
        }
    };

    const defaultArcChainId = isProd ? 5042001 : 5042002;
    const expectedChainId = linkData?.chain_id ? Number(linkData.chain_id) : defaultArcChainId;
    const expectedChainName = expectedChainId === 5042001 ? "Arc Mainnet" : expectedChainId === 5042002 ? "Arc Testnet" : `Chain ${expectedChainId}`;

    const { data: arcBalanceData } = useBalance({
        address: address,
        token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
        chainId: expectedChainId,
    });

    const arcUsdcBalance = arcBalanceData ? arcBalanceData.value : BigInt(0);
    const invoiceAmount = linkData ? (linkData.amount_usdc ? BigInt(linkData.amount_usdc) : BigInt(linkData.amount || 0)) : BigInt(0);
    const requiredAmount = invoiceAmount;
    const hasSufficientArcBalance = arcBalanceData ? (arcUsdcBalance >= invoiceAmount) : true;

    const cctpOriginChainId = expectedChainId === 5042001 ? 1 : 11155111;
    const cctpOriginChainName = expectedChainId === 5042001 ? "Ethereum Mainnet" : "Ethereum Sepolia";
    const cctpCheckoutEnabled = false;

    const isCctpMode = cctpCheckoutEnabled && isConnected && !hasSufficientArcBalance;
    const isCctpChain = cctpCheckoutEnabled && isConnected && chainId === cctpOriginChainId;

    const isWrongChain = isConnected && (isCctpMode ? chainId !== cctpOriginChainId : chainId !== expectedChainId);
    const requiredChainId = isCctpMode ? cctpOriginChainId : expectedChainId;
    const requiredChainName = isCctpMode ? cctpOriginChainName : expectedChainName;

    const isInsufficientBalance = isConnected && (
        isCctpMode 
            ? (chainId === cctpOriginChainId && balanceData && balanceData.value < invoiceAmount)
            : (chainId === expectedChainId && balanceData && balanceData.value < invoiceAmount)
    );


    useEffect(() => {
        if (initialLinkData) {
            setLinkData(initialLinkData);
            setIsLoading(false);
            return;
        }
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
    }, [id, initialLinkData]);

    useEffect(() => {
        if (!linkData?.merchant_address) return;

        const fetchMerchantVerification = async () => {
            try {
                const mRes = await fetch(`/api/merchant/profile?address=${linkData.merchant_address}`);
                if (mRes.ok) {
                    const mData = await mRes.json();
                    setMerchantVerified(mData.isUser ? null : mData.verified === true);
                }
            } catch {
                /* Verification badges are advisory; payment validation remains server-side. */
            }
        };

        fetchMerchantVerification();
    }, [linkData?.merchant_address]);

    useEffect(() => {
        if (!address) {
            setPayerRole(null);
            setIsRoleMismatch(false);
            return;
        }

        const checkRole = async () => {
            try {
                const res = await fetch("/api/auth/check-account", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address }),
                });
                const data = await res.json();
                if (data.exists && data.role) {
                    setPayerRole(data.role);
                    if (data.role === "ENTERPRISE") {
                        setIsRoleMismatch(true);
                    } else {
                        setIsRoleMismatch(false);
                    }
                } else {
                    setPayerRole(null);
                    setIsRoleMismatch(false);
                }
            } catch (err) {
                console.error("Error checking account role:", err);
            }
        };

        checkRole();
    }, [address]);

    const handleConnect = () => {
        const connector = connectors.find((item) => item.id === "injected") || connectors[0];
        if (!connector) {
            setVerificationError("No browser wallet connector is available. Install or unlock a wallet extension, then try again.");
            return;
        }
        connect({ connector });
    };

    const handleSwitchChain = async () => {
        try {
            await switchChainAsync({ chainId: requiredChainId });
        } catch (err: any) {
            setVerificationError(`Failed to switch network: ${err.message || "User rejected the request"}`);
        }
    };

    const handlePay = async () => {
        if (!linkData || !address) return;
        setVerificationError(null);
        setVerificationStatus(null);
        setPayerEmailError(null);

        /* Returning payer must provide an email before paying. */
        if (payerNeedsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmailInput.trim())) {
            setPayerEmailError("Enter a valid email to continue.");
            return;
        }

        /* Strict production burn safeguard */
        if (!isProd && chainId === 1) {
            throw new Error("Production burn safeguard: Cannot bridge from Ethereum Mainnet in a testnet environment.");
        }

        /* Guard: prevent network mismatches based on the current mode (CCTP vs Direct) */
        if (isCctpMode ? !isCctpChain : chainId !== expectedChainId) {
            setVerificationError(`Wrong network detected. Please switch to ${requiredChainName} before paying.`);
            return;
        }

        const checkoutReceiptId = linkData.receipt_token;
        if (!isReceiptId(checkoutReceiptId)) {
            setVerificationError("This checkout session is missing a valid receipt token. Please ask the merchant to generate a new payment link.");
            return;
        }
        setReceiptId(checkoutReceiptId);

        setIsPaying(true);

        if (isCctpChain && chainId) {
            /* CCTP Payment Flow */
            try {
                const cctpConfig = CCTP_CONFIG[chainId];
                setVerificationStatus("Initiating CCTP transaction on origin chain...");

                /* Step 1: Approve USDC spend by TokenMessenger */
                setVerificationStatus("Approving USDC spend for CCTP TokenMessenger...");
                const approveHash = await writeContractAsync({
                    address: cctpConfig.usdc,
                    abi: USDC_ERC20_ABI,
                    functionName: "approve",
                    args: [cctpConfig.tokenMessenger, requiredAmount],
                });

                /* Wait for approval transaction receipt */
                setVerificationStatus("Waiting for approval transaction confirmation...");
                if (publicClient) {
                    const approveReceipt = await publicClient.waitForTransactionReceipt({
                        hash: approveHash,
                        timeout: 120_000,
                    });
                    if (approveReceipt.status !== "success") {
                        throw new Error("USDC approval transaction reverted.");
                    }
                } else {
                    /* Fallback: wait 15 seconds if publicClient is unavailable */
                    await new Promise((resolve) => setTimeout(resolve, 15000));
                }

                /* Step 2: Call depositForBurn */
                setVerificationStatus("Initiating cross-chain deposit for burn via CCTP...");
                const mintRecipientBytes32 = ("0x" + SUBSCRIPT_ROUTER_ADDRESS.slice(2).padStart(64, "0")) as `0x${string}`;
                
                const cctpHash = await writeContractAsync({
                    address: cctpConfig.tokenMessenger,
                    abi: [
                        {
                            type: "function",
                            name: "depositForBurn",
                            stateMutability: "nonpayable",
                            inputs: [
                                { name: "amount", type: "uint256" },
                                { name: "destinationDomain", type: "uint32" },
                                { name: "mintRecipient", type: "bytes32" },
                                { name: "burnToken", type: "address" },
                            ],
                            outputs: [{ name: "nonce", type: "uint64" }],
                        },
                    ],
                    functionName: "depositForBurn",
                    args: [requiredAmount, ARC_CCTP_DOMAIN_ID, mintRecipientBytes32, cctpConfig.usdc],
                });

                setTxHash(cctpHash);
                setSuccessTxHash(cctpHash);
                setShareableReceiptUrl(receiptUrl(checkoutReceiptId, window.location.origin));
                setIsVerifying(true);
                setVerificationStatus("CCTP transaction submitted. Waiting for confirmation...");
                setIsPaying(false);

            } catch (err: any) {
                setVerificationError(err.message || "CCTP payment execution failed");
                setIsPaying(false);
                setIsVerifying(false);
            }
        } else {
            /* Native Arc Network Payment Flow */
            try {
                const nextReceiptId = receiptId || checkoutReceiptId;
                setReceiptId(nextReceiptId);

                const currentAllowance = publicClient
                    ? await publicClient.readContract({
                        address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
                        abi: USDC_ERC20_ABI,
                        functionName: "allowance",
                        args: [address as `0x${string}`, SUBSCRIPT_ROUTER_ADDRESS],
                    })
                    : BigInt(0);

                if (BigInt(currentAllowance) < BigInt(linkData.amount_usdc)) {
                    setVerificationStatus("Approving merchant payment route...");
                    const approvalHash = await writeContractAsync({
                        address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
                        abi: USDC_ERC20_ABI,
                        functionName: "approve",
                        args: [SUBSCRIPT_ROUTER_ADDRESS, BigInt(linkData.amount_usdc)],
                    });

                    if (publicClient) {
                        const approvalReceipt = await publicClient.waitForTransactionReceipt({
                            hash: approvalHash,
                            timeout: 120_000,
                        });
                        if (approvalReceipt.status !== "success") {
                            throw new Error("USDC approval for merchant payment reverted.");
                        }
                    }
                }

                setVerificationStatus("Routing payment to merchant...");
                const hash = await writeContractAsync({
                    address: SUBSCRIPT_ROUTER_ADDRESS as `0x${string}`,
                    abi: ROUTER_DEPOSIT_ABI,
                    functionName: "depositForMerchant",
                    args: [linkData.merchant_address as `0x${string}`, BigInt(linkData.amount_usdc), nextReceiptId],
                });

                setTxHash(hash);
                setSuccessTxHash(hash);
                setShareableReceiptUrl(receiptUrl(nextReceiptId, window.location.origin));
                setIsVerifying(true);
                setVerificationStatus("Transaction submitted. Waiting for confirmation on the Arc Network...");

            } catch (err: any) {
                setVerificationError(err.message || "Payment transaction failed");
                setIsPaying(false);
                setIsVerifying(false);
            }
        }
    };

    useEffect(() => {
        if (isConfirmed && txReceipt && txHash && linkData && address && verifiedHash !== txHash) {
            if (txReceipt.status !== "success") {
                setVerificationError("On-chain transaction reverted or failed.");
                setIsPaying(false);
                setIsVerifying(false);
                return;
            }
            setVerifiedHash(txHash);
            
            /* Show high-fidelity toast notification */
            setToastMessage("Payment Confirmed");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 4000);

            const verifyPayment = async () => {
                try {
                    /* Submit verification job */
                    const verifyRes = await fetch("/api/payment-links/verify", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            txHash,
                            paymentLinkId: linkData.id,
                            payerAddress: address || "",
                            receiptId,
                            chainId: chainId,
                            payerEmail: payerEmailInput.trim() || undefined
                        })
                    });

                    if (!verifyRes.ok) {
                        const verifyData = await verifyRes.json();
                        throw new Error(verifyData.error || "Failed to initiate verification");
                    }

                    /* Subscribe to real-time status stream via SSE */
                    const eventSource = new EventSource(`/api/payment-links/verify/status?txHash=${txHash}`);
                    
                    eventSource.addEventListener("status", (event) => {
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
                    });

                    eventSource.onerror = (err) => {
                        console.error("EventSource connection error:", err);
                        eventSource.close();
                        setVerificationError("Real-time stream disconnected. Please verify on explorer.");
                        setIsVerifying(false);
                        setIsPaying(false);
                    };

                } catch (err: any) {
                    setVerificationError(err.message || "Payment verification failed");
                    setIsVerifying(false);
                    setIsPaying(false);
                }
            };

            verifyPayment();
        }
    }, [isConfirmed, txHash, linkData, address, verifiedHash, chainId, receiptId]);

    return (
        <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4] flex items-center justify-center p-6 relative font-sans">
            <AnimatedGradientBg />
            
            <div className="relative z-10 w-full max-w-md">

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

                        {/* Role Mismatch Warning Banner */}
                        {isRoleMismatch && (
                            <div className="bg-red-500/[0.06] border border-red-500/25 rounded-2xl p-4 space-y-3">
                                <div className="flex items-start gap-3">
                                    <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-red-300 uppercase tracking-wide">Role Mismatch</p>
                                        <p className="text-[10px] text-white/50 leading-relaxed">
                                            This wallet is registered as a Merchant (Enterprise) account. Only standard User accounts can use this payment link to pay and start a DM. Please switch to a user wallet to proceed.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Unverified Merchant Warning Banner */}
                        {merchantVerified === false && !unverifiedAccepted && !isUserRequest && (
                            <div className="bg-amber-500/[0.06] border border-amber-500/25 rounded-2xl p-4 space-y-3">
                                <div className="flex items-start gap-3">
                                    <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-amber-300 uppercase tracking-wide">Unverified Merchant</p>
                                        <p className="text-[10px] text-white/50 leading-relaxed">
                                            This merchant has not been verified by SubScript. Proceed with caution and ensure you trust the payment recipient.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setUnverifiedAccepted(true)}
                                    className="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-300 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
                                >
                                    I understand the risk, continue
                                </button>
                            </div>
                        )}

                        {/* Verified Merchant Badge */}
                        {merchantVerified === true && (
                            <div className="flex items-center gap-2 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl px-3 py-2">
                                <Shield className="w-4 h-4 text-emerald-400" />
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">SubScript Verified Merchant</span>
                            </div>
                        )}

                        {/* Payment Link Exhausted */}
                        {isLinkExhausted && (
                            <div className="bg-red-500/[0.06] border border-red-500/25 rounded-2xl p-5 flex flex-col items-center justify-center text-center gap-3">
                                <AlertTriangle className="w-8 h-8 text-red-400" />
                                <p className="text-xs font-bold text-red-300 uppercase tracking-wide">Payment Link Exhausted</p>
                                <p className="text-[10px] text-white/40 leading-relaxed">This payment link has reached its maximum number of uses and is no longer accepting payments.</p>
                            </div>
                        )}

                        {linkData.expires_at && (
                            <div className="flex justify-end">
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">
                                    Expires: {new Date(linkData.expires_at).toLocaleDateString()}
                                </span>
                            </div>
                        )}


                        <div className="space-y-2">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">You are paying for</span>
                            <h2 className="text-2xl font-extrabold text-white tracking-tight">{linkData.title}</h2>
                            {linkData.description && (
                                <p className="text-xs text-white/50 leading-relaxed font-sans">{linkData.description}</p>
                            )}
                        </div>


                        <div className="bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex justify-between items-center">
                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Amount Due</span>
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-[#00d2b4] tracking-tight">
                                    {displayCurrency && displayAmount !== undefined 
                                        ? `${fiatSymbol}${displayAmount.toFixed(2)}` 
                                        : `$${(Number(linkData.amount_usdc) / 1000000).toFixed(2)}`}
                                </p>
                                <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest font-mono">
                                    {displayCurrency && displayCurrency !== "USD" 
                                        ? `${displayCurrency} Equivalent (Settled in USDC)` 
                                        : "USDC (Arc Network)"}
                                </p>
                            </div>
                        </div>


                        {!isConnected ? (
                            <div className="space-y-4">
                                {/* Already signed in to SubScript: offer DMs instead of a fresh connect. */}
                                {sessionInfo?.loggedIn && (
                                    <div className="rounded-2xl border border-[#00d2b4]/25 bg-[#00d2b4]/[0.06] p-4 space-y-3">
                                        <p className="text-[11px] leading-relaxed text-white/75">
                                            You're already signed in to SubScript
                                            {sessionInfo.email ? ` as ${sessionInfo.email}` : sessionInfo.wallet ? ` (${sessionInfo.wallet.slice(0, 6)}...${sessionInfo.wallet.slice(-4)})` : ""}.
                                            Open this request in your DMs, or connect a wallet below to pay directly.
                                        </p>
                                        <button
                                            onClick={handleGoToDms}
                                            disabled={isCreatingDm}
                                            className="w-full py-3 bg-gradient-to-r from-emerald-500 to-[#00d2b4] hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                        >
                                            {isCreatingDm ? (
                                                <><Loader2 className="w-4 h-4 animate-spin text-black" /> Opening DMs...</>
                                            ) : (
                                                <>Go to my SubScript DMs <ArrowRight className="w-4 h-4" /></>
                                            )}
                                        </button>
                                        {dmError && <p className="text-[10px] font-mono text-red-400">{dmError}</p>}
                                        <div className="flex items-center gap-3 pt-1">
                                            <span className="h-px flex-1 bg-white/10" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">or pay with a wallet</span>
                                            <span className="h-px flex-1 bg-white/10" />
                                        </div>
                                    </div>
                                )}

                                {noWalletDetected ? (
                                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5 space-y-3 text-center">
                                        <AlertCircle className="mx-auto h-6 w-6 text-amber-400" />
                                        <p className="text-[11px] leading-relaxed text-white/70">
                                            No browser wallet detected. Install MetaMask, Rabby, or another wallet extension, then refresh this page.
                                        </p>
                                        <a
                                            href="https://metamask.io/download/"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-white transition"
                                        >
                                            Get a wallet <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                ) : walletConnectors.length > 1 ? (
                                    <div className="space-y-2">
                                        <p className="text-[9px] font-bold uppercase tracking-wider text-white/40 text-center">
                                            Multiple wallets found — choose one
                                        </p>
                                        {walletConnectors.map((connector) => (
                                            <button
                                                key={connector.uid}
                                                onClick={() => connect({ connector })}
                                                disabled={isConnecting}
                                                className="w-full py-3.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-white font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                                            >
                                                {connector.icon ? (
                                                    <img src={connector.icon} alt="" className="h-4 w-4 rounded" />
                                                ) : (
                                                    <Wallet className="w-4 h-4" />
                                                )}
                                                {connector.name}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-white/40 text-center leading-relaxed font-sans">
                                            Connect your browser wallet (e.g. MetaMask, Rabby) on {expectedChainName} to complete the payment.
                                        </p>
                                        <button
                                            onClick={handleConnect}
                                            disabled={isConnecting}
                                            className="w-full py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 disabled:opacity-50 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.2)]"
                                        >
                                            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                                            {isConnecting ? "Connecting..." : "Connect Wallet"}
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-6">

                                <div className="flex flex-col gap-1.5 border-t border-b border-white/5 py-3 text-[10px] font-mono text-white/40">
                                    <div className="flex items-center justify-between">
                                        <span>Payer: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""}</span>
                                        <button type="button" onClick={() => disconnect()} className="hover:text-white transition-colors uppercase font-bold">Disconnect</button>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-white/60">
                                        <span>Network:</span>
                                        <span className={`font-bold ${isWrongChain ? "text-amber-400" : "text-[#00d2b4]"}`}>
                                            {isWrongChain ? `Switch to ${requiredChainName}` : `${requiredChainName} ✓`}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-white/60">
                                        <span>Arc Network USDC Balance:</span>
                                        <span className="font-bold text-[#00d2b4]">
                                            {parseFloat(formatUnits(arcUsdcBalance, 6)).toFixed(2)} USDC
                                        </span>
                                    </div>
                                    {isCctpMode && (
                                        <div className="flex items-center justify-between mt-1 text-white/60">
                                            <span>{cctpOriginChainName} USDC Balance:</span>
                                            <span className="font-bold text-blue-400">
                                                {balanceData ? `${parseFloat(balanceData.formatted).toFixed(2)} USDC` : "0.00 USDC"}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {isWrongChain ? (
                                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-4">
                                        <div className="flex items-center gap-3">
                                            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                                            <div>
                                                <p className="text-xs font-bold text-amber-300 uppercase tracking-wide">Wrong Network</p>
                                                <p className="text-[10px] text-white/50 mt-0.5 leading-relaxed">
                                                    Your wallet is connected to a different chain. Switch to <span className="font-bold text-white/70">{requiredChainName}</span> to continue.
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleSwitchChain}
                                            className="w-full py-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                        >
                                            Switch to {requiredChainName}
                                        </button>
                                    </div>
                                ) : verificationStatus ? (
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 text-center space-y-4 flex flex-col items-center">
                                        <CheckCircle className="w-8 h-8 text-emerald-400" />
                                        <p className="text-xs font-semibold text-white/80 leading-relaxed">{verificationStatus}</p>
                                        {shareableReceiptUrl && (
                                            <a
                                                href={shareableReceiptUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[9px] font-mono text-[#00d2b4] hover:underline flex items-center gap-1"
                                            >
                                                Share receipt <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                        {successTxHash && (
                                            <a 
                                                href={`${expectedChainId === 5042001 ? "https://arcscan.app" : "https://testnet.arcscan.app"}/tx/${successTxHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[9px] font-mono text-[#00d2b4] hover:underline flex items-center gap-1"
                                            >
                                                View Tx on Explorer <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                        {verificationStatus === "Payment confirmed and settled successfully!" && (
                                            <div className="w-full pt-4 border-t border-white/5 space-y-3">
                                                {dmError && (
                                                    <p className="text-[10px] font-mono text-red-400 text-center">{dmError}</p>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={handleGoToDms}
                                                    disabled={isCreatingDm}
                                                    className="w-full py-4 bg-gradient-to-r from-emerald-500 to-[#00d2b4] hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                                                >
                                                    {isCreatingDm ? (
                                                        <>
                                                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                                                            Opening Inbox DMs...
                                                        </>
                                                    ) : (
                                                        <>
                                                            Go to Inbox DMs <ArrowRight className="w-4 h-4" />
                                                        </>
                                                    )}
                                                </button>
                                            </div>
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

                                        {payerNeedsEmail && (
                                            <div className="rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/[0.04] p-4 space-y-2 text-left">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-[#00d2b4]">Add your email</p>
                                                <p className="text-[10px] leading-relaxed text-white/55">
                                                    Welcome back — we need an email for your receipt and account notifications before this payment.
                                                </p>
                                                <input
                                                    type="email"
                                                    value={payerEmailInput}
                                                    onChange={(event) => { setPayerEmailInput(event.target.value); setPayerEmailError(null); }}
                                                    placeholder="you@example.com"
                                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-xs text-white placeholder:text-white/30 focus:border-[#00d2b4]/50 focus:outline-none"
                                                />
                                                {payerEmailError && <p className="text-[10px] font-mono text-red-400">{payerEmailError}</p>}
                                            </div>
                                        )}

                                        {!hasSufficientArcBalance && (
                                            <div className="liquid-glass border border-amber-500/20 bg-amber-500/[0.03] rounded-2xl p-5 space-y-3 shadow-lg">
                                                <div className="flex items-start gap-3">
                                                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                                                    <div className="space-y-1">
                                                        <h3 className="text-xs font-bold text-white uppercase tracking-wide">Arc USDC Required</h3>
                                                        <p className="text-[10px] text-white/60 leading-relaxed font-sans">
                                                            Your Arc Network balance ({parseFloat(formatUnits(arcUsdcBalance, 6)).toFixed(2)} USDC) is insufficient for this ${(Number(linkData.amount_usdc) / 1000000).toFixed(2)} USDC payment.
                                                        </p>
                                                        <p className="text-[10px] text-white/40 leading-relaxed font-sans">
                                                            Cross-chain CCTP checkout is disabled until Arc-side memo settlement is live. Bridge or fund USDC on Arc, then complete this payment.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {isRoleMismatch ? (
                                             <button
                                                 type="button"
                                                 disabled={true}
                                                 className="w-full py-4 border border-red-500/20 bg-red-500/[0.02] text-red-400 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-not-allowed"
                                             >
                                                 Role Mismatch: Merchant Wallet
                                             </button>
                                         ) : isLinkExhausted ? (
                                            <button
                                                type="button"
                                                disabled={true}
                                                className="w-full py-4 border border-red-500/20 bg-red-500/[0.02] text-red-400 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-not-allowed"
                                            >
                                                Payment Link Exhausted
                                            </button>
                                        ) : (merchantVerified === false && !unverifiedAccepted && !isUserRequest) ? (
                                            <button
                                                type="button"
                                                onClick={() => setShowUnverifiedWarning(true)}
                                                className="w-full py-4 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                            >
                                                <ShieldAlert className="w-4 h-4" /> Review Unverified Merchant Warning
                                            </button>
                                        ) : isInsufficientBalance || !hasSufficientArcBalance ? (
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
                                                        Processing...
                                                    </>
                                                ) : isCctpChain ? (
                                                    /* Subscribe seamlessly via CCTP */
                                                    <>
                                                        Bridge via {cctpOriginChainName} <ArrowRight className="w-4 h-4" />
                                                    </>
                                                ) : (
                                                    <>
                                                        Pay {displayCurrency && displayAmount !== undefined 
                                                            ? `${fiatSymbol}${displayAmount.toFixed(2)}` 
                                                            : `$${(Number(linkData.amount_usdc) / 1000000).toFixed(2)}`}{displayCurrency && displayCurrency !== "USD" ? ` (${(Number(linkData.amount_usdc) / 1000000).toFixed(2)} USDC)` : " USDC"} <ArrowRight className="w-4 h-4" />
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {checkoutUrl && (
                            <div className="border-t border-white/5 pt-4 space-y-3">
                                <button
                                    type="button"
                                    onClick={() => setShowQrCode(!showQrCode)}
                                    className="w-full py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                >
                                    <QrCode className="w-3.5 h-3.5 text-[#00d2b4]" />
                                    {showQrCode ? "Hide QR Code" : "Pay on Mobile (Scan QR)"}
                                </button>

                                {showQrCode && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="flex flex-col items-center justify-center space-y-3 bg-black/40 border border-white/5 rounded-2xl p-4 font-sans text-center overflow-hidden"
                                    >
                                        <p className="text-[10px] text-white/50 max-w-[200px] leading-relaxed">
                                            Scan this QR code with your mobile wallet's browser to complete the payment on your phone.
                                        </p>
                                        <div className="flex justify-center p-3 bg-white rounded-xl">
                                            <QRCodeSVG
                                                value={checkoutUrl}
                                                size={140}
                                                level="H"
                                                bgColor="#ffffff"
                                                fgColor="#000000"
                                            />
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        )}

                        <div className="pt-2 flex items-center justify-center gap-1.5 text-[9px] text-white/30 font-sans">
                            <Lock className="w-3 h-3" /> Securely routed via SubScript Router protocol
                        </div>
                    </div>
                )}
            </div>

            <AnimatePresence>
                {showUnverifiedWarning && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full max-w-md liquid-glass border border-amber-500/30 rounded-3xl p-6 shadow-2xl space-y-6 bg-black/90 text-left relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl -z-10" />
                            <div className="flex items-center gap-3 pb-2 border-b border-white/5">
                                <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                    <ShieldAlert className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white uppercase tracking-wider">Unverified Merchant</h3>
                                    <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Security Advisory</p>
                                </div>
                            </div>

                            <div className="space-y-4 font-sans text-xs text-white/70 leading-relaxed">
                                <p>
                                    You are about to make a payment to an <span className="font-semibold text-white">unverified merchant address</span>:
                                </p>
                                <div className="p-3 bg-white/5 border border-white/10 rounded-xl font-mono text-[10px] break-all text-white/80 select-all">
                                    {linkData?.merchant_address}
                                </div>
                                <p>
                                    This address has not completed the SubScript validation protocol. Please verify the identity of the recipient before proceeding.
                                </p>
                                <p className="text-amber-300/80 font-medium">
                                    Funds sent to unverified addresses cannot be recovered or reversed.
                                </p>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowUnverifiedWarning(false)}
                                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-2xl text-xs uppercase tracking-wider transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUnverifiedAccepted(true);
                                        setShowUnverifiedWarning(false);
                                    }}
                                    className="flex-1 py-3 bg-amber-500 text-black font-bold rounded-2xl text-xs uppercase tracking-wider hover:brightness-110 transition-all shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                                >
                                    Accept & Continue
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {showToast && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 liquid-glass border border-emerald-500/30 bg-black/60 rounded-2xl px-6 py-4 flex items-center gap-3 shadow-[0_8px_32px_0_rgba(0,210,180,0.2)]">
                    <Zap className="w-5 h-5 text-[#00d2b4] fill-[#00d2b4]/25 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                        Payment Confirmed
                    </span>
                </div>
            )}
        </div>
    );
}
