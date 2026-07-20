"use client";

import { useMemo, useState, useEffect, useCallback, useRef, Fragment } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import DashboardHeader from "@/components/DashboardHeader";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import DashboardSkeleton from "@/components/DashboardSkeleton";
import { getDashboardUrl } from "@/utils/navigation";
import { buildCheckoutUrl, buildSubscribeUrl } from "@/lib/checkoutUrl";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import AnimatedBottomNavButton from "@/components/AnimatedBottomNavButton";
import LiquidGlassEffect from "@/components/LiquidGlassEffect";
import WithdrawModal from "@/components/WithdrawModal";
import DepositModal from "@/components/DepositModal";
import ConfirmModal from "@/components/ConfirmModal";
import DurationPicker from "@/components/DurationPicker";
import SharePlanModal from "@/components/SharePlanModal";
import KycVerificationPanel from "@/components/KycVerificationPanel";
import { useAccount, useConnect, useDisconnect, useWriteContract, useSwitchChain, useReadContract, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import {
    createPublicClient,
    http,
    formatUnits,
    parseUnits,
} from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import { 
    Activity, Key, Code2, Webhook, ArrowRightLeft, 
    ShieldAlert, Copy, Check, Eye, EyeOff, RotateCw, 
    RefreshCw, Sliders, CheckCircle, AlertTriangle,
    PlugZap, Loader2, Award, Crown, ExternalLink, ArrowDownToLine,
    Wallet, Shield, BarChart3, Link2, Zap, QrCode, Lock, Building2,
    Play, Pause, Trash2, Globe, ArrowDown, ArrowUpRight, ArrowUp, ChevronDown, User, Share2,
    ShieldCheck, Save, Home, SquaresFour, Broadcast, MessageSquare, HelpCircle
} from "@/components/icons";
import { QRCode } from "react-qrcode-logo";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import type { MerchantAnalyticsSummary, MerchantSubscriptionDetail } from "@/lib/analytics/merchantSubscriptions";
import { PayrollContent } from "@/app/dashboard/payroll/PayrollContent";

import {
    PREMIUM_PLAN_ID,
    SUBSCRIPT_ROUTER_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS,
    CONFIDENTIAL_CONTRACT_ADDRESS
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI, SUBSCRIPT_ROUTER_ABI, USDC_ERC20_ABI, CONFIDENTIAL_CONTRACT_ABI } from "@/lib/contracts/abis";
import { useSwipeTabs } from "@/hooks/useSwipeTabs";
import FinancialStatusBadge from "@/components/FinancialStatusBadge";

const TEST_PUBLISHABLE_KEY = "pk_test_51Px9800Z7Z4M19XQY1R93B";

const publicClient = createPublicClient({
    chain: activeArcChain,
    transport: arcHttp(),
});

const ERC20_ABI = USDC_ERC20_ABI;
const ROUTER_ABI = SUBSCRIPT_ROUTER_ABI;
const STANDARD_ABI = STANDARD_SUBSCRIPT_ABI;


const tabs = [
    { id: "overview", label: "Overview", icon: SquaresFour },
    { id: "premium", label: "Premium", icon: Crown },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "payment-links", label: "Payments and Subscriptions", icon: Sliders },
    { id: "payroll", label: "Payroll", icon: Building2 },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "checkout", label: "Checkout Setup", icon: Code2 },
    { id: "webhooks", label: "Webhooks", icon: Broadcast },
    { id: "offramp", label: "Off-Ramp", icon: ArrowRightLeft },
    { id: "settings", label: "Profile & DNS", icon: User },
] as const;

type TabId = "overview" | "premium" | "analytics" | "payment-links" | "plans" | "apikeys" | "checkout" | "webhooks" | "settings" | "payroll" | "offramp";

type MerchantPlan = {
    id: string;
    targetSubscriber?: string | null;
    merchantAddress: string;
    name: string;
    description?: string | null;
    detailsUrl?: string | null;
    amountUsdc: string;
    periodSeconds: string;
    active: boolean;
};

type PlanPromotion = {
    id: string;
    planId: string;
    name: string;
    discountType: string;
    discountBps: number | null;
    regularAmountUsdc: string;
    introductoryAmountUsdc: string;
    introductoryCycles: number;
    startsAt: string | null;
    expiresAt: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    newCustomersOnly: boolean;
    active: boolean;
};

const PLAN_DESCRIPTION_MAX = 300;

const formatApiKeyFingerprint = (value: string | null | undefined) => {
    if (!value) return null;
    if (value.includes("...")) return value;
    if (value.length <= 12) return "••••••••";
    return `${value.slice(0, 12)}...${value.slice(-4)}`;
};

const formatPlanAmount = (micros: string) => {
    try {
        return Number(formatUnits(BigInt(micros), 6)).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch {
        return "0.00";
    }
};

const limitDecimals = (value: string, maxDecimals: number = 6): string => {
    if (!value || !value.includes(".")) return value;
    const [integer, fraction] = value.split(".");
    return `${integer}.${fraction.slice(0, maxDecimals)}`;
};

const formatPlanPeriod = (seconds: string) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "cycle";
    const days = Math.round(value / 86400);
    if (days === 1) return "day";
    if (days === 7) return "week";
    if (days >= 28 && days <= 31) return "month";
    if (days >= 364 && days <= 366) return "year";
    return `${days} days`;
};

const formatUsdcMicros = (value: any) => {
    try {
        const micros = BigInt(String(value ?? "0"));
        const unit = BigInt(1_000_000);
        const sign = micros < BigInt(0) ? "-" : "";
        const absolute = micros < BigInt(0) ? -micros : micros;
        const whole = absolute / unit;
        const fraction = (absolute % unit).toString().padStart(6, "0").slice(0, 2);
        return `${sign}${whole.toString()}.${fraction}`;
    } catch {
        return "0.00";
    }
};

const formatUsdcInput = (value: any) => {
    try {
        const micros = BigInt(String(value ?? "0"));
        const unit = BigInt(1_000_000);
        const sign = micros < BigInt(0) ? "-" : "";
        const absolute = micros < BigInt(0) ? -micros : micros;
        const whole = absolute / unit;
        const fraction = (absolute % unit).toString().padStart(6, "0").replace(/0+$/, "");
        return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
    } catch {
        return "0";
    }
};

const microsToNumber = (value: any) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const shortenHash = (value: string | undefined) => {
    if (!value) return "";
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const settlementTimeframes = ["24H", "1W", "1M", "3M", "6M", "1Y"] as const;

/* Same icons AND names as the desktop sidebar (`tabs`) so merchant navigation reads
   identically on both form factors. */
const mobileBottomTabs: ReadonlyArray<{ id: TabId; label: string; icon: typeof Home }> = [
    { id: "overview", label: "Overview", icon: SquaresFour },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "payment-links", label: "Payments", icon: Sliders },
    { id: "apikeys", label: "API Keys", icon: Key },
];

const comingSoonMerchantSettings = new Set([
    "pushEnabled",
    "emailEnabled",
    "payoutSettlementEnabled",
    "disputeAlertsEnabled",
    "securityMultiSigEnabled",
]);

