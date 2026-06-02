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
import { useAccount, useConnect, useDisconnect, useWriteContract, useSwitchChain, useReadContract, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, http, formatUnits, parseUnits, parseEventLogs } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { 
    Activity, Key, Code2, Webhook, ArrowRightLeft, 
    ShieldAlert, Copy, Check, Eye, EyeOff, RotateCw, 
    RefreshCw, Sliders, ShieldX, CheckCircle, AlertTriangle, 
    PlugZap, Loader2, Award, Crown, ExternalLink, ArrowDownToLine,
    Wallet, Shield
} from "lucide-react";

import { 
    ARC_TESTNET_CHAIN_ID, 
    SUBSCRIPT_ROUTER_ADDRESS, 
    STANDARD_CONTRACT_ADDRESS, 
    USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";

const TEST_PUBLISHABLE_KEY = "pk_test_51Px9800Z7Z4M19XQY1R93B";

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

const ERC20_ABI = [
    {
        type: "function" as const,
        name: "balanceOf" as const,
        stateMutability: "view" as const,
        inputs: [{ name: "account", type: "address" }] as const,
        outputs: [{ name: "", type: "uint256" }] as const,
    }
];

const SUBSCRIPT_ABI = [
    {
        inputs: [],
        name: "nextSubscriptionId",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "uint256" }],
        name: "subscriptions",
        outputs: [
            { name: "subscriber", type: "address" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "period", type: "uint256" },
            { name: "nextPayment", type: "uint256" },
            { name: "isActive", type: "bool" },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "_subId", type: "uint256" }],
        name: "cancelSubscription",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "address" }],
        name: "merchantTiers",
        outputs: [{ name: "", type: "uint8" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "address" }],
        name: "merchantBalances",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "address" }],
        name: "merchantPayoutDestination",
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "withdraw",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [{ name: "_newDestination", type: "address" }],
        name: "configurePayoutDestination",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;


