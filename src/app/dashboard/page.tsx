"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import posthog from "posthog-js";
import { ethers } from "ethers";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import DashboardHeader from "@/components/DashboardHeader";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import SubScriptCheckout from "@/components/SubScriptCheckout";
import WithdrawModal from "@/components/WithdrawModal";
import DepositModal from "@/components/DepositModal";
import { useAccount, useConnect, useDisconnect, useWriteContract, useSwitchChain, useReadContract, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import {
    createPublicClient,
    http,
    formatUnits,
    parseUnits,
    parseEventLogs,
    bytesToHex,
    encodePacked,
    getAddress,
    isAddress,
    keccak256,
    getContract,
    type Hex,
} from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { 
    Activity, Key, Code2, Webhook, ArrowRightLeft, 
    ShieldAlert, Copy, Check, Eye, EyeOff, RotateCw, 
    RefreshCw, Sliders, ShieldX, CheckCircle, AlertTriangle, 
    PlugZap, Loader2, Award, Crown, ExternalLink, ArrowDownToLine,
    Wallet, Shield, BarChart3
} from "lucide-react";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";

import { 
    ARC_TESTNET_CHAIN_ID, 
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    PREMIUM_PLAN_ID,
    PREMIUM_PLAN_PRICE_USDC,
    SUBSCRIPT_ROUTER_ADDRESS, 
    STANDARD_CONTRACT_ADDRESS, 
    USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI, SUBSCRIPT_ROUTER_ABI, USDC_ERC20_ABI } from "@/lib/contracts/abis";

const TEST_PUBLISHABLE_KEY = "pk_test_51Px9800Z7Z4M19XQY1R93B";

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

const ERC20_ABI = USDC_ERC20_ABI;
const ROUTER_ABI = SUBSCRIPT_ROUTER_ABI;
const STANDARD_ABI = STANDARD_SUBSCRIPT_ABI;


const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "premium", label: "Premium", icon: Crown },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "checkout", label: "Checkout Setup", icon: Code2 },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
] as const;

type TabId = typeof tabs[number]["id"];

