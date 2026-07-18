"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useConnect, useWriteContract, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";
import { useRouter } from "next/navigation";
import { injected } from "wagmi/connectors";
import {
    createPublicClient,
    http,
    parseUnits,
    parseEventLogs,
    getAddress,
    isAddress,
    getContract,
} from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import DashboardHeader from "@/components/DashboardHeader";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { 
    Activity, Crown, Shield, Key, ArrowRightLeft, 
    Check, Loader2, AlertTriangle, PlayCircle, XCircle, ChevronLeft
} from "@/components/icons";
import { 
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    PREMIUM_PLAN_PRICE_USDC,
    STANDARD_CONTRACT_ADDRESS, 
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI, USDC_ERC20_ABI } from "@/lib/contracts/abis";

const publicClient = createPublicClient({
    chain: activeArcChain,
    transport: arcHttp(),
});

const ERC20_ABI = USDC_ERC20_ABI;
const STANDARD_ABI = STANDARD_SUBSCRIPT_ABI;

type EmbeddedWallet = {
    wallet: string;
    email: string;
};

export default function UpgradePage() {
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const { address: browserAddress, chainId, isConnected: isBrowserConnected } = useAccount();
    const { connect, connectors, isPending: isConnecting } = useConnect();
    const { writeContractAsync } = useWriteContract();
    const { switchChainAsync } = useSwitchChain();
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [embeddedWallet, setEmbeddedWallet] = useState<EmbeddedWallet | null>(null);
    const [sessionAlert, setSessionAlert] = useState<string | null>(null);

    const activeMerchantAddress = embeddedWallet?.wallet || browserAddress || "";
    const isConnected = isBrowserConnected || Boolean(embeddedWallet);
    const address = activeMerchantAddress;

    const [txHashState, setTxHashState] = useState<`0x${string}` | undefined>(undefined);
    const { data: txReceipt } = useWaitForTransactionReceipt({
        hash: txHashState,
    });

    /* Tier & Subscription States */
    const [isPremium, setIsPremium] = useState(false);
    const [merchantTier, setMerchantTier] = useState<number | null>(null);
    const [premiumSubId, setPremiumSubId] = useState<number | null>(null);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [dbSubscriptionStatus, setDbSubscriptionStatus] = useState<string | null>(null);
    const [isLoadingTier, setIsLoadingTier] = useState(true);

    /* Checkout & Cancellation States */
    const [checkoutState, setCheckoutState] = useState<
        "idle" | "preparing" | "approving" | "confirming" | "success" | "error"
    >("idle");
    const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
    const [sessionIdState, setSessionIdState] = useState<string | null>(null);
    /* Set the moment a payment transaction is submitted on-chain. Once this exists the user has
       (or may have) been debited, so the UI must never offer a fresh checkout — only re-running
       server verification of this same transaction. */
    const [submittedTxHash, setSubmittedTxHash] = useState<string | null>(null);

    const [isCancelling, setIsCancelling] = useState(false);
    const [cancellationError, setCancellationError] = useState<string | null>(null);

    const refetchBalancesAndTier = useCallback(async () => {
        if (!address) return;
        try {
            const tierRes = await fetch(`/api/merchant/tier?address=${address}`);
            if (tierRes.ok) {
                const tierData = await tierRes.json();
                setIsPremium(Number(tierData.tier) >= 1);
                setMerchantTier(Number(tierData.tier));
                setPremiumSubId(tierData.subscriptionId ? Number(tierData.subscriptionId) : null);
                setCancelAtPeriodEnd(!!tierData.cancelAtPeriodEnd);
                setCurrentPeriodEnd(tierData.nextBillingDate || null);
                setDbSubscriptionStatus(tierData.status || null);
            }
        } catch (error) {
            console.error("Error fetching merchant tier info:", error);
        } finally {
            setIsLoadingTier(false);
        }
    }, [address]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        const restoreSession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();

                if (!data.loggedIn || !data.wallet) {
                    setEmbeddedWallet(null);
                    return;
                }

                if (!data.role) {
                    setSessionAlert("Missing account role. Sign in again before upgrading.");
                    return;
                }

                if (data.role === "USER") {
                    setSessionAlert("This upgrade is only available from a merchant account.");
                    return;
                }

                if (data.isEmbedded) {
                    setEmbeddedWallet({
                        wallet: String(data.wallet).toLowerCase(),
                        email: data.email || "",
                    });
                } else {
                    setEmbeddedWallet(null);
                }
            } catch (err) {
                console.error("Error restoring upgrade session:", err);
            } finally {
                setIsAuthLoading(false);
            }
        };

        restoreSession();
    }, []);

    useEffect(() => {
        if (!address) {
            setIsLoadingTier(false);
            return;
        }
        refetchBalancesAndTier();
        const interval = setInterval(refetchBalancesAndTier, 8000);
        return () => clearInterval(interval);
    }, [address, refetchBalancesAndTier]);

    const handleConnect = async () => {
        try {
            const injectedConnector = connectors.find((c) => c.id === "injected" || c.name.toLowerCase().includes("metamask"));
            if (injectedConnector) {
                await connect({ connector: injectedConnector });
            } else if (connectors.length > 0) {
                await connect({ connector: connectors[0] });
            }
        } catch (err) {
            console.error("Wallet connection failed:", err);
        }
    };

    const executeContractWrite = async ({
        address: contractAddress,
        abi: contractAbi,
        functionName,
        args = [],
    }: {
        address: string;
        abi: any;
        functionName: string;
        args?: any[];
    }) => {
        if (embeddedWallet) {
            let action = "";
            let serializedArgs: Record<string, string> = {};

            if (functionName === "approve") {
                action = "approveUsdc";
                serializedArgs = { spender: String(args[0]), amount: args[1].toString() };
            } else if (functionName === "createSubscription") {
                action = "createPremiumSubscription";
                serializedArgs = {
                    merchant: String(args[0]),
                    amount: args[1].toString(),
                    period: args[2].toString(),
                };
            } else {
                throw new Error(`Execution intent not allowlisted for embedded wallets: ${functionName}`);
            }

            const res = await fetch("/api/execute-tx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, args: serializedArgs }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Server transaction execution failed");
            }
            return data.txHash as string;
        }

        if (chainId !== activeArcChain.id) {
            setCheckoutStatus(`Switching network to ${activeArcChain.name}...`);
            await switchChainAsync({ chainId: activeArcChain.id });
        }

        return await writeContractAsync({
            address: contractAddress as `0x${string}`,
            abi: contractAbi,
            functionName,
            args,
        });
    };

    const getCheckoutErrorMessage = (error: any) => {
        const message = error?.shortMessage || error?.reason || error?.details || error?.message;
        if (/user rejected|rejected by user|user denied/i.test(String(message || ""))) {
            return "Transaction was rejected in the wallet.";
        }
        if (/insufficient allowance/i.test(String(message || ""))) {
            return "USDC allowance is insufficient for this checkout.";
        }
        if (/insufficient funds|exceeds balance/i.test(String(message || ""))) {
            return "Wallet has insufficient USDC or gas balance.";
        }
        return message || "An error occurred during subscription processing.";
    };

    const syncAndRedirect = useCallback(async (hash: string, sessionId = sessionIdState, subId?: number) => {
        setCheckoutState("confirming");
        setCheckoutStatus("Syncing premium state with server...");
        /* The server can legitimately need time after the payment lands: 202 while block
           confirmations accrue, 404 while the RPC indexes the receipt, 409 while another
           request (or the reconciler) holds the session. Those are pending states of an
           already-paid transaction, not failures — poll instead of surfacing an error that
           could push the user into paying again. */
        const RETRYABLE_STATUSES = [202, 404, 409];
        const MAX_ATTEMPTS = 12;
        const RETRY_DELAY_MS = 5000;
        try {
            let lastError = "Failed to finalize premium upgrade on server";
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const upgradeRes = await fetch("/api/premium/upgrade", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        txHash: hash,
                        sessionId,
                        subId,
                    }),
                });
                const upgradeData = await upgradeRes.json();

                if (upgradeRes.ok && upgradeData.success === true) {
                    setSuccessTxHash(hash);
                    setCheckoutState("success");
                    setCheckoutStatus("Upgrade successful! Privacy Premium activated.");
                    router.push("/merchant?upgradeSuccess=true");
                    return;
                }

                lastError = upgradeData.error || lastError;
                if (!RETRYABLE_STATUSES.includes(upgradeRes.status)) {
                    throw new Error(lastError);
                }

                setCheckoutStatus(
                    upgradeRes.status === 202
                        ? "Payment received — waiting for block confirmations..."
                        : "Payment submitted — waiting for the network to index the transaction..."
                );
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            }
            throw new Error(
                "Your payment was submitted on-chain but server confirmation is still pending. " +
                "It will be finalized automatically — you can also retry verification below. Do not pay again."
            );
        } catch (err: any) {
            console.error("Premium upgrade sync failed:", err);
            setCheckoutError(err.message || "Failed to sync premium state with server");
            setCheckoutState("error");
        }
    }, [router, sessionIdState]);

    useEffect(() => {
        if (txReceipt) {
            if (txReceipt.status === "success") {
                syncAndRedirect(txReceipt.transactionHash, sessionIdState || undefined);
            } else {
                setCheckoutError("Subscription creation transaction reverted on-chain.");
                setCheckoutState("error");
            }
        }
    }, [sessionIdState, txReceipt, syncAndRedirect]);

    const handleUpgrade = async () => {
        if (!isConnected || !address) {
            setCheckoutError("Sign in with your merchant email wallet or connect your merchant wallet first.");
            return;
        }

        setCheckoutError(null);
        setSuccessTxHash(null);
        setSubmittedTxHash(null);
        setCheckoutState("preparing");
        setCheckoutStatus("Checking network settings...");

        try {
            const userAddress = getAddress(address) as `0x${string}`;

            /* 1. Ensure connected browser wallets are on the active Arc chain. Embedded wallets are server-signed. */
            if (!embeddedWallet && chainId !== activeArcChain.id) {
                setCheckoutStatus(`Switching network to ${activeArcChain.name}...`);
                await switchChainAsync({ chainId: activeArcChain.id });
            }

            /* 2. Check USDC details and decimals */
            const usdcContract = getContract({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                client: publicClient,
            });

            setCheckoutStatus("Verifying token decimals...");
            const tokenDecimals = await usdcContract.read.decimals();
            if (Number(tokenDecimals) !== 6) {
                throw new Error(`Unexpected USDC decimals: ${tokenDecimals}. Expected 6.`);
            }

            const planPrice = parseUnits(PREMIUM_PLAN_PRICE_USDC, Number(tokenDecimals));
            const approvalAmount = parseUnits("120", Number(tokenDecimals)); /* Approve 12 months worth of allowance */
            const subscriptionPeriod = 2592000; /* 30 Days */

            /* 3. Register intent session in database */
            setCheckoutStatus("Registering premium checkout session...");
            const checkoutRes = await fetch("/api/premium/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    merchantAddress: userAddress,
                }),
            });
            const checkoutData = await checkoutRes.json();
            if (!checkoutRes.ok) {
                throw new Error(checkoutData.error || "Failed to initialize premium checkout session");
            }

            setSessionIdState(checkoutData.sessionId);

            /* 4. Check Allowance */
            setCheckoutStatus("Checking USDC allowance...");
            const currentAllowance = await usdcContract.read.allowance([userAddress, STANDARD_CONTRACT_ADDRESS]);

            if (currentAllowance < planPrice) {
                setCheckoutState("approving");
                setCheckoutStatus("Approving USDC Allowance (awaiting wallet confirmation)...");

                await publicClient.simulateContract({
                    address: USDC_NATIVE_GAS_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    account: userAddress,
                    args: [STANDARD_CONTRACT_ADDRESS, approvalAmount],
                });

                const approveTxHash = await executeContractWrite({
                    address: USDC_NATIVE_GAS_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [STANDARD_CONTRACT_ADDRESS, approvalAmount],
                });

                setCheckoutStatus("Waiting for approval transaction confirmation...");
                const approveReceipt = await publicClient.waitForTransactionReceipt({
                    hash: approveTxHash as `0x${string}`,
                    timeout: 120_000,
                });

                if (approveReceipt.status !== "success") {
                    throw new Error("USDC approval transaction reverted.");
                }
            }

            /* 5. Create Subscription */
            setCheckoutState("confirming");
            setCheckoutStatus("Creating Premium Subscription (awaiting wallet confirmation)...");

            await publicClient.simulateContract({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "createSubscription",
                account: userAddress,
                args: [PREMIUM_PAYMENT_RECIPIENT_ADDRESS, planPrice, BigInt(subscriptionPeriod)],
            });

            const txHash = await executeContractWrite({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "createSubscription",
                args: [PREMIUM_PAYMENT_RECIPIENT_ADDRESS, planPrice, BigInt(subscriptionPeriod)],
            });
            setSubmittedTxHash(txHash);

            setCheckoutStatus("Confirming subscription on-chain...");
            if (embeddedWallet) {
                const receipt = await publicClient.waitForTransactionReceipt({
                    hash: txHash as `0x${string}`,
                    timeout: 120_000,
                });

                if (receipt.status !== "success") {
                    throw new Error("Subscription creation transaction reverted on-chain.");
                }

                const subscriptionLogs = parseEventLogs({
                    abi: STANDARD_ABI,
                    logs: receipt.logs,
                });
                const createLog = subscriptionLogs.find(
                    (log) =>
                        log.eventName === "SubscriptionCreated" &&
                        log.args.subscriber?.toLowerCase() === userAddress.toLowerCase() &&
                        log.args.merchant?.toLowerCase() === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()
                );

                /* The server extracts the subId from the receipt logs itself, so a client-side
                   parse miss must not abort verification of an already-paid transaction. */
                await syncAndRedirect(
                    txHash,
                    checkoutData.sessionId,
                    createLog ? Number(createLog.args.subId) : undefined
                );
            } else {
                setTxHashState(txHash as `0x${string}`);
            }
        } catch (err: any) {
            console.error("Premium upgrade failed:", err);
            setCheckoutError(getCheckoutErrorMessage(err));
            setCheckoutState("error");
        }
    };

    const handleCancelSubscription = async () => {
        if (!confirm("Are you sure you want to cancel your Privacy Premium plan? Your Privacy Premium benefits will remain active until the end of your current billing period.")) {
            return;
        }

        setIsCancelling(true);
        setCancellationError(null);

        try {
            const cancelRes = await fetch("/api/premium/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            const data = await cancelRes.json();
            if (!cancelRes.ok) {
                throw new Error(data.error || "Failed to schedule subscription cancellation");
            }

            await refetchBalancesAndTier();
        } catch (err: any) {
            console.error("Cancellation request failed:", err);
            setCancellationError(err.message || "Failed to cancel subscription.");
        } finally {
            setIsCancelling(false);
        }
    };

    if (!isMounted) {
        return (
            <div className="min-h-screen bg-[#0a0a0c] text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#d4a853]">
                <AnimatedGradientBg variant="dashboard" />
                <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 pt-28 pb-12">
                    <div className="mb-8 h-9 w-36 rounded-full liquid-glass-skeleton" />
                    <div className="mx-auto mb-12 w-full max-w-xl space-y-4 text-center">
                        <div className="mx-auto h-10 w-64 rounded-2xl liquid-glass-skeleton" />
                        <div className="mx-auto h-3 w-full rounded-full liquid-glass-skeleton" />
                        <div className="mx-auto h-3 w-3/4 rounded-full liquid-glass-skeleton" />
                    </div>
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="h-64 rounded-3xl liquid-glass-skeleton" />
                        <div className="h-64 rounded-3xl liquid-glass-skeleton" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0c] text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#d4a853]">
            <AnimatedGradientBg variant="dashboard" />
            
            <div className="relative z-10">
                <DashboardHeader 
                    embeddedWallet={embeddedWallet}
                    onDisconnect={() => {
                        setEmbeddedWallet(null);
                        fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                    }}
                    isPremium={isPremium}
                    activeTab="premium"
                    onBackToOverview={() => router.push("/merchant")}
                />

                <main className="max-w-4xl mx-auto px-6 pt-28 pb-12">
                    <div className="mb-8 flex items-center justify-between">
                        <Link 
                            href="/merchant"
                            className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-all font-mono uppercase tracking-wider"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Back to Control Center
                        </Link>
                    </div>

                    <div className="text-center mb-12">
                        <h1 className="text-4xl font-extrabold text-white uppercase tracking-tight mb-3">
                            Privacy Premium <span className="font-serif italic lowercase font-normal text-[#d4a853]">subscription</span>
                        </h1>
                        <p className="text-sm text-white/50 max-w-xl mx-auto leading-relaxed">
                            Upgrade your SubScript merchant node to activate Arc privacy-aware receipt controls, priority keeper execution, and advanced automation.
                        </p>
                    </div>

                    {sessionAlert ? (
                        <div className="liquid-glass border border-yellow-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl bg-yellow-500/[0.03] flex flex-col items-center justify-center text-center gap-6 max-w-2xl mx-auto py-12">
                            <div className="p-4 rounded-3xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                                <AlertTriangle className="w-10 h-10" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-lg font-bold text-white uppercase tracking-wider">Merchant Session Required</h2>
                                <p className="text-xs text-white/60 max-w-md leading-relaxed">
                                    {sessionAlert}
                                </p>
                            </div>
                        </div>
                    ) : isAuthLoading ? (
                        <div className="flex flex-col items-center justify-center py-24 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-[#d4a853]" />
                            <p className="text-xs text-white/40 uppercase tracking-widest font-mono">Restoring Merchant Session...</p>
                        </div>
                    ) : !isConnected ? (
                        <div className="liquid-glass border border-yellow-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl bg-yellow-500/[0.03] flex flex-col items-center justify-center text-center gap-6 max-w-2xl mx-auto py-12">
                            <div className="p-4 rounded-3xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                                <AlertTriangle className="w-10 h-10" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-lg font-bold text-white uppercase tracking-wider">Wallet Connection Required</h2>
                                <p className="text-xs text-white/60 max-w-md leading-relaxed">
                                    Sign in with your merchant email wallet or connect your merchant wallet to verify subscription status and initiate the secure USDC checkout contract call.
                                </p>
                            </div>
                            <button
                                onClick={handleConnect}
                                className="px-8 py-3 bg-yellow-300 hover:bg-yellow-200 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                            >
                                <Loader2 className="w-4 h-4 animate-spin hidden" />
                                Connect Wallet
                            </button>
                        </div>
                    ) : isLoadingTier ? (
                        <div className="flex flex-col items-center justify-center py-24 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-[#d4a853]" />
                            <p className="text-xs text-white/40 uppercase tracking-widest font-mono">Loading Subscription Data...</p>
                        </div>
                    ) : isPremium ? (
                        /* Active Premium Status Panel */
                        <div className="max-w-2xl mx-auto space-y-6">
                            <div className="liquid-glass border border-[#d4a853]/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden bg-gradient-to-b from-[#d4a853]/[0.03] to-transparent">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-[#d4a853]/10 via-transparent to-transparent pointer-events-none" />

                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-3 bg-[#d4a853]/15 border border-[#d4a853]/30 text-[#d4a853] rounded-2xl">
                                        <Crown className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <span className="text-[9px] font-extrabold px-2.5 py-0.5 rounded-full bg-[#d4a853]/15 text-[#d4a853] border border-[#d4a853]/30 uppercase tracking-wider font-mono">
                                            Active Subscriber
                                        </span>
                                        <h3 className="text-xl font-extrabold text-white uppercase tracking-tight mt-1">
                                            Privacy Premium Plan
                                        </h3>
                                    </div>
                                </div>

                                <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 space-y-3 font-mono text-xs mb-6">
                                    <div className="flex justify-between">
                                        <span className="text-white/40">Subscription Status</span>
                                        <span className="text-[#d4a853] font-bold uppercase">{dbSubscriptionStatus || "Active"}</span>
                                    </div>
                                    {premiumSubId && (
                                        <div className="flex justify-between">
                                            <span className="text-white/40">Subscription ID</span>
                                            <span className="text-white font-bold">#{premiumSubId}</span>
                                        </div>
                                    )}
                                    {currentPeriodEnd && (
                                        <div className="flex justify-between">
                                            <span className="text-white/40">
                                                {cancelAtPeriodEnd ? "Expiration Date" : "Next Billing Date"}
                                            </span>
                                            <span className="text-white font-bold">
                                                {new Date(currentPeriodEnd).toLocaleDateString()}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {cancelAtPeriodEnd ? (
                                    <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl mb-6 flex items-start gap-3">
                                        <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-xs font-bold text-white uppercase tracking-wider">Cancellation Scheduled</p>
                                            <p className="text-[10px] text-white/50 leading-relaxed mt-1">
                                                You have requested to cancel your subscription. Premium benefits will remain active until the end of your billing cycle on {currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : "N/A"}.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex justify-end">
                                        <button
                                            onClick={handleCancelSubscription}
                                            disabled={isCancelling}
                                            className="px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-bold uppercase tracking-wider rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {isCancelling ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                                            ) : (
                                                <><XCircle className="w-4 h-4" /> Cancel Privacy Premium</>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {cancellationError && (
                                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-xs font-mono break-all">
                                        {cancellationError}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* Pricing Card UI for Free Merchants */
                        <div className="max-w-md mx-auto space-y-6">
                            <div className="liquid-glass border-2 border-[#d4a853]/40 rounded-[32px] p-6 sm:p-8 shadow-[0_8px_30px_rgb(212,168,83,0.1)] relative overflow-hidden bg-gradient-to-b from-[#d4a853]/[0.02] to-transparent">
                                <div className="absolute top-0 right-0 w-48 h-48 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-[#d4a853]/10 via-transparent to-transparent pointer-events-none" />

                                <div className="text-center mb-6">
                                    <span className="text-[9px] font-extrabold px-3 py-1 rounded-full bg-[#d4a853]/15 text-[#d4a853] border border-[#d4a853]/30 uppercase tracking-widest font-mono">
                                        Privacy Premium
                                    </span>
                                    <h2 className="text-2xl font-extrabold text-white uppercase tracking-tight mt-4">
                                        Privacy Premium
                                    </h2>
                                    <div className="flex items-baseline justify-center gap-1 mt-4">
                                        <span className="text-5xl font-extrabold text-white tracking-tight">10</span>
                                        <span className="text-lg font-bold text-white/60 uppercase font-mono">USDC</span>
                                        <span className="text-xs text-white/40 font-mono">/ month</span>
                                    </div>
                                </div>

                                <div className="space-y-4 py-6 border-t border-b border-white/5 mb-8">
                                    {[
                                        { title: "Opt-In Privacy Controls", desc: "Use Arc privacy-aware disclosure policies to limit who can view sensitive billing and settlement details." },
                                        { title: "Automated Cold-Storage Rerouting", desc: "Instantly sweep merchant revenue to secure cold storage, hardware, or multisig wallets." },
                                        { title: "Priority Keeper Execution", desc: "Enjoy priority processing status with automated keeper contract bots." },
                                        { title: "Full Webhooks & API Keys", desc: "Generate publishing keys and audit the complete HTTP payload stream." }
                                    ].map((f, i) => (
                                        <div key={i} className="flex gap-3 items-start">
                                            <div className="p-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mt-0.5 flex-shrink-0">
                                                <Check className="w-3.5 h-3.5" />
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">{f.title}</h4>
                                                <p className="text-[10px] text-white/50 leading-relaxed mt-0.5">{f.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-4">
                                    {checkoutState === "idle" && (
                                        <button
                                            onClick={handleUpgrade}
                                            className="w-full py-4 bg-gradient-to-r from-[#d4a853] via-[#e2be72] to-[#c49240] text-black font-extrabold rounded-2xl text-xs uppercase tracking-wider hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-[0_4px_25px_rgba(212,168,83,0.2)]"
                                        >
                                            <Crown className="w-4 h-4" />
                                            Activate Privacy Premium
                                        </button>
                                    )}

                                    {checkoutState !== "idle" && checkoutState !== "success" && checkoutState !== "error" && (
                                        <div className="w-full p-5 bg-white/[0.02] border border-white/5 rounded-2xl text-center space-y-3">
                                            <div className="flex items-center justify-center gap-3 text-xs text-[#d4a853] font-semibold uppercase tracking-wider">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>{checkoutState}</span>
                                            </div>
                                            <p className="text-[10px] text-white/50 font-mono leading-relaxed">{checkoutStatus}</p>
                                        </div>
                                    )}

                                    {checkoutState === "success" && (
                                        <div className="w-full p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl text-center space-y-3">
                                            <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-bold uppercase tracking-wider">
                                                <Check className="w-4 h-4" />
                                                <span>Subscription Active</span>
                                            </div>
                                            <p className="text-[10px] text-white/60">
                                                Premium tier upgraded and recorded successfully on the blockchain and database.
                                            </p>
                                            {successTxHash && (
                                                <div className="pt-2 border-t border-white/5 text-[9px] font-mono text-white/40 break-all text-left">
                                                    Tx Hash: {successTxHash}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {checkoutState === "error" && (
                                        <div className="w-full p-5 bg-red-500/5 border border-red-500/20 rounded-2xl text-center space-y-4">
                                            <div className="flex items-center justify-center gap-2 text-xs text-red-400 font-bold uppercase tracking-wider">
                                                <XCircle className="w-4 h-4" />
                                                <span>{submittedTxHash ? "Verification Incomplete" : "Transaction Failed"}</span>
                                            </div>
                                            <div className="p-3 bg-red-500/10 border border-red-500/10 rounded-xl text-red-300 text-[10px] font-mono break-all text-left leading-relaxed">
                                                {checkoutError}
                                            </div>
                                            {submittedTxHash ? (
                                                /* A payment transaction was already submitted on-chain. Re-running the
                                                   checkout would charge the wallet a second time — only re-verification
                                                   of the existing transaction is allowed from here. */
                                                <>
                                                    <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-yellow-200/80 text-[10px] leading-relaxed text-left">
                                                        Your payment transaction was already submitted on-chain and will not be charged again.
                                                        If verification keeps failing, premium is activated automatically once the payment is reconciled.
                                                    </div>
                                                    <div className="text-[9px] font-mono text-white/40 break-all text-left">
                                                        Tx Hash: {submittedTxHash}
                                                    </div>
                                                    <button
                                                        onClick={() => syncAndRedirect(submittedTxHash)}
                                                        className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                                                    >
                                                        Retry Verification
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => setCheckoutState("idle")}
                                                    className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                                                >
                                                    Retry Checkout
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