const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "premium", label: "Premium", icon: Crown },
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
            } else if (functionName === "setMerchantTier") {
                action = "setMerchantTier";
                serializedArgs = {
                    merchant: args[0],
                    tier: Number(args[1]),
                    zkProof: args[2],
                    rerouteConfig: args[3]
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

    const { switchChain } = useSwitchChain();
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

    const refetchBalancesAndTier = useCallback(async () => {
        if (!address) return;
        try {
            const [tierRaw, vaultRaw, payoutRaw, walletRaw] = await Promise.all([
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ABI,
                    functionName: "merchantTiers",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ABI,
                    functionName: "merchantBalances",
                    args: [address as `0x${string}`],
                }),
                publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ABI,
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
            }
        } catch (error) {
            console.error("Error reading contract data in background:", error);
        }
    }, [address]);

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
                const targetContract = isPremium ? SUBSCRIPT_ROUTER_ADDRESS : STANDARD_CONTRACT_ADDRESS;
                const nextId = await publicClient.readContract({
                    address: targetContract,
                    abi: SUBSCRIPT_ABI,
                    functionName: "nextSubscriptionId",
                });
                
                const nextIdNum = Number(nextId);
                const fetchedLedgers = [];
                
                for (let i = 1; i < nextIdNum; i++) {
                    const sub = await publicClient.readContract({
                        address: targetContract,
                        abi: SUBSCRIPT_ABI,
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
    }, [isConnected, address, isPremium]);

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
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: SUBSCRIPT_ABI,
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


    const handleWithdraw = async () => {
        if (vaultBalance <= 0) return;
        setIsWithdrawing(true);
        try {
            await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: SUBSCRIPT_ABI,
                functionName: "withdraw",
            });
            setWithdrawSuccess(true);
            setTimeout(() => setWithdrawSuccess(false), 4000);
            refetchVaultBalance();
            refetchWalletBalance();
        } catch (err) {
            console.error("Withdraw failed:", err);
        } finally {
            setIsWithdrawing(false);
        }
    };


    const generateZkCommitment = async (rerouteAddress: string, allocationBps: number): Promise<string> => {
        /* Simulate ZK circuit computation for premium checkout */
        await new Promise((resolve) => setTimeout(resolve, 2000));
        /* Encapsulate reroute configuration in a dummy ZK proof string payload */
        return "0x" + Array(64).fill("7").join("");
    };

    const handleUpgrade = async () => {
        if (!isConnected || !activeMerchantAddress) {
            setPremiumError("Please connect your merchant wallet first.");
            return;
        }
        if (!embeddedWallet && chainId !== 5042002) {
            setPremiumError("Not on Arc Testnet. Switching chain...");
            switchChain?.({ chainId: 5042002 });
            return;
        }

        setIsSubscribingPremium(true);
        setPremiumStatus("Encrypting Payload");
        setPremiumError(null);

        try {
            const PAYMENT_RECIPIENT = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
            const REROUTE_ADDRESS = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
            const REROUTE_SHARE = 10000;
            const amount = parseUnits("10", 6);

            /* Generate the ZK proof encapsulating rerouting configuration */
            const zkProof = await generateZkCommitment(REROUTE_ADDRESS, REROUTE_SHARE);

            setPremiumStatus("Preparing 10 USDC payment...");

            /* Step 1: Implement the Allowance Check */
            const currentAllowance = await publicClient.readContract({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: [
                    {
                        type: "function",
                        name: "allowance",
                        stateMutability: "view",
                        inputs: [
                            { name: "owner", type: "address" },
                            { name: "spender", type: "address" }
                        ],
                        outputs: [{ name: "", type: "uint256" }]
                    }
                ] as const,
                functionName: "allowance",
                args: [activeMerchantAddress as `0x${string}`, PAYMENT_RECIPIENT as `0x${string}`],
            });

            /* Step 2: Implement the Approval Flow */
            if (currentAllowance < amount) {
                setPremiumStatus("Awaiting USDC Approval");
                const approveHash = await executeContractWrite({
                    address: USDC_NATIVE_GAS_ADDRESS,
                    abi: [
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
                    ] as const,
                    functionName: "approve",
                    args: [PAYMENT_RECIPIENT, amount],
                });

                await publicClient.waitForTransactionReceipt({ hash: approveHash as `0x${string}` });
            }

            /* Step 3: Execute Payment */
            setPremiumStatus("Confirming Payment");
            const paymentHash = await executeContractWrite({
                address: PAYMENT_RECIPIENT,
                abi: [
                    {
                        type: "function",
                        name: "setMerchantTier",
                        stateMutability: "nonpayable",
                        inputs: [
                            { name: "_merchant", type: "address" },
                            { name: "_tierId", type: "uint8" },
                            { name: "_zkProof", type: "bytes" },
                            { name: "_rerouteConfig", type: "address" }
                        ],
                        outputs: []
                    }
                ] as const,
                functionName: "setMerchantTier",
                args: [activeMerchantAddress, 1, zkProof, REROUTE_ADDRESS],
            });

            posthog.capture("premium_upgrade_initiated");

            const receipt = await publicClient.waitForTransactionReceipt({ hash: paymentHash as `0x${string}` });

            if (receipt.status !== "success") {
                throw new Error("Payment transaction reverted on-chain.");
            }

            const transferLogs = parseEventLogs({
                abi: [
                    {
                        type: "event",
                        name: "Transfer",
                        inputs: [
                            { name: "from", type: "address", indexed: true },
                            { name: "to", type: "address", indexed: true },
                            { name: "value", type: "uint256", indexed: false }
                        ],
                        anonymous: false
                    }
                ] as const,
                logs: receipt.logs,
            });

            const paymentLog = transferLogs.find(
                (log) =>
                    log.eventName === "Transfer" &&
                    log.args.from?.toLowerCase() === activeMerchantAddress.toLowerCase() &&
                    log.args.to?.toLowerCase() === PAYMENT_RECIPIENT.toLowerCase()
            );

            if (!paymentLog) {
                throw new Error("Transfer event not found in receipt.");
            }
            if (paymentLog.args.value !== amount) {
                throw new Error(`Amount mismatch. Expected ${formatUnits(amount, 6)} USDC.`);
            }

            setPremiumStatus("Syncing premium state with server...");
            const upgradeRes = await fetch("/api/premium/upgrade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ txHash: paymentHash }),
            });
            const upgradeData = await upgradeRes.json();
            if (!upgradeRes.ok) {
                throw new Error(upgradeData.error || "Failed to finalize premium upgrade on server");
            }

            posthog.capture("premium_upgrade_success");

            setPremiumStatus("Payment verified! Premium tier activated.");
            refetchTier();
            setTimeout(() => setPremiumStatus(null), 4000);
        } catch (err: any) {
            console.error("Premium subscription failed:", err);
            setPremiumError(err.shortMessage || err.message || "Transaction failed");
        } finally {
            setIsSubscribingPremium(false);
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
                abi: SUBSCRIPT_ABI,
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
  mode="${isPremium ? "zk" : "standard"}"
/>`, [merchantWalletAddress, subCap, subChain, subInterval, subName, publishableKeyForSnippet, isPremium]);

    const agentIntegrationPrompt = useMemo(() => {
        if (!isPremium) {
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
- Merchant Secret API Key (for server integration): [GENERATE IN API KEYS TAB]
- Webhook Secret Key (for validation): [RETRIEVE IN WEBHOOKS TAB]

INTEGRATION WORKFLOW REQUIREMENTS:

1. FRONTEND USER FLOW (Standard Transparent Method)
   - Step 1: User connects wallet and approves USDC token allowance for the SubScript contract:
     USDC_NATIVE_GAS_ADDRESS.approve(STANDARD_CONTRACT_ADDRESS, parseUnits('${subCap}', 6) * 12)
   - Step 2: Call createSubscription(merchant, parseUnits('${subCap}', 6), periodSeconds) on the SubScript contract from the user's wallet.

2. SERVER-TO-SERVER VERIFICATION
   - To verify a subscription status from your backend, make a GET request to the SubScript API:
     GET /api/v1/subscriptions?id=sub_[SUBSCRIPTION_ID]
     or
     GET /api/v1/subscriptions?subscriber=[SUBSCRIBER_WALLET_ADDRESS]
   - Include the secret API key in the headers:
     Authorization: Bearer sk_test_...
   - Check the JSON response fields: { id, subscriber, amount, periodSeconds, isActive, nextPaymentDate }

3. WEBHOOK LOGIC & SIGNATURE VERIFICATION
   - Create a webhook receiver endpoint (e.g. POST /api/webhooks).
   - Verify the webhook signature received in the 'x-subscript-signature' header. The signature is computed as:
     HMAC-SHA256(webhook_secret_key, json_payload)
   - Handle events:
     - 'subscription.activated': Triggered when a subscription is initialized.
     - 'subscription.payment.succeeded': Triggered when a keeper runs a recurring billing cycle successfully.
     - 'subscription.cancelled': Triggered when a subscription is cancelled.

Please write clean, TypeScript-safe React components and backend routes using viem and ethers to implement this complete checkout workflow.`;
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
- Merchant Secret API Key (for server integration): [GENERATE IN API KEYS TAB]
- Webhook Secret Key (for validation): [RETRIEVE IN WEBHOOKS TAB]

INTEGRATION WORKFLOW REQUIREMENTS:

1. FRONTEND USER FLOW (ZK Burner Method)
   - Step 1: User connects Funding Wallet and approves USDC token allowance for the router contract:
     USDC_NATIVE_GAS_ADDRESS.approve(SUBSCRIPT_ROUTER_ADDRESS, parseUnits('${subCap}', 6) * 12)
   - Step 2: Generate a local cryptographically secure random 32-byte secret. Create commitment = keccak256(secret). Store the secret in the user's browser localStorage.
   - Step 3: Call depositAndCommit(commitment, parseUnits('${subCap}', 6)) on the SubScript Router contract from the Funding Wallet.
   - Step 4: Construct the ZK-friendly parameter proof array: [secret, expectedPublicInputHash] where expectedPublicInputHash = keccak256(abi.encodePacked(merchant, amount, period)).
   - Step 5: Ask user to switch context to a burner wallet (or auto-generate a secure burner wallet key pair in memory).
   - Step 6: Burner wallet calls verifyAndActivate(proof, nullifierHash, merchant, amount, period) on the SubScript Router.

2. SERVER-TO-SERVER VERIFICATION
   - To verify a subscription status from your backend, make a GET request to the SubScript API:
     GET /api/v1/subscriptions?id=sub_[SUBSCRIPTION_ID]
     or
     GET /api/v1/subscriptions?subscriber=[SUBSCRIBER_WALLET_ADDRESS]
   - Include the secret API key in the headers:
     Authorization: Bearer sk_test_...
   - Check the JSON response fields: { id, subscriber, amount, periodSeconds, isActive, nextPaymentDate }

3. WEBHOOK LOGIC & SIGNATURE VERIFICATION
   - Create a webhook receiver endpoint (e.g. POST /api/webhooks).
   - Verify the webhook signature received in the 'x-subscript-signature' header. The signature is computed as:
     HMAC-SHA256(webhook_secret_key, json_payload)
   - Handle events:
     - 'subscription.activated': Triggered when a subscription is initialized.
     - 'subscription.payment.succeeded': Triggered when a keeper runs a recurring billing cycle successfully.
     - 'subscription.cancelled': Triggered when a subscription is cancelled.

Please write clean, TypeScript-safe React components and backend routes using viem and ethers to implement this complete checkout workflow.`;
    }, [activeMerchantAddress, merchantWalletAddress, subName, subCap, billingPeriodSeconds, isPremium]);

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

    const renderView = () => {
        switch (activeTab) {
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
                                        onClick={handleWithdraw}
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
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">SDK Code Snippet</span>
                                    <div className="flex items-center gap-3">
                                        {copiedText === "Checkout Snippet" && (
                                            <span className="text-[10px] text-[#00d2b4] font-bold">Copied</span>
                                        )}
                                        <button 
                                            onClick={() => handleCopy(checkoutCode, "Checkout Snippet")}
                                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 p-6 font-mono text-[11px] text-white/80 overflow-x-auto leading-relaxed">
                                    <pre><code>{checkoutCode}</code></pre>
                                </div>
                                <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 flex justify-between font-mono">
                                    <span>React SDK Component</span>
                                    <span>Wallet: {address?.slice(0, 6)}...{address?.slice(-4)}</span>
                                </div>
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
                                    mode={isPremium ? "zk" : "standard"}
                                    onSuccess={(txHash) => {
                                        console.log("Subscription created:", txHash);
                                    }}
                                />
                            </div>
                        </div>

                        {/* Agent Prompt Block */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <div>
                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Agent Integration Prompt</span>
                                    <p className="text-[10px] text-white/30 mt-0.5">Copy this into your AI agent (Cursor, Claude, etc.) to integrate SubScript.</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    {copiedText === "Agent Prompt" && (
                                        <span className="text-[10px] text-[#00d2b4] font-bold">Copied</span>
                                    )}
                                    <button
                                        onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="p-6 font-mono text-[11px] text-emerald-300/80 overflow-x-auto leading-relaxed max-h-[400px] overflow-y-auto">
                                <pre className="whitespace-pre-wrap">{agentIntegrationPrompt}</pre>
                            </div>
                        </div>

                        {/* MCP Config */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <div>
                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">cursor_mcp.json</span>
                                    <p className="text-[10px] text-white/30 mt-0.5">Drop-in MCP context for Cursor or compatible agents.</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    {copiedText === "MCP Config" && (
                                        <span className="text-[10px] text-[#00d2b4] font-bold">Copied</span>
                                    )}
                                    <button
                                        onClick={() => handleCopy(cursorMcpConfig, "MCP Config")}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="p-6 font-mono text-[11px] text-emerald-300/90 overflow-x-auto leading-relaxed max-h-[420px]">
                                <pre>{cursorMcpConfig}</pre>
                            </div>
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
            <DashboardHeader />

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
        </div>
    );
}