export default function DashboardPage() {
    const [isMounted, setIsMounted] = useState(false);
    const { address: realAddress, isConnected: realIsConnected } = useAccount();
    const { connect, connectors, error: connectError, isError: isConnectError, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();
    const [isTestMode, setIsTestMode] = useState(false);

    const [premiumSubId, setPremiumSubId] = useState<number | null>(null);
    const [isCancellingPremium, setIsCancellingPremium] = useState(false);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [isResumingPremium, setIsResumingPremium] = useState(false);
    const [dbSubscriptionStatus, setDbSubscriptionStatus] = useState<string | null>(null);
    const [downgradeFailures, setDowngradeFailures] = useState<number>(0);


    const [embeddedWallet, setEmbeddedWallet] = useState<{ wallet: string; email: string } | null>(null);
    const [otpEmail, setOtpEmail] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpSuccess, setOtpSuccess] = useState(false);
    const [otpError, setOtpError] = useState<string | null>(null);
    const [rememberMe, setRememberMe] = useState(true);

    const activeMerchantAddress = useMemo(() => {
        if (isTestMode) return "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
        return embeddedWallet?.wallet || realAddress || "";
    }, [embeddedWallet, realAddress, isTestMode]);

    const isConnected = realIsConnected || isTestMode || !!embeddedWallet;
    const address = activeMerchantAddress;

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
            let serializedArgs: any = {};

            if (functionName === "cancelSubscription") {
                action = "cancelSubscription";
                serializedArgs = { subscriptionId: args[0].toString() };
            } else if (functionName === "withdraw") {
                action = "withdraw";
                serializedArgs = {};
            } else if (functionName === "transfer") {
                action = "transferUsdc";
                serializedArgs = { to: args[0], amount: args[1].toString() };
            } else if (functionName === "configurePayoutDestination") {
                action = "configurePayoutDestination";
                serializedArgs = { payoutAddress: args[0] };
            } else if (functionName === "approve") {
                action = "approveUsdc";
                serializedArgs = { spender: args[0], amount: args[1].toString() };
            } else if (functionName === "depositAndCommit") {
                action = "depositAndCommit";
                serializedArgs = { commitment: args[0], amount: args[1].toString() };
            } else if (functionName === "verifyAndActivate") {
                action = "verifyAndActivate";
                serializedArgs = {
                    proof: args[0],
                    nullifierHash: args[1],
                    merchant: args[2],
                    amount: args[3].toString(),
                    period: args[4].toString()
                };
            } else if (functionName === "setMerchantTier") {
                action = "setMerchantTier";
                serializedArgs = {
                    merchant: args[0],
                    tier: Number(args[1]),
                    zkProof: args[2],
                    rerouteConfig: args[3]
                };
            } else if (functionName === "withdrawWithProof") {
                action = "withdrawWithProof";
                serializedArgs = {
                    proof: args[0],
                    nullifierHash: args[1],
                    merchant: args[2],
                    target: args[3]
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
        } else {
            return await writeContractAsync({
                address: contractAddress as `0x${string}`,
                abi: contractAbi,
                functionName,
                args,
            });
        }
    };

    const { switchChain, switchChainAsync } = useSwitchChain();
    const { chainId } = useAccount();


    const [isSubscribingPremium, setIsSubscribingPremium] = useState(false);
    const [premiumStatus, setPremiumStatus] = useState<string | null>(null);
    const [premiumError, setPremiumError] = useState<string | null>(null);
    const [rerouteAddress, setRerouteAddress] = useState("");
    const [isRerouting, setIsRerouting] = useState(false);
    const [rerouteSuccess, setRerouteSuccess] = useState(false);
    const [isTriggeringKeeper, setIsTriggeringKeeper] = useState(false);
    const [keeperStatus, setKeeperStatus] = useState<string | null>(null);
    const [keeperError, setKeeperError] = useState<string | null>(null);

    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== "undefined") {
            setIsTestMode(
                Boolean(window.navigator.webdriver || document.cookie.includes("subscript_e2e_test=true"))
            );
        }
    }, [realAddress, realIsConnected]);


    const [merchantTier, setMerchantTier] = useState(0);
    const [vaultBalance, setVaultBalance] = useState(0);
    const [payoutDestination, setPayoutDestination] = useState<string | null>(null);
    const [walletBalance, setWalletBalance] = useState(0);
    const [isPremium, setIsPremium] = useState(false);
    const [promptFlowMode, setPromptFlowMode] = useState<"standard" | "private">("standard");
    const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
    const [isDepositOpen, setIsDepositOpen] = useState(false);

    useEffect(() => {
        setPromptFlowMode(isPremium ? "private" : "standard");
    }, [isPremium]);

    const refetchBalancesAndTier = useCallback(async () => {
        if (!address) return;
        try {
            const [tierRaw, vaultRaw, payoutRaw, walletRaw] = await Promise.all([
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: ROUTER_ABI,
                    functionName: "merchantTiers",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: ROUTER_ABI,
                    functionName: "merchantBalances",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: ROUTER_ABI,
                    functionName: "merchantPayoutDestination",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: USDC_NATIVE_GAS_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [address as `0x${string}`],
                }),
            ]);

            setMerchantTier(Number(tierRaw));
            setIsPremium(Number(tierRaw) >= 1);
            setVaultBalance(parseFloat(formatUnits(vaultRaw, 6)));
            setPayoutDestination(payoutRaw && payoutRaw !== "0x0000000000000000000000000000000000000000" ? payoutRaw : null);
            setWalletBalance(parseFloat(formatUnits(walletRaw as bigint, 6)));

            const tierRes = await fetch(`/api/merchant/tier?address=${address}`);
            if (tierRes.ok) {
                const tierData = await tierRes.json();
                setIsPremium(Number(tierData.tier) >= 1);
                setMerchantTier(Number(tierData.tier));
                setPremiumSubId(tierData.subscriptionId ? Number(tierData.subscriptionId) : null);
                setCancelAtPeriodEnd(!!tierData.cancelAtPeriodEnd);
                setCurrentPeriodEnd(tierData.nextBillingDate || null);
                setDbSubscriptionStatus(tierData.status || null);
                setDowngradeFailures(tierData.downgradeFailures ? Number(tierData.downgradeFailures) : 0);
            }
        } catch (error) {
            console.error("Error reading contract data in background:", error);
        }
    }, [address]);

    const handleDepositSuccess = () => {
        refetchBalancesAndTier();
    };

    useEffect(() => {
        if (!address) return;
        refetchBalancesAndTier();
        const interval = setInterval(refetchBalancesAndTier, 8000);
        return () => clearInterval(interval);
    }, [address, refetchBalancesAndTier]);



    const refetchTier = refetchBalancesAndTier;
    const refetchVaultBalance = refetchBalancesAndTier;
    const refetchPayoutDest = refetchBalancesAndTier;
    const refetchWalletBalance = refetchBalancesAndTier;


    const [activeTab, setActiveTab] = useState<TabId>("overview");


    const [copiedText, setCopiedText] = useState<string | null>(null);


    const [sessionWallet, setSessionWallet] = useState<string | null>(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    
    /* Loading states for initial fetches to support skeleton loading */
    const [initialKeysFetched, setInitialKeysFetched] = useState(false);
    const [initialWebhooksFetched, setInitialWebhooksFetched] = useState(false);
    const [initialEventsFetched, setInitialEventsFetched] = useState(false);
    const [initialContractFetched, setInitialContractFetched] = useState(false);

    const isLoading = isAuthLoading || (isConnected && sessionWallet && (!initialKeysFetched || !initialWebhooksFetched || !initialEventsFetched || !initialContractFetched));
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const { signMessageAsync } = useSignMessage();


    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [isKeysLoading, setIsKeysLoading] = useState(false);
    const [revealSecret, setRevealSecret] = useState(false);
    const [isRolling, setIsRolling] = useState(false);


    const [webhookEndpoints, setWebhookEndpoints] = useState<any[]>([]);
    const [isWebhooksLoading, setIsWebhooksLoading] = useState(false);
    const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
    const [isEventsLoading, setIsEventsLoading] = useState(false);
    const [webhookUrlInput, setWebhookUrlInput] = useState("");
    const [isAddingWebhook, setIsAddingWebhook] = useState(false);
    const [revealWebhookSecret, setRevealWebhookSecret] = useState<string | null>(null);


    const [selectedWebhook, setSelectedWebhook] = useState<string>("");
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayStatus, setReplayStatus] = useState<string | null>(null);


    const [subName, setSubName] = useState("AI Agent Compute Limit");
    const [subCap, setSubCap] = useState("150.00");
    const [subInterval, setSubInterval] = useState("monthly");
    const [subChain, setSubChain] = useState("base");

    const fetchApiKeys = async () => {
        setIsKeysLoading(true);
        try {
            const res = await fetch("/api/keys");
            const data = await res.json();
            if (data.keys) {
                setApiKeys(data.keys);
            }
        } catch (err) {
            console.error("Error fetching keys:", err);
        } finally {
            setIsKeysLoading(false);
            setInitialKeysFetched(true);
        }
    };

    const fetchWebhookEndpoints = async () => {
        setIsWebhooksLoading(true);
        try {
            const res = await fetch("/api/webhooks/endpoints");
            const data = await res.json();
            if (data.endpoints) {
                setWebhookEndpoints(data.endpoints);
            }
        } catch (err) {
            console.error("Error fetching endpoints:", err);
        } finally {
            setIsWebhooksLoading(false);
            setInitialWebhooksFetched(true);
        }
    };

    const fetchWebhookEvents = async () => {
        setIsEventsLoading(true);
        try {
            const res = await fetch("/api/webhooks/events");
            const data = await res.json();
            if (data.events) {
                setWebhookEvents(data.events);
                if (data.events.length > 0 && !selectedWebhook) {
                    setSelectedWebhook(data.events[0].id);
                }
            }
        } catch (err) {
            console.error("Error fetching events:", err);
        } finally {
            setIsEventsLoading(false);
            setInitialEventsFetched(true);
        }
    };


    useEffect(() => {
        const restoreSession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();
                if (data.loggedIn && data.wallet) {
                    setSessionWallet(data.wallet.toLowerCase());
                    if (data.email) {
                        setEmbeddedWallet({
                            wallet: data.wallet,
                            email: data.email
                        });
                    }
                }
            } catch (err) {
                console.error("Error restoring session:", err);
            } finally {
                setIsAuthLoading(false);
            }
        };
        restoreSession();
    }, []);


    useEffect(() => {
        if (!address) {
            setSessionWallet(null);
            setApiKeys([]);
            setWebhookEndpoints([]);
            setWebhookEvents([]);
            setInitialKeysFetched(false);
            setInitialWebhooksFetched(false);
            setInitialEventsFetched(false);
            setInitialContractFetched(false);
            return;
        }

        const verifySession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();
                if (data.loggedIn && data.wallet.toLowerCase() === address.toLowerCase()) {
                    setSessionWallet(data.wallet.toLowerCase());
                } else {
                    setSessionWallet(null);
                }
            } catch (err) {
                console.error("Error verifying session:", err);
            }
        };


        if (isConnected && !embeddedWallet) {
            verifySession();
        }
    }, [address, isConnected, embeddedWallet]);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpEmail || !otpEmail.includes("@")) {
            setOtpError("Please enter a valid email address.");
            return;
        }
        setOtpLoading(true);
        setOtpError(null);
        try {
            const res = await fetch("/api/auth/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: otpEmail }),
            });
            const data = await res.json();
            if (data.success) {
                setOtpSent(true);
                console.log("Sandbox OTP Code:", data.sandboxCode);
            } else {
                setOtpError(data.error || "Failed to send verification code.");
            }
        } catch (err) {
            console.error("Error sending OTP:", err);
            setOtpError("Network error sending OTP code.");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpCode) {
            setOtpError("Please enter the verification code.");
            return;
        }
        setOtpLoading(true);
        setOtpError(null);
        try {
            const res = await fetch("/api/auth/otp/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: otpEmail, code: otpCode, rememberMe }),
            });
            const data = await res.json();
            if (data.success) {
                setEmbeddedWallet({
                    wallet: data.wallet,
                    email: data.email
                });
                setSessionWallet(data.wallet.toLowerCase());
                setOtpSuccess(true);
            } else {
                setOtpError(data.error || "Invalid verification code.");
            }
        } catch (err) {
            console.error("Error verifying OTP:", err);
            setOtpError("Network error verifying OTP code.");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleSocialLogin = (provider: "google" | "apple") => {
        const width = 500;
        const height = 650;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const popup = window.open(
            `/auth/popup?provider=${provider}`,
            `SubScript - Continue with ${provider}`,
            `width=${width},height=${height},left=${left},top=${top}`
        );

        const handleMessage = async (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === "social-login-success") {
                const { email } = event.data;
                setOtpLoading(true);
                setOtpError(null);
                try {
                    const res = await fetch("/api/auth/social", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email, provider, rememberMe }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        setEmbeddedWallet({
                            wallet: data.wallet,
                            email: data.email
                        });
                        setSessionWallet(data.wallet.toLowerCase());
                    } else {
                        setOtpError(data.error || `Failed to log in with ${provider}`);
                    }
                } catch (err) {
                    console.error("Social login verify error:", err);
                    setOtpError(`Network error logging in with ${provider}`);
                } finally {
                    setOtpLoading(false);
                }
                window.removeEventListener("message", handleMessage);
            }
        };

        window.addEventListener("message", handleMessage);
    };


    const loadBackendData = useCallback(async () => {
        if (!sessionWallet) return;
        
        await Promise.all([
            fetchApiKeys(),
            fetchWebhookEndpoints(),
            fetchWebhookEvents(),
        ]);
    }, [sessionWallet]);

    useEffect(() => {
        if (sessionWallet) {
            loadBackendData();
        }
    }, [sessionWallet, loadBackendData]);

    const handleBackendLogin = async () => {
        if (embeddedWallet) return;
        if (!activeMerchantAddress) return;
        setIsLoggingIn(true);
        try {
            const nonceRes = await fetch("/api/auth/nonce");
            const nonceData = await nonceRes.json();
            if (!nonceRes.ok || !nonceData.nonce) {
                throw new Error(nonceData.error || "Failed to fetch nonce");
            }
            const fetchedNonce = nonceData.nonce;
            const message = `Sign this message to verify ownership of your SubScript Merchant Dashboard.\n\nNonce: ${fetchedNonce}`;
            const signature = await signMessageAsync({ message });
            
            const res = await fetch("/api/auth/verify-signature", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: activeMerchantAddress, signature, nonce: fetchedNonce }),
            });
            
            const data = await res.json();
            if (data.success) {
                setSessionWallet(activeMerchantAddress.toLowerCase());
            } else {
                console.error("Login failed:", data.error);
            }
        } catch (err) {
            console.error("Error signing message:", err);
        } finally {
            setIsLoggingIn(false);
        }
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            setSessionWallet(null);
            setEmbeddedWallet(null);
            setApiKeys([]);
            setWebhookEndpoints([]);
            setWebhookEvents([]);
            setInitialKeysFetched(false);
            setInitialWebhooksFetched(false);
            setInitialEventsFetched(false);
            setInitialContractFetched(false);
        } catch (err) {
            console.error("Error logging out:", err);
        }
    };

    const handleAddWebhook = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!webhookUrlInput) return;
        setIsAddingWebhook(true);
        try {
            const res = await fetch("/api/webhooks/endpoints", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrlInput }),
            });
            const data = await res.json();
            if (data.endpoint) {
                setWebhookEndpoints(prev => [data.endpoint, ...prev]);
                setWebhookUrlInput("");
            } else {
                alert(data.error || "Failed to add endpoint");
            }
        } catch (err) {
            console.error("Error adding endpoint:", err);
        } finally {
            setIsAddingWebhook(false);
        }
    };

    const handleDeleteWebhook = async (id: string) => {
        if (!confirm("Are you sure you want to delete this webhook endpoint?")) return;
        try {
            const res = await fetch(`/api/webhooks/endpoints?id=${id}`, {
                method: "DELETE",
            });
            const data = await res.json();
            if (data.success) {
                setWebhookEndpoints(prev => prev.filter(e => e.id !== id));
            }
        } catch (err) {
            console.error("Error deleting endpoint:", err);
        }
    };


    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);


    const [ledgers, setLedgers] = useState<any[]>([]);
    const [isLoadingContract, setIsLoadingContract] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);


    useEffect(() => {
        const merchantAddress = address;
        if (!isConnected || !merchantAddress) {
            setLedgers([]);
            return;
        }

        let isSubscribed = true;

        async function fetchOnChainData() {
            if (!merchantAddress) return;
            setIsLoadingContract(true);
            try {
                const nextId = await publicClient.readContract({
                    address: STANDARD_CONTRACT_ADDRESS,
                    abi: STANDARD_ABI,
                    functionName: "nextSubscriptionId",
                });
                
                const nextIdNum = Number(nextId);
                const fetchedLedgers = [];
                
                for (let i = 1; i < nextIdNum; i++) {
                    const sub = await publicClient.readContract({
                        address: STANDARD_CONTRACT_ADDRESS,
                        abi: STANDARD_ABI,
                        functionName: "subscriptions",
                        args: [BigInt(i)],
                    });
                    
                    const [subscriber, merchant, amount, period, nextPayment, isActive] = sub;
                    
                    if (merchant.toLowerCase() === merchantAddress.toLowerCase()) {
                        fetchedLedgers.push({
                            id: `agent-run-${i}`,
                            rawId: String(i),
                            address: subscriber,
                            shortSubAddress: `${subscriber.slice(0, 6)}...${subscriber.slice(-4)}`,
                            limit: `${formatUnits(amount, 6)} USDC / ${Number(period) === 2592000 ? "mo" : Number(period) === 604800 ? "wk" : "yr"}`,
                            rawAmount: formatUnits(amount, 6),
                            rawPeriod: String(period),
                            nextBilling: new Date(Number(nextPayment) * 1000).toLocaleDateString(),
                            active: isActive,
                        });
                    }
                }
                
                if (isSubscribed) {
                    setLedgers(fetchedLedgers);
                    if (fetchedLedgers.length > 0 && !selectedWebhook) {
                        setSelectedWebhook(`evt_01_0`);
                    }
                }
            } catch (err) {
                console.error("Error fetching on-chain subscriptions:", err);
            } finally {
                if (isSubscribed) {
                    setIsLoadingContract(false);
                    setInitialContractFetched(true);
                }
            }
        }

        fetchOnChainData();
        const interval = setInterval(fetchOnChainData, 10000);

        return () => {
            isSubscribed = false;
            clearInterval(interval);
        };
    }, [isConnected, address, isPremium, refreshTrigger]);

    const handleCopy = (text: string, label: string) => {
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(text).catch(err => {
                    console.warn("Clipboard write failed:", err);
                });
            }
        } catch (err) {
            console.warn("Synchronous clipboard write failed:", err);
        }
        setCopiedText(label);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleRollKeys = async () => {
        setIsRolling(true);
        try {
            const res = await fetch("/api/keys", { method: "POST" });
            const data = await res.json();
            if (data.key) {
                setApiKeys([data.key]);
                handleCopy(data.key.secretKeyPlain, "API Secret Key Rolled");
            }
        } catch (err) {
            console.error("Error rolling keys:", err);
        } finally {
            setIsRolling(false);
        }
    };

    const handleRevokeCustomer = async (rawId: string) => {
        try {
            await executeContractWrite({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "cancelSubscription",
                args: [BigInt(rawId)],
            });
            setLedgers(prev => prev.map(item => {
                if (item.rawId === rawId) {
                    return { ...item, active: false };
                }
                return item;
            }));
        } catch (err) {
            console.error("Error revoking subscription on-chain:", err);
        }
    };

    const handleRetryCharge = async (rawId: string) => {
        try {
            const userAddress = address as `0x${string}`;
            
            if (isTestMode) {
                console.log("Mocking retry charge for sub ID:", rawId);
                await new Promise((resolve) => setTimeout(resolve, 1500));
                setRefreshTrigger((prev) => prev + 1);
                return;
            }

            await publicClient.simulateContract({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "executePayment",
                account: userAddress,
                args: [BigInt(rawId)],
            });

            const txHash = await executeContractWrite({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "executePayment",
                args: [BigInt(rawId)],
            });

            const receipt = await publicClient.waitForTransactionReceipt({
                hash: txHash as `0x${string}`,
                timeout: 120_000,
            });

            if (receipt.status !== "success") {
                throw new Error("Payment execution transaction reverted on-chain.");
            }

            await refetchBalancesAndTier();
            setRefreshTrigger((prev) => prev + 1);
        } catch (err: any) {
            console.error("Error retrying subscription charge:", err);
            alert(err.message || "Failed to execute subscription payment.");
            throw err;
        }
    };

    const handleReplayWebhook = async (eventId: string) => {
        setIsReplaying(true);
        setReplayStatus("Replaying event...");
        try {
            const res = await fetch("/api/webhooks/events/replay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventId }),
            });
            const data = await res.json();
            if (data.success) {
                setReplayStatus(`Webhook event successfully re-delivered. HTTP ${data.status} OK.`);
                await fetchWebhookEvents();
            } else {
                setReplayStatus(`Webhook re-delivery failed. HTTP ${data.status}.`);
            }
            setTimeout(() => setReplayStatus(null), 4000);
        } catch (err) {
            console.error("Error replaying webhook:", err);
            setReplayStatus("Network error replaying webhook.");
            setTimeout(() => setReplayStatus(null), 4000);
        } finally {
            setIsReplaying(false);
        }
    };


    const handleWithdraw = async (targetAddress?: string) => {
        if (vaultBalance <= 0) return;
        setIsWithdrawing(true);
        let merchantAddr = (address || "") as Hex;
        let targetPayout = (targetAddress || payoutDestination || "") as string;
        let nullifierHash = "";
        let publicInputHash = "";
        try {
            if (!merchantAddr) {
                throw new Error("No merchant wallet address available.");
            }

            if (
                !targetPayout ||
                targetPayout === "0x0000000000000000000000000000000000000000" ||
                !isAddress(targetPayout)
            ) {
                throw new Error("Configure a valid payout destination before withdrawing.");
            }

            /* Generate random 32-byte burner secret hex */
            const randomBytes = new Uint8Array(32);
            if (typeof window !== "undefined" && window.crypto) {
                window.crypto.getRandomValues(randomBytes);
            } else {
                for (let i = 0; i < 32; i++) {
                    randomBytes[i] = Math.floor(Math.random() * 256);
                }
            }
            const burnerSecret = bytesToHex(randomBytes);
            
            /* Compute nullifier hash (unique per withdrawal to prevent double-spend) */
            nullifierHash = keccak256(encodePacked(["bytes32", "address"], [burnerSecret, merchantAddr]));
            
            /* Compute public input hash binding merchant and target, matching contract logic:
               keccak256(abi.encodePacked(merchant, target)) */
            publicInputHash = keccak256(encodePacked(["address", "address"], [merchantAddr, targetPayout as Hex]));
            
            /* Assemble the proof array: [burnerSecret, publicInputHash] */
            const proof = [burnerSecret, publicInputHash] as readonly `0x${string}`[];
            
            console.log("Generating local proof for private routing...");
            console.log("Merchant Address:", merchantAddr);
            console.log("Payout Target:", targetPayout);
            console.log("Nullifier Hash:", nullifierHash);
            console.log("Public Input Hash:", publicInputHash);
            console.log("Proof Payload:", proof);
            console.log("Local private routing proof simulation completed successfully.");

            const txHash = await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "withdrawWithProof",
                args: [proof, nullifierHash, merchantAddr, targetPayout as Hex],
            });

            /* Post-Execution Client-Side Audit Sync: Register the broadcasted withdrawal hash */
            try {
                await fetch("/api/premium/audit-withdrawal", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        merchantAddress: merchantAddr,
                        destinationAddress: targetPayout,
                        amount: vaultBalance,
                        commitmentHash: publicInputHash,
                        nullifierHash,
                        txHash,
                        proofType: "commit_reveal"
                    })
                });
            } catch (auditErr) {
                console.error("Failed to submit client withdrawal audit:", auditErr);
            }

            setWithdrawSuccess(true);
            setTimeout(() => setWithdrawSuccess(false), 4000);
            refetchVaultBalance();
            refetchWalletBalance();
        } catch (err: any) {
            console.error("Withdraw failed:", err);

            /* If the parameters were successfully constructed, record the transaction broadcast failure */
            if (nullifierHash && publicInputHash) {
                try {
                    await fetch("/api/premium/audit-withdrawal", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            merchantAddress: merchantAddr,
                            destinationAddress: targetPayout,
                            amount: vaultBalance,
                            commitmentHash: publicInputHash,
                            nullifierHash,
                            txHash: null,
                            status: "FAILED_PERMANENTLY_CONTRACT",
                            errorMessage: err.message || "Transaction signature or execution failed.",
                            proofType: "commit_reveal"
                        })
                    });
                } catch (auditErr) {
                    console.error("Failed to log failed withdrawal audit:", auditErr);
                }
            }

            throw err;
        } finally {
            setIsWithdrawing(false);
        }
    };



    const getCheckoutErrorMessage = (error: any) => {
        /* Walk the error to find the root cause if it is a viem/wagmi error */
        let message = error?.shortMessage || error?.reason || error?.message || "";
        let currentError = error;
        while (currentError) {
            if (currentError.shortMessage) {
                message = currentError.shortMessage;
            } else if (currentError.reason) {
                message = currentError.reason;
            } else if (currentError.details) {
                message = currentError.details;
            }
            currentError = currentError.walk ? currentError.walk() : currentError.cause;
        }

        const code = error?.code || error?.cause?.code || error?.details?.code;
        if (code === 4001 || /user rejected|rejected by user|user denied/i.test(String(message || ""))) {
            return "Transaction was rejected in the wallet.";
        }
        if (/insufficient allowance/i.test(String(message || ""))) {
            return "USDC allowance is insufficient for the premium router.";
        }
        if (/insufficient funds|exceeds balance/i.test(String(message || ""))) {
            return "Wallet has insufficient USDC or gas balance for this payment.";
        }
        if (/execution reverted|revert/i.test(String(message || ""))) {
            return `Contract reverted: ${message}`;
        }
        return message || "Premium checkout failed. Please try again.";
    };

    const handleUpgrade = async () => {
        if (!isConnected || !activeMerchantAddress) {
            setPremiumError("Please connect your merchant wallet first.");
            return;
        }

        /* Enforce locking controls so user cannot submit multiple times */
        if (isSubscribingPremium) {
            return;
        }

        setIsSubscribingPremium(true);
        setPremiumStatus("Checking network");
        setPremiumError(null);

        try {
            if (!isAddress(activeMerchantAddress)) {
                throw new Error("Connected wallet address is invalid.");
            }

            if (!embeddedWallet && chainId !== ARC_TESTNET_CHAIN_ID) {
                setPremiumStatus("Switching to Arc Testnet");
                if (switchChainAsync) {
                    await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
                } else {
                    switchChain?.({ chainId: ARC_TESTNET_CHAIN_ID });
                    throw new Error("Switch to Arc Testnet and retry checkout.");
                }
            }

            const userAddress = getAddress(activeMerchantAddress) as `0x${string}`;

            /* Instantiate the USDC ERC20 contract using getContract from viem */
            const usdcContract = getContract({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                client: publicClient,
            });

            setPremiumStatus("Checking USDC decimals");
            const tokenDecimals = await usdcContract.read.decimals();
            if (Number(tokenDecimals) !== 6) {
                throw new Error(`Unexpected USDC decimals: ${tokenDecimals}. Expected 6.`);
            }

            const planPrice = parseUnits(PREMIUM_PLAN_PRICE_USDC, Number(tokenDecimals));
            const approvalAmount = parseUnits("120", Number(tokenDecimals));
            const subscriptionPeriod = 2592000;

            /* Register purchase intent session in the database first */
            setPremiumStatus("Registering purchase intent");
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

            setPremiumStatus("Approving USDC Allowance");
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

            setPremiumStatus("Waiting for approval confirmation...");
            const approveReceipt = await publicClient.waitForTransactionReceipt({
                hash: approveTxHash as `0x${string}`,
                timeout: 120_000,
            });

            if (approveReceipt.status !== "success") {
                throw new Error("USDC approval transaction reverted.");
            }

            setPremiumStatus("Creating Premium Subscription");
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

            posthog.capture("premium_upgrade_initiated");

            setPremiumStatus("Confirming subscription on-chain...");
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

            if (!createLog) {
                throw new Error("SubscriptionCreated event not found in logs.");
            }

            const subId = Number(createLog.args.subId);

            setPremiumStatus("Syncing premium state with server...");
            const upgradeRes = await fetch("/api/premium/upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    txHash,
                    sessionId: checkoutData.sessionId,
                    subId,
                }),
            });
            const upgradeData = await upgradeRes.json();
            if (!upgradeRes.ok) {
                throw new Error(upgradeData.error || "Failed to finalize premium upgrade on server");
            }

            posthog.capture("premium_upgrade_success");

            setPremiumStatus("Subscription active! Premium tier activated.");
            await refetchBalancesAndTier();
            setTimeout(() => setPremiumStatus(null), 4000);
        } catch (err: any) {
            console.error("Premium subscription failed:", err);
            setPremiumError(getCheckoutErrorMessage(err));
        } finally {
            setIsSubscribingPremium(false);
        }
    };

    const handleCancelPremium = async () => {
        if (!isConnected || !activeMerchantAddress || !isPremium) {
            setPremiumError("No active subscription metadata to cancel.");
            return;
        }

        if (isCancellingPremium) {
            return;
        }

        if (!confirm("Are you sure you want to cancel your Premium Plan subscription? Your Premium benefits will remain active until the end of your current billing period.")) {
            return;
        }

        setIsCancellingPremium(true);
        setPremiumStatus("Executing cancellation...");
        setPremiumError(null);

        try {
            /* Send the POST request to /api/premium/cancel */
            const cancelRes = await fetch("/api/premium/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const cancelData = await cancelRes.json();
            if (!cancelRes.ok) {
                throw new Error(cancelData.error || "Failed to sync cancellation to database.");
            }

            const dateStr = cancelData.nextBillingDate ? new Date(cancelData.nextBillingDate).toLocaleDateString() : "the end of the current period";
            setPremiumStatus(`Your Premium subscription will remain active until ${dateStr}. You can resume anytime before that date.`);
            await refetchBalancesAndTier();
            setTimeout(() => setPremiumStatus(null), 8000);
        } catch (err: any) {
            console.error("Cancellation failed:", err);
            setPremiumError(err.message || "Cancellation failed.");
        } finally {
            setIsCancellingPremium(false);
        }
    };

    const handleResumePremium = async () => {
        if (!isConnected || !activeMerchantAddress || !isPremium || !cancelAtPeriodEnd) {
            setPremiumError("No cancellation schedule to resume.");
            return;
        }

        if (isResumingPremium) {
            return;
        }

        setIsResumingPremium(true);
        setPremiumStatus("Restoring premium subscription...");
        setPremiumError(null);

        try {
            const resumeRes = await fetch("/api/premium/resume", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const resumeData = await resumeRes.json();
            if (!resumeRes.ok) {
                throw new Error(resumeData.error || "Failed to resume subscription.");
            }

            setPremiumStatus("Premium renewal has been restored. Your subscription will continue normally.");
            await refetchBalancesAndTier();
            setTimeout(() => setPremiumStatus(null), 6000);
        } catch (err: any) {
            console.error("Resume failed:", err);
            setPremiumError(err.message || "Resume failed.");
        } finally {
            setIsResumingPremium(false);
        }
    };


    const handleReroute = async () => {
        if (!rerouteAddress || !rerouteAddress.startsWith("0x") || rerouteAddress.length !== 42) {
            setPremiumError("Please enter a valid Ethereum address (0x...).");
            return;
        }
        setIsRerouting(true);
        setPremiumError(null);
        try {
            await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "configurePayoutDestination",
                args: [rerouteAddress as `0x${string}`],
            });
            setRerouteSuccess(true);
            setTimeout(() => setRerouteSuccess(false), 4000);
            refetchPayoutDest();
        } catch (err: any) {
            console.error("Reroute failed:", err);
            setPremiumError(err.shortMessage || err.message || "Reroute transaction failed");
        } finally {
            setIsRerouting(false);
        }
    };


    const handleTriggerKeeper = async () => {
        setIsTriggeringKeeper(true);
        setKeeperStatus(null);
        setKeeperError(null);
        try {
            const response = await fetch("/api/keeper/trigger", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to trigger keepers");
            }
            if (data.executedCount > 0) {
                setKeeperStatus(`Checked successfully. Executed ${data.executedCount} recurring subscription payment(s) on-chain!`);
            } else {
                setKeeperStatus("Checked successfully. No recurring subscriptions are currently due for renewal.");
            }
            setTimeout(() => setKeeperStatus(null), 5000);
            refetchBalancesAndTier();
        } catch (err: any) {
            console.error("Manual keeper trigger failed:", err);
            setKeeperError(err.message || "Execution failed");
            setTimeout(() => setKeeperError(null), 5000);
        } finally {
            setIsTriggeringKeeper(false);
        }
    };

    const merchantWalletAddress = activeMerchantAddress || "";
    const billingPeriodSeconds = useMemo(() => {
        if (subInterval === "weekly") return "604800";
        if (subInterval === "yearly") return "31536000";
        return "2592000";
    }, [subInterval]);

    const activeKeyForSnippet = apiKeys.find(k => !k.revoked);
    const publishableKeyForSnippet = activeKeyForSnippet ? activeKeyForSnippet.publishableKey : "pk_test_YOUR_PUBLISHABLE_KEY";

    const checkoutCode = useMemo(() => `<SubScriptCheckout
  publishableKey="${publishableKeyForSnippet}"
  merchantAddress="${merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS"}"
  planName="${subName}"
  amountCap="${subCap}"
  interval="${subInterval}"
  fundingChain="${subChain}"
  mode="${promptFlowMode}"
/>`, [merchantWalletAddress, subCap, subChain, subInterval, subName, publishableKeyForSnippet, promptFlowMode]);

    const agentIntegrationPrompt = useMemo(() => {
        if (promptFlowMode === "standard") {
            return `Act as an elite full-stack Web3 integration engineer. You are integrating the SubScript Decentralized Subscription Protocol into my application.

SubScript uses standard transparent on-chain subscriptions on Arc Testnet for standard tier merchants.

LIVE MERCHANT DEPLOYMENT DETAILS:
- Merchant Payout Wallet: "${merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS"}"
- Plan Name: "${subName}"
- Price per Period: "${subCap}" USDC (6 decimals, formatted as parseUnits('${subCap}', 6))
- Billing Interval: ${billingPeriodSeconds} seconds
- SubScript Contract: "${STANDARD_CONTRACT_ADDRESS}"
- USDC Contract (Native Gas Token): "${USDC_NATIVE_GAS_ADDRESS}"
- Network: Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID}, RPC: https://rpc.testnet.arc.network)
- Routing Metadata: { "routing": "traceable" }

To implement this project, follow this sequential 6-mission roadmap. Each mission must be completed completely with no TODOs or mock interfaces.

---

MISSION 1 — DATABASE SCHEMA & RELATIONS
Responsibilities:
- Create normalized PostgreSQL schemas (via Prisma) for: users, wallets, subscriptions, entitlements, subscription_events, payment_events, webhook_events, and audit_logs.
- Implement relational constraints, foreign keys, and indexes supporting lookups (entitlement, subscription, wallet) and webhook idempotency.
- Enforce unique constraints on webhook events (e.g., event hash/provider ID + destination endpoint) for DB-level deduplication.
- Design database queries to be row-locking compatible.

MISSION 2 — ENTITLEMENT ENGINE & REDIS CACHE
Responsibilities:
- Implement resolveAccess(), grantEntitlement(), and revokeEntitlement() with row-level locks on writes.
- Cache entitlement results in Redis (TTL = 300 seconds), evicting cached records on grant or revoke.
- CRITICAL: Entitlements must never rely on background cleanup jobs. resolveAccess() must treat expired records (validUntil <= now()) as revoked even if the database status remains ACTIVE.
- Derive entitlement duration strictly from database plan definitions (never accept duration from caller inputs).

MISSION 3 — FRONTEND CHECKOUT HOOK
Responsibilities:
- Implement a React hook useSubscriptCheckout() using viem.
- Handle standard transparent checkout flow:
  1. Approve USDC allowance for the contract: approve(STANDARD_CONTRACT_ADDRESS, parseUnits('${subCap}', 6) * 12).
  2. Call createSubscription(merchant, parseUnits('${subCap}', 6), periodSeconds) from user's connected wallet.
- Display transaction states (approving, executing, success, error) with clean, minimal text/loaders.

MISSION 4 — IDEMPOTENT WEBHOOK PROCESSOR
Responsibilities:
- Create a POST /api/webhooks route to ingest webhook events.
- Verify HMAC-SHA256 signature using the configured webhook_secret_key. Reject invalid signatures.
- Process subscription events: activated, payment.succeeded, payment.failed, cancelled, expired, updating entitlements.
- CRITICAL: A database unique constraint is required for idempotency. Application-level deduplication (e.g. cache lookups) alone is insufficient.

MISSION 5 — MIDDLEWARE & ACCESS CONTROL
Responsibilities:
- Protect all premium routes using Next.js middleware by evaluating entitlement status (Redis first, DB second).
- CRITICAL: Middleware must not instantiate PrismaClient or open TCP database connections directly. Middleware may only use Redis, an HTTP API route, or an Edge-compatible database endpoint.

MISSION 6 — SYSTEM INTEGRATION VERIFICATION
Responsibilities:
- Write comprehensive integration tests to verify: subscription activation, entitlement creation, webhook replay resistance, passive entitlement expiration, middleware route protection, and cache invalidation.
- Implement concurrency tests and replay attack verification.`;
        }

        return `Act as an elite full-stack Web3 integration engineer. You are integrating the SubScript Decentralized Subscription Protocol into my application.

SubScript uses ZK Burner Proofs on Arc Testnet to implement secure, automated, recurring subscriptions.

LIVE MERCHANT DEPLOYMENT DETAILS:
- Merchant Payout Wallet: "${merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS"}"
- Plan Name: "${subName}"
- Price per Period: "${subCap}" USDC (6 decimals, formatted as parseUnits('${subCap}', 6))
- Billing Interval: ${billingPeriodSeconds} seconds
- SubScript Router Contract: "${SUBSCRIPT_ROUTER_ADDRESS}"
- USDC Contract (Native Gas Token): "${USDC_NATIVE_GAS_ADDRESS}"
- Network: Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID}, RPC: https://rpc.testnet.arc.network)
- Routing Metadata: { "routing": "private" }

To implement this project, follow this sequential 7-mission roadmap. Each mission must be completed completely with no TODOs or mock interfaces.

---

MISSION 1 — DATABASE SCHEMA & RELATIONS
Responsibilities:
- Create normalized PostgreSQL schemas (via Prisma) for: users, wallets, subscriptions, entitlements, subscription_events, payment_events, webhook_events, and audit_logs.
- Implement relational constraints, foreign keys, and indexes supporting lookups (entitlement, subscription, wallet) and webhook idempotency.
- Enforce unique constraints on webhook events (e.g., event hash/provider ID + destination endpoint) for DB-level deduplication.
- Design database queries to be row-locking compatible.

MISSION 2 — ENTITLEMENT ENGINE & REDIS CACHE
Responsibilities:
- Implement resolveAccess(), grantEntitlement(), and revokeEntitlement() with row-level locks on writes.
- Cache entitlement results in Redis (TTL = 300 seconds), evicting cached records on grant or revoke.
- CRITICAL: Entitlements must never rely on background cleanup jobs. resolveAccess() must treat expired records (validUntil <= now()) as revoked even if the database status remains ACTIVE.
- Derive entitlement duration strictly from database plan definitions (never accept duration from caller inputs).

MISSION 3 — SERVER RELAYER ENGINE
Responsibilities:
- Implement burner activation relay flow using viem on the server to execute verifyAndActivate().
- Server signs activation transaction; frontend burner wallet never funds gas.
- CRITICAL: Relayer state must survive process restarts. The nonce source of truth must not be in-memory. Persist nonce coordination using Redis or database locking.
- Manage tx propagation, handling RPC failures, dropped transactions, replacements (gas speed-up), and chain reorgs.

MISSION 4 — DETERMINISTIC CRYPTOGRAPHY & FRONTEND HOOKS
Responsibilities:
- Implement useSubscriptCheckout() to handle ZK Burner private flow (approve router, commit keccak256(secret), depositAndCommit(), sign/verify signature).
- Derive AES key from deterministic EIP-191 signature. Encrypt secret, store ciphertext only.
- CRITICAL: The signature itself must never be stored. Only derived key material or ciphertext metadata may persist.
- Implement wallet reconnect, multi-device, and browser refresh recovery.

MISSION 5 — IDEMPOTENT WEBHOOK PROCESSOR
Responsibilities:
- Create a POST /api/webhooks route to ingest webhook events.
- Verify HMAC-SHA256 signature using the configured webhook_secret_key. Reject invalid signatures.
- Process subscription events: activated, payment.succeeded, payment.failed, cancelled, expired, updating entitlements.
- CRITICAL: A database unique constraint is required for idempotency. Application-level deduplication (e.g. cache lookups) alone is insufficient.

MISSION 6 — MIDDLEWARE & ACCESS CONTROL
Responsibilities:
- Protect all premium routes using Next.js middleware by evaluating entitlement status (Redis first, DB second).
- CRITICAL: Middleware must not instantiate PrismaClient or open TCP database connections directly. Middleware may only use Redis, an HTTP API route, or an Edge-compatible database endpoint.

MISSION 7 — SYSTEM INTEGRATION VERIFICATION
Responsibilities:
- Write comprehensive integration tests to verify: subscription activation, entitlement creation, relayer execution, webhook replay resistance, entitlement expiration, middleware route protection, cache invalidation, and multi-device recovery.
- Implement concurrency tests, replay attack tests, and relayer nonce collision tests.`;
    }, [activeMerchantAddress, merchantWalletAddress, subName, subCap, billingPeriodSeconds, promptFlowMode]);

    const cursorMcpConfig = useMemo(() => JSON.stringify({
        mcpServers: {
            subscript: {
                command: "npx",
                args: ["-y", "@subscript-protocol/mcp"],
                env: {
                    SUBSCRIPT_MERCHANT_ADDRESS: merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS",
                    SUBSCRIPT_CHAIN_ID: String(ARC_TESTNET_CHAIN_ID),
                    SUBSCRIPT_ROUTER_ADDRESS,
                    SUBSCRIPT_USDC_NATIVE_GAS_ADDRESS: USDC_NATIVE_GAS_ADDRESS,
                },
            },
        },
    }, null, 2), [merchantWalletAddress]);

    const handleConnect = () => {
        const connector = connectors.find((c) => c.id === "injected") || connectors[0];
        if (connector) {
            connect({ connector });
        } else {
            connect({ connector: injected() });
        }
    };


    const activeAllowances = ledgers.filter(l => l.active).length;
    const revokedCount = ledgers.filter(l => !l.active).length;
    const totalSubs = ledgers.length;
    const failureRate = totalSubs > 0 ? ((revokedCount / totalSubs) * 100).toFixed(1) : "0.0";
    const projected30DaySettlement = ledgers.reduce((acc, sub) => {
        if (!sub.active) return acc;
        const amountNum = parseFloat(sub.rawAmount) || 0;
        const periodNum = parseFloat(sub.rawPeriod) || 2592000;
        const monthlyEquivalent = amountNum * (2592000 / periodNum);
        return acc + monthlyEquivalent;
    }, 0);

    const primaryColorText = "text-[#00d2b4]";
    const primaryColorBg = "bg-[#00d2b4]";

    const renderPremiumLock = (tabLabel: string) => {
        return (
            <div className="liquid-glass border border-[#d4a853]/20 rounded-3xl p-10 shadow-2xl bg-black/60 flex flex-col items-center justify-center text-center gap-6 min-h-[400px] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#d4a853]/5 rounded-full blur-3xl -z-10" />
                <div className="p-5 rounded-3xl bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853] animate-pulse">
                    <Crown className="w-12 h-12" />
                </div>
                <div className="space-y-3 max-w-md">
                    <h2 className="text-xl font-extrabold text-white uppercase tracking-wider">Premium Feature Locked</h2>
                    <p className="text-xs text-white/60 leading-relaxed font-sans">
                        Access to <span className="font-semibold text-white">{tabLabel}</span> requires an active SubScript Premium subscription. Upgrade to unlock keys, private checkout generation, and webhook event streaming.
                    </p>
                </div>
                <button
                    onClick={() => setActiveTab("premium")}
                    className="px-8 py-3 bg-[#d4a853] hover:bg-[#d4a853]/80 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(212,168,83,0.2)]"
                >
                    <Crown className="w-4 h-4" />
                    Upgrade to Premium
                </button>
            </div>
        );
    };

    const renderView = () => {
        if (!isPremium && ["apikeys", "checkout", "webhooks"].includes(activeTab)) {
            const labelMap = {
                apikeys: "API Keys Management",
                checkout: "Checkout Setup & Generator",
                webhooks: "Developer Webhooks"
            };
            return renderPremiumLock(labelMap[activeTab as "apikeys" | "checkout" | "webhooks"]);
        }

        switch (activeTab) {
            case "analytics":
                return (
                    <AnalyticsDashboard
                        isPremium={isPremium}
                        setActiveTab={setActiveTab}
                        walletBalance={walletBalance}
                        vaultBalance={vaultBalance}
                        ledgers={ledgers}
                        onRetryCharge={handleRetryCharge}
                    />
                );

            case "overview":
                return (
                    <div className="space-y-8">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            {/* Wallet Balance */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Wallet Balance</p>
                                <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                    ${walletBalance.toFixed(2)}
                                </p>
                                <p className="text-[10px] text-white/30 flex items-center gap-1">
                                    <Wallet className="w-3 h-3 text-[#00d2b4]" /> USDC in connected wallet
                                </p>
                            </div>

                            {/* Vault Balance */}
                            <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Vault Balance</p>
                                <p className={`text-3xl font-extrabold ${primaryColorText} mb-1 tracking-tight`}>
                                    ${vaultBalance.toFixed(2)}
                                </p>
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] text-white/30">Claimable USDC in router</p>
                                    <button
                                        onClick={() => handleWithdraw()}
                                        disabled={vaultBalance <= 0 || isWithdrawing}
                                        className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                                            vaultBalance > 0 
                                                ? "border-[#00d2b4]/30 text-[#00d2b4] hover:bg-[#00d2b4]/10" 
                                                : "border-white/5 text-white/20 cursor-not-allowed"
                                        }`}
                                    >
                                        {isWithdrawing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <ArrowDownToLine className="w-2.5 h-2.5" />}
                                        Withdraw
                                    </button>
                                </div>
                                {withdrawSuccess && (
                                    <p className="text-[10px] text-emerald-400 mt-2 font-semibold">Withdrawal successful</p>
                                )}
                            </div>

                            {/* Active Allowances */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Active Allowances</p>
                                <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                    {isLoadingContract ? "..." : activeAllowances}
                                </p>
                                <p className="text-[10px] text-white/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                    Active M2M contracts
                                </p>
                            </div>

                            {/* 30 Day Settlement */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">30-Day Projection</p>
                                <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                    {isLoadingContract ? "..." : `$${projected30DaySettlement.toFixed(2)}`}
                                </p>
                                <p className="text-[10px] text-white/30">Estimated monthly volume</p>
                            </div>
                        </div>

                        {/* Tier Badge */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-5 shadow-xl flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-xl ${isPremium ? "bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853]" : "bg-white/5 border border-white/10 text-white/40"}`}>
                                    {isPremium ? <Crown className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-white uppercase tracking-wider">
                                        {isPremium ? "Premium Tier" : "Standard Tier"}
                                    </p>
                                    <p className="text-[10px] text-white/40">
                                        {isPremium ? "Full access to rerouting, analytics, and priority execution" : "Basic dashboard access — upgrade for premium features"}
                                    </p>
                                </div>
                            </div>
                            {!isPremium && (
                                <button
                                    onClick={() => setActiveTab("premium")}
                                    className="px-4 py-2 bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853] text-[10px] font-bold uppercase tracking-wider rounded-full hover:bg-[#d4a853]/20 transition-all"
                                >
                                    Upgrade
                                </button>
                            )}
                        </div>

                        {/* Customer / Agent Ledger */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                                <Activity className={`w-4 h-4 ${primaryColorText}`} />
                                Customer / Agent Ledger
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-white/5 text-white/40 text-[10px] uppercase font-bold tracking-wider">
                                            <th className="pb-3">ID</th>
                                            <th className="pb-3">Subscriber</th>
                                            <th className="pb-3">Allowance</th>
                                            <th className="pb-3">Next Billing</th>
                                            <th className="pb-3">Status</th>
                                            <th className="pb-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-xs text-white/70 font-mono">
                                        {isLoadingContract ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-white/40 flex items-center justify-center gap-2">
                                                    <Loader2 className="w-4 h-4 animate-spin" /> Fetching on-chain state...
                                                </td>
                                            </tr>
                                        ) : ledgers.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-white/30 font-sans">
                                                    No active recurring allowances detected for this merchant address.
                                                </td>
                                            </tr>
                                        ) : (
                                            ledgers.map((item) => (
                                                <tr key={item.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                                                    <td className="py-4 font-semibold text-white">{item.id}</td>
                                                    <td className="py-4 text-white/40" title={item.address}>{item.shortSubAddress}</td>
                                                    <td className="py-4 text-[#d4a853]">{item.limit}</td>
                                                    <td className="py-4">{item.nextBilling}</td>
                                                    <td className="py-4">
                                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                                            item.active 
                                                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                                : "bg-red-500/10 text-red-400 border border-red-500/20"
                                                        }`}>
                                                            {item.active ? "Active" : "Revoked"}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 text-right">
                                                        {item.active ? (
                                                            <button 
                                                                onClick={() => handleRevokeCustomer(item.rawId)}
                                                                className="p-1.5 text-red-400 hover:text-white hover:bg-red-500/10 rounded-lg transition-all"
                                                                title="Revoke Allowance"
                                                            >
                                                                <ShieldX className="w-4 h-4" />
                                                            </button>
                                                        ) : (
                                                            <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold">Ended</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );

            case "premium":
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
                            <Shield className="w-10 h-10 mx-auto text-[#00d2b4] animate-pulse" />
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Verify Wallet Ownership</h2>
                            <p className="text-xs text-white/50 leading-relaxed max-w-xs mx-auto">
                                To manage premium subscriptions and security configurations, please sign a secure message using your connected wallet.
                            </p>
                            <button
                                onClick={handleBackendLogin}
                                disabled={isLoggingIn}
                                className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                            >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Shield className="w-4 h-4" />}
                                Authenticate Developer Portal
                            </button>
                        </div>
                    );
                }

                return (
                    <div className="space-y-8">
                        {/* Tier Status Card */}
                        <div className={`liquid-glass border rounded-3xl p-8 shadow-2xl relative overflow-hidden ${isPremium ? "border-[#d4a853]/30 bg-gradient-to-b from-[#d4a853]/[0.03] to-transparent" : "border-white/5"}`}>
                            <div className="flex items-start gap-4">
                                <div className={`p-3 rounded-2xl ${isPremium ? "bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853]" : "bg-white/5 border border-white/10 text-white/40"}`}>
                                    <Crown className="w-8 h-8" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 className="text-xl font-extrabold text-white uppercase tracking-tight">
                                            {isPremium ? "Premium Active" : "Standard Tier"}
                                        </h2>
                                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                            isPremium 
                                                ? "bg-[#d4a853]/10 text-[#d4a853] border border-[#d4a853]/20" 
                                                : "bg-white/5 text-white/40 border border-white/10"
                                        }`}>
                                            Tier {merchantTier}
                                        </span>
                                    </div>
                                    <p className="text-xs text-white/50 leading-relaxed">
                                        {isPremium 
                                            ? "You have full access to payout rerouting, priority keeper execution, advanced analytics, and multi-wallet support." 
                                            : "Upgrade to Premium to unlock payout rerouting, priority execution, advanced analytics, and more."
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>

                        {isPremium ? (
                            <>
                                {/* PAST_DUE Warning Banner */}
                                {dbSubscriptionStatus === "PAST_DUE" && (
                                    <div className="liquid-glass border border-amber-500/20 rounded-3xl p-6 shadow-2xl space-y-4 bg-amber-500/[0.02]">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                                                <AlertTriangle className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Premium Grace Period</h3>
                                                <p className="text-xs text-white/50">Payment failed — access temporarily preserved</p>
                                            </div>
                                        </div>
                                        <p className="text-xs text-white/70 leading-relaxed font-sans">
                                            Your Premium renewal payment could not be processed. Premium access remains active during the grace period. Please restore wallet balance or allowance to avoid interruption.
                                        </p>
                                        <div className="grid grid-cols-2 gap-4 bg-black/40 border border-white/5 rounded-2xl p-4">
                                            <div>
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest leading-none mb-1">Billing Status</p>
                                                <p className="text-xs font-semibold text-amber-400">Attempt {downgradeFailures} of 3</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest leading-none mb-1">Grace Period</p>
                                                <p className="text-xs font-semibold text-white/80">{3 - downgradeFailures} {3 - downgradeFailures === 1 ? "day" : "days"} remaining</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Payout Rerouting Controls */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                        <ArrowRightLeft className="w-4 h-4 text-[#d4a853]" />
                                        Fund Rerouting
                                    </h3>

                                    {/* Current Destination */}
                                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-2">Current Payout Destination</p>
                                        {payoutDestination ? (
                                            <div className="flex items-center gap-3">
                                                <code className="text-sm font-mono text-[#d4a853] break-all">{payoutDestination}</code>
                                                <button
                                                    onClick={() => handleCopy(payoutDestination, "Payout Destination")}
                                                    className="p-1.5 text-white/30 hover:text-white rounded-lg hover:bg-white/5 transition-all flex-shrink-0"
                                                >
                                                    {copiedText === "Payout Destination" ? <Check className="w-3.5 h-3.5 text-[#00d2b4]" /> : <Copy className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-white/50">Default — funds route to your connected wallet ({address?.slice(0, 6)}...{address?.slice(-4)})</p>
                                        )}
                                    </div>

                                    {/* Set New Destination */}
                                    <div>
                                        <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">
                                            New Destination Address
                                        </label>
                                        <div className="flex gap-3">
                                            <input 
                                                type="text" 
                                                value={rerouteAddress} 
                                                onChange={(e) => setRerouteAddress(e.target.value)}
                                                placeholder="0x... cold storage, multisig, or ledger address"
                                                className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-[#d4a853]/50 transition-colors placeholder:text-white/20"
                                            />
                                            <button
                                                onClick={handleReroute}
                                                disabled={isRerouting || !rerouteAddress}
                                                className="px-5 py-3 bg-[#d4a853] text-black font-bold rounded-xl text-xs uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {isRerouting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                                                Reroute
                                            </button>
                                        </div>
                                        {rerouteSuccess && (
                                            <p className="text-emerald-400 text-xs mt-3 font-semibold">Payout destination updated on-chain successfully!</p>
                                        )}
                                        {premiumError && (
                                            <p className="text-red-400 text-xs mt-3 font-mono break-all">{premiumError}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Manual Keeper Execution Control */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                        <PlugZap className="w-4 h-4 text-[#d4a853]" />
                                        Keeper Force Execution
                                    </h3>
                                    <p className="text-xs text-white/50 leading-relaxed">
                                        Force the SubScript protocol keepers to check and execute any due subscription payments for your wallet immediately on-chain, bypassing the standard scheduler loop.
                                    </p>
                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-black/40 border border-white/5 rounded-2xl p-5">
                                        <div>
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest leading-none mb-1">Status</p>
                                            <p className="text-xs font-semibold text-white/80">Schedule: Idle (60s cycles)</p>
                                        </div>
                                        <button
                                            onClick={handleTriggerKeeper}
                                            disabled={isTriggeringKeeper}
                                            className="px-5 py-3 bg-[#d4a853] text-black font-bold rounded-xl text-xs uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {isTriggeringKeeper ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                            Run Keepers
                                        </button>
                                    </div>
                                    {keeperStatus && (
                                        <p className="text-emerald-400 text-xs font-semibold">{keeperStatus}</p>
                                    )}
                                    {keeperError && (
                                        <p className="text-red-400 text-xs font-mono break-all">{keeperError}</p>
                                    )}
                                </div>

                                {/* Subscription Cancellation Control */}
                                <div className="liquid-glass border border-red-500/20 rounded-3xl p-6 shadow-2xl space-y-6 bg-red-500/[0.01]">
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                        <ShieldAlert className="w-4 h-4 text-red-400" />
                                        {cancelAtPeriodEnd ? "Subscription Scheduled to End" : "Cancel Subscription"}
                                    </h3>
                                    <p className="text-xs text-white/50 leading-relaxed font-sans">
                                        {cancelAtPeriodEnd 
                                            ? `Your Premium subscription will remain active until ${currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : "the end of the current period"}. You can resume anytime before that date.`
                                            : "Cancel your active SubScript Premium subscription. Your Premium benefits will remain active until the end of your current billing period."
                                        }
                                    </p>
                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-black/40 border border-white/5 rounded-2xl p-5">
                                        <div>
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest leading-none mb-1">Billing Status</p>
                                            <p className="text-xs font-semibold text-white/80">
                                                 {cancelAtPeriodEnd ? "Pending Cancellation" : "Active (Renews monthly)"}
                                            </p>
                                        </div>
                                        {cancelAtPeriodEnd ? (
                                            <button
                                                onClick={handleResumePremium}
                                                disabled={isResumingPremium || !isPremium}
                                                className="px-5 py-3 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold border border-emerald-500/30 rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                {isResumingPremium ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                                Continue Subscription
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleCancelPremium}
                                                disabled={isCancellingPremium || !isPremium}
                                                className="px-5 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 font-bold border border-red-500/30 rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                {isCancellingPremium ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                                                Cancel Premium Plan
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Premium Features Summary */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    {[
                                        { icon: ArrowRightLeft, title: "Fund Rerouting", desc: "Route subscription funds to cold storage, multisig, or custom wallets.", active: true },
                                        { icon: Activity, title: "Priority Execution", desc: "Keeper bots prioritize your subscription renewals in the execution queue.", active: true },
                                        { icon: Webhook, title: "Advanced Webhooks", desc: "Full webhook event stream with payload inspection and replay capability.", active: true },
                                        { icon: Key, title: "Full API Access", desc: "Publishable and secret API keys for backend SDK integration.", active: true },
                                    ].map((feature, idx) => (
                                        <div key={idx} className="liquid-glass border border-white/5 rounded-2xl p-5 flex items-start gap-3">
                                            <div className="p-2 bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853] rounded-xl flex-shrink-0">
                                                <feature.icon className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-white uppercase tracking-wider mb-0.5">{feature.title}</p>
                                                <p className="text-[10px] text-white/40 leading-relaxed">{feature.desc}</p>
                                            </div>
                                            <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">Active</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            /* Upgrade CTA for Standard tier */
                            <div className="liquid-glass border border-[#d4a853]/20 rounded-3xl p-8 shadow-2xl bg-gradient-to-b from-[#d4a853]/[0.02] to-transparent">
                                <div className="max-w-lg mx-auto text-center space-y-6">
                                    <div className="space-y-2">
                                        <h3 className="text-lg font-extrabold text-white uppercase tracking-tight">Upgrade to Premium</h3>
                                        <p className="text-xs text-white/50 leading-relaxed">
                                            Unlock fund rerouting to cold storage and multisigs, priority keeper execution, advanced analytics, and full API access.
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-center gap-2">
                                        <span className="text-3xl font-extrabold text-[#d4a853]">$10.00</span>
                                        <span className="text-xs text-white/40">USDC / month</span>
                                    </div>

                                    <button
                                        onClick={handleUpgrade}
                                        disabled={isSubscribingPremium}
                                        className="px-8 py-3.5 bg-gradient-to-r from-[#d4a853] to-[#c49240] text-[#111111] font-extrabold text-xs uppercase tracking-widest rounded-full shadow-[0_4px_25px_rgba(212,168,83,0.3)] hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-2 mx-auto"
                                    >
                                        {isSubscribingPremium ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                                        ) : (
                                            <><Crown className="w-4 h-4" /> Upgrade Now</>
                                        )}
                                    </button>

                                    {premiumStatus && (
                                        <p className="text-xs text-[#d4a853] font-semibold animate-pulse">{premiumStatus}</p>
                                    )}
                                    {premiumError && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-xs font-mono break-all">
                                            {premiumError}
                                        </div>
                                    )}

                                    {/* Features list */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left pt-4 border-t border-white/5">
                                        {[
                                            "Fund rerouting to multisig",
                                            "Priority keeper execution",
                                            "Advanced analytics",
                                            "Full API & webhook access",
                                            "Multi-wallet support",
                                            "Premium merchant badge"
                                        ].map((f, i) => (
                                            <div key={i} className="flex items-center gap-2 text-xs text-white/60">
                                                <Check className="w-3.5 h-3.5 text-[#d4a853] flex-shrink-0" /> {f}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );

            case "apikeys":
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
                            <Shield className="w-10 h-10 mx-auto text-[#00d2b4] animate-pulse" />
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Verify Wallet Ownership</h2>
                            <p className="text-xs text-white/50 leading-relaxed max-w-xs mx-auto">
                                To protect your API credentials and webhook endpoints, please sign a secure message using your connected wallet.
                            </p>
                            <button
                                onClick={handleBackendLogin}
                                disabled={isLoggingIn}
                                className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                            >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Shield className="w-4 h-4" />}
                                Authenticate Developer Portal
                            </button>
                        </div>
                    );
                }

                const activeKey = apiKeys.find(k => !k.revoked) || null;
                const activePublishableKey = activeKey ? activeKey.publishableKey : "";
                const activeSecretKey = activeKey ? activeKey.secretKeyPlain : "";

                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-8">
                        <div className="flex justify-between items-start">
                            <div>
                                <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Key className={`w-5 h-5 ${primaryColorText}`} />
                                    API Credentials
                                </h2>
                                <p className="text-xs text-white/50 font-sans leading-relaxed">
                                    Use these keys to authenticate your backend with the SubScript SDK.
                                    API credentials are secure and persisted in the database.
                                </p>
                            </div>
                            {sessionWallet && (
                                <button
                                    onClick={handleLogout}
                                    className="px-3 py-1.5 border border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 rounded-xl text-[10px] font-sans transition-all"
                                >
                                    Log Out Developer Portal
                                </button>
                            )}
                        </div>

                        {isKeysLoading ? (
                            <div className="py-12 text-center flex flex-col items-center gap-2">
                                <Loader2 className="w-6 h-6 animate-spin text-[#00d2b4]" />
                                <span className="text-xs text-white/40">Loading keys...</span>
                            </div>
                        ) : !activeKey ? (
                            <div className="border border-white/5 rounded-2xl p-8 text-center bg-black/20 space-y-4 font-sans">
                                <Key className="w-8 h-8 mx-auto text-white/20" />
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-white uppercase tracking-wider">No Active API Credentials</p>
                                    <p className="text-[10px] text-white/40 leading-relaxed">Generate credentials to start integrating the SubScript SDK.</p>
                                </div>
                                <button
                                    onClick={handleRollKeys}
                                    disabled={isRolling}
                                    className="px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 text-black rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 mx-auto transition-all"
                                >
                                    {isRolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                                    Generate API Keys
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Publishable Key */}
                                <div className="bg-black/40 border border-white/5 rounded-2xl p-5 font-sans">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Publishable Key</span>
                                        {copiedText === "Publishable Key" && (
                                            <span className="text-[10px] text-[#00d2b4] font-bold">Copied</span>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between gap-4 bg-black/60 rounded-xl p-3 border border-white/5">
                                        <code className="text-xs font-mono text-white/80 break-all select-all">{activePublishableKey}</code>
                                        <button 
                                            onClick={() => handleCopy(activePublishableKey, "Publishable Key")}
                                            className="p-2 text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-all"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Secret Key */}
                                <div className="bg-black/40 border border-white/5 rounded-2xl p-5 font-sans">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Secret Key</span>
                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Secret</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {copiedText === "Secret Key" && (
                                                <span className="text-[10px] text-[#00d2b4] font-bold">Copied</span>
                                            )}
                                            <button
                                                onClick={() => setRevealSecret(!revealSecret)}
                                                className="text-white/40 hover:text-white transition-colors"
                                            >
                                                {revealSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 bg-black/60 rounded-xl p-3 border border-white/5 font-mono">
                                        <code className="text-xs text-white/80 break-all">
                                            {revealSecret 
                                                ? activeSecretKey 
                                                : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••"
                                            }
                                        </code>
                                        <button 
                                            onClick={() => handleCopy(activeSecretKey, "Secret Key")}
                                            disabled={!revealSecret}
                                            className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-all"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Roll Keys */}
                                <div className="pt-4 border-t border-white/5 flex items-center justify-between font-sans">
                                    <div>
                                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Rotation / Roll Credentials</h3>
                                        <p className="text-[10px] text-white/40 max-w-md">
                                            Roll your API key pair instantly. Old keys are immediately invalidated for safety in this sandbox.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {copiedText === "API Secret Key Rolled" && (
                                            <span className="text-[10px] text-[#00d2b4] font-bold animate-pulse">Rolled & Copied</span>
                                        )}
                                        <button
                                            onClick={handleRollKeys}
                                            disabled={isRolling}
                                            className={`px-5 py-3 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition-all flex items-center gap-2 ${isRolling ? "opacity-50" : ""}`}
                                        >
                                            {isRolling ? <RefreshCw className="w-4 h-4 animate-spin text-white" /> : <RotateCw className="w-4 h-4 text-white" />}
                                            Roll
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );

            case "checkout":
                return (
                    <div className="space-y-8">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                            {/* Configurator Form */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                                <div>
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                                        <Sliders className={`w-4 h-4 ${primaryColorText}`} />
                                        Checkout Configurator
                                    </h2>
                                    <div className="space-y-4 font-sans text-xs">
                                        <div>
                                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Subscription/Plan Name</label>
                                            <input 
                                                type="text" 
                                                value={subName} 
                                                onChange={(e) => setSubName(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Monthly cap (USDC)</label>
                                                <input 
                                                    type="text" 
                                                    value={subCap} 
                                                    onChange={(e) => setSubCap(e.target.value)}
                                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Billing Interval</label>
                                                <select 
                                                    value={subInterval}
                                                    onChange={(e) => setSubInterval(e.target.value)}
                                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors appearance-none"
                                                >
                                                    <option value="weekly">Weekly</option>
                                                    <option value="monthly">Monthly</option>
                                                    <option value="yearly">Yearly</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Funding Chain</label>
                                            <select 
                                                value={subChain}
                                                onChange={(e) => setSubChain(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                            >
                                                <option value="base">Base (CCTP Auto-Routing)</option>
                                                <option value="solana">Solana (CCTP Auto-Routing)</option>
                                                <option value="arc">Arc Network (Native)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-8 pt-4 border-t border-white/5 text-[10px] text-white/40">
                                    SubScript is fast, private, and reliable: Arc-native USDC gas, private burner activation, and a 1% protocol fee.
                                </div>
                            </div>

                            {/* Code output Block */}
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40 p-6 flex flex-col justify-between space-y-4">
                                <div className="space-y-1">
                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">SDK Code Snippet</span>
                                    <p className="text-[10px] text-white/30">React checkout paywall integration code snippet.</p>
                                </div>
                                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-5 text-center flex-1 flex items-center justify-center">
                                    <p className="text-xs text-white/60 leading-relaxed">
                                        Checkout paywall configurations compiled successfully. Ready to deploy.
                                    </p>
                                </div>
                                <button 
                                    onClick={() => handleCopy(checkoutCode, "Checkout Snippet")}
                                    className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
                                        copiedText === "Checkout Snippet"
                                            ? "bg-[#00d2b4] text-[#111111] shadow-[0_0_20px_rgba(0,210,180,0.25)]"
                                            : "bg-white/5 hover:bg-[#00d2b4]/10 border border-white/10 hover:border-[#00d2b4]/30 text-white hover:text-[#00d2b4]"
                                    }`}
                                >
                                    {copiedText === "Checkout Snippet" ? (
                                        <>
                                            <Check className="w-4 h-4" /> ✓ Snippet Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4" /> Copy React SDK Component
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Live Checkout Preview */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest">
                                    Interactive Preview
                                </h3>
                                <p className="text-xs text-white/50 leading-relaxed font-sans">
                                    Test the generated checkout flow directly on the Arc Testnet.
                                    Ensure your wallet is connected, has sufficient USDC, and click the Subscribe button to trigger the approval and subscription flow.
                                </p>
                            </div>
                            <div className="max-w-md w-full mx-auto lg:mx-0">
                                <SubScriptCheckout
                                    merchantAddress={activeMerchantAddress}
                                    planName={subName}
                                    amountCap={subCap}
                                    interval={subInterval}
                                    mode={promptFlowMode}
                                    onSuccess={(txHash) => {
                                        console.log("Subscription created:", txHash);
                                    }}
                                />
                            </div>
                        </div>

                        {/* Agent Prompt Block */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                            <div className="border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Agent Integration Prompt</span>
                                <p className="text-[10px] text-white/30 mt-0.5">Configure your subscription settings and copy the setup prompt for your AI agent.</p>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="space-y-1.5">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                                        Payment Flow Mode
                                    </label>
                                    <select
                                        value={promptFlowMode}
                                        disabled={!isPremium}
                                        onChange={(e) => setPromptFlowMode(e.target.value as "standard" | "private")}
                                        className="w-full text-xs p-3 bg-white/[0.02] border border-white/5 rounded-xl text-white/80 focus:outline-none focus:border-[#00d2b4]/40 transition-colors font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <option value="standard" className="bg-[#0a0a0c]">Traceable (Standard)</option>
                                        <option value="private" disabled={!isPremium} className="bg-[#0a0a0c]">
                                            Private Routing (Premium) {!isPremium && "🔒 (Premium Only)"}
                                        </option>
                                    </select>
                                </div>

                                {/* Configuration Status Card */}
                                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-5 text-center">
                                    <p className="text-xs text-white/60 leading-relaxed">
                                        Prompt configurations compiled successfully. Ready to copy for your AI coding assistant.
                                    </p>
                                </div>

                                <button
                                    onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                    className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
                                        copiedText === "Agent Prompt"
                                            ? "bg-[#00d2b4] text-[#111111] shadow-[0_0_20px_rgba(0,210,180,0.25)]"
                                            : "bg-white/5 hover:bg-[#00d2b4]/10 border border-white/10 hover:border-[#00d2b4]/30 text-white hover:text-[#00d2b4]"
                                    }`}
                                >
                                    {copiedText === "Agent Prompt" ? (
                                        <>
                                            <Check className="w-4 h-4" /> ✓ Prompt Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4" /> Copy Payment Prompt
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* MCP Config */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40 p-6 space-y-4">
                            <div className="space-y-1">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">cursor_mcp.json</span>
                                <p className="text-[10px] text-white/30 mt-0.5">Drop-in MCP context for Cursor or compatible agents.</p>
                            </div>
                            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-5 text-center">
                                <p className="text-xs text-white/60 leading-relaxed font-sans">
                                    Cursor MCP Server configurations compiled successfully. Ready to deploy.
                                </p>
                            </div>
                            <button
                                onClick={() => handleCopy(cursorMcpConfig, "MCP Config")}
                                className={`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
                                    copiedText === "MCP Config"
                                        ? "bg-[#00d2b4] text-[#111111] shadow-[0_0_20px_rgba(0,210,180,0.25)]"
                                        : "bg-white/5 hover:bg-[#00d2b4]/10 border border-white/10 hover:border-[#00d2b4]/30 text-white hover:text-[#00d2b4]"
                                }`}
                            >
                                {copiedText === "MCP Config" ? (
                                    <>
                                        <Check className="w-4 h-4" /> ✓ MCP Config Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" /> Copy MCP Configuration
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                );

            case "webhooks":
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
                            <Shield className="w-10 h-10 mx-auto text-[#00d2b4] animate-pulse" />
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider">Verify Wallet Ownership</h2>
                            <p className="text-xs text-white/50 leading-relaxed max-w-xs mx-auto">
                                To protect your API credentials and webhook endpoints, please sign a secure message using your connected wallet.
                            </p>
                            <button
                                onClick={handleBackendLogin}
                                disabled={isLoggingIn}
                                className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                            >
                                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin text-black" /> : <Shield className="w-4 h-4" />}
                                Authenticate Developer Portal
                            </button>
                        </div>
                    );
                }

                const selectedPayload = webhookEvents.find(w => w.id === selectedWebhook);

                return (
                    <div className="space-y-8">
                        {/* Webhook Endpoints Config */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                            <div>
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Sliders className={`w-4 h-4 ${primaryColorText}`} />
                                    Webhook Endpoints
                                </h2>
                                <p className="text-[11px] text-white/40 font-sans">
                                    Configure endpoints to receive subscription.created, payment.succeeded, and other lifecycle events.
                                </p>
                            </div>

                            {/* Add endpoint form */}
                            <form onSubmit={handleAddWebhook} className="flex gap-4 items-center">
                                <input
                                    type="url"
                                    placeholder="https://yourserver.com/api/webhooks"
                                    value={webhookUrlInput}
                                    onChange={(e) => setWebhookUrlInput(e.target.value)}
                                    required
                                    className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans"
                                />
                                <button
                                    type="submit"
                                    disabled={isAddingWebhook || !webhookUrlInput}
                                    className="px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 disabled:opacity-50 text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2"
                                >
                                    {isAddingWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                                    Add Endpoint
                                </button>
                            </form>

                            {/* List endpoints */}
                            {isWebhooksLoading ? (
                                <div className="py-4 text-center">
                                    <Loader2 className="w-5 h-5 animate-spin text-[#00d2b4] mx-auto" />
                                </div>
                            ) : webhookEndpoints.length === 0 ? (
                                <p className="text-[11px] text-white/30 font-sans text-center py-4 bg-black/20 rounded-xl border border-white/5">
                                    No webhook endpoints configured.
                                </p>
                            ) : (
                                <div className="space-y-3 font-sans text-xs">
                                    {webhookEndpoints.map((ep) => (
                                        <div key={ep.id} className="bg-black/30 border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                            <div className="space-y-1">
                                                <p className="font-mono text-xs font-bold text-white break-all">{ep.url}</p>
                                                <div className="flex items-center gap-3 text-[10px] text-white/40">
                                                    <span>Secret: </span>
                                                    <code className="font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5">
                                                        {revealWebhookSecret === ep.id ? ep.secret : "whsec_••••••••••••••••••••••••••••••••"}
                                                    </code>
                                                    <button
                                                        type="button"
                                                        onClick={() => setRevealWebhookSecret(prev => prev === ep.id ? null : ep.id)}
                                                        className="text-[#00d2b4] hover:underline"
                                                    >
                                                        {revealWebhookSecret === ep.id ? "Hide" : "Reveal"}
                                                    </button>
                                                    {revealWebhookSecret === ep.id && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCopy(ep.secret, "Webhook Secret")}
                                                            className="text-white/40 hover:text-white"
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteWebhook(ep.id)}
                                                className="px-3 py-1.5 border border-red-500/10 hover:bg-red-500/10 text-red-400 hover:border-red-500/20 rounded-xl text-[10px] font-bold uppercase transition-all"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Event Feed and Inspector */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                            {/* Event Feed */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                                <div>
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                                        <Webhook className={`w-4 h-4 ${primaryColorText}`} />
                                        Live Webhook Deliveries
                                    </h2>
                                    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                                        {isEventsLoading ? (
                                            <div className="py-12 text-center">
                                                <Loader2 className="w-6 h-6 animate-spin text-[#00d2b4] mx-auto" />
                                            </div>
                                        ) : webhookEvents.length === 0 ? (
                                            <div className="py-12 text-center text-white/30 font-sans text-xs space-y-3">
                                                <Webhook className="w-8 h-8 mx-auto text-white/10" />
                                                <p>No webhook deliveries logged yet.</p>
                                                <p className="text-[10px] text-white/20">Trigger events on-chain (like creating subscriptions) to see delivery reports here.</p>
                                            </div>
                                        ) : (
                                            webhookEvents.map((item) => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => setSelectedWebhook(item.id)}
                                                    className={`w-full p-4 rounded-2xl border text-left flex justify-between items-center transition-all ${
                                                        selectedWebhook === item.id 
                                                            ? "bg-[#00d2b4]/10 border-[#00d2b4]/30 shadow-inner"
                                                            : "bg-white/[0.01] border-white/5 hover:bg-white/[0.02]"
                                                    }`}
                                                >
                                                    <div className="font-mono text-[11px] space-y-1 max-w-[70%]">
                                                        <p className="font-bold text-white uppercase tracking-wider">{item.event}</p>
                                                        <p className="text-white/40 text-[9px] truncate">{item.endpointUrl}</p>
                                                        <p className="text-white/30 text-[9px]">{item.time}</p>
                                                    </div>
                                                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold ${
                                                        item.status >= 200 && item.status < 300
                                                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                                                    }`}>
                                                        HTTP {item.status}
                                                    </span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                                
                                <div className="mt-6 pt-4 border-t border-white/5 text-[10px] text-white/40 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-[#00d2b4] rounded-full animate-ping" />
                                        <span>Logged: {webhookEvents.length} events</span>
                                    </div>
                                    <button
                                        onClick={fetchWebhookEvents}
                                        className="text-[#00d2b4] hover:underline flex items-center gap-1"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Refresh logs
                                    </button>
                                </div>
                            </div>

                            {/* Payload Inspector */}
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest font-mono">Payload Inspector</span>
                                    <button
                                        onClick={() => handleReplayWebhook(selectedWebhook)}
                                        disabled={isReplaying || !selectedWebhook}
                                        className={`px-3 py-1.5 border border-white/10 rounded-xl text-[9px] font-bold uppercase tracking-wider hover:bg-white/5 flex items-center gap-1.5 ${isReplaying || !selectedWebhook ? "opacity-50" : ""}`}
                                    >
                                        {isReplaying ? <Loader2 className="w-3 h-3 animate-spin text-white" /> : <RotateCw className="w-3 h-3 text-white" />}
                                        Replay
                                    </button>
                                </div>
                                
                                <div className="flex-1 p-6 font-mono text-[11px] text-emerald-400/90 overflow-y-auto min-h-[300px] leading-relaxed select-all">
                                    {replayStatus && (
                                        <p className={`p-3 border rounded-xl mb-4 font-sans text-xs ${
                                            replayStatus.includes("successfully") 
                                                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" 
                                                : "bg-red-500/10 text-red-300 border-red-500/20"
                                        }`}>{replayStatus}</p>
                                    )}
                                    {selectedPayload ? (
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-white/30 text-[9px] uppercase tracking-wider mb-1 font-bold">JSON Payload</p>
                                                <pre className="bg-black/40 p-3 rounded-xl border border-white/5 overflow-x-auto text-[#00d2b4]">
                                                    <code>{JSON.stringify(selectedPayload.payload, null, 2)}</code>
                                                </pre>
                                            </div>
                                            {selectedPayload.responseBody && (
                                                <div>
                                                    <p className="text-white/30 text-[9px] uppercase tracking-wider mb-1 font-bold">Response Body</p>
                                                    <pre className="bg-black/50 p-3 rounded-xl border border-white/5 overflow-x-auto text-white/70 max-h-[150px]">
                                                        <code>{selectedPayload.responseBody}</code>
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-white/30">Select a webhook event to inspect</span>
                                    )}
                                </div>
                                
                                <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 flex justify-between font-mono">
                                    <span>Event ID: {selectedPayload?.id || "N/A"}</span>
                                    <span>HTTP Status: {selectedPayload?.status || "N/A"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div data-mounted={isMounted} className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4]">
            <AnimatedGradientBg />
            <div className="relative z-10">
            <DashboardHeader 
                embeddedWallet={embeddedWallet}
                onDisconnect={handleLogout}
                vaultBalance={vaultBalance}
                onWithdraw={async () => setIsWithdrawOpen(true)}
                isWithdrawing={isWithdrawing}
                onDepositSuccess={handleDepositSuccess}
                isPremium={isPremium}
                promptFlowMode={promptFlowMode}
                onDeposit={() => setIsDepositOpen(true)}
            />

            {/* Dashboard Content */}
            <main className="max-w-7xl mx-auto px-6 pt-28 pb-12">
                {/* Header Row */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 pb-6 border-b border-white/5">
                    <div>
                        <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2">
                            Merchant Control <span className="font-serif italic lowercase font-normal text-[#00d2b4]">center</span>
                        </h1>
                        <p className="text-xs text-white/50 font-sans">
                            Sandbox Environment: SubScript is fast, private, and reliable with Arc testnet.
                        </p>
                    </div>
                </div>

                {!isConnected ? (
                    <div className="space-y-8">
                        <div className="liquid-glass border border-yellow-500/20 rounded-3xl p-8 shadow-2xl bg-yellow-500/[0.03] flex flex-col items-center justify-center text-center gap-6 max-w-2xl mx-auto py-12">
                            <div className="p-4 rounded-3xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                                <AlertTriangle className="w-10 h-10" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-lg font-bold text-white uppercase tracking-wider">Merchant Wallet Connection Required</h2>
                                <p className="text-sm text-white/60 max-w-md leading-relaxed">
                                    Connect your browser wallet to access allowances, metrics, premium features, and settlement configurations.
                                </p>
                            </div>
                            <button
                                onClick={handleConnect}
                                className="px-8 py-3 bg-yellow-300 hover:bg-yellow-200 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                            >
                                <PlugZap className="w-4 h-4" />
                                {isConnecting ? "Connecting Wallet..." : "Connect Merchant Wallet"}
                            </button>
                            {isConnectError && connectError && (
                                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-left max-w-md w-full">
                                    <span className="text-red-400 text-xs font-semibold uppercase tracking-wide block">
                                        Connection Failed
                                    </span>
                                    <p className="text-red-200 text-xs font-mono break-all mt-1 leading-relaxed">
                                        {connectError.message}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : isLoading ? (
                    <DashboardSkeleton activeTab={activeTab} />
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
                        {/* Sidebar Navigation */}
                        <div className="lg:col-span-1 space-y-2">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border text-left ${
                                        activeTab === tab.id
                                            ? tab.id === "premium"
                                                ? "bg-[#d4a853]/10 border-[#d4a853]/30 text-white shadow-lg shadow-[#d4a853]/5"
                                                : "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-white shadow-lg shadow-[#00d2b4]/5"
                                            : "bg-white/[0.01] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.03]"
                                    }`}
                                >
                                    <tab.icon className={`w-4 h-4 ${
                                        activeTab === tab.id 
                                            ? tab.id === "premium" ? "text-[#d4a853]" : "text-[#00d2b4]"
                                            : "text-white/40"
                                    }`} />
                                    {tab.label}
                                    {tab.id === "premium" && isPremium && (
                                        <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#d4a853]/10 text-[#d4a853] border border-[#d4a853]/20">PRO</span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* View Content */}
                        <div className="lg:col-span-3 min-h-[500px]">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeTab}
                                    initial={{ opacity: 0, y: 15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -15 }}
                                    transition={{ duration: 0.25 }}
                                >
                                    {renderView()}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                )}
                
                {/* Footer */}
                <footer className="mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/40 gap-4">
                    <span>© 2026 SubScript Protocol. All rights reserved.</span>
                    <div className="flex gap-4">
                        <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                    </div>
                    <span>Built on Arc Network</span>
                </footer>
            </main>
            </div>
            <WithdrawModal
                isOpen={isWithdrawOpen}
                onClose={() => setIsWithdrawOpen(false)}
                vaultBalance={vaultBalance}
                connectedAddress={address || ""}
                payoutDestination={payoutDestination}
                onConfirmWithdraw={async (targetAddress) => {
                    await handleWithdraw(targetAddress);
                    setIsWithdrawOpen(false);
                }}
                isWithdrawing={isWithdrawing}
            />
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={!!embeddedWallet}
                depositAddress={address || ""}
                onSuccess={handleDepositSuccess}
                executeContractWrite={executeContractWrite}
            />
        </div>
    );
}