export default function DashboardPage() {
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const { address: realAddress, isConnected: realIsConnected, chainId } = useAccount();
    const { connect, connectors, error: connectError, isError: isConnectError, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();
    const { switchChain, switchChainAsync } = useSwitchChain();
    const [isTestMode, setIsTestMode] = useState(false);

    /* Soulbound Access Key (SBT) State removed because SBT infrastructure is deleted */

    /* Payment Links States */
    const [paymentLinks, setPaymentLinks] = useState<any[]>([]);
    const [isLinksLoading, setIsLinksLoading] = useState(false);
    const [initialLinksFetched, setInitialLinksFetched] = useState(false);
    const [merchantPlans, setMerchantPlans] = useState<MerchantPlan[]>([]);
    const [planPromotions, setPlanPromotions] = useState<PlanPromotion[]>([]);
    const [isPlansLoading, setIsPlansLoading] = useState(false);
    const [initialPlansFetched, setInitialPlansFetched] = useState(false);
    const [planName, setPlanName] = useState("");
    const [planDescription, setPlanDescription] = useState("");
    const [planDetailsUrl, setPlanDetailsUrl] = useState("");
    const [planAmountUsdc, setPlanAmountUsdc] = useState("");
    const [planPeriodDays, setPlanPeriodDays] = useState("30");
    const [planMinCommitmentDays, setPlanMinCommitmentDays] = useState("");
    const [planError, setPlanError] = useState<string | null>(null);
    const [planSuccess, setPlanSuccess] = useState<string | null>(null);

    const [linkTitle, setLinkTitle] = useState("");
    const [linkDescription, setLinkDescription] = useState("");
    const [linkAmountUsdc, setLinkAmountUsdc] = useState("");
    const [linkDurationMinutes, setLinkDurationMinutes] = useState(1440); /* Default to 24 hours (1440 mins) */
    const [linkExternalReference, setLinkExternalReference] = useState("");
    const [linkMaxUses, setLinkMaxUses] = useState("1");
    const [linkInvoiceNumber, setLinkInvoiceNumber] = useState("");
    const [linkDueDate, setLinkDueDate] = useState("");
    const [linkPayerEmail, setLinkPayerEmail] = useState("");

    /* Configurable dunning: failed renewal attempts before the keeper stops a customer sub. */
    const [dunningMaxFailures, setDunningMaxFailures] = useState("4");
    const [dunningLoaded, setDunningLoaded] = useState(false);
    const [dunningSaving, setDunningSaving] = useState(false);
    const [dunningMessage, setDunningMessage] = useState<string | null>(null);
    const [isCreatingLink, setIsCreatingLink] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
    const [createdLinkInfo, setCreatedLinkInfo] = useState<{ id: string; title: string; checkoutUrl: string } | null>(null);
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState("");
    const [confirmModal, setConfirmModal] = useState<{
        open: boolean;
        title: string;
        description: string;
        confirmLabel: string;
        cancelLabel?: string;
        variant: "danger" | "warning" | "default";
        onConfirm: () => void;
        onCancel?: () => void;
    } | null>(null);
    const [linkCopyFeedback, setLinkCopyFeedback] = useState<{ [id: string]: boolean }>({});
    const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);
    const [showLinkAdvanced, setShowLinkAdvanced] = useState(true);
    const [showCheckoutAdvanced, setShowCheckoutAdvanced] = useState(false);
    const [walletProvider, setWalletProvider] = useState("none");
    const [dbProvider, setDbProvider] = useState("none");
    const [sessionProvider, setSessionProvider] = useState("none");
    const [ledgerPage, setLedgerPage] = useState(0);
    const [ledgerCursors, setLedgerCursors] = useState<Array<string | null>>([null]);
    const [linksPage, setLinksPage] = useState(0);
    const [webhooksPage, setWebhooksPage] = useState(0);

    const [premiumSubId, setPremiumSubId] = useState<number | null>(null);
    const [sharingPlan, setSharingPlan] = useState<MerchantPlan | null>(null);
    const [isCancellingPremium, setIsCancellingPremium] = useState(false);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
    const [isResumingPremium, setIsResumingPremium] = useState(false);
    const [dbSubscriptionStatus, setDbSubscriptionStatus] = useState<string | null>(null);
    const [downgradeFailures, setDowngradeFailures] = useState<number>(0);


    const [embeddedWallet, setEmbeddedWallet] = useState<{ wallet: string; email: string } | null>(null);
    const [sessionWallet, setSessionWallet] = useState<string | null>(null);
    const [otpEmail, setOtpEmail] = useState("");
    const [otpCode, setOtpCode] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpSuccess, setOtpSuccess] = useState(false);
    const [otpError, setOtpError] = useState<string | null>(null);
    const [rememberMe, setRememberMe] = useState(true);

    const activeMerchantAddress = useMemo(() => {
        if (isTestMode) return "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
        return embeddedWallet?.wallet || realAddress || sessionWallet || "";
    }, [embeddedWallet, realAddress, isTestMode, sessionWallet]);

    const isConnected = realIsConnected || isTestMode || !!embeddedWallet || !!sessionWallet;
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
            } else if (functionName === "createSubscription") {
                action = "createPremiumSubscription";
                serializedArgs = {
                    merchant: args[0],
                    amount: args[1].toString(),
                    period: args[2].toString(),
                };
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
            } else if (functionName === "registerViewKey") {
                action = "registerViewKey";
                serializedArgs = { viewKeyHash: args[0] };
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
            if (chainId !== activeArcChain.id) {
                if (switchChainAsync) {
                    await switchChainAsync({ chainId: activeArcChain.id });
                } else if (switchChain) {
                    switchChain({ chainId: activeArcChain.id });
                }
            }
            return await writeContractAsync({
                address: contractAddress as `0x${string}`,
                abi: contractAbi,
                functionName,
                args,
            });
        }
    };


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
            /* Check for upgrade success and show toast */
            const urlParams = new URLSearchParams(window.location.search);
            const tabParam = urlParams.get("tab");
            if (tabParam && tabs.some(t => t.id === tabParam)) {
                setActiveTab(tabParam as TabId);
            }
            if (urlParams.get("upgradeSuccess") === "true") {
                setToastMessage("Privacy Premium activated successfully!");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 4000);
                /* Clean up URL parameter to avoid showing the toast again on refresh */
                window.history.replaceState({}, document.title, window.location.pathname);
            }
            const scrollParam = urlParams.get("scroll");
            if (scrollParam === "dns") {
                setActiveTab("settings");
            }
        }
    }, [realAddress, realIsConnected]);

    /* Detect browser local currency and fetch real-time exchange rate */
    useEffect(() => {
        if (typeof window === "undefined") return;

        const detectLocalCurrency = () => {
            try {
                const locale = navigator.language || "en-US";
                const parts = locale.split("-");
                const country = parts[1] ? parts[1].toUpperCase() : "";
                
                const countryToCurrency: Record<string, { code: string; symbol: string }> = {
                    NG: { code: "NGN", symbol: "₦" },
                    GB: { code: "GBP", symbol: "£" },
                    DE: { code: "EUR", symbol: "€" },
                    FR: { code: "EUR", symbol: "€" },
                    IT: { code: "EUR", symbol: "€" },
                    ES: { code: "EUR", symbol: "€" },
                    NL: { code: "EUR", symbol: "€" },
                    JP: { code: "JPY", symbol: "¥" },
                    IN: { code: "INR", symbol: "₹" },
                    AU: { code: "AUD", symbol: "A$" },
                    CA: { code: "CAD", symbol: "C$" },
                    US: { code: "USD", symbol: "$" },
                    ZA: { code: "ZAR", symbol: "R" },
                    KE: { code: "KES", symbol: "KSh" },
                    GH: { code: "GHS", symbol: "GH₵" },
                };
                
                if (country && countryToCurrency[country]) {
                    return countryToCurrency[country];
                }
                
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
                if (tz.includes("Lagos")) return { code: "NGN", symbol: "₦" };
                if (tz.includes("London")) return { code: "GBP", symbol: "£" };
                if (tz.includes("Europe")) return { code: "EUR", symbol: "€" };
                if (tz.includes("Calcutta") || tz.includes("Kolkata")) return { code: "INR", symbol: "₹" };
                if (tz.includes("Tokyo")) return { code: "JPY", symbol: "¥" };
                if (tz.includes("Sydney") || tz.includes("Melbourne")) return { code: "AUD", symbol: "A$" };
                if (tz.includes("Toronto") || tz.includes("Vancouver")) return { code: "CAD", symbol: "C$" };
                if (tz.includes("Nairobi")) return { code: "KES", symbol: "KSh" };
                if (tz.includes("Accra")) return { code: "GHS", symbol: "GH₵" };
                if (tz.includes("Johannesburg")) return { code: "ZAR", symbol: "R" };
                
            } catch (e) {
                console.error("Failed to detect currency from locale/timezone fallback:", e);
            }
            return { code: "USD", symbol: "$" };
        };

        const initialCurrency = detectLocalCurrency();
        setDetectedCurrency(initialCurrency);

        const fetchGeoCurrencyAndRate = async () => {
            try {
                const res = await fetch("/api/rates");
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        setDetectedCurrency({
                            code: data.currency,
                            symbol: data.symbol
                        });
                        setExchangeRate(Number(data.rate));
                    }
                }
            } catch (e) {
                console.error("Failed to fetch exchange rates from local API:", e);
            }
        };

        fetchGeoCurrencyAndRate();
    }, []);

    const [merchantTier, setMerchantTier] = useState(0);
    const [vaultBalance, setVaultBalance] = useState(0);
    const [payoutDestination, setPayoutDestination] = useState<string | null>(null);
    const [walletBalance, setWalletBalance] = useState(0);
    const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
    const [isPremium, setIsPremium] = useState(false);
    const [promptFlowMode, setPromptFlowMode] = useState<"standard" | "private">("standard");
    const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

    /* Currency detection and real-time exchange rate states */
    const [detectedCurrency, setDetectedCurrency] = useState<{ code: string; symbol: string }>({ code: "USD", symbol: "$" });
    const [exchangeRate, setExchangeRate] = useState<number>(1.0);

    /* Confidentiality states */
    const [sessionAlert, setSessionAlert] = useState<"role_missing" | "wrong_role" | "wallet_mismatch" | null>(null);
    const [shieldedEnabled, setShieldedEnabled] = useState(false);
    const [viewKey, setViewKey] = useState("");
    const [isViewKeyRegistered, setIsViewKeyRegistered] = useState(false);
    const [showViewKey, setShowViewKey] = useState(false);
    const [copiedViewKey, setCopiedViewKey] = useState(false);
    const [isSavingConfidentiality, setIsSavingConfidentiality] = useState(false);
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [settlementTimeframe, setSettlementTimeframe] = useState<string>('6M');
    const [balanceVisible, setBalanceVisible] = useState(true);
    const [timeframeOpen, setTimeframeOpen] = useState(false);
    const [fiatSplit, setFiatSplit] = useState(50);

    /* QR Code modal states */
    const [activeQrCodeLink, setActiveQrCodeLink] = useState<string | null>(null);
    const [activeQrCodeTitle, setActiveQrCodeTitle] = useState("");

    /* SubScript Alias DNS states */
    const [merchantAlias, setMerchantAlias] = useState<string | null>(null);
    const [merchantAliasIsAnonymous, setMerchantAliasIsAnonymous] = useState(false);
    const [aliasInput, setAliasInput] = useState("");
    const [aliasIsAnonymousInput, setAliasIsAnonymousInput] = useState(false);
    const [isSavingAlias, setIsSavingAlias] = useState(false);
    const [aliasSuccessMessage, setAliasSuccessMessage] = useState<string | null>(null);
    const [aliasErrorMessage, setAliasErrorMessage] = useState<string | null>(null);



    /* Tier and confidentiality come from the database, and must not sit downstream of the chain
       reads. All of this used to share ONE try block, with the API fetches sequenced after a
       Promise.all of four Arc calls — and Arc's public RPC rate-limits per call while viem does not
       retry its 429s (see lib/arc/transport). A single collision rejected the Promise.all and threw
       before setIsPremium ever ran, so isPremium stayed false and a paying merchant was shown the
       upgrade lock over their own API keys, checkout and webhooks. The retrying transport makes that
       far less likely; independence makes it harmless. A chain hiccup may cost you a balance — it
       must never cost you your tier. */
    const refetchBalancesAndTier = useCallback(async () => {
        if (!address) return;

        const loadTier = async () => {
            try {
                const tierRes = await fetch(`/api/merchant/tier?address=${address}`);
                if (!tierRes.ok) return;
                const tierData = await tierRes.json();
                setIsPremium(Number(tierData.tier) >= 1);
                setMerchantTier(Number(tierData.tier));
                setPremiumSubId(tierData.subscriptionId ? Number(tierData.subscriptionId) : null);
                setCancelAtPeriodEnd(!!tierData.cancelAtPeriodEnd);
                setCurrentPeriodEnd(tierData.nextBillingDate || null);
                setDbSubscriptionStatus(tierData.status || null);
                setDowngradeFailures(tierData.downgradeFailures ? Number(tierData.downgradeFailures) : 0);
            } catch (error) {
                console.error("Error loading merchant tier:", error);
            }
        };

        const loadConfidentiality = async () => {
            try {
                const confidentialityRes = await fetch("/api/merchant/confidentiality");
                if (!confidentialityRes.ok) return;
                const confData = await confidentialityRes.json();
                setShieldedEnabled(!!confData.shielded_payouts_enabled);
                setIsViewKeyRegistered(!!confData.view_key_hash);
            } catch (error) {
                console.error("Error loading confidentiality settings:", error);
            }
        };

        const loadChainState = async () => {
            try {
                /* merchantTiers was read here too and never used — the tier below is the DB's. It was
                   a fourth call into the limiter for nothing. */
                const [vaultRaw, payoutRaw, walletRaw] = await Promise.all([
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

                setVaultBalance(parseFloat(formatUnits(vaultRaw, 6)));
                setPayoutDestination(payoutRaw && payoutRaw !== "0x0000000000000000000000000000000000000000" ? payoutRaw : null);
                setWalletBalance(parseFloat(formatUnits(walletRaw as bigint, 6)));
            } catch (error) {
                console.error("Error reading contract data in background:", error);
            }
        };

        await Promise.all([loadTier(), loadConfidentiality(), loadChainState()]);
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

    useEffect(() => {
        if (typeof window !== "undefined" && address) {
            const storedKey = sessionStorage.getItem(`subscript_viewkey_${address.toLowerCase()}`);
            if (storedKey) {
                setViewKey(storedKey);
            } else {
                setViewKey("");
            }
        }
    }, [address]);

    /* useEffect for SBT metadata fetching removed */



    const refetchTier = refetchBalancesAndTier;
    const refetchVaultBalance = refetchBalancesAndTier;
    const refetchPayoutDest = refetchBalancesAndTier;
    const refetchWalletBalance = refetchBalancesAndTier;

    const handleManualRefreshBalances = async () => {
        setIsRefreshingBalances(true);
        try {
            await refetchBalancesAndTier();
        } catch (err) {
            console.error("Failed to refresh balances manually:", err);
        } finally {
            setIsRefreshingBalances(false);
        }
    };


    const [activeTab, setActiveTab] = useState<TabId>("overview");

    /* A tab switch always starts at the top — otherwise a scroll depth carried over
       from a longer tab can sit past the end of a shorter one, showing only background. */
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeTab]);

    /* Load the dunning config lazily, the first time the settings tab opens. */
    useEffect(() => {
        if (activeTab !== "settings" || dunningLoaded) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/merchant/dunning");
                const data = await res.json().catch(() => ({}));
                if (!cancelled && res.ok && data.success) {
                    setDunningMaxFailures(String(data.dunning.maxFailures));
                    setDunningLoaded(true);
                }
            } catch { /* keep the default; the card still saves */ }
        })();
        return () => { cancelled = true; };
    }, [activeTab, dunningLoaded]);

    const handleSaveDunning = async () => {
        const value = Number(dunningMaxFailures);
        if (!Number.isInteger(value) || value < 1 || value > 10) {
            setDunningMessage("Choose a whole number between 1 and 10.");
            return;
        }
        setDunningSaving(true);
        setDunningMessage(null);
        try {
            const res = await fetch("/api/merchant/dunning", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ maxFailures: value }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to save");
            setDunningMessage("Saved. Applies from the next billing run.");
            setTimeout(() => setDunningMessage(null), 4000);
        } catch (err: any) {
            setDunningMessage(err.message || "Failed to save dunning settings.");
        } finally {
            setDunningSaving(false);
        }
    };
    const [subTab, setSubTab] = useState<"subscriptions" | "one-time" | "commit">("subscriptions");
    /* Thumb-swipe or mouse-drag across the Payments & Subscriptions sub-tabs; taps still work. */
    const paymentSwipe = useSwipeTabs(["subscriptions", "one-time", "commit"] as const, subTab, setSubTab);
    const [prevSubTab, setPrevSubTab] = useState<"subscriptions" | "one-time" | "commit">("subscriptions");
    if (subTab !== prevSubTab) {
        setPrevSubTab(subTab);
    }
    const subTabsList = ["subscriptions", "one-time", "commit"] as const;
    const subTabIndex = subTabsList.indexOf(subTab);
    const prevSubTabIndex = subTabsList.indexOf(prevSubTab);
    const subTabDirection = subTabIndex >= prevSubTabIndex ? 1 : -1;
    const [vaults, setVaults] = useState<any[]>([]);
    const [isVaultsLoading, setIsVaultsLoading] = useState(false);
    const [requiredCommit, setRequiredCommit] = useState("0");
    const [commitInput, setCommitInput] = useState("0");
    const [claimableAmount, setClaimableAmount] = useState("0");
    const [isVaultOpsLoading, setIsVaultOpsLoading] = useState(false);
    const [isSavingCommit, setIsSavingCommit] = useState(false);
    const [isClaimingVault, setIsClaimingVault] = useState(false);
    const [vaultOpsStatus, setVaultOpsStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [usageSecretKey, setUsageSecretKey] = useState("");
    const [selectedApiKey, setSelectedApiKey] = useState("");

    const [vaultsError, setVaultsError] = useState<string | null>(null);
    const fetchVaults = useCallback(async () => {
        setIsVaultsLoading(true);
        setVaultsError(null);
        try {
            const res = await fetch("/api/user/vault/config");
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                setVaults(data.vaults || []);
            } else {
                /* Don't render "no customers yet" over a failed load — that reads as
                   real business data (zero escrows) when it's actually an error. */
                setVaultsError(data?.error || "Customer escrows could not be loaded. Retry with Refresh.");
            }
        } catch (err) {
            console.error("Failed to load customer vaults:", err);
            setVaultsError("Customer escrows could not be loaded. Retry with Refresh.");
        } finally {
            setIsVaultsLoading(false);
        }
    }, []);

    const fetchVaultOps = useCallback(async () => {
        setIsVaultOpsLoading(true);
        try {
            const [commitRes, claimRes] = await Promise.all([
                fetch("/api/merchant/vault/commit-config"),
                fetch("/api/merchant/vault/claim")
            ]);

            const commitData = await commitRes.json().catch(() => null);
            const claimData = await claimRes.json().catch(() => null);

            if (commitRes.ok && commitData?.success) {
                const nextCommit = commitData.commitUsdc || "0";
                setRequiredCommit(nextCommit);
                setCommitInput(formatUsdcInput(nextCommit));
            }
            if (claimRes.ok && claimData?.success) {
                setClaimableAmount(claimData.claimableUsdc || "0");
            }
            if (!commitRes.ok || !claimRes.ok) {
                setVaultOpsStatus({
                    text: commitData?.error || claimData?.error || "Vault controls could not be loaded.",
                    type: "error"
                });
            }
        } catch (err) {
            console.error("Failed to load merchant vault controls:", err);
        } finally {
            setIsVaultOpsLoading(false);
        }
    }, []);

    const fetchVaultApiKeys = useCallback(async () => {
        try {
            const res = await fetch("/api/merchant/api-keys");
            if (res.ok) {
                const data = await res.json();
                const keys = data.keys || [];
                const usableKey = keys.find((key: any) => key.secretKeyAvailable && key.secretKeyPlain);
                if (usableKey) {
                    setSelectedApiKey(usableKey.secretKeyPlain);
                } else {
                    setSelectedApiKey("");
                }
            }
        } catch (err) {
            console.error("Failed to load API keys:", err);
        }
    }, []);

    useEffect(() => {
        if (activeTab === "payment-links" && subTab === "commit" && isPremium && address) {
            fetchVaults();
            fetchVaultOps();
            fetchVaultApiKeys();
        }
    }, [activeTab, subTab, isPremium, address, fetchVaults, fetchVaultOps, fetchVaultApiKeys]);

    const handleSaveCommitConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        if (commitInput === "" || isNaN(Number(commitInput)) || Number(commitInput) < 0) {
            setVaultOpsStatus({ text: "Required commit must be zero or greater.", type: "error" });
            return;
        }

        setIsSavingCommit(true);
        setVaultOpsStatus(null);
        try {
            const res = await fetch("/api/merchant/vault/commit-config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amountUsdc: commitInput })
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                const nextCommit = data.commitUsdc || "0";
                setRequiredCommit(nextCommit);
                setCommitInput(formatUsdcInput(nextCommit));
                setVaultOpsStatus({
                    text: `Required commit saved. Tx ${shortenHash(data.txHash)}.`,
                    type: "success"
                });
                fetchVaults();
            } else {
                setVaultOpsStatus({ text: data?.error || "Failed to save required commit.", type: "error" });
            }
        } catch (err: any) {
            setVaultOpsStatus({ text: err.message || "Failed to save required commit.", type: "error" });
        } finally {
            setIsSavingCommit(false);
        }
    };

    const handleClaimVaultFunds = async () => {
        setIsClaimingVault(true);
        setVaultOpsStatus(null);
        try {
            const res = await fetch("/api/merchant/vault/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                setVaultOpsStatus({
                    text: `Funds claimed successfully. Tx ${shortenHash(data.txHash)}.`,
                    type: "success"
                });
                setClaimableAmount("0");
                fetchVaultOps();
                handleManualRefreshBalances();
            } else {
                setVaultOpsStatus({ text: data?.error || "Failed to claim settled funds.", type: "error" });
            }
        } catch (err: any) {
            setVaultOpsStatus({ text: err.message || "Failed to claim settled funds.", type: "error" });
        } finally {
            setIsClaimingVault(false);
        }
    };

    const [userSettings, setUserSettings] = useState<any>(null);
    const [settingsTransactions, setSettingsTransactions] = useState<any[]>([]);
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [dnsDomain, setDnsDomain] = useState("");
    const [dnsSuffix, setDnsSuffix] = useState(".hq");
    const [dnsConfirmPending, setDnsConfirmPending] = useState<string | null>(null);
    const [merchantAliasNextChange, setMerchantAliasNextChange] = useState<string | null>(null);
    const [dnsLoading, setDnsLoading] = useState(false);
    const [dnsSuccess, setDnsSuccess] = useState<string | null>(null);
    const [dnsError, setDnsError] = useState<string | null>(null);
    const [uploadingPic, setUploadingPic] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [savingSettingsField, setSavingSettingsField] = useState<string | null>(null);
    const [payoutDestinationDraft, setPayoutDestinationDraft] = useState("");
    const [payoutDestinationError, setPayoutDestinationError] = useState<string | null>(null);
    const savedPayoutDestination = userSettings?.payoutDestination || "";

    useEffect(() => {
        if (userSettings) setPayoutDestinationDraft(savedPayoutDestination);
    }, [savedPayoutDestination, userSettings]);
    const [churnQuestionDraft, setChurnQuestionDraft] = useState("");
    const [merchantWalletBackupLoading, setMerchantWalletBackupLoading] = useState(false);
    const [merchantWalletBackupError, setMerchantWalletBackupError] = useState<string | null>(null);
    const [merchantExportOtpStage, setMerchantExportOtpStage] = useState(false);
    const [merchantExportOtpCode, setMerchantExportOtpCode] = useState("");
    const [merchantExportOtpSending, setMerchantExportOtpSending] = useState(false);
    const [merchantExportedPrivateKey, setMerchantExportedPrivateKey] = useState<string | null>(null);
    const [merchantPrivateKeyVisible, setMerchantPrivateKeyVisible] = useState(false);

    const fetchSettings = useCallback(async () => {
        if (!address) return;
        setIsSettingsLoading(true);
        try {
            const res = await fetch("/api/user/settings");
            const data = await res.json();
            if (data.success) {
                setUserSettings(data.settings);
                setChurnQuestionDraft(data.settings?.churnSurveyQuestion || "");
                setSettingsTransactions(data.receipts);
                if (data.settings.alias) {
                    const aliasParts = data.settings.alias.split(".");
                    setDnsDomain(aliasParts[0]);
                    setDnsSuffix("." + (aliasParts[1] || "hq"));
                }
            }
        } catch (err) {
            console.error("Error fetching settings:", err);
        } finally {
            setIsSettingsLoading(false);
        }
    }, [address]);

    useEffect(() => {
        if (address) {
            fetchSettings();
        }
    }, [address, fetchSettings]);

    const requestMerchantExportOtp = async () => {
        const email = userSettings?.walletBackup?.email || embeddedWallet?.email;
        if (!email) {
            setMerchantWalletBackupError("No verified email is linked to this merchant wallet.");
            return;
        }
        setMerchantExportOtpSending(true);
        setMerchantWalletBackupError(null);
        setMerchantExportedPrivateKey(null);
        setMerchantPrivateKeyVisible(false);
        try {
            const res = await fetch("/api/auth/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Could not send a verification code.");
            }
            setMerchantExportOtpStage(true);
            setMerchantExportOtpCode("");
            setToastMessage(`Verification code sent to ${email}`);
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
        } catch (error: any) {
            setMerchantWalletBackupError(error.message || "Could not send a verification code.");
        } finally {
            setMerchantExportOtpSending(false);
        }
    };

    const handleMerchantWalletExport = async () => {
        setMerchantWalletBackupLoading(true);
        setMerchantWalletBackupError(null);
        try {
            const res = await fetch("/api/user/wallet/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ otpCode: merchantExportOtpCode.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Could not export this merchant wallet.");
            }
            setMerchantExportedPrivateKey(data.privateKey);
            setMerchantPrivateKeyVisible(true);
            setMerchantExportOtpStage(false);
            setMerchantExportOtpCode("");
        } catch (error: any) {
            setMerchantWalletBackupError(error.message || "Could not export this merchant wallet.");
        } finally {
            setMerchantWalletBackupLoading(false);
        }
    };

    const downloadMerchantWalletBackup = () => {
        if (!merchantExportedPrivateKey || !address) return;
        const blob = new Blob([[
            "SubScript merchant wallet private key backup",
            `Wallet: ${address.toLowerCase()}`,
            `Created: ${new Date().toISOString()}`,
            "",
            merchantExportedPrivateKey,
            "",
            "Store this offline. Anyone with this key can control this wallet.",
        ].join("\n")], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `subscript-merchant-wallet-${address.slice(2, 8).toLowerCase()}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleToggleSetting = async (field: string, currentValue: boolean) => {
        if (comingSoonMerchantSettings.has(field)) return;
        setSavingSettingsField(field);
        try {
            const res = await fetch("/api/user/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [field]: !currentValue })
            });
            const data = await res.json();
            if (data.success) {
                setUserSettings((prev: any) => ({ ...prev, [field]: !currentValue }));
            }
        } catch (err) {
            console.error(`Error saving setting ${field}:`, err);
        } finally {
            setSavingSettingsField(null);
        }
    };

    const handleUpdateChurnSurveyQuestion = async (question: string) => {
        setSavingSettingsField("churnSurveyQuestion");
        try {
            const res = await fetch("/api/user/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ churnSurveyQuestion: question })
            });
            const data = await res.json();
            if (data.success) {
                const trimmed = question.trim();
                setUserSettings((prev: any) => ({ ...prev, churnSurveyQuestion: trimmed.length > 0 ? trimmed : null }));
                setToastMessage("Exit-survey question saved");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
            } else {
                setToastMessage(data.error || "Could not save the exit-survey question");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
            }
        } catch (err) {
            console.error("Error updating churn survey question:", err);
        } finally {
            setSavingSettingsField(null);
        }
    };

    const handleUpdatePayoutDestination = async (destination: string) => {
        const normalized = destination.trim();
        if (normalized && !ethers.isAddress(normalized)) {
            setPayoutDestinationError("Enter a valid EVM wallet address before saving.");
            return;
        }
        setConfirmModal({
            open: true,
            title: "Update Payout Destination",
            description: `Save ${normalized || "no address"} as the default payout destination? This changes the saved destination but does not move funds now.`,
            confirmLabel: "Save",
            variant: "warning",
            onConfirm: async () => {
                setConfirmModal(null);
                setSavingSettingsField("payoutDestination");
                setPayoutDestinationError(null);
                try {
                    const res = await fetch("/api/user/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ payoutDestination: normalized })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setUserSettings((prev: any) => ({ ...prev, payoutDestination: normalized }));
                        setToastMessage("Payout destination updated");
                        setShowToast(true);
                        setTimeout(() => setShowToast(false), 3000);
                    } else {
                        setPayoutDestinationError(data.error || "Could not save the payout destination.");
                    }
                } catch (err) {
                    console.error("Error updating payout destination:", err);
                    setPayoutDestinationError("Network error. Your previous payout destination is still saved.");
                } finally {
                    setSavingSettingsField(null);
                }
            },
        });
    };

    const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            setUploadError("Image size must be smaller than 2MB");
            return;
        }

        setUploadingPic(true);
        setUploadError(null);

        const reader = new FileReader();
        reader.onloadend = async () => {
            try {
                const res = await fetch("/api/user/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profilePic: reader.result })
                });
                const data = await res.json();
                if (data.success) {
                    setUserSettings((prev: any) => ({ ...prev, profilePic: reader.result as string }));
                } else {
                    setUploadError(data.error || "Upload failed");
                }
            } catch (err) {
                console.error("Error uploading profile pic:", err);
                setUploadError("Upload failed");
            } finally {
                setUploadingPic(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleRegisterDns = (e: React.FormEvent) => {
        e.preventDefault();
        setDnsError(null);
        setDnsSuccess(null);

        const prefix = dnsDomain.trim().toLowerCase();
        if (!prefix) {
            setDnsError("DNS alias cannot be empty");
            return;
        }
        const cleanPrefix = prefix.split(".")[0];
        /* Show a branded confirmation step (the name is locked for 365 days after this). */
        setDnsConfirmPending(`${cleanPrefix}${dnsSuffix}`);
    };

    const confirmDnsRegistration = async () => {
        const fullAlias = dnsConfirmPending;
        if (!fullAlias) return;
        setDnsLoading(true);
        setDnsError(null);
        setDnsSuccess(null);
        try {
            const res = await fetch("/api/merchant/alias", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ alias: fullAlias })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setDnsSuccess(`DNS Registered: ${fullAlias}`);
                setUserSettings((prev: any) => ({ ...prev, alias: fullAlias }));
                setMerchantAlias(fullAlias);
                setDnsConfirmPending(null);
            } else {
                setDnsError(data.error || "Registration failed");
            }
        } catch (err) {
            console.error("Error registering DNS:", err);
            setDnsError("Registration failed");
        } finally {
            setDnsLoading(false);
        }
    };


    const [copiedText, setCopiedText] = useState<string | null>(null);

    const [isAuthLoading, setIsAuthLoading] = useState(true);
    
    /* Loading states for initial fetches to support skeleton loading */
    const [initialKeysFetched, setInitialKeysFetched] = useState(false);
    const [initialWebhooksFetched, setInitialWebhooksFetched] = useState(false);
    const [initialEventsFetched, setInitialEventsFetched] = useState(false);
    const [initialContractFetched, setInitialContractFetched] = useState(false);

    const isLoading = !isMounted || isAuthLoading || (isConnected && sessionWallet && (!initialKeysFetched || !initialWebhooksFetched || !initialEventsFetched || !initialContractFetched || !initialLinksFetched || !initialPlansFetched));
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const { signMessageAsync } = useSignMessage();


    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [isKeysLoading, setIsKeysLoading] = useState(false);
    const [revealSecret, setRevealSecret] = useState(false);
    const [isRolling, setIsRolling] = useState(false);
    const [apiKeyWebhookUrl, setApiKeyWebhookUrl] = useState("");
    const [apiKeySetupStatus, setApiKeySetupStatus] = useState<string | null>(null);


    const [webhookEndpoints, setWebhookEndpoints] = useState<any[]>([]);
    const [isWebhooksLoading, setIsWebhooksLoading] = useState(false);
    const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
    const [isEventsLoading, setIsEventsLoading] = useState(false);
    const [webhookUrlInput, setWebhookUrlInput] = useState("");
    const [isAddingWebhook, setIsAddingWebhook] = useState(false);
    const [revealWebhookSecret, setRevealWebhookSecret] = useState<string | null>(null);


    const [selectedWebhook, setSelectedWebhook] = useState<string>("");
    const [isReplaying, setIsReplaying] = useState(false);
    const [isTestingWebhook, setIsTestingWebhook] = useState<string | null>(null);
    const [replayStatus, setReplayStatus] = useState<string | null>(null);


    const [subName, setSubName] = useState("AI Agent Compute Limit");
    const [subCap, setSubCap] = useState("150.00");
    const [subInterval, setSubInterval] = useState("monthly");
    const [subChain, setSubChain] = useState("arc");

    const fetchPaymentLinks = async () => {
        setIsLinksLoading(true);
        try {
            const res = await fetch("/api/payment-links");
            const data = await res.json();
            if (data.links) {
                setPaymentLinks(data.links);
            }
        } catch (err) {
            console.error("Error fetching payment links:", err);
        } finally {
            setIsLinksLoading(false);
            setInitialLinksFetched(true);
        }
    };

    const fetchMerchantPlans = async () => {
        setIsPlansLoading(true);
        try {
            const [res, promoRes] = await Promise.all([
                fetch("/api/merchant/plans"),
                fetch("/api/merchant/promotions"),
            ]);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to load plans");
            }
            setMerchantPlans(data.plans || []);
            const promoData = await promoRes.json().catch(() => ({}));
            if (promoRes.ok && promoData.success) {
                setPlanPromotions(promoData.promotions || []);
            }
        } catch (err: any) {
            console.error("Error fetching merchant plans:", err);
            setPlanError(err.message || "Failed to load plans");
        } finally {
            setIsPlansLoading(false);
            setInitialPlansFetched(true);
        }
    };

    const handleCreatePlan = async (event: React.FormEvent) => {
        event.preventDefault();
        setPlanError(null);
        setPlanSuccess(null);

        if (!planName.trim()) {
            setPlanError("Plan name is required.");
            return;
        }
        if (!planAmountUsdc || Number(planAmountUsdc) <= 0) {
            setPlanError("Amount must be greater than 0 USDC.");
            return;
        }
        if (!planPeriodDays || Number(planPeriodDays) < 1) {
            setPlanError("Billing period must be at least 1 day.");
            return;
        }
        if (planDescription.length > PLAN_DESCRIPTION_MAX) {
            setPlanError(`Description must be ${PLAN_DESCRIPTION_MAX} characters or fewer.`);
            return;
        }
        const trimmedDetailsUrl = planDetailsUrl.trim();
        if (trimmedDetailsUrl && !/^https?:\/\//i.test(trimmedDetailsUrl)) {
            setPlanError("Details link must start with http:// or https://");
            return;
        }
        const commitmentDays = planMinCommitmentDays === "" ? 0 : Number(planMinCommitmentDays);
        const commitmentCap = Math.min(30, Number(planPeriodDays));
        if (!Number.isFinite(commitmentDays) || commitmentDays < 0 || commitmentDays > commitmentCap) {
            setPlanError(`Minimum commitment must be between 0 and ${commitmentCap} days (one billing period, capped at 30).`);
            return;
        }

        setIsPlansLoading(true);
        try {
            const res = await fetch("/api/merchant/plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: planName,
                    description: planDescription.trim() || undefined,
                    detailsUrl: trimmedDetailsUrl || undefined,
                    amountUsdc: planAmountUsdc,
                    periodDays: Number(planPeriodDays),
                    minCommitmentDays: commitmentDays > 0 ? commitmentDays : undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to create plan.");
            setPlanName("");
            setPlanDescription("");
            setPlanDetailsUrl("");
            setPlanAmountUsdc("");
            setPlanPeriodDays("30");
            setPlanMinCommitmentDays("");
            setPlanSuccess("Plan created. Copy its subscribe link below and share it with customers.");
            setToastMessage("Plan Created");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);
            await fetchMerchantPlans();
        } catch (err: any) {
            setPlanError(err.message || "Failed to create plan.");
        } finally {
            setIsPlansLoading(false);
        }
    };

    const handleTogglePlanActive = async (plan: MerchantPlan) => {
        setPlanError(null);
        setPlanSuccess(null);
        setIsPlansLoading(true);
        try {
            const res = await fetch("/api/merchant/plans", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: plan.id, active: !plan.active }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to update plan.");
            setPlanSuccess(!plan.active ? "Plan reactivated." : "Plan deactivated for new subscribers.");
            await fetchMerchantPlans();
        } catch (err: any) {
            setPlanError(err.message || "Failed to update plan.");
        } finally {
            setIsPlansLoading(false);
        }
    };

    const handleCreatePaymentLink = async (e: React.FormEvent) => {
        e.preventDefault();
        setLinkError(null);
        setLinkSuccess(null);
        setCreatedLinkInfo(null);
        setIsCreatingLink(true);

        try {
            if (!linkTitle.trim()) {
                throw new Error("Title is required");
            }
            if (!linkAmountUsdc || isNaN(Number(linkAmountUsdc)) || Number(linkAmountUsdc) <= 0) {
                throw new Error("Amount must be a positive number");
            }

            const rawAmount = parseUnits(limitDecimals(linkAmountUsdc, 6), 6).toString();
            const totalSelectedSeconds = linkDurationMinutes * 60;
            const expiresTimestamp = Math.floor(Date.now() / 1000) + totalSelectedSeconds;

            const res = await fetch("/api/payment-links", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: linkTitle,
                    description: linkDescription || null,
                    amount_usdc: rawAmount,
                    expires_at: linkDurationMinutes > 0 ? expiresTimestamp : null,
                    external_reference: linkExternalReference || null,
                    max_uses: linkMaxUses ? Number(linkMaxUses) : null,
                    invoice_number: linkInvoiceNumber.trim() || null,
                    due_date: linkDueDate || null,
                    payer_email: linkPayerEmail.trim() || null
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to create payment link");
            }

            setCreatedLinkInfo({
                id: data.link.id,
                title: data.link.title,
                checkoutUrl: data.link.checkoutUrl || buildCheckoutUrl(data.link.id, window.location.origin),
            });
            setLinkSuccess("Payment link created successfully!");
            setToastMessage("Link Created Successfully");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 4000);
            setLinkTitle("");
            setLinkDescription("");
            setLinkAmountUsdc("");
            setLinkDurationMinutes(1440);
            setLinkMaxUses("1");
            setLinkInvoiceNumber("");
            setLinkDueDate("");
            setLinkPayerEmail("");
            setLinkExternalReference("");
            await fetchPaymentLinks();
        } catch (err: any) {
            setLinkError(err.message || "Something went wrong");
        } finally {
            setIsCreatingLink(false);
        }
    };

    const handleToggleLinkActive = async (linkId: string, currentActive: boolean) => {
        try {
            const res = await fetch(`/api/payment-links/${linkId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: !currentActive }),
            });
            if (res.ok) {
                await fetchPaymentLinks();
            } else {
                const data = await res.json();
                console.error("Failed to toggle payment link active state:", data.error);
            }
        } catch (err) {
            console.error("Error toggling payment link active state:", err);
        }
    };

    const handleUpdateLinkRules = async (linkId: string, durationMinutes: number, maxUses: string | null) => {
        try {
            const expiresAt = durationMinutes > 0
                ? Math.floor(Date.now() / 1000) + durationMinutes * 60
                : null;

            const res = await fetch(`/api/payment-links/${linkId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    expires_at: expiresAt,
                    max_uses: maxUses,
                }),
            });

            if (res.ok) {
                setToastMessage("Payment link rules updated");
                setShowToast(true);
                setTimeout(() => setShowToast(false), 3000);
                await fetchPaymentLinks();
            } else {
                const data = await res.json();
                console.error("Failed to update payment link rules:", data.error);
                setLinkError(data.error || "Failed to update payment link rules");
            }
        } catch (err) {
            console.error("Error updating payment link rules:", err);
            setLinkError("Failed to update payment link rules");
        }
    };

    const handleDeleteLink = async (linkId: string) => {
        setConfirmModal({
            open: true,
            title: "Delete Payment Link",
            description: "This payment link will be permanently deleted. Any pending checkouts using this link will stop working. This cannot be undone.",
            confirmLabel: "Delete",
            variant: "danger",
            onConfirm: async () => {
                setConfirmModal(null);
                try {
                    const res = await fetch(`/api/payment-links/${linkId}`, {
                        method: "DELETE",
                    });
                    if (res.ok) {
                        await fetchPaymentLinks();
                    } else {
                        const data = await res.json();
                        console.error("Failed to delete payment link:", data.error);
                    }
                } catch (err) {
                    console.error("Error deleting payment link:", err);
                }
            },
        });
    };

    const getPublicCheckoutUrl = (linkId: string, checkoutUrl?: string | null) => {
        return checkoutUrl || buildCheckoutUrl(linkId, typeof window !== "undefined" ? window.location.origin : undefined);
    };

    const handleCopyLink = (linkId: string, checkoutUrl?: string | null) => {
        const url = getPublicCheckoutUrl(linkId, checkoutUrl);
        navigator.clipboard.writeText(url);
        setLinkCopyFeedback(prev => ({ ...prev, [linkId]: true }));
        setTimeout(() => {
            setLinkCopyFeedback(prev => ({ ...prev, [linkId]: false }));
        }, 2000);
    };

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
                    if (!data.role) {
                        console.warn("Missing account role");
                        setSessionAlert("role_missing");
                        return;
                    }
                    if (data.role === "USER") {
                        console.warn("Unauthorized role for merchant dashboard");
                        setSessionAlert("wrong_role");
                        return;
                    }
                    setSessionWallet(data.wallet.toLowerCase());
                    if (data.isEmbedded) {
                        setEmbeddedWallet({
                            wallet: data.wallet,
                            email: data.email
                        });
                    } else {
                        setEmbeddedWallet(null);
                    }
                }
            } catch (err) {
                console.error("Error restoring session:", err);
            } finally {
                setIsAuthLoading(false);
            }
        };
        restoreSession();
    }, [router]);


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
            setInitialPlansFetched(false);
            return;
        }

        const verifySession = async () => {
            try {
                const res = await fetch("/api/auth/session");
                const data = await res.json();
                if (data.loggedIn) {
                    if (data.isEmbedded) {
                        setEmbeddedWallet({
                            wallet: data.wallet,
                            email: data.email
                        });
                    } else if (data.wallet.toLowerCase() !== address.toLowerCase()) {
                        console.warn("Session wallet mismatch");
                        setSessionAlert("wallet_mismatch");
                        return;
                    }
                    if (!data.role) {
                        console.warn("Missing account role");
                        setSessionAlert("role_missing");
                        return;
                    }
                    if (data.role === "USER") {
                        console.warn("Unauthorized role for merchant dashboard");
                        setSessionAlert("wrong_role");
                        return;
                    }
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
    }, [address, isConnected, embeddedWallet, router]);

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
                console.log("Development OTP Code:", data.devOtpCode);
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

    const fetchAlias = useCallback(async () => {
        try {
            const res = await fetch("/api/merchant/alias");
            if (res.ok) {
                const data = await res.json();
                setMerchantAlias(data.alias);
                setMerchantAliasIsAnonymous(!!data.is_anonymous);
                setAliasInput(data.alias || "");
                setAliasIsAnonymousInput(!!data.is_anonymous);
                setMerchantAliasNextChange(data.next_change_at || null);
            }
        } catch (err) {
            console.error("Error fetching merchant alias:", err);
        }
    }, []);

    const handleSaveAlias = async () => {
        setIsSavingAlias(true);
        setAliasSuccessMessage(null);
        setAliasErrorMessage(null);
        try {
            let finalAlias = aliasInput.trim().toLowerCase();
            if (finalAlias && !finalAlias.endsWith(".sub")) {
                finalAlias = finalAlias + ".sub";
            }
            const res = await fetch("/api/merchant/alias", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    alias: finalAlias,
                    isAnonymous: aliasIsAnonymousInput
                })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to save alias");
            }
            setMerchantAlias(data.alias);
            setMerchantAliasIsAnonymous(data.is_anonymous);
            setAliasInput(data.alias || "");
            setAliasSuccessMessage("SubScript alias setting updated successfully!");
            fetchPaymentLinks();
        } catch (err: any) {
            setAliasErrorMessage(err.message || "An error occurred");
        } finally {
            setIsSavingAlias(false);
        }
    };

    const handleDeleteAlias = async () => {
        setIsSavingAlias(true);
        setAliasSuccessMessage(null);
        setAliasErrorMessage(null);
        try {
            const res = await fetch("/api/merchant/alias", {
                method: "DELETE"
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to remove alias");
            }
            setMerchantAlias(null);
            setMerchantAliasIsAnonymous(false);
            setAliasInput("");
            setAliasIsAnonymousInput(false);
            setAliasSuccessMessage("SubScript alias removed successfully!");
            fetchPaymentLinks();
        } catch (err: any) {
            setAliasErrorMessage(err.message || "An error occurred");
        } finally {
            setIsSavingAlias(false);
        }
    };

    const loadBackendData = useCallback(async () => {
        if (!sessionWallet) return;
        
        await Promise.all([
            fetchApiKeys(),
            fetchWebhookEndpoints(),
            fetchWebhookEvents(),
            fetchPaymentLinks(),
            fetchMerchantPlans(),
            fetchAlias(),
        ]);
    }, [sessionWallet, fetchAlias]);

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
            const message = buildWalletAuthMessage({ address, nonce: fetchedNonce, domain: window.location.host, uri: window.location.origin });
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

    const handleDnsClick = () => {
        setActiveTab("settings");
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
        setConfirmModal({
            open: true,
            title: "Delete Webhook Endpoint",
            description: "This endpoint will stop receiving webhook events immediately. This cannot be undone.",
            confirmLabel: "Delete",
            variant: "danger",
            onConfirm: async () => {
                setConfirmModal(null);
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
            },
        });
    };


    const [isWithdrawing, setIsWithdrawing] = useState(false);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);


    const [ledgers, setLedgers] = useState<any[]>([]);
    const [ledgerPagination, setLedgerPagination] = useState({ total: 0, totalPages: 1 });
    const [merchantAnalytics, setMerchantAnalytics] = useState<MerchantAnalyticsSummary | null>(null);
    const [isLoadingContract, setIsLoadingContract] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const ledgerCursor = ledgerCursors[ledgerPage] || null;


    useEffect(() => {
        const merchantAddress = address;
        if (!isConnected || !merchantAddress) {
            setLedgers([]);
            setLedgerPagination({ total: 0, totalPages: 1 });
            setMerchantAnalytics(null);
            setLedgerPage(0);
            setLedgerCursors([null]);
            return;
        }

        let isSubscribed = true;

        async function fetchOnChainData() {
            if (!merchantAddress) return;
            setIsLoadingContract(true);
            if (isTestMode) {
                setLedgers([]);
                setLedgerPagination({ total: 0, totalPages: 1 });
                setMerchantAnalytics(null);
                setIsLoadingContract(false);
                setInitialContractFetched(true);
                return;
            }
            try {
                const cursorParam = ledgerCursor ? `&cursor=${encodeURIComponent(ledgerCursor)}` : "";
                const mirrorResponse = await fetch(`/api/merchant/subscriptions?pageSize=5${cursorParam}`);
                const mirrorPayload = await mirrorResponse.json().catch(() => null);
                if (!mirrorResponse.ok || !mirrorPayload?.success) {
                    throw new Error(mirrorPayload?.error || "Subscription analytics could not be loaded");
                }

                /* The server owns merchant scoping, complete aggregates, and page-bounded detail.
                   This keeps browser work constant and removes every protocol-wide RPC scan. */
                const fetchedLedgers = (mirrorPayload.subscriptions || []).map((subscription: MerchantSubscriptionDetail) => {
                    const subscriber = subscription.subscriber || "";
                    const shortAddress = subscriber
                        ? `${subscriber.slice(0, 6)}...${subscriber.slice(-4)}`
                        : "Unknown subscriber";
                    const nextBillingTs = subscription.nextBillingDate
                        ? Math.floor(new Date(subscription.nextBillingDate).getTime() / 1000)
                        : 0;
                    return {
                        id: `agent-run-${subscription.subscriptionId}`,
                        rawId: subscription.subscriptionId,
                        address: subscriber,
                        displayAddress: subscription.externalReference || subscription.subscriberName || shortAddress,
                        shortSubAddress: subscription.externalReference || subscription.subscriberName || shortAddress,
                        limit: `${formatUnits(BigInt(subscription.amountUsdcMicros), 6)} USDC / ${formatPlanPeriod(subscription.periodSeconds)}`,
                        rawAmount: formatUnits(BigInt(subscription.amountUsdcMicros), 6),
                        rawPeriod: subscription.periodSeconds,
                        nextBilling: subscription.nextBillingDate
                            ? new Date(subscription.nextBillingDate).toLocaleDateString()
                            : "Not scheduled",
                        nextPaymentTs: nextBillingTs,
                        activityAt: subscription.activityAt,
                        active: subscription.status === "ACTIVE",
                        billingStatus: subscription.status,
                        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                        downgradeFailures: Number(subscription.downgradeFailures || 0),
                    };
                });
                
                if (isSubscribed) {
                    const totalPages = Math.max(1, Number(mirrorPayload.pagination?.totalPages || 1));
                    if (ledgerPage >= totalPages) {
                        setLedgerPage(totalPages - 1);
                        return;
                    }
                    setLedgers(fetchedLedgers);
                    setLedgerPagination({
                        total: Number(mirrorPayload.pagination?.total || 0),
                        totalPages,
                    });
                    const nextCursor = mirrorPayload.pagination?.nextCursor || null;
                    setLedgerCursors((current) => {
                        const updated = current.slice(0, ledgerPage + 1);
                        if (nextCursor) updated[ledgerPage + 1] = String(nextCursor);
                        return updated;
                    });
                    setMerchantAnalytics(mirrorPayload.analytics || null);
                    if (fetchedLedgers.length > 0) {
                        setSelectedWebhook((current) => current || "evt_01_0");
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
        /* 45s: subscription state changes on billing-cycle timescales; a 10s poll only
           multiplied RPC load (and 429s) without making the numbers fresher in practice. */
        const interval = setInterval(fetchOnChainData, 45000);

        return () => {
            isSubscribed = false;
            clearInterval(interval);
        };
    }, [isConnected, address, isPremium, refreshTrigger, isTestMode, ledgerPage, ledgerCursor]);

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
        const hasActiveKey = apiKeys.some((key) => !key.revoked);
        setConfirmModal({
            open: true,
            title: hasActiveKey ? "Rotate API Key" : "Generate API Key",
            description: hasActiveKey
                ? "The current production key will stop working immediately. Existing integrations will fail until they are updated with the new key."
                : "Your secret key will be shown once. Save it before leaving this page.",
            confirmLabel: hasActiveKey ? "Rotate Key" : "Generate Key",
            variant: hasActiveKey ? "danger" : "default",
            onConfirm: async () => {
                setConfirmModal(null);
                setIsRolling(true);
                setApiKeySetupStatus(null);
                try {
                    const webhookUrl = apiKeyWebhookUrl.trim();
                    const res = await fetch("/api/keys", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(webhookUrl ? { webhookUrl } : {}),
                    });
                    const data = await res.json();
                    if (data.key) {
                        setApiKeys([data.key]);
                        handleCopy(data.key.secretKeyPlain, "API Secret Key Rolled");
                        if (data.webhookEndpoint) {
                            setWebhookEndpoints((current) => [
                                data.webhookEndpoint,
                                ...current.filter((endpoint) => endpoint.id !== data.webhookEndpoint.id),
                            ]);
                            setApiKeyWebhookUrl("");
                        }
                        if (data.webhookWarning) {
                            setApiKeySetupStatus(`API key created, but webhook setup needs attention: ${data.webhookWarning}`);
                        } else {
                            setApiKeySetupStatus(data.webhookEndpoint
                                ? "API key and webhook endpoint created."
                                : "API key created. Register a webhook before going live.");
                        }
                    } else {
                        setApiKeySetupStatus(data.error || "Could not create API credentials.");
                    }
                } catch (err) {
                    console.error("Error rolling keys:", err);
                    setApiKeySetupStatus("Network error while creating API credentials.");
                } finally {
                    setIsRolling(false);
                }
            },
        });
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

            // Query the next unexecuted sequence ID
            let sequenceId = 1;
            while (true) {
                const isExecuted = await publicClient.readContract({
                    address: STANDARD_CONTRACT_ADDRESS,
                    abi: STANDARD_ABI,
                    functionName: "isSequenceExecuted",
                    args: [BigInt(rawId), BigInt(sequenceId)],
                });
                if (!isExecuted) {
                    break;
                }
                sequenceId++;
            }

            await publicClient.simulateContract({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "executePayment",
                account: userAddress,
                args: [BigInt(rawId), BigInt(sequenceId)],
            });

            const txHash = await executeContractWrite({
                address: STANDARD_CONTRACT_ADDRESS,
                abi: STANDARD_ABI,
                functionName: "executePayment",
                args: [BigInt(rawId), BigInt(sequenceId)],
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

    const handleReplayWebhook = async (eventId?: string) => {
        setIsReplaying(true);
        setReplayStatus(eventId ? "Replaying event..." : "Resending latest event...");
        try {
            const res = await fetch("/api/webhooks/events/replay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(eventId ? { eventId } : { latest: true }),
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

    const handleSendWebhookTest = async (eventType: "test" | "payment.succeeded" | "subscription.created") => {
        setIsTestingWebhook(eventType);
        setReplayStatus(`Sending ${eventType} test event...`);
        try {
            const res = await fetch("/api/webhooks/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventType }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || data.message || "Test webhook delivery failed.");
            }
            setReplayStatus(data.message || `${eventType} test event sent.`);
            await Promise.all([fetchWebhookEndpoints(), fetchWebhookEvents()]);
        } catch (err: any) {
            setReplayStatus(err.message || "Network error sending test webhook.");
        } finally {
            setIsTestingWebhook(null);
            setTimeout(() => setReplayStatus(null), 6000);
        }
    };


    const handleWithdraw = async (targetAddress?: string) => {
        if (vaultBalance <= 0) return;
        setIsWithdrawing(true);
        try {
            const liveBalanceRaw = await publicClient.readContract({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: "merchantBalances",
                args: [address as `0x${string}`],
            });
            const liveBalance = Number(formatUnits(liveBalanceRaw, 6));
            if (Math.abs(liveBalance - vaultBalance) > 0.000001) {
                setVaultBalance(liveBalance);
                throw new Error(`Claimable balance changed to ${liveBalance.toFixed(2)} USDC. Review the updated amount before confirming again.`);
            }
            const hasTarget = targetAddress && targetAddress.toLowerCase() !== address?.toLowerCase();
            const txHash = await executeContractWrite({
                address: SUBSCRIPT_ROUTER_ADDRESS,
                abi: ROUTER_ABI,
                functionName: hasTarget ? "withdrawTo" : "withdraw",
                args: hasTarget ? [targetAddress as `0x${string}`] : [],
            });

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
            if (receipt.status !== "success") throw new Error("The withdrawal failed before on-chain confirmation.");

            setWithdrawSuccess(true);
            setToastMessage("Withdrawal confirmed on Arc");
            setShowToast(true);
            setTimeout(() => setShowToast(false), 4000);
            setTimeout(() => setWithdrawSuccess(false), 4000);
            refetchVaultBalance();
            refetchWalletBalance();
        } catch (err: any) {
            console.error("Withdraw failed:", err);
            throw err;
        } finally {
            setIsWithdrawing(false);
        }
    };



    /* The premium checkout itself lives on /merchant/upgrade (src/app/dashboard/upgrade/page.tsx),
       which handles both embedded (custody) and browser wallets and never re-runs a checkout after
       a payment transaction was submitted. The dashboard only links there. */

    const handleCancelPremium = async () => {
        if (!isConnected || !activeMerchantAddress || !isPremium) {
            setPremiumError("No active subscription metadata to cancel.");
            return;
        }

        if (isCancellingPremium) {
            return;
        }

        setConfirmModal({
            open: true,
            title: "Cancel Privacy Premium",
            description: "Your Privacy Premium benefits will remain active until the end of the current billing period. You can resume before that date.",
            confirmLabel: "Cancel Plan",
            variant: "warning",
            onConfirm: async () => {
                setConfirmModal(null);
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
                    setPremiumStatus(`Your Privacy Premium subscription will remain active until ${dateStr}. You can resume anytime before that date.`);
                    await refetchBalancesAndTier();
                    setTimeout(() => setPremiumStatus(null), 8000);
                } catch (err: any) {
                    console.error("Cancellation failed:", err);
                    setPremiumError(err.message || "Cancellation failed.");
                } finally {
                    setIsCancellingPremium(false);
                }
            },
        });
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

            setPremiumStatus("Privacy Premium renewal has been restored. Your subscription will continue normally.");
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

    const handleToggleShielded = () => {
        setShieldedEnabled(prev => !prev);
    };

    const handleGenerateViewKey = () => {
        try {
            const keyBytes = ethers.randomBytes(32);
            const keyHex = ethers.hexlify(keyBytes);
            setViewKey(keyHex);
            setIsViewKeyRegistered(false);
            setShowViewKey(true);
        } catch (err) {
            console.error("Failed to generate view key:", err);
        }
    };

    const handleCopyViewKey = () => {
        if (!viewKey) return;
        navigator.clipboard.writeText(viewKey);
        setCopiedViewKey(true);
        setTimeout(() => setCopiedViewKey(false), 2000);
    };

    const handleSaveConfidentiality = async () => {
        if (!viewKey || !address) return;
        setIsSavingConfidentiality(true);
        setPremiumError(null);
        try {
            const viewKeyHash = ethers.keccak256(viewKey);

            /* 1. If key is not registered, use commit-reveal to prevent front-running */
            if (!isViewKeyRegistered) {
                /* Generate a random salt to blind the commitment */
                const salt = ethers.hexlify(ethers.randomBytes(32));

                /* commitment = keccak256(abi.encodePacked(viewKeyHash, msg.sender, salt)) */
                const commitment = ethers.keccak256(
                    ethers.solidityPacked(
                        ["bytes32", "address", "bytes32"],
                        [viewKeyHash, address, salt]
                    )
                );

                /* Phase 1: commit the blinded hash */
                await executeContractWrite({
                    address: CONFIDENTIAL_CONTRACT_ADDRESS,
                    abi: CONFIDENTIAL_CONTRACT_ABI,
                    functionName: "commitViewKey",
                    args: [commitment],
                });

                /* Wait for COMMIT_DELAY blocks (~20s on Arc with ~2s blocks).
                   Poll the chain until enough blocks have passed. */
                const provider = new ethers.BrowserProvider((window as any).ethereum);
                const commitBlockNum = await provider.getBlockNumber();
                const targetBlock = commitBlockNum + 11; /* COMMIT_DELAY (10) + 1 margin */

                await new Promise<void>((resolve, reject) => {
                    const maxWait = setTimeout(() => reject(new Error("Timed out waiting for commit delay")), 120_000);
                    const poll = setInterval(async () => {
                        try {
                            const current = await provider.getBlockNumber();
                            if (current >= targetBlock) {
                                clearInterval(poll);
                                clearTimeout(maxWait);
                                resolve();
                            }
                        } catch {
                            /* keep polling */
                        }
                    }, 2000);
                });

                /* Phase 2: reveal the view key hash */
                await executeContractWrite({
                    address: CONFIDENTIAL_CONTRACT_ADDRESS,
                    abi: CONFIDENTIAL_CONTRACT_ABI,
                    functionName: "revealViewKey",
                    args: [viewKeyHash, salt],
                });
            }

            /* 2. Update backend database setting */
            const res = await fetch("/api/merchant/confidentiality", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shieldedPayoutsEnabled: shieldedEnabled,
                    viewKeyHash: viewKeyHash
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to save confidentiality settings on server");
            }

            setIsViewKeyRegistered(true);
            /* Store in sessionStorage (not localStorage) — cleared on tab close to
               reduce the XSS exposure window for the plaintext view key. */
            if (typeof window !== "undefined" && address) {
                sessionStorage.setItem(`subscript_viewkey_${address.toLowerCase()}`, viewKey);
            }
            
            /* Refresh settings */
            await refetchBalancesAndTier();
        } catch (err: any) {
            console.error("Save confidentiality error:", err);
            setPremiumError(err.message || "Failed to register View Key");
        } finally {
            setIsSavingConfidentiality(false);
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
    const checkoutCode = useMemo(() => `import { SubScriptCheckoutButton } from "@/components/subscript/SubScriptCheckoutButton";

<SubScriptCheckoutButton
  amountUsdc="${subCap}"
  planName="${subName}"
  description="${subInterval} access"
  externalReference="user_or_order_id"
/>`, [subCap, subInterval, subName]);

    const agentIntegrationPrompt = useMemo(() => {
        return `I want to integrate the SubScript Protocol into this codebase.
Please inspect the workspace. If the initialization package has NOT been run yet, please run it in the terminal first:
npx @subscriptonarc/create

This initialization tool installs the SubScript SDK, prompts for deployment parameters, writes SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET into .env.local, configures .cursorrules, and scaffolds both a server-side checkout intent route and a signed webhook route.

Once initialized, read .env.local and the .cursorrules file to find the plan parameters (merchant wallet address, plan name, plan cap, interval) and target framework.

Here are my project configuration specifications for this integration:
- Wallet Connection Provider: ${walletProvider === "none" ? "None / Implement standard wallet connection (e.g. RainbowKit or Privy)" : walletProvider}
- Backend & Database Provider: ${dbProvider === "none" ? "None / Detect database from project structure or recommend Prisma" : dbProvider}
- Session Persistence Mechanism: ${sessionProvider === "none" ? "None / Detect session pattern or recommend HTTP secure cookies or JWT" : sessionProvider}

Please complete the following implementation tasks:
1. Checkout Intent Creation: Locate the generated server route (for example, src/app/api/subscript/checkout/route.ts). From the pricing page, call that route with amountUsdc, title, description, externalReference, and an idempotencyKey. Store the returned intentId beside the logged-in user/order/subscription before redirecting the user to checkoutUrl.
2. Webhook Fulfillment: Locate the generated webhook route (for example, src/app/api/webhooks/subscript/route.ts or an Express router). Keep raw-body x-subscript-signature verification enabled. When event.type === "payment.succeeded" (its alias "payment.success" is also accepted), use data.intent_id or data.checkout_session_id to find the local record, enforce idempotency with event.id, and unlock the matching plan exactly once using ${dbProvider === "none" ? "the detected database" : dbProvider}.
3. User Session: Set up session recreation/persistence using ${sessionProvider === "none" ? "HTTP-only secure cookies or JWT" : sessionProvider} so the frontend can determine whether the logged-in user has an active paid subscription. Do not ask my app to know the payer wallet; SubScript maps wallet payment activity to the Checkout Intent.
4. Payment Rail Boundary: Treat hosted checkout as Arc-native USDC only. Do not add Base, Solana, or CCTP checkout claims unless the SubScript docs in this repo explicitly say hosted CCTP memo settlement is live.
5. Clean Code Practices: Keep SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET server-side only. Do not add emojis in comments or logs.`;
    }, [walletProvider, dbProvider, sessionProvider]);

    const cursorMcpConfig = useMemo(() => JSON.stringify({
        mcpServers: {
            subscript: {
                command: "npx",
                args: ["-y", "@subscriptonarc/mcp"],
                env: {
                    SUBSCRIPT_MERCHANT_ADDRESS: merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS",
                    SUBSCRIPT_CHAIN_ID: String(activeArcChain.id),
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


    const activeAllowances = merchantAnalytics?.activeSubscriptions ?? ledgers.filter(l => l.active).length;
    const totalSubs = merchantAnalytics?.totalSubscriptions ?? ledgerPagination.total;
    const revokedCount = Math.max(0, totalSubs - activeAllowances);
    const failureRate = totalSubs > 0 ? ((revokedCount / totalSubs) * 100).toFixed(1) : "0.0";
    /* Only subscriptions that will actually renew belong in a forward projection: an
       on-chain-active sub that is mid-failed-renewal, past due, or ending at period end
       will not collect next cycle, so counting it overstates expected volume. Mirrors
       the isPaying definition in AnalyticsDashboard. */
    const projected30DaySettlement = merchantAnalytics?.mrrUsdc ?? ledgers.reduce((acc, sub) => {
        const willRenew = sub.active
            && sub.billingStatus === "ACTIVE"
            && Number(sub.downgradeFailures || 0) === 0
            && !sub.cancelAtPeriodEnd;
        if (!willRenew) return acc;
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
                    <h2 className="text-xl font-extrabold text-white uppercase tracking-wider">Privacy Premium Feature Locked</h2>
                    <p className="text-xs text-white/60 leading-relaxed font-sans">
                        Access to <span className="font-semibold text-white">{tabLabel}</span> requires an active SubScript Privacy Premium subscription. Upgrade to unlock keys, private checkout generation, and webhook event streaming.
                    </p>
                </div>
                <button
                    onClick={() => setActiveTab("premium")}
                    className="px-8 py-3 bg-[#d4a853] hover:bg-[#d4a853]/80 text-black rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(212,168,83,0.2)]"
                >
                    <Crown className="w-4 h-4" />
                    Upgrade to Privacy Premium
                </button>
            </div>
        );
    };

    const renderPaymentLinksTab = () => {
        if (isConnected && address && !sessionWallet && !embeddedWallet) {
            return (
                <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
                    <Shield className="w-10 h-10 mx-auto text-[#00d2b4] animate-pulse" />
                    <h2 className="text-lg font-bold text-white uppercase tracking-wider">Verify Wallet Ownership</h2>
                    <p className="text-xs text-white/50 leading-relaxed max-w-xs mx-auto">
                        To protect your payment configurations and links, please sign a secure message using your connected wallet.
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
                {/* Create Payment Link Form */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Link2 className={`w-4 h-4 ${primaryColorText}`} />
                            Create Hosted Payment Link
                        </h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            Generate direct checkout links for individual purchases. Customers will pay USDC on the Arc Network.
                        </p>
                    </div>

                    <form onSubmit={handleCreatePaymentLink} className="space-y-4 font-sans text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Product Title *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Pro Membership Key"
                                    value={linkTitle}
                                    onChange={(e) => setLinkTitle(e.target.value)}
                                    required
                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">USDC Amount *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="e.g. 15.00"
                                    value={linkAmountUsdc}
                                    onChange={(e) => setLinkAmountUsdc(e.target.value)}
                                    required
                                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Description</label>
                            <textarea
                                placeholder="Describe what the customer gets with this payment link..."
                                value={linkDescription}
                                onChange={(e) => setLinkDescription(e.target.value)}
                                rows={3}
                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => setShowLinkAdvanced(!showLinkAdvanced)}
                                className="text-[10px] text-white/40 hover:text-white flex items-center gap-1.5 uppercase font-bold tracking-wider transition-colors"
                            >
                                <Sliders className="w-3.5 h-3.5" />
                                {showLinkAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
                            </button>
                        </div>

                        {showLinkAdvanced && (
                            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/5">
                                <div className="col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setLinkDurationMinutes(1440);
                                            setLinkMaxUses("1");
                                        }}
                                        className="px-3 py-2 rounded-xl border border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4] text-[10px] font-bold uppercase tracking-wider hover:bg-[#00d2b4]/20 transition-colors"
                                    >
                                        One-Time 24H
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setLinkDurationMinutes(7 * 24 * 60);
                                            setLinkMaxUses("");
                                        }}
                                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white/70 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 hover:text-white transition-colors"
                                    >
                                        Reusable 7D
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setLinkDurationMinutes(0);
                                            setLinkMaxUses("");
                                        }}
                                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white/70 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 hover:text-white transition-colors"
                                    >
                                        No Expiry
                                    </button>
                                </div>
                                <div className="space-y-1 col-span-2">
                                    <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Expiration Window</label>
                                    <DurationPicker
                                        value={linkDurationMinutes}
                                        onChange={(mins) => setLinkDurationMinutes(mins)}
                                    />
                                    <p className="text-[10px] text-white/35">Set duration to 00:00 for a link that does not expire automatically.</p>
                                </div>

                                <div className="space-y-1 col-span-2">
                                    <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">External Reference (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. internal-sku-102"
                                        value={linkExternalReference}
                                        onChange={(e) => setLinkExternalReference(e.target.value)}
                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                    />
                                </div>

                                <div className="col-span-2 space-y-3 rounded-2xl border border-white/5 bg-white/[0.015] p-4">
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-white/40">
                                        Invoice details <span className="normal-case text-white/25">(optional, turns this link into an invoice; shown on the checkout page)</span>
                                    </p>
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="space-y-1">
                                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Invoice Number</label>
                                            <input
                                                type="text"
                                                placeholder="INV-2026-001"
                                                value={linkInvoiceNumber}
                                                onChange={(e) => setLinkInvoiceNumber(e.target.value.slice(0, 64))}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Due Date</label>
                                            <input
                                                type="date"
                                                value={linkDueDate}
                                                onChange={(e) => setLinkDueDate(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors [color-scheme:dark]"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Payer Email</label>
                                            <input
                                                type="email"
                                                placeholder="billing@client.com"
                                                value={linkPayerEmail}
                                                onChange={(e) => setLinkPayerEmail(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1 col-span-2">
                                    <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Maximum Uses</label>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder="Unlimited"
                                        value={linkMaxUses}
                                        onChange={(e) => setLinkMaxUses(e.target.value)}
                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                    />
                                    <p className="text-[10px] text-white/35">Use 1 for one-time checkout links. Leave blank for unlimited reusable links.</p>
                                </div>
                            </div>
                        )}

                        {linkError && (
                            <p className="text-red-400 text-[10px] font-mono font-semibold">{linkError}</p>
                        )}
                        {linkSuccess && (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 space-y-4 font-sans text-left">
                                <p className="text-emerald-400 text-xs font-bold uppercase tracking-wider">
                                    Payment link created successfully!
                                </p>
                                {createdLinkInfo && (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-black/40 border border-white/5 rounded-xl p-3">
                                        <span className="text-[11px] font-mono text-white/70 truncate max-w-[190px] xs:max-w-[240px] sm:max-w-none flex-1">
                                            {createdLinkInfo.checkoutUrl}
                                        </span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveQrCodeLink(createdLinkInfo.checkoutUrl);
                                                    setActiveQrCodeTitle(createdLinkInfo.title);
                                                }}
                                                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white transition-all flex items-center justify-center"
                                                title="Show QR Code"
                                            >
                                                <QrCode className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleCopyLink(createdLinkInfo.id, createdLinkInfo.checkoutUrl)}
                                                className="px-3 py-1.5 rounded-lg bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 border border-[#00d2b4]/20 text-[#00d2b4] text-[10px] font-bold uppercase tracking-wider transition-all"
                                            >
                                                {linkCopyFeedback[createdLinkInfo.id] ? "Copied!" : "Copy Link"}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end pt-2">
                            <button
                                type="submit"
                                disabled={isCreatingLink || !linkTitle || !linkAmountUsdc}
                                className="px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 disabled:opacity-50 text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 font-sans"
                            >
                                <Link2 className="w-3.5 h-3.5" />
                                {isCreatingLink ? "Creating..." : "Create Link"}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Existing Payment Links List */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Hosted Payment Links</h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            Manage your created hosted payment links, monitor their status, and copy links for customers.
                        </p>
                    </div>

                    <div className="relative">
                        {isLinksLoading && paymentLinks.length > 0 && (
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center rounded-2xl z-20">
                                <Loader2 className="w-6 h-6 animate-spin text-[#00d2b4]" />
                            </div>
                        )}
                        {isLinksLoading && paymentLinks.length === 0 ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-[#00d2b4]" />
                            </div>
                        ) : paymentLinks.length === 0 ? (
                            <div className="text-center py-12 border border-white/5 rounded-2xl bg-white/[0.01]">
                                <p className="text-white/40 text-xs font-sans">No payment links created yet.</p>
                            </div>
                        ) : (
                            <>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse font-sans text-xs">
                                    <thead>
                                        <tr className="border-b border-white/5 text-[9px] uppercase tracking-wider text-white/40 text-left font-sans">
                                            <th className="pb-3 pr-4 font-bold">Title</th>
                                            <th className="pb-3 px-4 font-bold">Amount</th>
                                            <th className="pb-3 px-4 font-bold hidden md:table-cell">Reference</th>
                                            <th className="pb-3 px-4 font-bold hidden sm:table-cell">Expiration</th>
                                            <th className="pb-3 px-4 font-bold">Status</th>
                                            <th className="pb-3 pl-4 font-bold text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 font-sans">
                                    {(() => {
                                        const linksPageSize = 5;
                                        const paginatedLinks = paymentLinks.slice(linksPage * linksPageSize, (linksPage + 1) * linksPageSize);
                                        return paginatedLinks.map((link) => {
                                            const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
                                            const isExhausted = link.max_uses != null && Number(link.use_count || 0) >= Number(link.max_uses);
                                            const status = !link.active 
                                                ? "Inactive" 
                                                : isExhausted
                                                    ? "Exhausted"
                                                : isExpired 
                                                    ? "Expired" 
                                                    : "Active";

                                            return (
                                                <Fragment key={link.id}>
                                                    <tr className="hover:bg-white/[0.01] transition-colors">
                                                        <td className="py-4 pr-4">
                                                            <div className="font-bold text-white">{link.title}</div>
                                                            {link.description && (
                                                                <div className="text-[10px] text-white/40 line-clamp-1">{link.description}</div>
                                                            )}
                                                            {link.max_uses != null && (
                                                                <div className="text-[9px] text-white/30 font-mono mt-1">
                                                                    Uses: {link.use_count || 0}/{link.max_uses}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="py-4 px-4 font-mono font-semibold text-[#00d2b4]">
                                                            ${(Number(link.amount_usdc) / 1000000).toFixed(2)} USDC
                                                        </td>
                                                        <td className="py-4 px-4 text-white/60 font-mono hidden md:table-cell">
                                                            {link.external_reference || "-"}
                                                        </td>
                                                        <td className="py-4 px-4 text-white/50 hidden sm:table-cell">
                                                            {link.expires_at ? new Date(link.expires_at).toLocaleString() : "Never"}
                                                        </td>
                                                        <td className="py-4 px-4">
                                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                                                                status === "Active"
                                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                                    : status === "Expired"
                                                                        ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                                                        : "bg-white/5 border-white/10 text-white/40"
                                                            }`}>
                                                                {status}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 pl-4 text-right">
                                                            <div className="flex gap-2 justify-end items-center font-sans">
                                                                <button
                                                                    onClick={() => handleCopyLink(link.id, link.checkoutUrl)}
                                                                    className="p-2 md:px-4 md:py-2 rounded-xl bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 border border-[#00d2b4]/20 text-[#00d2b4] text-[10px] font-bold uppercase transition-all shadow-sm shadow-[#00d2b4]/5 flex items-center gap-1.5"
                                                                    title={linkCopyFeedback[link.id] ? "Copied!" : "Copy Link"}
                                                                >
                                                                    {linkCopyFeedback[link.id] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                                    <span className="hidden md:inline">{linkCopyFeedback[link.id] ? "Copied!" : "Copy Link"}</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        const url = getPublicCheckoutUrl(link.id, link.checkoutUrl);
                                                                        setActiveQrCodeLink(url);
                                                                        setActiveQrCodeTitle(link.title);
                                                                    }}
                                                                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white transition-all flex items-center justify-center"
                                                                    title="Show QR Code"
                                                                >
                                                                    <QrCode className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setExpandedLinkId(expandedLinkId === link.id ? null : link.id);
                                                                    }}
                                                                    className={`p-2 rounded-xl border transition-all flex items-center justify-center ${
                                                                        expandedLinkId === link.id
                                                                            ? "bg-[#00d2b4]/20 border-[#00d2b4]/30 text-[#00d2b4]"
                                                                            : "bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white"
                                                                    }`}
                                                                    title="Show Payments Stats"
                                                                >
                                                                    <BarChart3 className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleToggleLinkActive(link.id, link.active)}
                                                                    className={`p-2 md:px-4 md:py-2 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center gap-1.5 ${
                                                                        link.active
                                                                            ? "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 text-amber-400"
                                                                            : "bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 border border-[#00d2b4]/20 text-[#00d2b4]"
                                                                    }`}
                                                                    title={link.active ? "Deactivate" : "Activate"}
                                                                >
                                                                    {link.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                                                    <span className="hidden md:inline">{link.active ? "Deactivate" : "Activate"}</span>
                                                                </button>
                                                                <div className="w-[1px] h-4 bg-white/10 mx-1" />
                                                                <button
                                                                    onClick={() => handleDeleteLink(link.id)}
                                                                    className="p-2 md:px-4 md:py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[10px] font-bold uppercase transition-all flex items-center gap-1.5"
                                                                    title="Delete Link"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                    <span className="hidden md:inline">Delete</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {expandedLinkId === link.id && (
                                                        <tr className="bg-white/[0.01]">
                                                            <td colSpan={6} className="py-4 px-6 border-l-2 border-[#00d2b4] bg-white/[0.005] rounded-r-2xl">
                                                                <div className="space-y-3 font-sans">
                                                                    <div className="flex justify-between items-center">
                                                                        <span className="text-white font-bold text-xs uppercase tracking-wider">Link Stats & Payments</span>
                                                                        <span className="text-[10px] text-white/40">Total Payments: {link.payments?.length || 0}</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start border border-white/5 rounded-xl bg-black/20 p-3">
                                                                        <div className="space-y-1">
                                                                            <div className="text-[10px] text-white/45 uppercase tracking-wider font-bold">Link Rules</div>
                                                                            <div className="text-[11px] text-white/65">
                                                                                {link.max_uses != null ? `Uses ${link.use_count || 0}/${link.max_uses}` : "Unlimited uses"}
                                                                                {" · "}
                                                                                {link.expires_at ? `Expires ${new Date(link.expires_at).toLocaleString()}` : "No automatic expiry"}
                                                                            </div>
                                                                        </div>
                                                                        <div className="grid grid-cols-3 gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUpdateLinkRules(link.id, 1440, "1")}
                                                                                className="px-3 py-2 rounded-lg border border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4] text-[9px] font-bold uppercase tracking-wider hover:bg-[#00d2b4]/20 transition-colors"
                                                                            >
                                                                                One-Time
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUpdateLinkRules(link.id, 7 * 24 * 60, null)}
                                                                                className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/70 text-[9px] font-bold uppercase tracking-wider hover:bg-white/10 hover:text-white transition-colors"
                                                                            >
                                                                                7D Reuse
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleUpdateLinkRules(link.id, 0, null)}
                                                                                className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white/70 text-[9px] font-bold uppercase tracking-wider hover:bg-white/10 hover:text-white transition-colors"
                                                                            >
                                                                                No Expiry
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    {!link.payments || link.payments.length === 0 ? (
                                                                        <div className="py-4 text-center text-[11px] text-white/30 border border-dashed border-white/5 rounded-xl">
                                                                            No payments recorded for this checkout link yet.
                                                                        </div>
                                                                    ) : (
                                                                        <div className="overflow-x-auto border border-white/5 rounded-xl bg-black/20">
                                                                            <table className="w-full text-left border-collapse text-[10px]">
                                                                                <thead>
                                                                                    <tr className="border-b border-white/5 bg-white/[0.02] text-[8px] uppercase tracking-wider text-white/30 font-bold">
                                                                                        <th className="py-2.5 px-3">Payer Address</th>
                                                                                        <th className="py-2.5 px-3">Tx Hash</th>
                                                                                        <th className="py-2.5 px-3">Date</th>
                                                                                        <th className="py-2.5 px-3 text-right">Amount</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="divide-y divide-white/5 font-mono text-white/60">
                                                                                    {link.payments.map((p: any) => (
                                                                                        <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                                                                                            <td className="py-2 px-3 text-[#00d2b4]" title={p.payer_address || ""}>
                                                                                                {p.payer_alias ? (
                                                                                                    <span className="font-sans font-semibold text-white/80 bg-[#00d2b4]/10 border border-[#00d2b4]/25 px-2 py-0.5 rounded-md text-[9px] uppercase tracking-wider">
                                                                                                        {p.payer_alias}
                                                                                                    </span>
                                                                                                ) : (
                                                                                                    p.payer_address ? `${p.payer_address.slice(0, 10)}...${p.payer_address.slice(-8)}` : "-"
                                                                                                )}
                                                                                            </td>
                                                                                            <td className="py-2 px-3 text-white/40 hover:text-[#00d2b4] transition-colors">
                                                                                                {p.tx_hash ? (
                                                                                                    <a 
                                                                                                        href={`${activeArcChain.blockExplorers.default.url}/tx/${p.tx_hash}`}
                                                                                                        target="_blank" 
                                                                                                        rel="noopener noreferrer"
                                                                                                    >
                                                                                                        {p.tx_hash.slice(0, 10)}...{p.tx_hash.slice(-8)}
                                                                                                    </a>
                                                                                                ) : "-"}
                                                                                            </td>
                                                                                            <td className="py-2 px-3 text-white/40">
                                                                                                {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                                                                                            </td>
                                                                                            <td className="py-2 px-3 text-right text-white font-sans font-semibold">
                                                                                                ${(Number(p.amount_usdc) / 1000000).toFixed(2)} USDC
                                                                                            </td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </Fragment>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        {(() => {
                            const linksPageSize = 5;
                            const totalPages = Math.ceil(paymentLinks.length / linksPageSize);
                            if (totalPages <= 1) return null;
                            return (
                                <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 font-sans">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
                                        Page {linksPage + 1} of {totalPages}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={linksPage === 0}
                                            onClick={() => setLinksPage((p) => Math.max(0, p - 1))}
                                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                        >
                                            Prev
                                        </button>
                                        <button
                                            type="button"
                                            disabled={linksPage >= totalPages - 1}
                                            onClick={() => setLinksPage((p) => Math.min(totalPages - 1, p + 1))}
                                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </>
                    )}
                    </div>
                </div>
            </div>
        );
    };

    const renderPlansTab = () => {
        const activePlans = merchantPlans.filter((plan) => plan.active);
        const inactivePlans = merchantPlans.filter((plan) => !plan.active);
        /* The most recent promotion per plan (active first) drives the row's promo panel. */
        const promotionsByPlan = new Map<string, PlanPromotion>();
        for (const promo of planPromotions) {
            const existing = promotionsByPlan.get(promo.planId);
            if (!existing || (promo.active && !existing.active)) {
                promotionsByPlan.set(promo.planId, promo);
            }
        }

        return (
            <div className="space-y-8">
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Sliders className="w-4 h-4 text-[#00d2b4]" />
                                Create Subscription Plan
                            </h2>
                            <p className="text-[11px] text-white/40 font-sans">
                                Publish named recurring USDC plans. Share each plan's subscribe link with customers, with no website needed.
                                The same plans power your API keys and webhooks later, so you scale without rebuilding.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={fetchMerchantPlans}
                            disabled={isPlansLoading}
                            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/55 transition hover:border-[#00d2b4]/30 hover:text-white disabled:opacity-50"
                        >
                            {isPlansLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
                        </button>
                    </div>

                    <form onSubmit={handleCreatePlan} className="space-y-4 font-sans text-xs">
                        <div className="grid gap-4 md:grid-cols-[1.3fr_0.8fr_0.8fr] md:items-end">
                            <div className="space-y-1">
                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Plan Name</label>
                                <input
                                    type="text"
                                    value={planName}
                                    onChange={(event) => setPlanName(event.target.value)}
                                    placeholder="Pro API Access"
                                    className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white transition-colors focus:border-[#00d2b4] focus:outline-none"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">USDC Amount</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={planAmountUsdc}
                                    onChange={(event) => setPlanAmountUsdc(event.target.value)}
                                    placeholder="29.00"
                                    className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white transition-colors focus:border-[#00d2b4] focus:outline-none"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Period Days</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="366"
                                    value={planPeriodDays}
                                    onChange={(event) => setPlanPeriodDays(event.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white transition-colors focus:border-[#00d2b4] focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">
                                Minimum Commitment (days) <span className="normal-case text-white/25">(optional, disclosed to subscribers before they authorize; max one billing period, capped at 30 days)</span>
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="30"
                                value={planMinCommitmentDays}
                                onChange={(event) => setPlanMinCommitmentDays(event.target.value)}
                                placeholder="0 = no commitment"
                                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white transition-colors focus:border-[#00d2b4] focus:outline-none"
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="flex items-center justify-between">
                                <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">
                                    Description <span className="normal-case text-white/25">(optional, shown to subscribers)</span>
                                </label>
                                <span className={`text-[9px] font-bold ${planDescription.length >= PLAN_DESCRIPTION_MAX ? "text-amber-400" : "text-white/30"}`}>
                                    {planDescription.length}/{PLAN_DESCRIPTION_MAX}
                                </span>
                            </div>
                            <textarea
                                value={planDescription}
                                onChange={(event) => setPlanDescription(event.target.value.slice(0, PLAN_DESCRIPTION_MAX))}
                                rows={3}
                                maxLength={PLAN_DESCRIPTION_MAX}
                                placeholder="What's included (features, usage limits, support level, billing terms…)"
                                className="w-full resize-none rounded-xl border border-white/10 bg-black px-4 py-3 text-white transition-colors focus:border-[#00d2b4] focus:outline-none"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">
                                Details Link <span className="normal-case text-white/25">(optional, &ldquo;view more&rdquo;)</span>
                            </label>
                            <input
                                type="url"
                                inputMode="url"
                                value={planDetailsUrl}
                                onChange={(event) => setPlanDetailsUrl(event.target.value)}
                                placeholder="https://yoursite.com/plans/pro"
                                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white transition-colors focus:border-[#00d2b4] focus:outline-none"
                            />
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={isPlansLoading}
                                className="rounded-xl bg-[#00d2b4] px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-black transition hover:bg-[#00d2b4]/85 disabled:opacity-50"
                            >
                                {isPlansLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                            </button>
                        </div>
                    </form>

                    {planError && <p className="text-[10px] font-bold text-red-400">{planError}</p>}
                    {planSuccess && <p className="text-[10px] font-bold text-emerald-400">{planSuccess}</p>}
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                    <div className="liquid-glass min-w-0 overflow-hidden border border-white/5 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Active Plans</h3>
                            <span className="rounded-full border border-[#00d2b4]/20 bg-[#00d2b4]/10 px-3 py-1 text-[10px] font-bold text-[#00d2b4]">{activePlans.length}</span>
                        </div>
                        {activePlans.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 p-6 sm:p-8 text-center text-xs text-white/40">
                                No active plans yet. Create one above to get a shareable subscribe link.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {activePlans.map((plan) => (
                                    <MerchantPlanRow key={plan.id} plan={plan} busy={isPlansLoading} onToggle={handleTogglePlanActive} onShare={setSharingPlan} promotion={promotionsByPlan.get(plan.id) ?? null} onPromotionsChanged={fetchMerchantPlans} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="liquid-glass min-w-0 overflow-hidden border border-white/5 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Inactive Plans</h3>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold text-white/45">{inactivePlans.length}</span>
                        </div>
                        {inactivePlans.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 p-6 sm:p-8 text-center text-xs text-white/40">
                                Deactivated plans stay here for auditability.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {inactivePlans.map((plan) => (
                                    <MerchantPlanRow key={plan.id} plan={plan} busy={isPlansLoading} onToggle={handleTogglePlanActive} onShare={setSharingPlan} promotion={promotionsByPlan.get(plan.id) ?? null} onPromotionsChanged={fetchMerchantPlans} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderSettingsTab = () => {
        if (!userSettings) {
            return (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
                </div>
            );
        }

        return (
            <div className="space-y-8 max-w-4xl mx-auto">
                {/* Help & Support */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <HelpCircle className="w-4 h-4 text-[#00d2b4]" />
                            Help &amp; Support
                        </h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            Integration help, activation issues, billing questions, or security disclosures. Real
                            humans read every message.
                        </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3 font-sans text-xs">
                        <a
                            href="mailto:support@subscriptonarc.com"
                            className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 transition hover:border-[#00d2b4]/25 hover:bg-[#00d2b4]/5"
                        >
                            <span className="block text-[9px] font-black uppercase tracking-wider text-white/35">General support</span>
                            <span className="mt-1 block break-all font-mono text-[10px] font-bold text-[#00d2b4]">support@subscriptonarc.com</span>
                        </a>
                        <a
                            href="mailto:compliance@subscriptonarc.com"
                            className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 transition hover:border-[#00d2b4]/25 hover:bg-[#00d2b4]/5"
                        >
                            <span className="block text-[9px] font-black uppercase tracking-wider text-white/35">Billing, legal &amp; security</span>
                            <span className="mt-1 block break-all font-mono text-[10px] font-bold text-[#00d2b4]">compliance@subscriptonarc.com</span>
                        </a>
                        <a
                            href="/support"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-[#00d2b4] transition hover:bg-[#00d2b4]/10"
                        >
                            Open the Help Center
                        </a>
                    </div>
                </div>

                {/* Dunning / failed-renewal policy */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <ArrowRightLeft className="w-4 h-4 text-[#00d2b4]" />
                            Failed-Renewal Policy (Dunning)
                        </h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            When a customer&apos;s renewal fails (insufficient balance), the keeper retries roughly
                            once a day. Choose how many attempts to make before the subscription is stopped and the
                            customer is notified. More attempts ≈ more days of grace.
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center font-sans">
                        <input
                            type="number"
                            min="1"
                            max="10"
                            step="1"
                            value={dunningMaxFailures}
                            onChange={(e) => setDunningMaxFailures(e.target.value)}
                            className="w-full sm:w-32 bg-black border border-white/10 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-[#00d2b4] transition-colors"
                        />
                        <button
                            type="button"
                            onClick={handleSaveDunning}
                            disabled={dunningSaving}
                            className="w-full sm:w-auto shrink-0 px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 disabled:opacity-50 text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            {dunningSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save
                        </button>
                        {dunningMessage && (
                            <span className="text-[10px] text-white/50">{dunningMessage}</span>
                        )}
                    </div>
                </div>

                {/* Profile & Identity Section */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <User className="w-4 h-4 text-[#00d2b4]" />
                            Profile & Identity
                        </h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            Manage your merchant identity, custom alias, and branding.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row items-start md:items-center gap-6 pb-6 border-b border-white/5">
                        <div className="relative group shrink-0">
                            <div className="w-20 h-20 rounded-full border-2 border-white/10 overflow-hidden bg-gradient-to-tr from-[#00d2b4]/20 to-purple-500/20 flex items-center justify-center text-[#00d2b4] shadow-lg relative">
                                {userSettings.profilePic ? (
                                    <img src={userSettings.profilePic} alt="Merchant Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <User className="w-8 h-8 text-[#00d2b4]" />
                                )}
                                {uploadingPic && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-[#00d2b4]" />
                                    </div>
                                )}
                            </div>
                            <label className="absolute -bottom-1 -right-1 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black p-1.5 rounded-full cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-all">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                            </label>
                        </div>

                        <div className="flex-1 space-y-1">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Merchant Profile Photo</h3>
                            <p className="text-[10px] text-white/40 leading-relaxed font-sans max-w-sm">
                                Upload a brand logo or profile picture. JPG/PNG, maximum 2MB size limit.
                            </p>
                            {uploadError && <p className="text-[10px] text-red-400 mt-1 font-sans">{uploadError}</p>}
                        </div>
                    </div>

                    {/* Verification tier and plan are independent tracks: KYC is a trust badge,
                        the plan gates product features. Each card always reflects the real DB
                        state, so a Premium-but-unverified merchant sees both facts correctly. */}
                    <div className="space-y-4 pt-4 border-t border-white/5">
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Verification & Plan</h3>
                        <p className="text-[10px] text-white/40 leading-relaxed font-sans max-w-sm">
                            Verification (KYC) adds a public trust badge. Your plan controls which product features are unlocked. They are independent, so you can hold either without the other.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* KYC track */}
                            <div className={`p-4 rounded-2xl border ${userSettings.verified ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'} space-y-2`}>
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black uppercase tracking-wider text-white">KYC Tier</h4>
                                    <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${userSettings.verified ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                        {userSettings.verified ? 'Verified' : 'Unverified'}
                                    </span>
                                </div>
                                <ul className="space-y-1 text-[9px] text-white/50 leading-relaxed font-sans">
                                    {userSettings.verified ? (
                                        <>
                                            <li className="flex items-center gap-1 text-emerald-400">✓ Verified badge on your public profile</li>
                                            <li className="flex items-center gap-1 text-emerald-400">✓ Customers can commit without a risk warning</li>
                                            <li className="flex items-center gap-1 text-emerald-400">✓ Ready for regulated rails as they launch</li>
                                        </>
                                    ) : (
                                        <>
                                            <li className="flex items-center gap-1 text-white/60">• Public profile shows unverified</li>
                                            <li className="flex items-center gap-1 text-white/60">• Customers see a warning before committing funds</li>
                                            <li className="flex items-center gap-1 text-white/60">• Complete business verification below to upgrade</li>
                                        </>
                                    )}
                                </ul>
                            </div>

                            {/* Plan track */}
                            <div className={`p-4 rounded-2xl border ${userSettings.tier === 'PREMIUM' ? 'border-purple-500/30 bg-purple-500/5' : 'border-white/5 bg-white/[0.02]'} space-y-2`}>
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black uppercase tracking-wider text-white">Plan</h4>
                                    <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${userSettings.tier === 'PREMIUM' ? 'bg-purple-500/20 text-purple-300' : 'bg-white/10 text-white/60'}`}>
                                        {userSettings.tier === 'PREMIUM' ? 'Premium' : 'Free'}
                                    </span>
                                </div>
                                <ul className="space-y-1 text-[9px] text-white/50 leading-relaxed font-sans">
                                    <li className="flex items-center gap-1 text-emerald-400">✓ Create unlimited payment links</li>
                                    <li className={`flex items-center gap-1 ${userSettings.tier === 'PREMIUM' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {userSettings.tier === 'PREMIUM' ? '✓' : '✗'} API Keys &amp; Webhook endpoints
                                    </li>
                                    <li className={`flex items-center gap-1 ${userSettings.tier === 'PREMIUM' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {userSettings.tier === 'PREMIUM' ? '✓' : '✗'} Customer commitment vaults
                                    </li>
                                </ul>
                                {userSettings.tier !== 'PREMIUM' && (
                                    <p className="text-[8px] text-white/40 italic pt-1 font-sans">Upgrade plan under the "Premium" tab.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Identity Verification (KYC/KYB) */}
                    <KycVerificationPanel />

                    {/* DNS / Alias Section */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">SubScript DNS Registration</h3>
                        <p className="text-[10px] leading-relaxed text-amber-300/80 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 font-sans">
                            {merchantAliasNextChange
                                ? <>Your DNS name is locked until <strong>{new Date(merchantAliasNextChange).toLocaleDateString()}</strong>. You can change it again then. Business names cannot be unregistered.</>
                                : <>Heads up: a DNS name can only be changed <strong>once every 365 days</strong>. Choose carefully, because after a change you won't be able to switch again for a year.</>}
                        </p>
                        {userSettings.alias ? (
                            <div className="p-4 rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 flex items-center justify-between">
                                <div>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-[#00d2b4]/70">Registered Alias</p>
                                    <h4 className="font-mono text-lg font-bold text-[#00d2b4] mt-1">{userSettings.alias}</h4>
                                </div>
                                {/* Merchants can never unregister: the registered business name is the
                                    identity customers pay to, and the API refuses the DELETE too. */}
                                <span className="px-3 py-1.5 border border-white/10 text-white/40 text-[10px] font-bold uppercase tracking-wider rounded-xl select-none">
                                    Permanent
                                </span>
                            </div>
                        ) : dnsConfirmPending ? (
                            <div className="p-5 rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/[0.04] space-y-4">
                                <div>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-[#ccff00]/70">Confirm DNS name</p>
                                    <h4 className="font-mono text-lg font-bold text-[#ccff00] mt-1">{dnsConfirmPending}</h4>
                                </div>
                                <p className="text-[10px] leading-relaxed text-amber-300/80">
                                    This is locked for <strong>365 days</strong> once registered. Make sure it's right.
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setDnsConfirmPending(null)}
                                        disabled={dnsLoading}
                                        className="flex-1 py-2.5 border border-white/10 hover:bg-white/5 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={confirmDnsRegistration}
                                        disabled={dnsLoading}
                                        className="flex-1 py-2.5 bg-[#ccff00] hover:bg-[#ccff00]/85 text-black text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
                                    >
                                        {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm & Register"}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleRegisterDns} className="space-y-3 font-sans text-xs">
                                <div className="space-y-1">
                                    <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Domain Alias</label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <input
                                                type="text"
                                                value={dnsDomain}
                                                onChange={(e) => setDnsDomain(e.target.value)}
                                                placeholder="my-company"
                                                className="w-full bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#00d2b4]/40 font-mono"
                                                required
                                            />
                                            <div className="absolute right-3 top-2.5 flex gap-1">
                                                <select
                                                    value={dnsSuffix}
                                                    onChange={(e) => setDnsSuffix(e.target.value)}
                                                    className="bg-transparent text-white/50 text-xs font-bold border-none focus:outline-none cursor-pointer"
                                                >
                                                    <option value=".hq" className="bg-[#111111] text-white">.hq</option>
                                                    <option value=".biz" className="bg-[#111111] text-white">.biz</option>
                                                </select>
                                            </div>
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={dnsLoading}
                                            className="px-6 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold uppercase tracking-wider rounded-xl transition-all"
                                        >
                                            {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register"}
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-white/35">
                                        Enterprise custom namespaces allow customers to identify your business link securely.
                                    </p>
                                </div>
                            </form>
                        )}
                        {dnsError && <p className="text-[10px] text-red-400">{dnsError}</p>}
                        {dnsSuccess && <p className="text-[10px] text-emerald-400">{dnsSuccess}</p>}
                    </div>
                </div>

                {/* Wallet Recovery & Backup */}
                {userSettings.walletBackup?.available && (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-[#00d2b4]" />
                                    Wallet Recovery & Backup
                                </h2>
                                <p className="text-[11px] text-white/40 font-sans leading-relaxed max-w-xl">
                                    Export the private key for your email-created merchant wallet after email verification.
                                    Importing this key into a wallet app lets you use <strong className="text-white/65">Sign in with Wallet</strong> and
                                    opens this same merchant account.
                                </p>
                            </div>
                            <span className="self-start rounded-full border border-[#00d2b4]/25 bg-[#00d2b4]/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#00d2b4]">
                                Exportable
                            </span>
                        </div>

                        {merchantExportedPrivateKey && (
                            <div className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
                                <p className="text-[10px] font-bold text-amber-200">
                                    Keep this secret offline. SubScript will never ask you to paste it into the app.
                                </p>
                                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2.5">
                                    <code className="min-w-0 flex-1 truncate text-[10px] text-white/75">
                                        {merchantPrivateKeyVisible ? merchantExportedPrivateKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                                    </code>
                                    <button
                                        type="button"
                                        onClick={() => setMerchantPrivateKeyVisible((visible) => !visible)}
                                        className="p-1.5 text-white/45 hover:text-white"
                                        aria-label={merchantPrivateKeyVisible ? "Hide private key" : "Show private key"}
                                    >
                                        {merchantPrivateKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(merchantExportedPrivateKey, "Merchant Wallet Private Key")}
                                        className="p-1.5 text-white/45 hover:text-white"
                                        aria-label="Copy private key"
                                    >
                                        {copiedText === "Merchant Wallet Private Key"
                                            ? <Check className="h-4 w-4 text-[#00d2b4]" />
                                            : <Copy className="h-4 w-4" />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={downloadMerchantWalletBackup}
                                        className="p-1.5 text-white/45 hover:text-white"
                                        aria-label="Download private key backup"
                                    >
                                        <ArrowDownToLine className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {merchantWalletBackupError && (
                            <p className="text-[11px] text-red-300">{merchantWalletBackupError}</p>
                        )}

                        {merchantExportOtpStage ? (
                            <div className="space-y-3">
                                <p className="text-[10px] text-white/45">
                                    Enter the 6-digit code sent to {userSettings.walletBackup.email}.
                                </p>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={merchantExportOtpCode}
                                    onChange={(event) => setMerchantExportOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-white placeholder:text-white/20 focus:border-[#00d2b4]/50 focus:outline-none"
                                />
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={handleMerchantWalletExport}
                                        disabled={merchantWalletBackupLoading || merchantExportOtpCode.length !== 6}
                                        className="w-full rounded-2xl border border-[#00d2b4]/30 bg-[#00d2b4]/10 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-[#00d2b4]/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {merchantWalletBackupLoading ? "Unlocking…" : "Confirm & Reveal"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMerchantExportOtpStage(false);
                                            setMerchantExportOtpCode("");
                                            setMerchantWalletBackupError(null);
                                        }}
                                        disabled={merchantWalletBackupLoading}
                                        className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/65 transition hover:bg-white/10 disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={requestMerchantExportOtp}
                                disabled={merchantExportOtpSending}
                                className="w-full rounded-2xl border border-[#00d2b4]/30 bg-[#00d2b4]/10 py-3.5 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-[#00d2b4]/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {merchantExportOtpSending ? "Sending verification code…" : "Verify email & export wallet"}
                            </button>
                        )}
                    </div>
                )}

                {/* Payout & Settlement Wallet Section */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-[#00d2b4]" />
                            Payout Destination
                        </h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            Save the default wallet offered during settlement withdrawals. Changing this setting does not move funds.
                        </p>
                    </div>

                    <div className="space-y-4 font-sans text-xs">
                        <div className="space-y-1">
                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Payout Destination Address</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={payoutDestinationDraft}
                                    placeholder="0x..."
                                    onChange={(e) => { setPayoutDestinationDraft(e.target.value); setPayoutDestinationError(null); }}
                                    className="flex-1 bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#00d2b4]/40 font-mono"
                                />
                                <button type="button" onClick={() => handleUpdatePayoutDestination(payoutDestinationDraft)} disabled={savingSettingsField === "payoutDestination" || payoutDestinationDraft.trim() === (userSettings.payoutDestination || "")} className="rounded-xl bg-[#00d2b4] px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-black disabled:cursor-not-allowed disabled:opacity-40">{savingSettingsField === "payoutDestination" ? "Saving…" : "Review & save"}</button>
                            </div>
                            <p className="text-[9px] text-white/45">
                                Enter a valid EVM address. You will still review the destination before each withdrawal.
                            </p>
                            {payoutDestinationError && <p className="text-[10px] text-red-300" role="alert">{payoutDestinationError}</p>}
                        </div>
                    </div>
                </div>

                {/* Preferences Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Notification Preferences */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                        <div>
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Sliders className="w-4 h-4 text-[#00d2b4]" />
                                Notifications
                            </h2>
                            <p className="text-[11px] text-white/40 font-sans">
                                Set up real-time alert preferences.
                            </p>
                        </div>

                        <div className="space-y-4 font-sans text-xs">
                            <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                                <div className="space-y-0.5">
                                    <p className="text-white font-bold flex items-center gap-1.5">Push Notifications <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                                    <p className="text-[9px] text-white/40">Merchant inbox alerts are not live yet</p>
                                </div>
                                <button
                                    onClick={() => {}}
                                    disabled={true}
                                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                                >
                                    <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                                </button>
                            </div>

                            <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                                <div className="space-y-0.5">
                                    <p className="text-white font-bold flex items-center gap-1.5">Email Alerts <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                                    <p className="text-[9px] text-white/40">Receive settlement summaries via email</p>
                                </div>
                                <button
                                    onClick={() => {}}
                                    disabled={true}
                                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                                >
                                    <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                                </button>
                            </div>

                            <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                                <div className="space-y-0.5">
                                    <p className="text-white font-bold flex items-center gap-1.5">Payout Settlements <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                                    <p className="text-[9px] text-white/40">Settlement alerts will arrive in the merchant inbox when live</p>
                                </div>
                                <button
                                    onClick={() => {}}
                                    disabled={true}
                                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                                >
                                    <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                                </button>
                            </div>

                            <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                                <div className="space-y-0.5">
                                    <p className="text-white font-bold flex items-center gap-1.5">Client Disputes <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                                    <p className="text-[9px] text-white/40">Receive immediate alerts on cancel or payment failure events</p>
                                </div>
                                <button
                                    onClick={() => {}}
                                    disabled={true}
                                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                                >
                                    <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Exit Survey — merchant-defined cancellation question (SUB-501) */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                        <div>
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-[#00d2b4]" />
                                Exit Survey
                            </h2>
                            <p className="text-[11px] text-white/40 font-sans">
                                Ask cancelling customers your own question. Leave blank to use the default prompt.
                            </p>
                        </div>

                        <div className="space-y-3 font-sans">
                            <textarea
                                value={churnQuestionDraft}
                                onChange={(e) => setChurnQuestionDraft(e.target.value)}
                                maxLength={280}
                                rows={3}
                                placeholder="e.g. What could we have done to keep you subscribed?"
                                className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs text-white placeholder:text-white/30 focus:border-[#00d2b4]/50 focus:outline-none"
                            />
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] text-white/30 uppercase tracking-wider">{churnQuestionDraft.length}/280</span>
                                <button
                                    type="button"
                                    onClick={() => handleUpdateChurnSurveyQuestion(churnQuestionDraft)}
                                    disabled={savingSettingsField === "churnSurveyQuestion" || (churnQuestionDraft.trim() === (userSettings?.churnSurveyQuestion || ""))}
                                    className="px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-full bg-[#00d2b4]/10 border border-[#00d2b4]/30 text-white hover:bg-[#00d2b4]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    {savingSettingsField === "churnSurveyQuestion" ? "Saving..." : "Save question"}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Security Toggles */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                        <div>
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Lock className="w-4 h-4 text-[#00d2b4]" />
                                Security Settings
                            </h2>
                            <p className="text-[11px] text-white/40 font-sans">
                                Configure merchant authorization preferences.
                            </p>
                        </div>

                        <div className="space-y-4 font-sans text-xs">
                            <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                                <div className="space-y-0.5">
                                    <p className="text-white font-bold flex items-center gap-1.5">Multi-Sig Payout Verification <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                                    <p className="text-[9px] text-white/40">Require secondary signature verification for payouts</p>
                                </div>
                                <button
                                    onClick={() => {}}
                                    disabled={true}
                                    className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                                >
                                    <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Transaction History Receipt Logs */}
                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-[#00d2b4]" />
                            Transaction History Logs
                        </h2>
                        <p className="text-[11px] text-white/40 font-sans">
                            Review recent transactions and payments.
                        </p>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-sans text-xs">
                            <thead>
                                <tr className="border-b border-white/5 text-white/40 uppercase text-[9px] tracking-wider">
                                    <th className="pb-3">Receipt ID</th>
                                    <th className="pb-3">Date &amp; Time</th>
                                    <th className="pb-3">Type</th>
                                    <th className="pb-3">Amount</th>
                                    <th className="pb-3">Status</th>
                                    <th className="pb-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {settingsTransactions.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center py-6 text-white/30">
                                            No transaction logs found.
                                        </td>
                                    </tr>
                                ) : (
                                    settingsTransactions.map((tx) => {
                                        const isOutgoing = tx.payerAddress.toLowerCase() === address.toLowerCase();
                                        return (
                                            <tr key={tx.receiptId} className="border-b border-white/5 hover:bg-white/[0.01] transition-all">
                                                <td className="py-4 font-mono font-semibold text-white/80">{tx.receiptId.slice(0, 8)}...</td>
                                                <td className="py-4 text-white/50">{new Date(tx.createdAt).toLocaleString()}</td>
                                                <td className="py-4">
                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${isOutgoing ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                                                        {isOutgoing ? "Debit" : "Credit"}
                                                    </span>
                                                </td>
                                                <td className="py-4 font-mono font-bold text-white">
                                                    {(Number(tx.amountUsdc) / 1_000_000).toFixed(2)} USDC
                                                </td>
                                                <td className="py-4">
                                                    <FinancialStatusBadge status={tx.status} />
                                                </td>
                                                <td className="py-4 text-right">
                                                    <div className="inline-flex items-center gap-3">
                                                        <a
                                                            href={`/receipt/${tx.receiptId}?invite=1`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-white/50 hover:text-[#00d2b4] hover:underline inline-flex items-center gap-1"
                                                            title="Grant another address permission to view this private receipt"
                                                        >
                                                            Grant access
                                                        </a>
                                                        <a
                                                            href={`${activeArcChain.blockExplorers.default.url}/tx/${tx.txHash}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-[#00d2b4] hover:underline inline-flex items-center gap-1"
                                                        >
                                                            Tx <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    const renderView = () => {
        if (isConnected && address && !sessionWallet && !embeddedWallet) {
            return (
                <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans mt-12">
                    <Shield className="w-10 h-10 mx-auto text-[#00d2b4] animate-pulse" />
                    <h2 className="text-lg font-bold text-white uppercase tracking-wider">Verify Wallet Ownership</h2>
                    <p className="text-xs text-white/50 leading-relaxed max-w-xs mx-auto">
                        To protect your account configurations, stats, and settings, please sign a secure message using your connected wallet.
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

        if (!isPremium && ["apikeys", "checkout", "webhooks"].includes(activeTab)) {
            const labelMap = {
                apikeys: "API Keys Management",
                checkout: "Checkout Setup & Generator",
                webhooks: "Developer Webhooks"
            };
            return renderPremiumLock(labelMap[activeTab as "apikeys" | "checkout" | "webhooks"]);
        }

        const renderSubTabs = () => {
            const tabsConfig = [
                { id: "subscriptions", label: "Subscriptions", icon: Sliders },
                { id: "one-time", label: "One-Time Payments", icon: Link2 },
                { id: "commit", label: "Vault Commits", icon: ShieldCheck }
            ];

            return (
                <div className="relative grid grid-cols-3 sm:flex sm:items-center gap-1 border-b border-white/5 pb-0 mb-8 w-full">
                    {tabsConfig.map((tab) => {
                        const isActive = subTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setSubTab(tab.id as any)}
                                className="group relative flex min-w-0 items-center justify-center sm:justify-start pb-3 pt-2 px-2 sm:px-4 cursor-pointer select-none transition-all duration-300 ease-out focus:outline-none"
                            >
                                <div className="flex items-center">
                                    <Icon 
                                        className={`w-4 h-4 transition-colors duration-300 ${
                                            isActive ? "text-[#00d2b4]" : "text-white/40 group-hover:text-white/80"
                                        }`} 
                                    />
                                    <div 
                                        className={`max-w-[110px] opacity-100 ml-1.5 transition-all duration-300 ease-out overflow-hidden flex items-center ${
                                            isActive 
                                                ? "sm:max-w-[150px] sm:opacity-100 sm:ml-2"
                                                : "sm:max-w-0 sm:opacity-0 sm:ml-0"
                                        }`}
                                    >
                                        <span className={`text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap ${
                                            isActive ? "text-white" : "text-white/40"
                                        }`}>
                                            <span className="hidden sm:inline">{tab.label}</span>
                                            <span className="inline sm:hidden">
                                                {tab.id === "subscriptions" ? "Plans" : tab.id === "one-time" ? "One-Time" : "Commits"}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                {/* Underline Indicator */}
                                {isActive && (
                                    <motion.div 
                                        layoutId="merchantActiveSubTabUnderline"
                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00d2b4]" 
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            );
        };

        const renderCommitTab = () => {
            if (!isPremium) {
                return renderPremiumLock("Vault Commits Setup");
            }

            return (
                <div className="space-y-8 font-sans">
                    {/* Vault Config Form and Claim Settlement */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-[#00d2b4]" />
                                    Vault Commits Control
                                </h2>
                                <p className="text-[11px] text-white/40">
                                    Configure user escrow commitments, claim settled funds, and view customer balances.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    fetchVaultOps();
                                    fetchVaults();
                                }}
                                disabled={isVaultOpsLoading || isVaultsLoading}
                                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/55 transition hover:border-[#00d2b4]/30 hover:text-white disabled:opacity-50 flex items-center gap-1.5"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${(isVaultOpsLoading || isVaultsLoading) ? "animate-spin" : ""}`} />
                                Refresh
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Required Commit form */}
                            <form onSubmit={handleSaveCommitConfig} className="rounded-2xl border border-white/5 bg-black/20 p-5 space-y-4">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Required Commit</p>
                                    <p className="text-[9px] text-white/35 mt-1">
                                        Minimum escrow each customer must restore before usage can continue.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <label className="space-y-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">USDC</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.000001"
                                            value={commitInput}
                                            onChange={(e) => setCommitInput(e.target.value)}
                                            disabled={isSavingCommit}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#00d2b4] transition text-xs font-mono disabled:opacity-50"
                                            placeholder="0"
                                        />
                                    </label>
                                    <button
                                        type="submit"
                                        disabled={isSavingCommit}
                                        className="w-full py-2 bg-[#00d2b4] text-[#111111] hover:brightness-110 disabled:opacity-50 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                    >
                                        {isSavingCommit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                        Save Commit
                                    </button>
                                </div>
                                <p className="text-[9px] text-white/35 uppercase tracking-wider">
                                    Current on-chain setting: <span className="font-mono text-[#ccff00]">${formatUsdcMicros(requiredCommit)} USDC</span>
                                </p>
                            </form>

                            {/* Claim Settled Funds card */}
                            <div className="rounded-2xl border border-white/5 bg-black/20 p-5 flex flex-col justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Claimable Settled Funds</p>
                                    <p className="text-3xl font-black text-white mt-2">${formatUsdcMicros(claimableAmount)}</p>
                                    <p className="text-[9px] text-white/35 mt-1">
                                        Funds become claimable after the keeper draws accrued cycle usage from escrow.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleClaimVaultFunds}
                                    disabled={isClaimingVault || isVaultOpsLoading || microsToNumber(claimableAmount) <= 0}
                                    className="w-full py-2 bg-white/[0.08] border border-white/10 hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                >
                                    {isClaimingVault ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5 text-[#00d2b4]" />}
                                    Claim Funds
                                </button>
                            </div>

                            {/* Usage Test Key */}
                            <div className="rounded-2xl border border-white/5 bg-black/20 p-5 space-y-4">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Usage Test Key</p>
                                    <p className="text-[9px] text-white/35 mt-1">
                                        Paste a one-time revealed secret key to test usage reports from this dashboard.
                                    </p>
                                </div>
                                <label className="block space-y-1.5">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">Secret key</span>
                                    <input
                                        type="password"
                                        value={usageSecretKey}
                                        onChange={(e) => setUsageSecretKey(e.target.value)}
                                        autoComplete="off"
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#00d2b4] transition text-xs font-mono"
                                        placeholder="sk_test_..."
                                    />
                                </label>
                                <p className="text-[9px] text-white/30">
                                    Keys are only returned as hints after creation; this field stays in local state.
                                </p>
                            </div>
                        </div>

                        {vaultOpsStatus && (
                            <p className={`text-[10px] font-bold tracking-wide ${
                                vaultOpsStatus.type === "success" ? "text-emerald-400" : "text-red-400"
                            }`}>
                                {vaultOpsStatus.text}
                            </p>
                        )}
                    </div>

                    {/* Customer Vaults list */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-white">Active Customer Escrows</h3>
                            <p className="text-[10px] text-white/40">A live register of active customer commitments and owed usages.</p>
                        </div>

                        {isVaultsLoading ? (
                            <div className="flex h-24 items-center justify-center">
                                <Loader2 className="h-5 w-5 animate-spin text-[#00d2b4]" />
                            </div>
                        ) : vaultsError ? (
                            <div className="flex h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-red-500/20 bg-red-500/[0.03] text-center p-4">
                                <p className="text-xs text-red-300/80">{vaultsError}</p>
                            </div>
                        ) : vaults.length === 0 ? (
                            <div className="flex h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center p-4">
                                <p className="text-xs text-white/45">No customers have committed escrow to your metered service yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-3">
                                    {vaults.map((vault) => (
                                        <LocalCustomerVaultRow
                                            key={vault.id}
                                            vault={vault}
                                            apiKey={usageSecretKey.trim() || selectedApiKey}
                                            onRefresh={fetchVaults}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        switch (activeTab) {
            case "offramp":
                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
                        <div className="space-y-2">
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <ArrowRightLeft className={`w-5 h-5 ${primaryColorText}`} />
                                Fiat off-ramp
                            </h2>
                            <p className="text-xs text-white/50 font-sans leading-relaxed">
                                Bank settlement routing is not yet available. No bank account is connected and changing controls here will never move or allocate funds.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-5 flex items-start gap-4">
                            <div className="p-2 rounded-xl flex-shrink-0 border bg-amber-400/10 border-amber-400/20 text-amber-300">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-white uppercase tracking-wider">Coming soon</p>
                                <p className="text-[10px] text-white/50 leading-relaxed font-sans">
                                    When this launches, you will review the verified bank destination, conversion quote, fees, settlement timing, and allocation before explicitly confirming any change.
                                </p>
                            </div>
                        </div>
                    </div>
                );

            case "settings":
                return renderSettingsTab();
 
             case "payment-links":
                return (
                    <div className="space-y-6 overflow-hidden" {...paymentSwipe}>
                        {renderSubTabs()}
                        <div className="overflow-hidden w-full relative">
                            <AnimatePresence mode="wait" initial={false} custom={subTabDirection}>
                                <motion.div
                                    key={subTab}
                                    custom={subTabDirection}
                                    variants={{
                                        enter: (dir: number) => ({
                                            x: dir > 0 ? "100%" : "-100%",
                                            opacity: 0,
                                        }),
                                        center: {
                                            x: 0,
                                            opacity: 1,
                                        },
                                        exit: (dir: number) => ({
                                            x: dir < 0 ? "100%" : "-100%",
                                            opacity: 0,
                                        }),
                                    }}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    transition={{
                                        x: { type: "spring", stiffness: 300, damping: 30 },
                                        opacity: { duration: 0.2 },
                                    }}
                                    className="w-full"
                                >
                                    {subTab === "subscriptions" && renderPlansTab()}
                                    {subTab === "one-time" && renderPaymentLinksTab()}
                                    {subTab === "commit" && renderCommitTab()}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                );

            case "plans":
                return renderPlansTab();

            case "analytics":
                return (
                    <AnalyticsDashboard
                        isPremium={isPremium}
                        setActiveTab={setActiveTab}
                        walletBalance={walletBalance}
                        vaultBalance={vaultBalance}
                        ledgers={ledgers}
                        analytics={merchantAnalytics}
                        onRetryCharge={handleRetryCharge}
                        merchantAddress={address || ""}
                    />
                );

            case "payroll":
                return <PayrollContent embedded />;

            case "overview":
                return (
                    <>
                        {/* Desktop Overview Layout */}
                        <div className="hidden md:block space-y-8">
                            {/* Stats Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                                {/* Wallet Balance */}
                                <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Wallet Balance</p>
                                            <button onClick={() => setBalanceVisible(!balanceVisible)} className="text-white/30 hover:text-white/60 transition-colors p-0.5">
                                                {balanceVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                            </button>
                                        </div>
                                        <button 
                                            onClick={handleManualRefreshBalances}
                                            disabled={isRefreshingBalances}
                                            className="text-white/30 hover:text-white/65 disabled:opacity-50 transition-all p-0.5 flex items-center justify-center"
                                            title="Refresh Balance"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${isRefreshingBalances ? "animate-spin" : ""}`} />
                                        </button>
                                    </div>
                                    <p className="text-3xl font-extrabold text-white mb-1 tracking-tight">
                                        {balanceVisible ? `$${walletBalance.toFixed(2)}` : '•••••'}
                                    </p>
                                    <p className="text-[10px] text-white/30 flex items-center gap-1">
                                        <Wallet className="w-3 h-3 text-[#00d2b4]" /> USDC in connected wallet
                                    </p>
                                </div>

                                {/* Claimable Settlement */}
                                <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                    <div className="flex items-center gap-2 mb-2">
                                        <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Claimable Settlement</p>
                                        <button onClick={() => setBalanceVisible(!balanceVisible)} className="text-white/30 hover:text-white/60 transition-colors p-0.5">
                                            {balanceVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                        </button>
                                    </div>
                                    <p className={`text-3xl font-extrabold ${primaryColorText} mb-1 tracking-tight`}>
                                        {balanceVisible ? `$${vaultBalance.toFixed(2)}` : '•••••'}
                                    </p>
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] text-white/30">USDC ready for merchant payout</p>
                                        <button
                                            onClick={() => setIsWithdrawOpen(true)}
                                            disabled={vaultBalance <= 0 || isWithdrawing}
                                            className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                                                vaultBalance > 0 
                                                    ? "border-[#00d2b4]/30 text-[#00d2b4] hover:bg-[#00d2b4]/10" 
                                                    : "border-white/5 text-white/20 cursor-not-allowed"
                                            }`}
                                        >
                                            <ArrowDownToLine className="w-2.5 h-2.5" />
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
                                            {isPremium ? "Full access to rerouting, analytics, and priority execution" : "Basic dashboard access. Upgrade for premium features."}
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
                                                <th className="pb-3 text-right">Control</th>
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
                                                (() => {
                                                    return ledgers.map((item) => (
                                                        <tr key={item.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                                                            <td className="py-4 font-semibold text-white">{item.id}</td>
                                                            <td className="py-4 text-white/40">{item.displayAddress || item.shortSubAddress}</td>
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
                                                                <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold">
                                                                    {item.active ? "Customer controlled" : "Ended"}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ));
                                                })()
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {(() => {
                                    const totalPages = ledgerPagination.totalPages;
                                    if (totalPages <= 1) return null;
                                    return (
                                        <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 font-sans">
                                            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
                                                Page {ledgerPage + 1} of {totalPages}
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={ledgerPage === 0}
                                                    onClick={() => setLedgerPage((p) => Math.max(0, p - 1))}
                                                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                                >
                                                    Prev
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={ledgerPage >= totalPages - 1}
                                                    onClick={() => setLedgerPage((p) => Math.min(totalPages - 1, p + 1))}
                                                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Mobile Overview Layout (Strictly blueprint aligned) */}
                        <div className="md:hidden space-y-6 pb-24 font-sans">
                            {/* Wallet Balance Card */}
                            <div className="liquid-glass border border-white/10 rounded-3xl p-6 shadow-xl flex justify-between items-center relative overflow-hidden bg-black/35 backdrop-blur-xl">
                                <div className="space-y-1 relative z-10">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-white/45 uppercase font-bold tracking-wider">Wallet Balance</span>
                                        <button onClick={() => setBalanceVisible(!balanceVisible)} className="text-white/30 hover:text-white/60 transition-colors p-0.5">
                                            {balanceVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                        </button>
                                        <button 
                                            onClick={handleManualRefreshBalances}
                                            disabled={isRefreshingBalances}
                                            className="text-white/30 hover:text-white/65 disabled:opacity-50 transition-all p-0.5 flex items-center justify-center"
                                            title="Refresh Balance"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${isRefreshingBalances ? "animate-spin" : ""}`} />
                                        </button>
                                    </div>
                                    <p className="text-3xl font-extrabold text-white mt-1.5 tracking-tight leading-none">
                                        {balanceVisible ? `$${walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••'}
                                    </p>
                                    <span className="text-xs font-semibold text-white/40 font-mono">
                                        {balanceVisible ? `${detectedCurrency.symbol}${(walletBalance * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••'}
                                    </span>
                                </div>
                                <div className="relative z-10">
                                    <button
                                        onClick={() => setIsDepositOpen(true)}
                                        className="w-12 h-12 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-white flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95"
                                        title="Deposit funds"
                                    >
                                        <ArrowDown className="w-5 h-5 rotate-180" />
                                    </button>
                                </div>
                            </div>

                            {/* Claimable Settlement Card */}
                            <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 shadow-xl relative overflow-hidden bg-black/35 backdrop-blur-xl">
                                <div className="relative z-10 space-y-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-white/45 uppercase font-bold tracking-wider">Claimable Settlement</span>
                                            <button
                                                type="button"
                                                onClick={() => setBalanceVisible(!balanceVisible)}
                                                className="text-white/30 hover:text-white/60 transition-colors p-0.5"
                                                aria-label={balanceVisible ? "Hide balances" : "Show balances"}
                                            >
                                            {balanceVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setTimeframeOpen((open) => !open)}
                                            className="flex items-center gap-1 rounded-full border border-[#00d2b4]/30 bg-[#00d2b4]/15 px-2.5 py-1 text-[8px] font-bold text-[#00d2b4] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:bg-[#00d2b4]/25 active:scale-95"
                                            aria-expanded={timeframeOpen}
                                            aria-label="Select settlement timeframe"
                                        >
                                            <span>{settlementTimeframe}</span>
                                            <ChevronDown className={`h-3 w-3 transition-transform duration-300 ${timeframeOpen ? "rotate-180" : "rotate-0"}`} />
                                        </button>
                                    </div>
                                    <AnimatePresence initial={false}>
                                        {timeframeOpen && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0, y: -4 }}
                                                animate={{ opacity: 1, height: "auto", y: 0 }}
                                                exit={{ opacity: 0, height: 0, y: -4 }}
                                                transition={{ type: "spring", stiffness: 340, damping: 22, bounce: 0.22 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-white/10 bg-black/35 p-1.5 backdrop-blur-xl">
                                                    {settlementTimeframes.map((tf) => (
                                                        <button
                                                            key={tf}
                                                            type="button"
                                                            onClick={() => { setSettlementTimeframe(tf); setTimeframeOpen(false); }}
                                                            className={`rounded-full px-2 py-1.5 text-center text-[8px] font-bold transition-all duration-200 active:scale-95 ${
                                                                settlementTimeframe === tf
                                                                    ? "bg-[#00d2b4]/15 text-[#00d2b4] ring-1 ring-[#00d2b4]/30"
                                                                    : "text-white/50 hover:bg-white/5 hover:text-white"
                                                            }`}
                                                        >
                                                            {tf}
                                                        </button>
                                                    ))}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                    <div className="flex items-end justify-between gap-4">
                                        <div className="space-y-1">
                                            <p className="text-3xl font-extrabold text-[#00d2b4] tracking-tight leading-none">
                                                {balanceVisible ? `$${vaultBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••'}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] font-bold tracking-wide ${vaultBalance > 0 ? 'text-emerald-400' : 'text-white/30'}`}>
                                                    {vaultBalance > 0 ? "Available" : "-"}
                                                </span>
                                                <span className="text-xs font-semibold text-white/40 font-mono">
                                                    {balanceVisible ? `${detectedCurrency.symbol}${(vaultBalance * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••'}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setIsWithdrawOpen(true)}
                                            className="w-12 h-12 shrink-0 rounded-full border border-[#00d2b4]/30 bg-[#00d2b4]/10 hover:bg-[#00d2b4]/20 text-[#00d2b4] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] shadow-lg shadow-[#00d2b4]/5 hover:scale-105 active:scale-95"
                                            title="Withdraw routed funds"
                                        >
                                            <ArrowDown className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Quick Actions Grid (Circles) */}
                            <div className="grid grid-cols-4 gap-3 py-2 text-center">
                                {/* Quick-action icons mirror the desktop sidebar so the same
                                    destination always carries the same icon on every screen. */}
                                <div>
                                    <button
                                        onClick={() => setActiveTab("payment-links")}
                                        className="mx-auto w-12 h-12 rounded-full border border-[#00d2b4]/20 bg-white/[0.02] hover:bg-white/[0.05] text-[#00d2b4] flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95"
                                    >
                                        <Sliders className="w-5 h-5" />
                                    </button>
                                    <span className="text-[8px] font-bold text-white/50 uppercase tracking-widest block mt-2 leading-tight">Payments Link</span>
                                </div>
                                <div>
                                    <button
                                        onClick={() => setActiveTab("webhooks")}
                                        className="mx-auto w-12 h-12 rounded-full border border-[#00d2b4]/20 bg-white/[0.02] hover:bg-white/[0.05] text-[#00d2b4] flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95"
                                    >
                                        <Broadcast className="w-5 h-5" />
                                    </button>
                                    <span className="text-[8px] font-bold text-white/50 uppercase tracking-widest block mt-2 leading-tight">Webhooks</span>
                                </div>
                                <div>
                                    <Link
                                        href="/merchant/payroll"
                                        className="mx-auto w-12 h-12 rounded-full border border-[#00d2b4]/20 bg-white/[0.02] hover:bg-white/[0.05] text-[#00d2b4] flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95"
                                    >
                                        <Building2 className="w-5 h-5" />
                                    </Link>
                                    <span className="text-[8px] font-bold text-white/50 uppercase tracking-widest block mt-2 leading-tight">Payroll</span>
                                </div>
                                <div>
                                    <button
                                        onClick={() => setActiveTab("premium")}
                                        className={`mx-auto w-12 h-12 rounded-full border flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95 ${
                                            isPremium 
                                                ? "border-[#d4a853]/30 bg-[#d4a853]/10 text-[#d4a853]" 
                                                : "border-white/10 bg-white/[0.02] text-white/40"
                                        }`}
                                    >
                                        <Crown className="w-5 h-5" />
                                    </button>
                                    <span className="text-[8px] font-bold text-white/50 uppercase tracking-widest block mt-2 leading-tight">Premium Tier</span>
                                </div>
                            </div>

                            {/* Customer / Agent Ledger (Mobile list card) */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-5 shadow-xl space-y-4">
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                                    Customer / Agent Ledger
                                </h3>
                                <div className="space-y-3">
                                    {isLoadingContract ? (
                                        <div className="py-8 text-center text-white/30 flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin text-[#00d2b4]" />
                                            <span className="text-xs">Fetching ledger...</span>
                                        </div>
                                    ) : ledgers.length === 0 ? (
                                        <div className="py-8 text-center text-white/20 text-xs">
                                            No active allowances detected.
                                        </div>
                                    ) : (
                                        (() => {
                                            return ledgers.map((item) => (
                                                <div key={item.id} className="p-4 bg-white/[0.01] border border-white/5 rounded-2xl relative space-y-3">
                                                    <div className="flex justify-between items-start pr-8">
                                                        <div>
                                                            <p className="text-[10px] font-bold text-white uppercase tracking-wide">{item.id}</p>
                                                            <p className="text-[9px] font-mono text-white/40 mt-0.5">{item.displayAddress || item.shortSubAddress}</p>
                                                        </div>
                                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                                                            item.active 
                                                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                                : "bg-red-500/10 text-red-400 border border-red-500/20"
                                                        }`}>
                                                            {item.active ? "Active" : "Revoked"}
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-white/5 text-[9px] text-white/50 font-mono">
                                                        <div>
                                                            <span className="text-[8px] text-white/20 uppercase tracking-widest font-bold block">Allowance</span>
                                                            <span className="text-white font-semibold block mt-0.5">{item.limit}</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-[8px] text-white/20 uppercase tracking-widest font-bold block">Next Billing</span>
                                                            <span className="text-white/70 block mt-0.5">{item.nextBilling}</span>
                                                        </div>
                                                    </div>
                                                    {item.active && (
                                                        <span className="block text-[8px] font-bold uppercase tracking-widest text-white/20">
                                                            Only the customer can cancel
                                                        </span>
                                                    )}
                                                </div>
                                            ));
                                        })()
                                    )}
                                </div>
                                {(() => {
                                    const totalPages = ledgerPagination.totalPages;
                                    if (totalPages <= 1) return null;
                                    return (
                                        <div className="flex items-center justify-between pt-3 border-t border-white/5 font-sans">
                                            <span className="text-[9px] text-white/30 uppercase font-bold">
                                                {ledgerPage + 1} / {totalPages}
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={ledgerPage === 0}
                                                    onClick={() => setLedgerPage((p) => Math.max(0, p - 1))}
                                                    className="px-2.5 py-1 bg-white/5 border border-white/10 disabled:opacity-30 text-white rounded-lg text-[9px] font-bold uppercase"
                                                >
                                                    Prev
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={ledgerPage >= totalPages - 1}
                                                    onClick={() => setLedgerPage((p) => Math.min(totalPages - 1, p + 1))}
                                                    className="px-2.5 py-1 bg-white/5 border border-white/10 disabled:opacity-30 text-white rounded-lg text-[9px] font-bold uppercase"
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </>
                );

            case "premium":
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
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
                        <div className={`liquid-glass border rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden ${isPremium ? "border-[#d4a853]/30 bg-gradient-to-b from-[#d4a853]/[0.03] to-transparent" : "border-white/5"}`}>
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
                                    : "Upgrade to Privacy Premium to unlock payout rerouting, priority execution, advanced analytics, and more."
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>

                        {isPremium ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                                <div className="md:col-span-2 space-y-6">
                                    {/* PAST_DUE Warning Banner */}
                                    {dbSubscriptionStatus === "PAST_DUE" && (
                                        <div className="liquid-glass border border-amber-500/20 rounded-3xl p-6 shadow-2xl space-y-4 bg-amber-500/[0.02]">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                                                    <AlertTriangle className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Premium Grace Period</h3>
                                                    <p className="text-xs text-white/50">Payment failed. Access temporarily preserved.</p>
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
                                                <p className="text-sm text-white/50">Default: funds route to your connected wallet ({address?.slice(0, 6)}...{address?.slice(-4)})</p>
                                            )}
                                        </div>

                                        {/* Set New Destination */}
                                        <div>
                                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">
                                                New Destination Address
                                            </label>
                                            <div className="flex flex-col gap-3 sm:flex-row">
                                                <input
                                                    type="text"
                                                    value={rerouteAddress}
                                                    onChange={(e) => setRerouteAddress(e.target.value)}
                                                    placeholder="0x... cold storage, multisig, or ledger address"
                                                    className="min-w-0 w-full flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-[#d4a853]/50 transition-colors placeholder:text-white/20"
                                                />
                                                <button
                                                    onClick={handleReroute}
                                                    disabled={isRerouting || !rerouteAddress}
                                                    className="w-full sm:w-auto shrink-0 px-5 py-3 bg-[#d4a853] text-black font-bold rounded-xl text-xs uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

                                    {/* Arc Confidentiality & Governed Access settings card */}
                                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                                        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                            <Shield className="w-4 h-4 text-[#d4a853]" />
                                            Arc Confidentiality
                                        </h3>

                                        {/* Operational switch for Shielded Batch Payouts */}
                                        <div className="flex items-center justify-between bg-black/40 border border-white/5 rounded-2xl p-5">
                                            <div>
                                                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Confidential Batch Payouts <span className="text-[#d4a853]/80">(Preview)</span></h4>
                                                <p className="text-[10px] text-white/50 leading-normal max-w-md">
                                                    Masks recipient addresses and transfer amounts in SubScript&apos;s batch event log. Note: the underlying USDC transfers are still recorded on Arc&apos;s public ledger today &mdash; full on-chain shielding activates once Arc&apos;s Privacy Sector (APS) is live.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {!isPremium && <Lock className="w-3.5 h-3.5 text-white/40" />}
                                                <button
                                                    onClick={handleToggleShielded}
                                                    disabled={!isPremium}
                                                    className={`w-11 h-6 rounded-full p-1 transition-all duration-300 ${
                                                        !isPremium ? "opacity-50 cursor-not-allowed bg-white/5" : (shieldedEnabled ? "bg-[#d4a853]" : "bg-white/10")
                                                    }`}
                                                >
                                                    <div
                                                        className={`w-4 h-4 rounded-full bg-black transition-all duration-300 transform ${
                                                            shieldedEnabled && isPremium ? "translate-x-5" : "translate-x-0"
                                                        }`}
                                                    />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Governed Access panel containing a generation button for the View Key */}
                                        <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-4">
                                            <div>
                                                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Governed View Key</h4>
                                                <p className="text-[10px] text-white/50 leading-normal">
                                                    Generate and register a View Key. Its hash is stored on-chain and gates retrieval of your batch payout history. The key itself never leaves your browser; only its hash is registered.
                                                </p>
                                            </div>

                                            <div className="flex gap-3">
                                                <div className="relative flex-1">
                                                    <input
                                                        type={showViewKey ? "text" : "password"}
                                                        value={viewKey}
                                                        readOnly
                                                        disabled={!isPremium}
                                                        placeholder="Click generate to create a View Key"
                                                        className={`w-full bg-black border border-white/10 rounded-xl pl-4 pr-10 py-3 text-xs font-mono text-white focus:outline-none placeholder:text-white/20 ${
                                                            !isPremium ? "opacity-50 cursor-not-allowed" : ""
                                                        }`}
                                                    />
                                                    {viewKey && (
                                                        <button
                                                            onClick={() => setShowViewKey(!showViewKey)}
                                                            disabled={!isPremium}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {showViewKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                        </button>
                                                    )}
                                                </div>
                                                
                                                {viewKey ? (
                                                    <button
                                                        onClick={handleCopyViewKey}
                                                        disabled={!isPremium}
                                                        className="px-4 bg-white/5 border border-white/10 text-white rounded-xl hover:bg-white/10 transition-all flex items-center justify-center animate-none disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {copiedViewKey ? <Check className="w-4 h-4 text-[#00d2b4]" /> : <Copy className="w-4 h-4" />}
                                                    </button>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        {!isPremium && <Lock className="w-3.5 h-3.5 text-white/45" />}
                                                        <button
                                                            onClick={handleGenerateViewKey}
                                                            disabled={!isPremium}
                                                            className={`px-5 py-3 border text-xs font-bold rounded-xl uppercase tracking-wider transition-all flex items-center gap-2 ${
                                                                !isPremium 
                                                                    ? "bg-white/5 border-white/10 text-white/40 cursor-not-allowed" 
                                                                    : "bg-[#d4a853]/10 hover:bg-[#d4a853]/20 border-[#d4a853]/30 text-[#d4a853]"
                                                            }`}
                                                        >
                                                            <Key className="w-3.5 h-3.5" />
                                                            Generate
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {viewKey && !isViewKeyRegistered && (
                                                <div className="flex items-center justify-between pt-2">
                                                    <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" /> Key generated but not registered on-chain
                                                    </span>
                                                    <button
                                                        onClick={handleSaveConfidentiality}
                                                        disabled={isSavingConfidentiality || !isPremium}
                                                        className={`px-5 py-2.5 font-bold rounded-xl text-xs uppercase tracking-wider transition-all flex items-center gap-2 ${
                                                            !isPremium 
                                                                ? "bg-white/5 border border-white/10 text-white/40 cursor-not-allowed" 
                                                                : "bg-[#d4a853] text-black hover:brightness-110"
                                                        }`}
                                                    >
                                                        {isSavingConfidentiality ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                        Register Key
                                                    </button>
                                                </div>
                                            )}

                                            {isViewKeyRegistered && (
                                                <div className="flex items-center justify-between pt-2">
                                                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                                                        <CheckCircle className="w-3.5 h-3.5" /> View Key is active and registered
                                                    </span>
                                                    <button
                                                        onClick={handleSaveConfidentiality}
                                                        disabled={isSavingConfidentiality || !isPremium}
                                                        className={`px-4 py-2 font-bold rounded-xl text-xs uppercase tracking-wider transition-all flex items-center gap-2 ${
                                                            !isPremium 
                                                                ? "bg-white/5 border border-white/10 text-white/40 cursor-not-allowed" 
                                                                : "bg-white/5 border border-white/10 hover:bg-white/10 text-white"
                                                        }`}
                                                    >
                                                        {isSavingConfidentiality ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                                        Update Settings
                                                    </button>
                                                </div>
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
                                                    Resume Premium
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleCancelPremium}
                                                    disabled={isCancellingPremium || !isPremium}
                                                    className="px-5 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 font-bold border border-red-500/30 rounded-xl text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {isCancellingPremium ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                                                    Cancel Privacy Premium
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
                                </div>

                                <div className="md:col-span-1 space-y-6">
                                    {/* Billing Summary Card */}
                                    <div className="liquid-glass border border-[#d4a853]/20 rounded-3xl p-6 shadow-2xl space-y-4">
                                        <h4 className="text-[10px] text-white/40 uppercase font-bold tracking-widest text-center">Subscription Billing</h4>
                                        <div className="space-y-3 font-mono text-[10px] text-white/60">
                                            <div className="flex justify-between border-b border-white/5 pb-2">
                                                <span>Tier:</span>
                                                <span className="text-[#d4a853] font-bold">PRIVACY PREMIUM</span>
                                            </div>
                                            <div className="flex justify-between border-b border-white/5 pb-2">
                                                <span>Price:</span>
                                                <span>10 USDC / mo</span>
                                            </div>
                                            {currentPeriodEnd && (
                                                <div className="flex justify-between border-b border-white/5 pb-2">
                                                    <span>{cancelAtPeriodEnd ? "Expires:" : "Next Renewal:"}</span>
                                                    <span>{new Date(currentPeriodEnd).toLocaleDateString()}</span>
                                                </div>
                                            )}
                                        </div>
                                        <Link
                                            href="/merchant/upgrade"
                                            className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 text-center"
                                        >
                                            Manage Subscription
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Upgrade CTA for Standard tier */
                            <div className="liquid-glass border border-[#d4a853]/20 rounded-3xl p-6 sm:p-8 shadow-2xl bg-gradient-to-b from-[#d4a853]/[0.02] to-transparent">
                                <div className="max-w-lg mx-auto text-center space-y-6">
                                    <div className="space-y-2">
                                        <h3 className="text-lg font-extrabold text-white uppercase tracking-tight">Upgrade to Privacy Premium</h3>
                                        <p className="text-xs text-white/50 leading-relaxed">
                                            Unlock privacy-aware payouts, fund rerouting to cold storage and multisigs, priority keeper execution, and full API/webhook access.
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-center gap-2">
                                        <span className="text-3xl font-extrabold text-[#d4a853]">10 USDC</span>
                                        <span className="text-xs text-white/40">/ month</span>
                                    </div>

                                    <Link
                                        href="/merchant/upgrade"
                                        className="px-8 py-3.5 bg-gradient-to-r from-[#d4a853] to-[#c49240] text-[#111111] font-extrabold text-xs uppercase tracking-widest rounded-full shadow-[0_4px_25px_rgba(212,168,83,0.3)] hover:brightness-110 transition-all flex items-center gap-2 mx-auto w-fit"
                                    >
                                        <Crown className="w-4 h-4" /> View Upgrade Options
                                    </Link>

                                    {/* Features list */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left pt-4 border-t border-white/5">
                                        {[
                                            "Opt-In Privacy Controls",
                                            "Priority keeper execution",
                                            "Advanced analytics",
                                            "Full API & webhook access",
                                            "Multi-wallet support",
                                            "Privacy Premium merchant badge"
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

            case "apikeys": {
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
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
                /* Secrets are hashed at rest: only secret_key_hash and an "sk_test_1234...2345" hint
                   are stored, so GET /api/keys can never return a usable key and always reports
                   secretKeyAvailable: false. It is true only for a key minted in this session.
                   This flag was returned by the API but never read here, so the hint was rendered
                   behind the same dots-and-eye affordance as a real secret — revealing it produced a
                   fingerprint, and Copy silently put that unusable string on the clipboard. */
                const activeSecretAvailable = Boolean(activeKey?.secretKeyAvailable && activeSecretKey);

                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-8">
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

                        {apiKeySetupStatus && (
                            <p role="status" className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-[10px] leading-relaxed text-white/65">
                                {apiKeySetupStatus}
                            </p>
                        )}

                        {isKeysLoading ? (
                            <div className="py-12 text-center flex flex-col items-center gap-2">
                                <Loader2 className="w-6 h-6 animate-spin text-[#00d2b4]" />
                                <span className="text-xs text-white/40">Loading keys...</span>
                            </div>
                        ) : !activeKey ? (
                            <div className="border border-white/5 rounded-2xl p-6 sm:p-8 text-center bg-black/20 space-y-4 font-sans">
                                <Key className="w-8 h-8 mx-auto text-white/20" />
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-white uppercase tracking-wider">No Active API Credentials</p>
                                    <p className="text-[10px] text-white/40 leading-relaxed">
                                        Generate credentials and optionally register the webhook receiver that belongs to this integration.
                                    </p>
                                </div>
                                <div className="mx-auto w-full max-w-xl space-y-2 text-left">
                                    <label htmlFor="api-key-webhook-url" className="block text-[10px] font-bold uppercase tracking-wider text-white/55">
                                        Webhook URL <span className="font-normal normal-case text-white/30">(recommended)</span>
                                    </label>
                                    <input
                                        id="api-key-webhook-url"
                                        type="url"
                                        value={apiKeyWebhookUrl}
                                        onChange={(event) => setApiKeyWebhookUrl(event.target.value)}
                                        placeholder="https://your-app.example/api/subscript/webhook"
                                        className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-white outline-none transition-colors focus:border-[#00d2b4]"
                                    />
                                    <p className="text-[9px] leading-relaxed text-white/30">
                                        SubScript creates the endpoint with your API key so payment and subscription events are observable immediately.
                                    </p>
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
                                            {activeSecretAvailable && (
                                                <button
                                                    onClick={() => setRevealSecret(!revealSecret)}
                                                    className="text-white/40 hover:text-white transition-colors"
                                                >
                                                    {revealSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {activeSecretAvailable ? (
                                        <>
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
                                            <p className="mt-2 text-[10px] leading-relaxed text-yellow-400/80">
                                                Copy this now. It is only readable while this page stays open; the key is stored
                                                hashed, so it cannot be shown again.
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-black/60 p-3 font-mono">
                                                <code className="break-all text-xs text-white/45">{activeSecretKey}</code>
                                            </div>
                                            <p className="mt-2 text-[10px] leading-relaxed text-white/40">
                                                This is a fingerprint of the live key, not the key itself. It's enough to tell which one
                                                your integration should be using. The secret is stored hashed and is shown only once,
                                                when it is created. If you no longer have it, roll the key below to issue a new one.
                                            </p>
                                        </>
                                    )}
                                </div>

                                {/* Roll Keys */}
                                <div className="pt-4 border-t border-white/5 flex items-center justify-between font-sans">
                                    <div>
                                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Rotation / Roll Credentials</h3>
                                        <p className="text-[10px] text-white/40 max-w-md">
                                            Roll your API key pair instantly. Old keys are immediately invalidated for safety in this sandbox.
                                            {!activeSecretAvailable && " This is also how you get a readable secret if you no longer have the current one. The new key is revealed and copied once, here."}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {copiedText === "API Secret Key Rolled" && (
                                            <span className="text-[10px] text-[#00d2b4] font-bold animate-pulse">API Secret Key Rolled</span>
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
            }

            case "checkout":
                return (
                    <div className="space-y-8">
                        {/* Fastest path: the CLI (no SDK, plain REST). */}
                        <div className="liquid-glass border border-[#00d2b4]/25 rounded-3xl p-6 shadow-2xl bg-[#00d2b4]/[0.04]">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <div>
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                        <Code2 className={`w-4 h-4 ${primaryColorText}`} />
                                        Fastest integration: the CLI
                                    </h2>
                                    <p className="mt-2 text-[11px] text-white/55 leading-relaxed max-w-md">
                                        One command scaffolds a checkout intent route, a signed webhook receiver, and a checkout button. SubScript is a plain REST API. There is no SDK to install.
                                    </p>
                                </div>
                                <a
                                    href="https://www.subscriptonarc.com/docs"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#00d2b4] hover:underline"
                                >
                                    Read the docs →
                                </a>
                            </div>
                            <div className="mt-4 flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-4 py-3">
                                <code className="flex-1 text-xs font-mono text-white/90 break-all">npx @subscriptonarc/cli</code>
                                <button
                                    onClick={() => handleCopy("npx @subscriptonarc/cli", "CLI Command")}
                                    className="shrink-0 p-2 text-white/50 hover:text-[#00d2b4] rounded-lg hover:bg-white/5 transition-colors"
                                    title="Copy command"
                                >
                                    {copiedText === "CLI Command" ? <Check className="w-4 h-4 text-[#00d2b4]" /> : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
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
                                                aria-label="Subscription/Plan Name"
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
                                        <div className="pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowCheckoutAdvanced(!showCheckoutAdvanced)}
                                                className="text-[10px] text-white/40 hover:text-white flex items-center gap-1.5 uppercase font-bold tracking-wider transition-colors"
                                            >
                                                <Sliders className="w-3.5 h-3.5" />
                                                {showCheckoutAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
                                            </button>
                                        </div>

                                        {showCheckoutAdvanced && (
                                            <div className="pt-3 border-t border-white/5 space-y-4">
                                                <div>
                                                    <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Settlement Rail</label>
                                                    <select 
                                                        value={subChain}
                                                        onChange={(e) => setSubChain(e.target.value)}
                                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans text-xs"
                                                    >
                                                        <option value="arc">Arc Network (Hosted checkout live)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Wallet Connection Provider</label>
                                                    <select 
                                                        value={walletProvider}
                                                        onChange={(e) => setWalletProvider(e.target.value)}
                                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans text-xs"
                                                    >
                                                        <option value="none">Not Connected (Agent will configure RainbowKit/wagmi)</option>
                                                        <option value="privy">Privy Auth (Embedded Wallets + Social Login)</option>
                                                        <option value="rainbowkit">RainbowKit (Standard Web3 Wallet Modal)</option>
                                                        <option value="web3onboard">Web3-Onboard (Enterprise Connection Modal)</option>
                                                        <option value="wagmi">wagmi Connectors (Custom wallet connect buttons)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Backend & Database Provider</label>
                                                    <select 
                                                        value={dbProvider}
                                                        onChange={(e) => setDbProvider(e.target.value)}
                                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans text-xs"
                                                    >
                                                        <option value="none">No Database (Agent will auto-detect or recommend Prisma)</option>
                                                        <option value="prisma">Prisma ORM (PostgreSQL/MySQL/SQLite)</option>
                                                        <option value="supabase">Supabase (PostgreSQL with client SDK)</option>
                                                        <option value="mongodb">MongoDB / Mongoose (NoSQL)</option>
                                                        <option value="postgresql">PostgreSQL (Raw pg client pool)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Session Persistence</label>
                                                    <select 
                                                        value={sessionProvider}
                                                        onChange={(e) => setSessionProvider(e.target.value)}
                                                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans text-xs"
                                                    >
                                                        <option value="none">No Session Engine (Agent will configure HTTP Cookies/JWT)</option>
                                                        <option value="cookies">HTTP-Only Secure Cookies (Stateful session)</option>
                                                        <option value="jwt">JWT Tokens (Stateless Authorization Headers)</option>
                                                        <option value="privy">Privy User Sessions (Managed JWT / Access Token)</option>
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-8 pt-4 border-t border-white/5 text-[10px] text-white/40">
                                    SubScript is fast, private, and reliable: Arc-native USDC gas, private burner activation, and a 1% protocol fee.
                                </div>
                            </div>

                            {/* Code output Block */}
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40 p-6 flex flex-col justify-between space-y-4">
                                <div className="space-y-1">
                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Checkout Snippet (REST · no SDK)</span>
                                    <p className="text-[10px] text-white/30">A fetch-based checkout button + intent route. No SDK to install.</p>
                                </div>
                                <pre className="bg-black/40 p-4 rounded-xl border border-white/5 overflow-x-auto text-[10px] font-mono text-emerald-400 text-left flex-1">
                                    <code>{checkoutCode}</code>
                                </pre>
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
                                            <Copy className="w-4 h-4" /> Copy Checkout Component
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>


                        {/* Agent Prompt Block */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                            <div className="border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Agent Integration Prompt</span>
                                <p className="text-[10px] text-white/30 mt-0.5">Configure your subscription settings and copy the setup prompt for your AI agent.</p>
                            </div>
                            <div className="p-6 space-y-4">


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

            case "webhooks": {
                if (isConnected && address && !sessionWallet && !embeddedWallet) {
                    return (
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-6 sm:p-8 text-center max-w-md mx-auto space-y-6 py-12 shadow-2xl bg-black/40 font-sans">
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
                const webhookActiveKey = apiKeys.find((key) => !key.revoked) || null;
                const webhookKeyFingerprint = formatApiKeyFingerprint(webhookActiveKey?.secretKeyPlain)
                    || webhookActiveKey?.publishableKey
                    || "No active API key";

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

                            <div className="grid gap-3 rounded-2xl border border-white/5 bg-black/25 p-4 text-[10px] font-sans sm:grid-cols-3">
                                <div>
                                    <p className="font-bold uppercase tracking-wider text-white/30">Merchant wallet</p>
                                    <p className="mt-1 break-all font-mono text-white/70">{sessionWallet || "Not authenticated"}</p>
                                </div>
                                <div>
                                    <p className="font-bold uppercase tracking-wider text-white/30">API key</p>
                                    <p className="mt-1 break-all font-mono text-white/70">{webhookKeyFingerprint}</p>
                                </div>
                                <div>
                                    <p className="font-bold uppercase tracking-wider text-white/30">Webhook access</p>
                                    <p className="mt-1 text-white/70">{isPremium ? "Premium enabled" : "Premium required"}</p>
                                </div>
                            </div>

                            {/* Add endpoint form */}
                            <form onSubmit={handleAddWebhook} className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                                <input
                                    type="url"
                                    placeholder="https://yourserver.com/api/webhooks"
                                    value={webhookUrlInput}
                                    onChange={(e) => setWebhookUrlInput(e.target.value)}
                                    required
                                    className="flex-1 w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#00d2b4] transition-colors font-sans"
                                />
                                <button
                                    type="submit"
                                    disabled={isAddingWebhook || !webhookUrlInput}
                                    className="px-6 py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/80 disabled:opacity-50 text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 w-full sm:w-auto shrink-0"
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
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="font-mono text-xs font-bold text-white break-all">{ep.url}</p>
                                                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
                                                        ep.active
                                                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                                            : "border-red-500/20 bg-red-500/10 text-red-400"
                                                    }`}>
                                                        {ep.active ? "Active" : "Inactive"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 text-[10px] text-white/40">
                                                    <span>Secret: </span>
                                                    <code className="font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5">
                                                        {ep.secretAvailable && revealWebhookSecret === ep.id
                                                            ? ep.secret
                                                            : "whsec_••••••••"}
                                                    </code>
                                                    {ep.secretAvailable && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={() => setRevealWebhookSecret(prev => prev === ep.id ? null : ep.id)}
                                                                className="text-[#00d2b4] hover:underline"
                                                            >
                                                                {revealWebhookSecret === ep.id ? "Hide" : "Reveal"}
                                                            </button>
                                                            {revealWebhookSecret === ep.id && <button
                                                            type="button"
                                                            onClick={() => handleCopy(ep.secret, "Webhook Secret")}
                                                            className="text-white/40 hover:text-white"
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                            </button>}
                                                        </>
                                                    )}
                                                </div>
                                                <p className="text-[10px] text-white/35">
                                                    {ep.latestDelivery
                                                        ? <>Last delivery: <span className="font-mono text-white/60">{ep.latestDelivery.event}</span> · HTTP {ep.latestDelivery.status ?? "pending"} · {ep.latestDelivery.lastAttemptAt ? new Date(ep.latestDelivery.lastAttemptAt).toLocaleString() : "time unavailable"}</>
                                                        : "No deliveries recorded for this endpoint yet."}
                                                </p>
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

                        <div className="liquid-glass space-y-4 rounded-3xl border border-[#00d2b4]/20 bg-[#00d2b4]/[0.03] p-6 shadow-2xl">
                            <div>
                                <h2 className="text-sm font-bold uppercase tracking-wider text-white">Webhook health checks</h2>
                                <p className="mt-1 text-[11px] text-white/40">
                                    Send signed sample events to every active endpoint, or resend the newest real delivery.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {([
                                    ["test", "Send test webhook"],
                                    ["payment.succeeded", "Send test payment.succeeded"],
                                    ["subscription.created", "Send test subscription.created"],
                                ] as const).map(([eventType, label]) => (
                                    <button
                                        key={eventType}
                                        type="button"
                                        onClick={() => handleSendWebhookTest(eventType)}
                                        disabled={Boolean(isTestingWebhook) || webhookEndpoints.every((endpoint) => !endpoint.active)}
                                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white transition-colors hover:border-[#00d2b4]/30 hover:bg-[#00d2b4]/10 disabled:opacity-40"
                                    >
                                        {isTestingWebhook === eventType ? "Sending…" : label}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => handleReplayWebhook()}
                                    disabled={isReplaying || webhookEvents.length === 0}
                                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white transition-colors hover:border-[#00d2b4]/30 hover:bg-[#00d2b4]/10 disabled:opacity-40"
                                >
                                    {isReplaying ? "Resending…" : "Resend latest event"}
                                </button>
                            </div>
                            {replayStatus && (
                                <p className="rounded-xl border border-white/5 bg-black/30 px-3 py-2 text-[10px] text-white/60">{replayStatus}</p>
                            )}
                        </div>

                        {/* Event Feed and Inspector */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
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
                                            (() => {
                                                const webhookPageSize = 5;
                                                const paginatedWebhooks = webhookEvents.slice(webhooksPage * webhookPageSize, (webhooksPage + 1) * webhookPageSize);
                                                return paginatedWebhooks.map((item) => (
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
                                                ));
                                            })()
                                        )}
                                    </div>

                                    {(() => {
                                        const webhookPageSize = 5;
                                        const totalPages = Math.ceil(webhookEvents.length / webhookPageSize);
                                        if (totalPages <= 1) return null;
                                        return (
                                            <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 font-sans">
                                                <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">
                                                    Page {webhooksPage + 1} of {totalPages}
                                                </span>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={webhooksPage === 0}
                                                        onClick={() => setWebhooksPage((p) => Math.max(0, p - 1))}
                                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                                    >
                                                        Prev
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={webhooksPage >= totalPages - 1}
                                                        onClick={() => setWebhooksPage((p) => Math.min(totalPages - 1, p + 1))}
                                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                                    >
                                                        Next
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}
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
        }
    };

    return (
        <div data-mounted={isMounted} className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white border-t-4 border-[#00d2b4]">
            <AnimatedGradientBg variant="dashboard" />
            <div className="relative z-10">
            {/* Session Consent Alerts Overlay */}
            {sessionAlert && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
                    <div className="liquid-glass border border-white/10 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center space-y-6 relative overflow-hidden bg-[#0d0d0d] shadow-2xl">
                        <div className="space-y-2">
                            <span className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 mb-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            </span>
                            <h2 className="text-lg font-extrabold uppercase tracking-wider text-white">
                                {sessionAlert === "role_missing" && "Account Incomplete"}
                                {sessionAlert === "wrong_role" && "Incorrect Dashboard"}
                                {sessionAlert === "wallet_mismatch" && "Wallet Mismatch"}
                            </h2>
                            <p className="text-xs text-white/50 leading-relaxed font-sans font-normal">
                                {sessionAlert === "role_missing" && "Your active profile is missing an assigned role. Please complete your registration."}
                                {sessionAlert === "wrong_role" && "This is the Enterprise Merchant dashboard, but your session is registered as an Individual User."}
                                {sessionAlert === "wallet_mismatch" && "Your connected wallet address does not match your active session. Please sign in again."}
                            </p>
                        </div>

                        <button
                            onClick={async () => {
                                if (sessionAlert === "role_missing") {
                                    window.location.href = getDashboardUrl("USER", "/signup?completeRole=1");
                                } else if (sessionAlert === "wrong_role") {
                                    window.location.href = getDashboardUrl("USER", "/user");
                                } else {
                                    await fetch("/api/auth/logout", { method: "POST" });
                                    window.location.href = getDashboardUrl("USER", "/login");
                                }
                            }}
                            className="w-full py-3 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                        >
                            {sessionAlert === "role_missing" && "Complete Account Setup"}
                            {sessionAlert === "wrong_role" && "Switch to User Dashboard"}
                            {sessionAlert === "wallet_mismatch" && "Return to Login"}
                        </button>
                    </div>
                </div>
            )}
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
                merchantAlias={merchantAlias}
                onDnsClick={handleDnsClick}
                activeTab={activeTab}
                onBackToOverview={() => setActiveTab('overview')}
                onProfileClick={() => setActiveTab('settings')}
                profilePic={userSettings?.profilePic || null}
            />

            {/* Dashboard Content */}
            <main className="max-w-7xl mx-auto px-6 pt-28 pb-12">
                {/* Header Row */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 pb-6 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        {!["overview", "analytics", "apikeys", "checkout"].includes(activeTab) && (
                            <button
                                onClick={() => setActiveTab("overview")}
                                className="md:hidden p-2.5 text-white/60 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-full transition-all"
                                title="Back to Overview"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                            </button>
                        )}
                        <div>
                            <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2 flex flex-wrap items-center gap-3">
                                Merchant Control <span className="font-serif italic lowercase font-normal text-[#00d2b4]">center</span>
                                {isConnected && userSettings && (
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                        !userSettings.verified
                                            ? "bg-amber-500/10 text-amber-300 border border-amber-500/25"
                                            : userSettings.tier === "PREMIUM"
                                            ? "bg-purple-500/10 text-purple-300 border border-purple-500/25"
                                            : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/25"
                                    }`}>
                                        {!userSettings.verified
                                            ? "Unverified"
                                            : userSettings.tier === "PREMIUM"
                                            ? "Premium"
                                            : "Verified"}
                                    </span>
                                )}
                            </h1>
                            <p className="text-xs text-white/50 font-sans">
                                Manage your premium subscriptions, payments, allowances, and billing analytics.
                            </p>
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <DashboardSkeleton activeTab={activeTab} />
                ) : !isConnected ? (
                    <div className="space-y-8">
                        <div className="liquid-glass border border-yellow-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl bg-yellow-500/[0.03] flex flex-col items-center justify-center text-center gap-6 max-w-2xl mx-auto py-12">
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
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-12 lg:grid-cols-4 gap-6 md:gap-8 items-start">
                        {/* Sidebar Navigation */}
                        <div className="hidden md:block md:col-span-1 lg:col-span-1 space-y-2">
                            {tabs.map((tab) => {
                                const hasHref = "href" in tab;
                                const isSelected = activeTab === (tab.id as any);
                                const itemClasses = `w-full flex items-center justify-center lg:justify-start gap-3.5 px-4 py-4 lg:px-5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border text-left ${
                                    isSelected
                                        ? tab.id === "premium"
                                            ? "bg-[#d4a853]/10 border-[#d4a853]/30 text-white shadow-lg shadow-[#d4a853]/5"
                                            : "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-white shadow-lg shadow-[#00d2b4]/5"
                                        : "bg-white/[0.01] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.03]"
                                }`;
                                
                                const iconClasses = `w-4 h-4 shrink-0 ${
                                    isSelected
                                        ? tab.id === "premium" ? "text-[#d4a853]" : "text-[#00d2b4]"
                                        : "text-white/40"
                                }`;

                                const content = (
                                    <>
                                        <tab.icon className={iconClasses} />
                                        <span className="hidden lg:inline">{tab.label}</span>
                                        {tab.id === "premium" && isPremium && (
                                            <span className="hidden lg:inline-flex ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#d4a853]/10 text-[#d4a853] border border-[#d4a853]/20">PRO</span>
                                        )}
                                    </>
                                );

                                if (hasHref) {
                                    return (
                                        <Link
                                            key={tab.id}
                                            href={tab.href!}
                                            className={itemClasses}
                                            title={tab.label}
                                        >
                                            {content}
                                        </Link>
                                    );
                                }

                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as TabId)}
                                        className={itemClasses}
                                        title={tab.label}
                                    >
                                        {content}
                                    </button>
                                );
                            })}

                            <a
                                href="/support"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center justify-center lg:justify-start gap-3.5 px-4 py-4 lg:px-5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border text-left bg-white/[0.01] border-white/5 text-white/50 hover:text-white hover:bg-[#00d2b4]/5 hover:border-[#00d2b4]/20"
                                title="Help & Support"
                            >
                                <HelpCircle className="w-4 h-4 shrink-0 text-white/40" />
                                <span className="hidden lg:inline">Support</span>
                            </a>
                        </div>

                        {/* View Content */}
                        <div className="md:col-span-11 lg:col-span-3 min-h-[500px]">
                            {/* Keyed enter-only animation — deliberately NO AnimatePresence/exit here.
                                mode="wait" gated the incoming tab on the outgoing exit spring, which
                                dropped the presence on interrupted switches (slow mobile frames) and
                                left the content area blank. */}
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 15, scale: 0.985 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: "spring", stiffness: 340, damping: 28, bounce: 0.16 }}
                            >
                                {renderView()}
                            </motion.div>
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
                payoutDestination={userSettings?.payoutDestination || payoutDestination}
                onConfirmWithdraw={async (targetAddress) => {
                    await handleWithdraw(targetAddress);
                    setIsWithdrawOpen(false);
                }}
                isWithdrawing={isWithdrawing}
                isPremium={isPremium}
            />
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={!!embeddedWallet}
                depositAddress={address || ""}
                onSuccess={handleDepositSuccess}
                executeContractWrite={executeContractWrite}
            />
            <SharePlanModal
                isOpen={sharingPlan !== null}
                onClose={() => setSharingPlan(null)}
                plan={sharingPlan}
                subscribeUrl={sharingPlan ? buildSubscribeUrl(sharingPlan.id, typeof window !== "undefined" ? window.location.origin : undefined) : ""}
            />
            {activeQrCodeLink && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md font-sans">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="liquid-glass border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative space-y-6 text-center"
                    >
                        {/* Close button */}
                        <button
                            onClick={() => {
                                setActiveQrCodeLink(null);
                                setActiveQrCodeTitle("");
                            }}
                            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-all"
                        >
                            <span className="sr-only">Close</span>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        <div className="space-y-1">
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center justify-center gap-2">
                                <QrCode className="w-4 h-4 text-[#00d2b4]" />
                                Payment Link QR Code
                            </h3>
                            <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider truncate px-4">
                                {activeQrCodeTitle}
                            </p>
                        </div>

                        {/* QR Code display */}
                        <div className="flex justify-center p-4 bg-white rounded-2xl mx-auto w-fit">
                            <QRCode
                                value={activeQrCodeLink}
                                size={180}
                                ecLevel="H"
                                bgColor="#ffffff"
                                fgColor="#000000"
                                qrStyle="dots"
                                eyeRadius={[
                                    [10, 10, 0, 10], // Top-left eye
                                    [10, 10, 10, 0], // Top-right eye
                                    [10, 0, 10, 10]  // Bottom-left eye
                                ]}
                                logoImage="/logo.png"
                                logoWidth={38}
                                logoHeight={38}
                                removeQrCodeBehindLogo={true}
                                logoPadding={2}
                            />
                        </div>

                        {/* Link Display and Copy Action */}
                        <div className="space-y-2">
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider text-left">Checkout URL</p>
                            <div className="bg-black/40 border border-white/5 rounded-xl p-3 flex items-center justify-between gap-3">
                                <span className="text-[11px] font-mono text-white/70 truncate text-left flex-1">
                                    {activeQrCodeLink}
                                </span>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(activeQrCodeLink);
                                    }}
                                    className="p-1.5 text-[#00d2b4] hover:text-[#00d2b4]/80 rounded-lg hover:bg-[#00d2b4]/5 transition-all flex-shrink-0"
                                    title="Copy URL"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
            {confirmModal && (
                <ConfirmModal
                    open={confirmModal.open}
                    title={confirmModal.title}
                    description={confirmModal.description}
                    confirmLabel={confirmModal.confirmLabel}
                    cancelLabel={confirmModal.cancelLabel}
                    variant={confirmModal.variant}
                    onConfirm={confirmModal.onConfirm}
                    onCancel={confirmModal.onCancel ?? (() => setConfirmModal(null))}
                />
            )}
            {/* High-fidelity glassmorphic toast notification for settlement confirmation */}
                            {showToast && (
                                <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 liquid-glass border border-emerald-500/30 bg-black/60 rounded-2xl px-6 py-4 flex items-center gap-3 shadow-[0_8px_32px_0_rgba(0,210,180,0.2)]">
                                    <Zap className="w-5 h-5 text-[#00d2b4] fill-[#00d2b4]/25 shrink-0" />
                                    <span className="text-xs font-bold uppercase tracking-wider text-white">
                                        {toastMessage}
                                    </span>
                                </div>
                            )}

                            {/* Floating Mobile Bottom Navigation Bar (Blueprint aligned) */}
                            {isConnected && (mobileBottomTabs.some((tab) => tab.id === activeTab) || activeTab === "checkout") && (
                            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex w-[calc(100%-0.75rem)] max-w-sm items-center justify-between gap-2 md:hidden">
                                {/* Capsule Navigation Menu */}
                                <div className="flex min-w-0 flex-1 items-center justify-around liquid-glass rounded-full border border-white/5 bg-black/60 px-2 py-3.5 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-xl">
                                    <LiquidGlassEffect />
                                    {mobileBottomTabs.map((tab) => (
                                        <AnimatedBottomNavButton
                                            key={tab.id}
                                            label={tab.label}
                                            icon={tab.icon}
                                            active={activeTab === tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                        />
                                    ))}
                                </div>

                                {/* Checkout Icon Outside Bottom Bar Capsule */}
                                <button
                                    onClick={() => setActiveTab("checkout")}
                                    className={`flex h-11 shrink-0 items-center justify-center overflow-hidden rounded-full border px-2 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 gap-2 ${
                                        activeTab === "checkout"
                                            ? "w-[104px] scale-105 border-[#00d2b4]/30 bg-[#00d2b4] text-[#111111] shadow-[0_0_15px_rgba(0,210,180,0.3)] min-[360px]:w-[124px]"
                                            : "w-11 border-white/5 bg-black/60 text-white/50 hover:text-white"
                                    }`}
                                    title="Checkout Setup"
                                >
                                    <Code2 className="w-5 h-5 shrink-0" />
                                    {activeTab === "checkout" && (
                                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide transition-opacity duration-300 min-[360px]:text-[10px] min-[360px]:tracking-wider">
                                            Checkout
                                        </span>
                                    )}
                                </button>
                            </div>
                            )}
                        </div>
                    );
                }

function MerchantPlanRow({
    plan,
    busy,
    onToggle,
    onShare,
    promotion = null,
    onPromotionsChanged,
}: {
    plan: MerchantPlan;
    busy: boolean;
    onToggle: (plan: MerchantPlan) => void;
    onShare: (plan: MerchantPlan) => void;
    promotion?: PlanPromotion | null;
    onPromotionsChanged?: () => void;
}) {
    const [copied, setCopied] = useState(false);
    const subscribeUrl = buildSubscribeUrl(plan.id, typeof window !== "undefined" ? window.location.origin : undefined);

    const handleCopy = () => {
        navigator.clipboard.writeText(subscribeUrl).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div data-testid="merchant-plan-row" className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 w-full">
                    <p className="truncate text-sm font-black uppercase tracking-[0.08em] text-white">{plan.name}</p>
                    <p className="mt-1 text-xs font-bold text-[#00d2b4]">
                        {formatPlanAmount(plan.amountUsdc)} USDC / {formatPlanPeriod(plan.periodSeconds)}
                    </p>
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-white/30">
                        {plan.targetSubscriber
                            ? `${plan.active ? "Assigned API offer" : "Assigned offer closed"} for ${plan.targetSubscriber.slice(0, 6)}...${plan.targetSubscriber.slice(-4)}`
                            : plan.active ? "Live, accepting subscribers" : "Hidden from new subscribers"}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => onToggle(plan)}
                    disabled={busy}
                    className={`inline-flex w-full shrink-0 items-center justify-center rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-50 sm:w-auto ${
                        plan.active
                            ? "border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/15"
                            : "border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4] hover:bg-[#00d2b4]/15"
                    }`}
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : plan.active ? "Deactivate" : "Reactivate"}
                </button>
            </div>

            {(plan.description || plan.detailsUrl) && (
                <div className="mt-3 space-y-1.5">
                    {plan.description && (
                        <p className="whitespace-pre-line text-[11px] leading-relaxed text-white/55">{plan.description}</p>
                    )}
                    {plan.detailsUrl && (
                        <a
                            href={plan.detailsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-[#00d2b4] transition hover:text-[#00d2b4]/80"
                        >
                            View more ↗
                        </a>
                    )}
                </div>
            )}

            {plan.active && !plan.targetSubscriber && (
                <div data-testid="merchant-plan-link-strip" className="mt-3 grid min-w-0 gap-2 overflow-hidden rounded-xl border border-white/5 bg-black/30 p-2 sm:flex sm:items-center sm:px-3 sm:py-2">
                    <span className="block min-w-0 max-w-full truncate border-b border-white/5 pb-1.5 font-mono text-[10px] text-white/45 sm:flex-1 sm:border-none sm:pb-0">{subscribeUrl}</span>
                    <div className="grid w-full min-w-0 grid-cols-2 gap-2 pt-1 sm:flex sm:w-auto sm:items-center sm:justify-end sm:pt-0">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#00d2b4]/20 bg-[#00d2b4]/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#00d2b4] transition hover:bg-[#00d2b4]/20 sm:flex-none sm:shrink-0 sm:px-3"
                            title={copied ? "Copied!" : "Copy subscribe link"}
                        >
                            {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{copied ? "Copied" : "Copy link"}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onShare(plan)}
                            className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white/80 transition hover:bg-white/10 hover:text-white sm:flex-none sm:shrink-0 sm:px-3"
                            title="Create sharing poster card"
                        >
                            <Share2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">Share</span>
                        </button>
                    </div>
                </div>
            )}

            {(plan.active || promotion) && (
                <PlanPromotionPanel plan={plan} promotion={promotion ?? null} onChanged={onPromotionsChanged} />
            )}
        </div>
    );
}

/* Introductory-offer controls for one plan: create, edit, activate/deactivate a promotion.
   Edits only affect FUTURE subscribers — terms already authorized are snapshotted per
   subscription and enforced on-chain, so existing subscribers never reprice. */
function PlanPromotionPanel({
    plan,
    promotion,
    onChanged,
}: {
    plan: MerchantPlan;
    promotion: PlanPromotion | null;
    onChanged?: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [promoName, setPromoName] = useState(promotion?.name || "");
    const [discountType, setDiscountType] = useState(promotion?.discountType || "PERCENT");
    const [percentOff, setPercentOff] = useState(
        promotion?.discountBps ? String(promotion.discountBps / 100) : "40",
    );
    const [introPriceUsdc, setIntroPriceUsdc] = useState(
        promotion && promotion.discountType === "FIXED_PRICE"
            ? formatPlanAmount(promotion.introductoryAmountUsdc)
            : "",
    );
    const [introCycles, setIntroCycles] = useState(String(promotion?.introductoryCycles || 1));
    const [expiresAt, setExpiresAt] = useState(
        promotion?.expiresAt ? promotion.expiresAt.slice(0, 16) : "",
    );
    const [maxRedemptions, setMaxRedemptions] = useState(
        promotion?.maxRedemptions ? String(promotion.maxRedemptions) : "",
    );
    const [newCustomersOnly, setNewCustomersOnly] = useState(promotion?.newCustomersOnly ?? true);

    const regularMicros = (() => {
        try { return BigInt(plan.amountUsdc); } catch { return BigInt(0); }
    })();
    const previewIntroMicros = (() => {
        if (discountType === "FREE_TRIAL") return BigInt(0);
        if (discountType === "PERCENT") {
            const pct = Number(percentOff);
            if (!Number.isFinite(pct) || pct < 1 || pct > 100) return null;
            return (regularMicros * BigInt(10000 - Math.round(pct * 100))) / BigInt(10000);
        }
        const price = Number(introPriceUsdc);
        if (!Number.isFinite(price) || price < 0) return null;
        return BigInt(Math.round(price * 1_000_000));
    })();
    const cadence = formatPlanPeriod(plan.periodSeconds);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        if (!promoName.trim()) { setError("Promotion name is required."); return; }
        if (previewIntroMicros === null) { setError("Enter a valid discount."); return; }
        if (previewIntroMicros >= regularMicros) { setError("Introductory price must be below the regular price."); return; }
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: promoName.trim(),
                discountType,
                introductoryCycles: Number(introCycles) || 1,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
                maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
                newCustomersOnly,
            };
            if (discountType === "PERCENT") payload.percentOff = Number(percentOff);
            if (discountType === "FIXED_PRICE") payload.introPriceUsdc = introPriceUsdc;
            const res = await fetch("/api/merchant/promotions", {
                method: promotion ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(promotion ? { ...payload, promotionId: promotion.id } : { ...payload, planId: plan.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to save promotion.");
            setEditing(false);
            onChanged?.();
        } catch (err: any) {
            setError(err.message || "Failed to save promotion.");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async () => {
        if (!promotion) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/merchant/promotions", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ promotionId: promotion.id, active: !promotion.active }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to update promotion.");
            onChanged?.();
        } catch (err: any) {
            setError(err.message || "Failed to update promotion.");
        } finally {
            setSaving(false);
        }
    };

    const summaryLabel = promotion
        ? promotion.discountType === "FREE_TRIAL"
            ? `Free for the first ${promotion.introductoryCycles > 1 ? `${promotion.introductoryCycles} cycles` : cadence}`
            : promotion.discountType === "PERCENT"
                ? `${(promotion.discountBps || 0) / 100}% off → ${formatPlanAmount(promotion.introductoryAmountUsdc)} USDC for ${promotion.introductoryCycles > 1 ? `${promotion.introductoryCycles} cycles` : `the first ${cadence}`}`
                : `${formatPlanAmount(promotion.introductoryAmountUsdc)} USDC for ${promotion.introductoryCycles > 1 ? `${promotion.introductoryCycles} cycles` : `the first ${cadence}`}`
        : null;

    return (
        <div data-testid="plan-promotion-panel" className="mt-3 rounded-xl border border-amber-300/10 bg-amber-400/[0.03] p-3 font-sans">
            {!editing && promotion && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-300/70">
                            Promotion · {promotion.active ? "Live" : "Off"} · {promotion.redemptionCount}{promotion.maxRedemptions ? `/${promotion.maxRedemptions}` : ""} redeemed
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-bold text-white/80">{promotion.name}: {summaryLabel}, then {formatPlanAmount(plan.amountUsdc)} USDC / {cadence}</p>
                        {promotion.expiresAt && (
                            <p className="text-[9px] text-white/35">Offer ends {new Date(promotion.expiresAt).toLocaleDateString()}</p>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => setEditing(true)} disabled={saving}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white/70 transition hover:text-white disabled:opacity-50">
                            Edit
                        </button>
                        <button type="button" onClick={toggleActive} disabled={saving}
                            className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition disabled:opacity-50 ${promotion.active ? "border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/15" : "border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4] hover:bg-[#00d2b4]/15"}`}>
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : promotion.active ? "Turn off" : "Turn on"}
                        </button>
                    </div>
                </div>
            )}

            {!editing && !promotion && plan.active && (
                <button type="button" onClick={() => setEditing(true)}
                    className="w-full rounded-lg border border-dashed border-amber-300/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-200/70 transition hover:border-amber-300/40 hover:text-amber-200">
                    + Add introductory offer (discount or free trial)
                </button>
            )}

            {editing && (
                <form onSubmit={submit} className="space-y-3 text-xs">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Offer name</label>
                            <input type="text" value={promoName} onChange={(e) => setPromoName(e.target.value)} placeholder="Launch offer"
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Offer type</label>
                            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none">
                                <option value="PERCENT">Percentage off</option>
                                <option value="FIXED_PRICE">Fixed intro price</option>
                                <option value="FREE_TRIAL">Free trial</option>
                            </select>
                        </div>
                        {discountType === "PERCENT" && (
                            <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Percent off (customer pays the rest)</label>
                                <input type="number" min="1" max="100" step="1" value={percentOff} onChange={(e) => setPercentOff(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                            </div>
                        )}
                        {discountType === "FIXED_PRICE" && (
                            <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Intro price (USDC)</label>
                                <input type="number" min="0" step="0.01" value={introPriceUsdc} onChange={(e) => setIntroPriceUsdc(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                            </div>
                        )}
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Discounted cycles</label>
                            <input type="number" min="1" max="36" value={introCycles} onChange={(e) => setIntroCycles(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Offer ends (optional)</label>
                            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase tracking-wide text-white/50">Max redemptions (optional)</label>
                            <input type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="Unlimited"
                                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white focus:border-[#00d2b4] focus:outline-none" />
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-[10px] text-white/60">
                        <input type="checkbox" checked={newCustomersOnly} onChange={(e) => setNewCustomersOnly(e.target.checked)} className="accent-[#00d2b4]" />
                        New customers only (subscribers who never had a plan with you)
                    </label>
                    {previewIntroMicros !== null && previewIntroMicros < regularMicros && (
                        <p className="rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-[10px] text-white/60">
                            Customers pay <span className="font-bold text-[#00d2b4]">{formatPlanAmount(previewIntroMicros.toString())} USDC</span>
                            {Number(introCycles) > 1 ? ` per ${cadence} for ${introCycles} cycles` : " today"}, then{" "}
                            <span className="font-bold text-white/85">{formatPlanAmount(plan.amountUsdc)} USDC / {cadence}</span>. Both prices are
                            disclosed and authorized at checkout; the switch to full price is enforced on-chain.
                        </p>
                    )}
                    {error && <p className="text-[10px] font-bold text-red-400">{error}</p>}
                    <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => { setEditing(false); setError(null); }} disabled={saving}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white/60 transition hover:text-white disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="rounded-lg bg-[#00d2b4] px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-black transition hover:bg-[#00d2b4]/85 disabled:opacity-50">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : promotion ? "Save changes" : "Launch offer"}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}

function LocalCustomerVaultRow({
    vault,
    apiKey,
    onRefresh,
}: {
    vault: any;
    apiKey: string;
    onRefresh: () => void;
}) {
    const [chargeAmount, setChargeAmount] = useState("1.50");
    const [loading, setLoading] = useState(false);
    const [reviewingCharge, setReviewingCharge] = useState(false);
    const usageRequestKey = useRef<string | null>(null);
    const usageInFlight = useRef(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);

    const handleReportUsage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) {
            setStatus({ text: "A newly revealed secret key is required for live usage reporting. Roll or create an API key and copy it while it is shown.", type: "error" });
            return;
        }

        if (!reviewingCharge) {
            setStatus(null);
            setReviewingCharge(true);
            return;
        }
        if (!chargeAmount || isNaN(Number(chargeAmount)) || Number(chargeAmount) <= 0) {
            setStatus({ text: "Invalid usage amount.", type: "error" });
            return;
        }

        if (usageInFlight.current) return;
        usageInFlight.current = true;
        usageRequestKey.current ||= crypto.randomUUID();

        setLoading(true);
        setStatus(null);

        try {
            const res = await fetch("/api/user/vault/report-usage", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "x-request-id": usageRequestKey.current,
                },
                body: JSON.stringify({
                    userAddress: vault.userAddress,
                    amountUsdc: chargeAmount
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setStatus({
                    text: `Usage charge accrued. Cycle total: ${formatUsdcMicros(data.accruedUsageUsdc)} USDC.`,
                    type: "success"
                });
                setReviewingCharge(false);
                usageRequestKey.current = null;
                onRefresh();
            } else {
                setStatus({ text: data.error || "Usage report failed.", type: "error" });
            }
        } catch (err: any) {
            setStatus({ text: err.message || "Failed to report usage.", type: "error" });
        } finally {
            usageInFlight.current = false;
            setLoading(false);
        }
    };

    const cycleStart = vault.cycleStart ? new Date(vault.cycleStart).toLocaleDateString() : "Not started";
    const owedMicros = microsToNumber(vault.owedUsdc);
    const isActive = Boolean(vault.active);

    return (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-black/20 hover:bg-black/35 hover:border-white/10 transition p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <p className="font-mono text-xs font-bold text-white break-all">{vault.userAddress}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                            isActive ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}>
                            {isActive ? "Active" : "Inactive"}
                        </span>
                    </div>
                    <p className="text-[10px] text-white/30 mt-1">
                        Vault cycle start: <span className="text-white/50">{cycleStart}</span>
                    </p>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div>
                        <span className="text-[8px] text-white/30 uppercase tracking-wider block font-bold">Escrow Balance</span>
                        <p className="text-sm font-black text-[#ccff00] mt-1">${formatUsdcMicros(vault.balanceUsdc)}</p>
                    </div>
                    <div>
                        <span className="text-[8px] text-white/30 uppercase tracking-wider block font-bold">Escrow Commit</span>
                        <p className="text-sm font-black text-white mt-1">${formatUsdcMicros(vault.commitUsdc)}</p>
                    </div>
                    <div>
                        <span className="text-[8px] text-white/30 uppercase tracking-wider block font-bold">Accrued Usage</span>
                        <p className="text-sm font-black text-[#00d2b4] mt-1">${formatUsdcMicros(vault.accruedUsageUsdc)}</p>
                    </div>
                    <div>
                        <span className="text-[8px] text-white/30 uppercase tracking-wider block font-bold">Owed Debt</span>
                        <p className={`text-sm font-black mt-1 ${owedMicros > 0 ? "text-red-300" : "text-white"}`}>${formatUsdcMicros(vault.owedUsdc)}</p>
                    </div>
                </div>
            </div>

            {/* Live usage accrual tool */}
            <form onSubmit={handleReportUsage} className="flex flex-col sm:flex-row gap-3 sm:items-end border-t border-white/5 pt-3">
                <label className="flex-1 space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Accrue live usage charge (USDC)</span>
                    <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        disabled={loading}
                        value={chargeAmount}
                        onChange={(e) => { setChargeAmount(e.target.value); setReviewingCharge(false); setStatus(null); usageRequestKey.current = null; }}
                        className="w-full max-w-xs bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-[#00d2b4] transition text-xs font-mono disabled:opacity-50"
                        placeholder="1.50"
                    />
                </label>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 text-[9px] font-bold uppercase tracking-wider text-white rounded-xl flex items-center justify-center gap-1.5 transition-all"
                >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 text-[#ccff00]" />}
                    {reviewingCharge ? "Confirm live charge" : "Review charge"}
                </button>
            </form>

            {reviewingCharge && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[10px] leading-relaxed text-amber-200/80">
                    This will add <strong>{Number(chargeAmount).toFixed(2)} USDC</strong> to the customer&apos;s live accrued usage for this billing cycle. It is not a test. Review the customer address above before confirming.
                    <button type="button" onClick={() => setReviewingCharge(false)} className="mt-2 block font-bold uppercase tracking-wider text-white/60 hover:text-white">Back to edit</button>
                </div>
            )}

            {status && (
                <p className={`text-[9px] font-bold tracking-wide ${
                    status.type === "success" ? "text-emerald-400" : "text-red-400"
                }`}>
                    {status.text}
                </p>
            )}
        </div>
    );
}
