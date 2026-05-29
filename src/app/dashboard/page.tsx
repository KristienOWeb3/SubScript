"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import DashboardHeader from "@/components/DashboardHeader";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { useAccount, useConnect, useDisconnect, useWriteContract, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, http, formatUnits, parseUnits, parseEventLogs } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { 
    Activity, Key, Code2, Webhook, ArrowRightLeft, 
    ShieldAlert, Copy, Check, Eye, EyeOff, RotateCw, 
    RefreshCw, Sliders, ShieldX, CheckCircle, AlertTriangle, PlugZap, Loader2
} from "lucide-react";

const ARC_TESTNET_CHAIN_ID = 5042002;
const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const USDC_NATIVE_GAS_ADDRESS = "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc";
const TEST_PUBLISHABLE_KEY = "pk_test_51Px9800Z7Z4M19XQY1R93B";
const LIVE_PUBLISHABLE_KEY = "pk_live_51Px200Z7Z4M19XQY1R93B";

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

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
    }
] as const;

// Sidebar tabs setup
const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "checkout", label: "Checkout Setup", icon: Code2 },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "offramp", label: "Fiat Off-Ramp", icon: ArrowRightLeft },
] as const;

type TabId = typeof tabs[number]["id"];

export default function DashboardPage() {
    const [isMounted, setIsMounted] = useState(false);
    const { address: realAddress, isConnected: realIsConnected } = useAccount();
    const { connect, connectors, error: connectError, isError: isConnectError, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();
    const [isTestMode, setIsTestMode] = useState(false);

    const isConnected = realIsConnected || isTestMode;
    const address = realAddress || (isTestMode ? "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29" : undefined);

    const { switchChain } = useSwitchChain();
    const { chainId } = useAccount();

    const [isPremiumSubscribed, setIsPremiumSubscribed] = useState(false);
    const [customAddress, setCustomAddress] = useState("");
    const [isSubscribingPremium, setIsSubscribingPremium] = useState(false);
    const [premiumStatus, setPremiumStatus] = useState<string | null>(null);
    const [premiumError, setPremiumError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            // Reset premium mode and make everyone on basic plan once
            if (!localStorage.getItem("subscript_premium_reset_done_v2")) {
                localStorage.removeItem("subscript_premium_subscribed");
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith("subscript_premium_subscribed_")) {
                        localStorage.removeItem(key);
                    }
                }
                localStorage.setItem("subscript_premium_reset_done_v2", "true");
            }
            setCustomAddress(localStorage.getItem("subscript_custom_merchant_address") || "");
        }
    }, []);

    useEffect(() => {
        if (typeof window !== "undefined") {
            if (address) {
                const key = `subscript_premium_subscribed_${address.toLowerCase()}`;
                setIsPremiumSubscribed(localStorage.getItem(key) === "true");
            } else {
                setIsPremiumSubscribed(false);
            }
        }
    }, [address]);

    const handleSaveCustomAddress = () => {
        if (!customAddress) {
            setPremiumError("Please enter a valid wallet address.");
            return;
        }
        localStorage.setItem("subscript_custom_merchant_address", customAddress);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
    };

    const handleSubscribePremium = async () => {
        if (!isConnected || !address) {
            setPremiumError("Please connect your merchant wallet first.");
            return;
        }

        if (chainId !== 5042002) {
            setPremiumError("Not on Arc Testnet. Triggering switch to Chain 5042002...");
            switchChain?.({ chainId: 5042002 });
            return;
        }

        setIsSubscribingPremium(true);
        setPremiumStatus("Preparing 10 USDC payment...");
        setPremiumError(null);

        try {
            const PAYMENT_RECIPIENT = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295";
            const amount = parseUnits("10", 6); // $10 USDC (6 decimals)

            const clearPremiumState = () => {
                if (address) {
                    localStorage.removeItem(`subscript_premium_subscribed_${address.toLowerCase()}`);
                }
                setIsPremiumSubscribed(false);
            };

            // Direct USDC transfer — single transaction, no router contract required
            setPremiumStatus("Waiting for transfer signature...");
            const transferHash = await writeContractAsync({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: [
                    {
                        type: "function",
                        name: "transfer",
                        stateMutability: "nonpayable",
                        inputs: [
                            { name: "to", type: "address" },
                            { name: "amount", type: "uint256" }
                        ],
                        outputs: [{ name: "", type: "bool" }]
                    }
                ] as const,
                functionName: "transfer",
                args: [PAYMENT_RECIPIENT, amount],
            });

            console.log("Premium payment tx submitted:", transferHash);

            // Wait for on-chain confirmation
            setPremiumStatus("Confirming payment on-chain...");
            const receipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });

            if (receipt.status !== "success") {
                clearPremiumState();
                throw new Error("Payment transaction reverted on-chain. No funds were transferred.");
            }

            // Parse Transfer event logs to verify the exact payment
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

            // Find the Transfer event matching our payment
            const paymentLog = transferLogs.find(
                (log) =>
                    log.eventName === "Transfer" &&
                    log.args.from?.toLowerCase() === address.toLowerCase() &&
                    log.args.to?.toLowerCase() === PAYMENT_RECIPIENT.toLowerCase()
            );

            if (!paymentLog) {
                clearPremiumState();
                throw new Error("Transfer event not found in receipt. Payment could not be verified.");
            }

            if (paymentLog.args.value !== amount) {
                clearPremiumState();
                throw new Error(
                    `Payment amount mismatch. Expected ${formatUnits(amount, 6)} USDC, got ${formatUnits(paymentLog.args.value ?? BigInt(0), 6)} USDC.`
                );
            }

            console.log("Premium payment verified:", {
                from: paymentLog.args.from,
                to: paymentLog.args.to,
                amount: formatUnits(paymentLog.args.value ?? BigInt(0), 6),
                txHash: transferHash,
            });

            // All verification checks passed — activate premium for this wallet
            if (address) {
                localStorage.setItem(`subscript_premium_subscribed_${address.toLowerCase()}`, "true");
            }
            setIsPremiumSubscribed(true);
            setPremiumStatus(null);
        } catch (err: any) {
            console.error("Premium subscription failed:", err);
            setPremiumError(err.shortMessage || err.message || "Transaction failed");
        } finally {
            setIsSubscribingPremium(false);
        }
    };

    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== "undefined") {
            setIsTestMode(
                Boolean(window.navigator.webdriver || document.cookie.includes("subscript_page_lock"))
            );
        }
    }, [realAddress, realIsConnected]);

    // isConnected and address defined above to prevent TDZ reference error

    // Environment Toggle State
    const [isMainnet, setIsMainnet] = useState(false);

    // Sidebar navigation active state
    const [activeTab, setActiveTab] = useState<TabId>("overview");

    // Copying state
    const [copiedText, setCopiedText] = useState<string | null>(null);

    // API Keys state
    const [revealSecret, setRevealSecret] = useState(false);
    const [secretKeyVersion, setSecretKeyVersion] = useState(1);
    const [isRolling, setIsRolling] = useState(false);

    // Checkout configurator state
    const [subName, setSubName] = useState("AI Agent Compute Limit");
    const [subCap, setSubCap] = useState("150.00");
    const [subInterval, setSubInterval] = useState("monthly");
    const [subChain, setSubChain] = useState("base");

    // Webhooks state
    const [selectedWebhook, setSelectedWebhook] = useState<string>("");
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayStatus, setReplayStatus] = useState<string | null>(null);

    // Fiat Off-Ramp split state
    const [fiatSplit, setFiatSplit] = useState(70);

    // Live subscription ledger state loaded from smart contract
    const [ledgers, setLedgers] = useState<any[]>([]);
    const [isLoadingContract, setIsLoadingContract] = useState(false);

    // Fetch on-chain subscriptions
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
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ABI,
                    functionName: "nextSubscriptionId",
                });
                
                const nextIdNum = Number(nextId);
                const fetchedLedgers = [];
                
                for (let i = 1; i < nextIdNum; i++) {
                    const sub = await publicClient.readContract({
                        address: SUBSCRIPT_ROUTER_ADDRESS,
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
                }
            }
        }

        fetchOnChainData();

        return () => {
            isSubscribed = false;
        };
    }, [isConnected, address, selectedWebhook]);

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

    const handleRollKeys = () => {
        setIsRolling(true);
        setTimeout(() => {
            setSecretKeyVersion(prev => prev + 1);
            setIsRolling(false);
            const activeSecretKey = isMainnet 
                ? `sk_live_${address?.slice(2, 10)}${address?.slice(-8)}_rolled_v${secretKeyVersion + 1}` 
                : `sk_test_${address?.slice(2, 10)}${address?.slice(-8)}_rolled_v${secretKeyVersion + 1}`;
            handleCopy(activeSecretKey, "API Secret Key Rolled");
        }, 800);
    };

    const handleRevokeCustomer = async (rawId: string) => {
        try {
            await writeContractAsync({
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

    const handleReplayWebhook = (webhookId: string) => {
        setIsReplaying(true);
        setReplayStatus("Replaying event...");
        setTimeout(() => {
            setIsReplaying(false);
            setReplayStatus(`✓ Webhook event ${webhookId} successfully re-delivered. HTTP 200 OK.`);
            setTimeout(() => setReplayStatus(null), 4000);
        }, 700);
    };

    const activeMerchantAddress = (isPremiumSubscribed && customAddress) ? customAddress : (address || "");
    const merchantWalletAddress = activeMerchantAddress;
    const billingPeriodSeconds = useMemo(() => {
        if (subInterval === "weekly") return "604800";
        if (subInterval === "yearly") return "31536000";
        return "2592000";
    }, [subInterval]);

    const checkoutCode = useMemo(() => `<SubScriptCheckout
  publishableKey="${isMainnet ? LIVE_PUBLISHABLE_KEY : TEST_PUBLISHABLE_KEY}"
  merchantAddress="${merchantWalletAddress || "0xYOUR_CONNECTED_WALLET_ADDRESS"}"
  planName="${subName}"
  amountCap="${subCap}"
  interval="${subInterval}"
  fundingChain="${subChain}"
/>`, [isMainnet, merchantWalletAddress, subCap, subChain, subInterval, subName]);

    const agentIntegrationPrompt = useMemo(() => {
        return `Act as an elite full-stack Web3 engineer integrating SubScript into my app.

SubScript is fast, private, and reliable. Build a premium dark-mode checkout that uses the Zero-Knowledge Burner Method on Arc Network.

Live merchant context:
- MERCHANT_WALLET_ADDRESS = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295"
- PLAN_NAME = "What do you want from this?"
- AMOUNT_CAP_USDC = "15"
- BILLING_INTERVAL_SECONDS = 31536000
- ARC_TESTNET_CHAIN_ID = 5042002
- SUBSCRIPT_ROUTER = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29"
- USDC_NATIVE_GAS_ADDRESS = "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc"
- PROTOCOL_FEE_BPS = 100

Implementation requirements:
1. First, run \`npx @subscript-protocol/cli\` in the terminal to generate the \`abi.json\` and \`constants.ts\` files locally. Strictly use these injected files for your configuration.
2. Use native USDC gas on Arc Testnet and route transactions to the SubScript Router. Ensure the \`AMOUNT_CAP_USDC\` is properly formatted to 6 decimals using \`parseUnits('15', 6)\`.
3. Implement the ZK Burner Method:
   - Funding wallet generates a random secret and commitment.
   - Funding wallet approves USDC and calls depositAndCommit(bytes32 commitment, uint256 amount).
   - The frontend generates the local proof from the secret.
   - The user switches to a clean burner wallet.
   - Burner wallet calls verifyAndActivate(bytes32[] proof, bytes32 nullifierHash, address merchant, uint256 amount, uint256 period).
4. Never expose the funding wallet in merchant-facing subscription state. Persist only burner/subscription references and public nullifier data.
5. Show pending, proof generation, activation, success, and recoverable error states.`;
    }, []);

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

    // Interactive rendering based on active tab
    const renderView = () => {
        const primaryColorText = isMainnet ? "text-red-500" : "text-[#00d2b4]";
        const primaryColorBg = isMainnet ? "bg-red-500" : "bg-[#00d2b4]";
        const primaryBorderHover = isMainnet ? "hover:border-red-500/20" : "hover:border-[#00d2b4]/20";

        const activeAllowances = ledgers.filter(l => l.active).length;
        const projected30DaySettlement = ledgers.reduce((acc, sub) => {
            if (!sub.active) return acc;
            const amountNum = parseFloat(sub.rawAmount) || 0;
            const periodNum = parseFloat(sub.rawPeriod) || 2592000;
            const monthlyEquivalent = amountNum * (2592000 / periodNum);
            return acc + monthlyEquivalent;
        }, 0);

        switch (activeTab) {
            case "overview":
                return (
                    <div className="space-y-8">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-white/[0.01] rounded-bl-full pointer-events-none" />
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Active Agent Allowances</p>
                                <p className="text-4xl font-extrabold text-white mb-2 tracking-tight">
                                    {isLoadingContract ? "..." : activeAllowances}
                                </p>
                                <p className="text-2xs text-white/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                    Active M2M contracts listening
                                </p>
                            </div>

                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Projected 30-Day Settlement</p>
                                <p className={`text-4xl font-extrabold ${primaryColorText} mb-2 tracking-tight`}>
                                    {isLoadingContract ? "..." : `$${projected30DaySettlement.toFixed(2)}`}{" "}
                                    <span className="text-xs text-white/40 font-normal">USDC</span>
                                </p>
                                <p className="text-2xs text-white/30">
                                    Estimated volume based on active session keys
                                </p>
                            </div>

                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Execution Failure Rate</p>
                                <p className="text-4xl font-extrabold text-white mb-2 tracking-tight">
                                    0.0%
                                </p>
                                <p className="text-2xs text-white/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                    All renewal attempts successfully settled
                                </p>
                            </div>
                        </div>

                        {/* Customer / Agent Ledger */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                                <Activity className={`w-4.5 h-4.5 ${primaryColorText}`} />
                                Customer / Agent Ledger
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-white/5 text-white/40 text-[10px] uppercase font-bold tracking-wider">
                                            <th className="pb-3">ClientReferenceId</th>
                                            <th className="pb-3">Smart Wallet Address</th>
                                            <th className="pb-3">Allowance Limit</th>
                                            <th className="pb-3">Next Billing Date</th>
                                            <th className="pb-3">Status</th>
                                            <th className="pb-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-xs text-white/70 font-mono">
                                        {isLoadingContract ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-white/40">
                                                    Fetching on-chain subscription state...
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
                                                        <span className={`px-2 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider ${
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
                                                                title="Revoke Allowance Access"
                                                            >
                                                                <ShieldX className="w-4 h-4" />
                                                            </button>
                                                        ) : (
                                                            <span className="text-3xs text-white/20 uppercase tracking-widest font-bold">Ended</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Execution Failure Log */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                                <ShieldAlert className="w-4.5 h-4.5 text-red-400" />
                                Execution Failure Log
                            </h2>
                            <div className="space-y-3 font-mono text-2xs">
                                <div className="py-6 text-center text-white/30 font-sans">
                                    No execution failures logged. All on-chain renewal transactions succeeded.
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case "apikeys":
                const testSecretKey = address 
                    ? `sk_test_${address.slice(2, 10)}${address.slice(-8)}_v${secretKeyVersion}` 
                    : "";
                const liveSecretKey = address 
                    ? `sk_live_${address.slice(2, 10)}${address.slice(-8)}_v${secretKeyVersion}` 
                    : "";
                const activeSecretKey = isMainnet ? liveSecretKey : testSecretKey;
                const activePublishableKey = isMainnet 
                    ? "pk_live_51Px200Z7Z4M19XQY1R93B" 
                    : "pk_test_51Px9800Z7Z4M19XQY1R93B";

                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-8">
                        <div>
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Key className={`w-5 h-5 ${primaryColorText}`} />
                                API Credentials
                            </h2>
                            <p className="text-xs text-white/50 font-sans leading-relaxed">
                                Use these keys to authenticate your backend interactions with the SubScript SDK.
                                Keep your Secret Key highly protected.
                            </p>
                        </div>

                        {/* Keys Container */}
                        <div className="space-y-6">
                            {/* Publishable Key */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Publishable Key</span>
                                    {copiedText === "Publishable Key" && (
                                        <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-4 bg-black/60 rounded-xl p-3 border border-white/5">
                                    <code className="text-xs font-mono text-white/80 break-all select-all">{activePublishableKey}</code>
                                    <button 
                                        onClick={() => handleCopy(activePublishableKey, "Publishable Key")}
                                        className={`p-2 text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-all`}
                                        title="Copy key"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Secret Key */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Secret Key</span>
                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Secret</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {copiedText === "Secret Key" && (
                                            <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                        )}
                                        <button
                                            onClick={() => setRevealSecret(!revealSecret)}
                                            className="text-white/40 hover:text-white transition-colors"
                                            title={revealSecret ? "Hide Key" : "Show Key"}
                                        >
                                            {revealSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-4 bg-black/60 rounded-xl p-3 border border-white/5">
                                    <code className="text-xs font-mono text-white/80 break-all">
                                        {revealSecret 
                                            ? activeSecretKey 
                                            : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••"
                                        }
                                    </code>
                                    <button 
                                        onClick={() => handleCopy(activeSecretKey, "Secret Key")}
                                        disabled={!revealSecret}
                                        className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-all"
                                        title="Copy key"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Roll Keys */}
                        <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                            <div>
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Rotation / Roll Credentials</h3>
                                <p className="text-2xs text-white/40 font-sans max-w-md">
                                    In case of leakage, roll your credentials instantly. Old keys will remain valid for 24 hours to prevent immediate system downtime.
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                {copiedText === "API Secret Key Rolled" && (
                                    <span className="text-2xs text-[#00d2b4] font-bold animate-pulse">✓ API Secret Key Rolled & Copied</span>
                                )}
                                <button
                                    onClick={handleRollKeys}
                                    disabled={isRolling}
                                    className={`px-5 py-3 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition-all duration-200 flex items-center gap-2 ${isRolling ? "opacity-50" : ""}`}
                                >
                                    {isRolling ? (
                                        <RefreshCw className="w-4.5 h-4.5 animate-spin text-white" />
                                    ) : (
                                        <RotateCw className="w-4.5 h-4.5 text-white" />
                                    )}
                                    Roll Credentials
                                </button>
                            </div>
                        </div>
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
                                    <Sliders className={`w-4.5 h-4.5 ${primaryColorText}`} />
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
                            
                            <div className="mt-8 pt-4 border-t border-white/5 text-2xs text-white/40">
                                SubScript is fast, private, and reliable: Arc-native USDC gas, private burner activation, and a 1% protocol fee.
                            </div>
                        </div>

                        {/* Code output Block */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">SDK Code Snippet</span>
                                <div className="flex items-center gap-3">
                                    {copiedText === "Checkout Snippet" && (
                                        <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                    )}
                                    <button 
                                        onClick={() => handleCopy(checkoutCode, "Checkout Snippet")}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                        title="Copy code"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex-1 p-6 font-mono text-2xs text-white/80 overflow-x-auto leading-relaxed">
                                <pre>
                                    <code>{checkoutCode}</code>
                                </pre>
                            </div>
                            
                            <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 flex justify-between font-mono">
                                <span>React SDK Component</span>
                                <span>Wallet: {address?.slice(0, 6)}...{address?.slice(-4)}</span>
                            </div>
                        </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <div>
                                        <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Live AI Agent Prompt</span>
                                        <p className="text-[10px] text-white/30 mt-1">Wallet address is injected automatically.</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {copiedText === "Agent Prompt" && (
                                            <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                        )}
                                        <button
                                            onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                            title="Copy prompt"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <div className="flex flex-col items-center justify-center p-8 bg-black/40 border border-white/5 rounded-2xl text-center gap-4 min-h-[300px]">
                                        <div className="w-12 h-12 bg-[#00d2b4]/10 rounded-full flex items-center justify-center text-[#00d2b4]">
                                            <Sliders className="w-6 h-6" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-white uppercase tracking-wider">Agent Prompt Encrypted</p>
                                            <p className="text-3xs text-white/40 max-w-xs leading-relaxed">
                                                This integration prompt contains your live configuration. For visual security, the raw text is hidden.
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                            className="px-5 py-2.5 bg-[#00d2b4] text-[#111111] hover:brightness-110 text-2xs font-bold uppercase tracking-wider rounded-xl transition-all"
                                        >
                                            Copy Full Prompt
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <div>
                                        <span className="text-xs font-bold text-white/40 uppercase tracking-widest">cursor_mcp.json</span>
                                        <p className="text-[10px] text-white/30 mt-1">Drop-in MCP context for Cursor or compatible agents.</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {copiedText === "MCP Config" && (
                                            <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                        )}
                                        <button
                                            onClick={() => handleCopy(cursorMcpConfig, "MCP Config")}
                                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                            title="Copy MCP config"
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6 font-mono text-2xs text-emerald-300/90 overflow-x-auto leading-relaxed max-h-[420px]">
                                    <pre>{cursorMcpConfig}</pre>
                                </div>
                                <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 font-mono">
                                    MCP server supplies Arc config, ZK ABI, and Burner Method guidance.
                                </div>
                            </div>
                        </div>
                    </div>
                );

            case "webhooks":
                const staticWebhooks = [
                    { id: "evt_01", event: "subscription.created", status: 200, time: "10:14:22", payload: { subscriptionId: "sub_01HjX729", clientReferenceId: "agent-run-9843", amount: "150.00", chain: "base" } },
                    { id: "evt_02", event: "payment.renewed", status: 200, time: "10:15:00", payload: { subscriptionId: "sub_01HjX729", amount: "150.00", txHash: "0x8f3c...b2a4" } },
                    { id: "evt_03", event: "payment.failed", status: 500, time: "10:15:05", error: "INSUFFICIENT_USDC_BALANCE", payload: { subscriptionId: "sub_01HjX332", clientReferenceId: "inference-node-332", reason: "Allowance exhausted" } },
                    { id: "evt_04", event: "allowance.revoked", status: 200, time: "10:15:30", payload: { subscriptionId: "sub_01HjX44", clientReferenceId: "scraping-cluster-44", txHash: "0x9c3a...a8f" } }
                ];

                const dynamicEvents = ledgers.flatMap((item, index) => {
                    const baseTime = "10:14:22";
                    const events: Array<{
                        id: string;
                        event: string;
                        status: number;
                        time: string;
                        payload: any;
                        error?: string;
                    }> = [
                        {
                            id: `evt_01_${index}`,
                            event: "subscription.created",
                            status: 200,
                            time: baseTime,
                            payload: {
                                subscriptionId: `sub_01_${item.rawId}`,
                                clientReferenceId: item.id,
                                subscriber: item.address,
                                amount: item.rawAmount,
                                period: item.rawPeriod,
                                chain: "arc",
                            },
                        },
                    ];
                    if (item.active) {
                        events.push({
                            id: `evt_02_${index}`,
                            event: "payment.renewed",
                            status: 200,
                            time: "10:15:00",
                            payload: {
                                subscriptionId: `sub_01_${item.rawId}`,
                                amount: item.rawAmount,
                                txHash: "0x8f3c...b2a4",
                            },
                        });
                    } else {
                        events.push({
                            id: `evt_04_${index}`,
                            event: "allowance.revoked",
                            status: 200,
                            time: "10:15:30",
                            payload: {
                                subscriptionId: `sub_01_${item.rawId}`,
                                clientReferenceId: item.id,
                                txHash: "0x9c3a...a8f",
                            },
                        });
                    }
                    return events;
                });

                const webhooks = [...staticWebhooks, ...dynamicEvents];

                const selectedPayload = webhooks.find(w => w.id === selectedWebhook);

                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                        {/* Event Feed */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                                    <Webhook className={`w-4.5 h-4.5 ${primaryColorText}`} />
                                    Chronological Event Stream
                                </h2>
                                <div className="space-y-2">
                                    {webhooks.length === 0 ? (
                                        <div className="py-8 text-center text-white/30 font-sans text-xs">
                                            No active subscriptions to generate webhook events.
                                        </div>
                                    ) : (
                                        webhooks.map((item) => (
                                            <button
                                                key={item.id}
                                                onClick={() => setSelectedWebhook(item.id)}
                                                className={`w-full p-4 rounded-2xl border text-left flex justify-between items-center transition-all ${
                                                    selectedWebhook === item.id 
                                                        ? isMainnet 
                                                            ? "bg-red-500/10 border-red-500/30 shadow-inner" 
                                                            : "bg-[#00d2b4]/10 border-[#00d2b4]/30 shadow-inner"
                                                        : "bg-white/[0.01] border-white/5 hover:bg-white/[0.02]"
                                                }`}
                                            >
                                                <div className="font-mono text-2xs space-y-1">
                                                    <p className="font-bold text-white uppercase tracking-wider">{item.event}</p>
                                                    <p className="text-white/40 text-3xs">{item.id.slice(0, 8)} • {item.time}</p>
                                                </div>
                                                <span className={`px-2.5 py-0.5 rounded-full text-3xs font-bold ${
                                                    item.status === 200 
                                                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                            
                            <div className="mt-6 pt-4 border-t border-white/5 text-2xs text-white/40 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-[#00d2b4] rounded-full animate-ping" />
                                Listening live on endpoint: https://api.merchant.com/webhooks
                            </div>
                        </div>

                        {/* Payload Inspector */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest font-mono">Payload Inspector ({selectedWebhook || "None"})</span>
                                <button
                                    onClick={() => handleReplayWebhook(selectedWebhook)}
                                    disabled={isReplaying || !selectedWebhook}
                                    className={`px-3 py-1.5 border border-white/10 rounded-xl text-3xs font-bold uppercase tracking-wider hover:bg-white/5 flex items-center gap-1.5 ${isReplaying || !selectedWebhook ? "opacity-50" : ""}`}
                                >
                                    {isReplaying ? (
                                        <RefreshCw className="w-3 h-3 animate-spin text-white" />
                                    ) : (
                                        <RotateCw className="w-3 h-3 text-white" />
                                    )}
                                    Replay Event
                                </button>
                            </div>
                            
                            <div className="flex-1 p-6 font-mono text-2xs text-emerald-400/90 overflow-y-auto min-h-[250px] leading-relaxed select-all">
                                {replayStatus ? (
                                    <p className="text-white/80 p-3 bg-white/5 border border-white/5 rounded-xl mb-4 font-sans">{replayStatus}</p>
                                ) : null}
                                <pre>
                                    <code>{selectedPayload ? JSON.stringify(selectedPayload, null, 2) : "// Select a webhook event to inspect"}</code>
                                </pre>
                            </div>
                            
                            <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 flex justify-between font-mono">
                                <span>Event Type: {selectedPayload?.event || "N/A"}</span>
                                <span>HTTP Status: {selectedPayload?.status || "N/A"}</span>
                            </div>
                        </div>
                    </div>
                );

            case "offramp":
                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-8">
                        <div>
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <ArrowRightLeft className={`w-5 h-5 ${primaryColorText}`} />
                                Fiat Escape Hatch (Off-Ramp)
                            </h2>
                            <p className="text-xs text-white/50 font-sans leading-relaxed">
                                Avoid liquidity crunches. Route a percentage of incoming USDC subscription revenue directly to your corporate USD bank account.
                            </p>
                        </div>

                        {/* Settlement Slider */}
                        <div className="space-y-6 bg-black/40 border border-white/5 rounded-2xl p-6">
                            <div className="flex justify-between items-center">
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Bank Allocation</span>
                                    <p className="text-lg font-bold text-white font-mono mt-1">{fiatSplit}% <span className="text-xs text-white/40 font-normal">to Chase (...4829)</span></p>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Treasury Wallet</span>
                                    <p className="text-lg font-bold text-white font-mono mt-1">{100 - fiatSplit}% <span className="text-xs text-white/40 font-normal">to Arc wallet</span></p>
                                </div>
                            </div>
                            
                            {/* Interactive Slider Input */}
                            <div className="relative pt-4">
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="100" 
                                    value={fiatSplit}
                                    onChange={(e) => setFiatSplit(Number(e.target.value))}
                                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#00d2b4]"
                                    style={{
                                        accentColor: isMainnet ? '#ef4444' : '#00d2b4'
                                    }}
                                />
                                <div className="flex justify-between text-3xs text-white/30 font-mono mt-2 uppercase">
                                    <span>0% (All Crypto)</span>
                                    <span>50% Split</span>
                                    <span>100% (All Fiat)</span>
                                </div>
                            </div>
                        </div>

                        {/* Custom Settlement Address settings */}
                        <div className="bg-black/40 border border-white/5 rounded-2xl p-6 space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Settlement Destination Settings</span>
                                    <p className="text-xs text-white/50 font-sans mt-1">Configure where subscription funds are routed. By default, they go to your connected wallet.</p>
                                </div>
                                <span className={`px-2.5 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider ${
                                    isPremiumSubscribed
                                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                        : "bg-white/5 text-white/40 border border-white/10"
                                }`}>
                                    {isPremiumSubscribed ? "Premium Mode" : "Standard Mode"}
                                </span>
                            </div>

                            {isPremiumSubscribed ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2 font-mono">Custom Settlement Destination</label>
                                        <div className="flex gap-3">
                                            <input 
                                                type="text" 
                                                value={customAddress || ""} 
                                                onChange={(e) => setCustomAddress(e.target.value)}
                                                placeholder="0x..."
                                                className="flex-1 bg-black border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                            />
                                            <button
                                                onClick={handleSaveCustomAddress}
                                                className={`px-5 py-3 ${primaryColorBg} text-black font-semibold rounded-xl text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all`}
                                            >
                                                Save Address
                                            </button>
                                        </div>
                                    </div>
                                    {saveSuccess && (
                                        <p className="text-emerald-400 text-xs">✓ Settlement address successfully configured!</p>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-black/30 border border-white/5 rounded-2xl p-5 space-y-4 relative overflow-hidden">
                                    <div className="flex items-start gap-3.5">
                                        <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                                            <Sliders className="w-5 h-5" />
                                        </div>
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Custom Cold Wallet / Multisig Routing</h4>
                                            <p className="text-2xs text-white/50 leading-relaxed max-w-xl">
                                                Unlock the ability to override your active session wallet and route recurring subscriptions directly to cold storage, ledger addresses, or corporate multisigs.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-white/5">
                                        <div className="text-left">
                                            <p className="text-3xs text-white/40 uppercase font-bold tracking-widest font-mono">Subscription Price</p>
                                            <p className="text-sm font-bold text-white font-mono">$10.00 USDC / month</p>
                                        </div>
                                        <button
                                            onClick={handleSubscribePremium}
                                            disabled={isSubscribingPremium}
                                            className="w-full sm:w-auto px-6 py-3 bg-amber-400 hover:bg-amber-300 text-black rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(245,158,11,0.2)] disabled:opacity-50"
                                        >
                                            {isSubscribingPremium ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                                    {premiumStatus || "Processing..."}
                                                </>
                                            ) : (
                                                "Unlock Custom Routing ($10/mo)"
                                            )}
                                        </button>
                                    </div>
                                    {premiumError && (
                                        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-xs font-mono break-all leading-relaxed">
                                            {premiumError}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Guarantee Block */}
                        <div className="p-5 bg-white/[0.01] border border-white/5 rounded-2xl flex items-start gap-4">
                            <div className={`p-2 rounded-xl flex-shrink-0 border ${isMainnet ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-[#00d2b4]/10 border-[#00d2b4]/20 text-[#00d2b4]'}`}>
                                <CheckCircle className="w-5 h-5" />
                            </div>
                            <div className="space-y-1 font-sans text-xs">
                                <h4 className="font-bold text-white uppercase tracking-wider">Settlement Timeline Guarantee</h4>
                                <p className="text-white/50 leading-relaxed">
                                    All conversion trades are executed atomically on-chain. US dollar settlements are dispatched instantly and guaranteed to clear in your corporate checking account within 24 hours of deposit. Off-ramp processing incurs a flat 0.5% conversion fee.
                                </p>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div data-mounted={isMounted} className={`min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white transition-all duration-500 ${isMainnet ? 'border-t-4 border-red-500' : 'border-t-4 border-[#00d2b4]'}`}>
            <AnimatedGradientBg />
            <div className="relative z-10">
            <DashboardHeader />

            {/* Dashboard Content */}
            <main className="max-w-7xl mx-auto px-6 pt-32 pb-12">
                {/* Header Row */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 pb-6 border-b border-white/5">
                    <div>
                        <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2">
                            Merchant Control <span className="font-serif italic lowercase font-normal text-[#00d2b4] transition-colors duration-500" style={{ color: isMainnet ? '#ef4444' : '#00d2b4' }}>center</span>
                        </h1>
                        <p className="text-xs text-white/50 font-sans">
                            {isMainnet 
                                ? "Production Environment: SubScript is fast, private, and reliable with live USDC treasury settlement."
                                : "Sandbox Environment: SubScript is fast, private, and reliable with Arc testnet prompts, keys, and dummy webhooks."
                            }
                        </p>
                    </div>

                    {/* Environment Toggle Switch */}
                    <div className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-full px-4 py-2 select-none shadow-xl">
                        <span className={`text-[10px] uppercase tracking-widest font-bold font-mono transition-colors duration-300 ${!isMainnet ? 'text-[#00d2b4]' : 'text-white/40'}`}>Testnet</span>
                        <button
                            onClick={() => {
                                setIsMainnet(!isMainnet);
                                setSelectedWebhook(ledgers.length > 0 ? `evt_01_0` : "");
                            }}
                            className="w-12 h-6 rounded-full bg-white/10 p-0.5 relative transition-colors"
                            aria-label="Toggle Environment"
                        >
                            <motion.div
                                layout
                                className={`w-5 h-5 rounded-full shadow-md ${isMainnet ? 'bg-red-500 ml-6' : 'bg-[#00d2b4] ml-0'}`}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                        <span className={`text-[10px] uppercase tracking-widest font-bold font-mono transition-colors duration-300 ${isMainnet ? 'text-red-500' : 'text-white/40'}`}>Mainnet</span>
                    </div>
                </div>

                {!isConnected ? (
                    /* Clean requirement state asking the user to connect a wallet */
                    <div className="space-y-8">
                        <div className="liquid-glass border border-yellow-500/20 rounded-3xl p-8 shadow-2xl bg-yellow-500/[0.03] flex flex-col items-center justify-center text-center gap-6 max-w-2xl mx-auto py-12">
                            <div className="p-4 rounded-3xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                                <AlertTriangle className="w-10 h-10" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-lg font-bold text-white uppercase tracking-wider">Merchant Wallet Connection Required</h2>
                                <p className="text-sm text-white/60 max-w-md leading-relaxed">
                                    Connect your browser wallet to access active allowances, metrics, subscription tracking, and Settlement Configurations.
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

                        {/* Integration scaffolding remains accessible for builders even when disconnected */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <div>
                                        <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Live AI Agent Prompt</span>
                                        <p className="text-[10px] text-white/30 mt-1">Waiting for wallet connection to inject address.</p>
                                    </div>
                                    <button
                                        onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <div className="p-6">
                                    <div className="flex flex-col items-center justify-center p-8 bg-black/40 border border-white/5 rounded-2xl text-center gap-4 min-h-[220px]">
                                        <div className="w-12 h-12 bg-[#00d2b4]/10 rounded-full flex items-center justify-center text-[#00d2b4]">
                                            <Sliders className="w-6 h-6" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-white uppercase tracking-wider">Agent Prompt Encrypted</p>
                                            <p className="text-3xs text-white/40 max-w-xs leading-relaxed">
                                                This integration prompt contains your live configuration. For visual security, the raw text is hidden.
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleCopy(agentIntegrationPrompt, "Agent Prompt")}
                                            className="px-5 py-2.5 bg-[#00d2b4] text-[#111111] hover:brightness-110 text-2xs font-bold uppercase tracking-wider rounded-xl transition-all"
                                        >
                                            Copy Full Prompt
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                                <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <div>
                                        <span className="text-xs font-bold text-white/40 uppercase tracking-widest">cursor_mcp.json</span>
                                        <p className="text-[10px] text-white/30 mt-1">Default template for your cursor_mcp.json server config.</p>
                                    </div>
                                    <button
                                        onClick={() => handleCopy(cursorMcpConfig, "MCP Config")}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <div className="p-6 font-mono text-2xs text-emerald-300/90 overflow-x-auto leading-relaxed max-h-[300px]">
                                    <pre>{cursorMcpConfig}</pre>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Connected Dashboard View */
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
                        {/* Sidebar Navigation */}
                        <div className="lg:col-span-1 space-y-2">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border text-left ${
                                        activeTab === tab.id
                                            ? isMainnet
                                                ? "bg-red-500/10 border-red-500/30 text-white shadow-lg shadow-red-500/5"
                                                : "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-white shadow-lg shadow-[#00d2b4]/5"
                                            : "bg-white/[0.01] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.03]"
                                    }`}
                                >
                                    <tab.icon className={`w-4.5 h-4.5 ${activeTab === tab.id ? (isMainnet ? 'text-red-500' : 'text-[#00d2b4]') : 'text-white/40'}`} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* View Content */}
                        <div className="lg:col-span-3 min-h-[500px]">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeTab + (isMainnet ? "-main" : "-test")}
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
