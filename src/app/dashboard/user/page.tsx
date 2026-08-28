/* Mobile-first user dashboard: wallet home, system-DM chat, DNS, payment links, and batch send. */
"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { enablePush, disablePush, isPushEnabled, pushSupported, sendTestPush } from "@/lib/clientPush";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDisconnect, useReadContract, useReadContracts, useAccount, useSwitchChain, useWriteContract } from "wagmi";
import {
  formatUnits,
  createPublicClient,
  http,
  parseUnits,
  fallback
} from "viem";
import { activeArcChain } from "@/lib/wagmi";
import { MAX_BATCH_RECIPIENTS } from "@/lib/payments/batchLimits";
import { arcHttp } from "@/lib/arc/transport";
import {
  ARC_CCTP_DOMAIN_ID,
  ARC_TOKEN_MESSENGER_ADDRESS,
  BRIDGE_FEE_TREASURY_ADDRESS,
  CCTP_CONFIG
} from "@/lib/contracts/constants";
import { calculateBridgeFee, formatFeeBps, formatMicros } from "@/lib/cctp/feeEngine";
import { QRCode } from "react-qrcode-logo";
import jsQR from "jsqr";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedBottomNavButton from "@/components/AnimatedBottomNavButton";
import LoadingDots from "@/components/ui/LoadingDots";
import LiquidGlassEffect from "@/components/LiquidGlassEffect";

import NotificationBell from "@/components/dashboard/NotificationBell";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import { useTheme } from "@/hooks/useTheme";
import KycVerificationPanel from "@/components/KycVerificationPanel";
import ConfirmModal from "@/components/ConfirmModal";
import QrScannerModal from "@/components/QrScannerModal";
import { resolveScannedTarget } from "@/lib/qr/scanTargets";
import SendSingleModal from "@/components/SendSingleModal";
import SupportChatModal from "@/components/support/SupportChatModal";

import DmRequestsModal from "@/components/dashboard/DmRequestsModal";
import DmInviteManagerModal from "@/components/dashboard/DmInviteManagerModal";
import BlockedUsersModal from "@/components/dashboard/BlockedUsersModal";
import VaultShareManager from "@/components/VaultShareManager";
import AccountHoldModal from "@/components/dashboard/AccountHoldModal";
import { getDashboardUrl } from "@/utils/navigation";
import { Identity } from "@/components/Identity";
import { MerchantVerifiedTick } from "@/components/MerchantVerifiedBadge";
import { receiptHrefFromDescriptionLine } from "@/lib/dms/receiptPresentation";
import { isMerchantOpsDm } from "@/lib/dms/catalog";
import { buildSubscribeUrl } from "@/lib/checkoutUrl";
import {
  AlertCircle,
  ArrowDown,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Check,
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Filter,
  ChevronDown,
  Globe,
  HelpCircle,
  Home,
  Layers,
  Link2,
  Loader2,
  LogOut,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Plus,
  QrCode,
  Send,
  Share2,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  Inbox,
  User,
  UserX,
  Users,
  Wallet,
  X,
  Activity,
  Sliders,
  Eye,
  EyeOff,
  RefreshCw,
  Gift,
  KeyRound,
  Lock,
  BarChart3,
  TrendingUp,
  Search,
  Tag,
  PieChart,
  DollarSign,
} from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { USDC_NATIVE_GAS_ADDRESS, SUBSCRIPT_VAULT_ADDRESS } from "@/lib/contracts/constants";
import { compareRecurringRates } from "@/lib/subscriptions/planComparison";
import { humanStatus, humanSubscriptionStatus, normalizeReceiptStatus } from "@/lib/transactionLabels";
import { useSwipeTabs } from "@/hooks/useSwipeTabs";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";
import { accountDisplayName, merchantDisplayName } from "@/lib/identityDisplay";
import { recordOptimisticTx } from "@/lib/optimisticTx";

const comingSoonUserSettings = new Set(["emailEnabled", "securityShieldEnabled", "securityMultiSigEnabled"]);

function getExplorerTxUrl(txHash?: string | null) {
  if (!txHash) return "#";
  const base = activeArcChain.blockExplorers?.default?.url || "https://arcscan.app";
  return `${base}/tx/${txHash}`;
}

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

/* Minimal client-side ABIs for external/browser-wallet vault actions (the embedded path is
   signed server-side instead). */
const VAULT_TOKEN_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const VAULT_CONTRACT_ABI = [
  { type: "function", name: "commit", stateMutability: "nonpayable", inputs: [{ name: "merchant", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawSurplus", stateMutability: "nonpayable", inputs: [{ name: "merchant", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/* CCTP client-side ABIs. Both the deposit (burn on an origin chain) and the browser-wallet
   withdrawal (burn on Arc) paths sign these through wagmi. */
const CCTP_ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "success", type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "success", type: "bool" }] },
] as const;

/* CCTP V2 takes seven arguments. The four-argument V1 form is a different selector and reverts on a
   V2 TokenMessenger, which is what every chain in CCTP_CONFIG points at. */
const CCTP_TOKEN_MESSENGER_V2_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

/* bytes32(0): anyone may call receiveMessage, which is how our relayer completes the transfer
   without having been named at burn time. */
const ANY_DESTINATION_CALLER = `0x${"0".repeat(64)}` as `0x${string}`;

/* 2000 = Finalized, the standard transfer. Requesting 1000 (Fast) needs a nonzero maxFee, which
   would take a second cut out of the user's money on top of the protocol fee. */
const CCTP_FINALITY_STANDARD = 2000;

/* Left-pads an EVM address into the bytes32 mintRecipient CCTP expects. */
const toBytes32Address = (address: string): `0x${string}` =>
  `0x${address.trim().toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as `0x${string}`;

/* One CCTP chain a deposit can start from, with the user's USDC balance on it. */
type DepositOriginBalance = {
  chainId: number;
  name: string;
  feeBps: number;
  feePercentage: string;
  isL1: boolean;
  balance: number;
  balanceMicros: bigint;
};

const publicClient = createPublicClient({
  chain: activeArcChain,
  transport: arcHttp(),
});

/* Read-only clients for the CCTP origin chains, built lazily from the RPC in CCTP_CONFIG so a chain
   added there needs no client wired up by hand. Only used to wait on receipts, which needs no chain
   metadata, so `chain` is deliberately omitted. */
const originClientCache = new Map<number, ReturnType<typeof createPublicClient>>();
function originPublicClient(chainId: number) {
  const cached = originClientCache.get(chainId);
  if (cached) return cached;
  const rpc = CCTP_CONFIG[chainId]?.defaultRpc;
  if (!rpc) throw new Error(`No RPC configured for chain ${chainId}.`);
  const client = createPublicClient({ transport: http(rpc) });
  originClientCache.set(chainId, client);
  return client;
}

interface Subscription {
  subscriptionId: string;
  merchantAddress: string;
  merchantName: string;
  merchantVerified: boolean;
  merchantProfilePic: string | null;
  status: string;
  tier: number;
  amountCapUsdc: string;
  billingIntervalSeconds: string;
  lastSettlementTimestamp: string | null;
  /** Paid-through date. Drives the resume dialog's "no charge until" statement. */
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

interface DmMessage {
  id: string;
  senderAddress: string;
  senderName: string;
  senderRole: string | null;
  senderProfilePic: string | null;
  /* merchants.verified for this address, from the server. Absent for non-merchant peers. */
  senderVerified?: boolean;
  receiverAddress: string;
  receiverName: string;
  receiverRole: string | null;
  receiverProfilePic: string | null;
  receiverVerified?: boolean;
  messageType: string;
  status: string;
  amountUsdc: string | null;
  title: string | null;
  description: string | null;
  txHash: string | null;
  paymentLinkId: string | null;
  createdAt: string;
}

interface MerchantPlan {
  id: string;
  checkoutSessionId?: string | null;
  merchantAddress: string;
  name: string;
  description?: string | null;
  detailsUrl?: string | null;
  amountUsdc: string;
  periodSeconds: string;
  /* Both of these already come back from /api/merchant/plans and were simply not declared here, so
     the plan cards silently dropped the two terms a subscriber most needs before deciding. */
  minCommitmentSeconds?: string | null;
  promotion?: {
    name: string;
    introductoryAmountUsdc: string;
    introductoryCycles: number;
  } | null;
  active: boolean;
}

type UserTab = "home" | "commit" | "links" | "batch" | "inbox" | "dns" | "referrals";
type AccountSubView =
  | "menu"
  | "profile"
  | "appearance"
  | "kyc"
  | "transactions"
  | "notifications"
  | "security"
  | "support"
  | "spend-analysis";

const userBottomTabs = [
  { id: "home", label: "Home", icon: Home },
  { id: "commit", label: "Commit", icon: Shield },
  { id: "links", label: "Links", icon: Link2 },
  { id: "batch", label: "Send", icon: Send },
] as const;

const userDesktopTabs = [
  { id: "home", label: "Dashboard", icon: Home },
  { id: "commit", label: "Vault & Commits", icon: Shield },
  { id: "batch", label: "Batch Payments", icon: Layers },
  { id: "links", label: "Payment Links", icon: Link2 },
  { id: "inbox", label: "Direct Messages", icon: MessageSquare },
  { id: "referrals", label: "Refer & Earn", icon: Gift },
] as const;

/* Collapses the two status vocabularies in the activity feed onto the three buckets a spend view
   can filter by. They are mapped separately rather than through one lookup because the same word
   means different things on each side: a CANCELED subscription still settled every cycle it ran,
   so its rows are completed history, whereas a DECLINED payment DM never moved money at all.
   Anything unrecognised counts as completed — these rows exist because money moved, so the safe
   default is to show them rather than quietly drop them out of the totals. */
type TxStatus = "COMPLETED" | "PENDING" | "FAILED";

function subscriptionTxStatus(raw: unknown): TxStatus {
  const value = String(raw || "").toUpperCase();
  if (value === "PENDING") return "PENDING";
  /* Only a renewal that actually failed. CANCELED and EXPIRED are ordinary ends of life. */
  if (value === "PAST_DUE") return "FAILED";
  return "COMPLETED";
}

function dmTxStatus(raw: unknown): TxStatus {
  const value = String(raw || "").toUpperCase();
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "AWAITING", "QUEUED"].includes(value)) return "PENDING";
  if (["FAILED", "DECLINED", "REJECTED", "EXPIRED", "DISMISSED"].includes(value)) return "FAILED";
  return "COMPLETED";
}

/* How many rows the "All transactions" page reveals per scroll page. */
const SETTINGS_TX_PAGE_SIZE = 30;

const formatAddress = (addr: string | null) => {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;};

const limitDecimals = (value: string, maxDecimals: number = 6): string => {
  if (!value || !value.includes(".")) return value;
  const [integer, fraction] = value.split(".");
  return `${integer}.${fraction.slice(0, maxDecimals)}`;
};

const walletAddressPattern = /0x[a-fA-F0-9]{40}/g;

const looksLikeWalletAddress = (value: string | null | undefined) => {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
};

/* An alias-less peer used to fall through to accountDisplayName(null), which is the constant
   "SubScript account" — so three contacts without a registered DNS name all rendered as the same
   string in the inbox and could not be told apart. The shortened address is the only identifier
   that is definitely present and definitely distinct, and it is already how the sidebar and the
   send flow label an alias-less account. The generic label is kept for the case where there is no
   address either. */
const formatPeerDisplayName = (name: string | null | undefined, address: string | null) => {
  const cleanedName = name?.trim();
  if (cleanedName && !looksLikeWalletAddress(cleanedName)) {
    const display = accountDisplayName(cleanedName, "");
    if (display) return display;
  }
  return formatAddress(address) || accountDisplayName(null);
};

const txHashPattern = /0x[a-fA-F0-9]{64}/g;

/* Shorten raw hex identifiers to a scannable form. Tx hashes (66 chars) must be replaced
   before addresses (42 chars) or the address pattern eats the front of the hash and leaves
   mangled text. Never replace with a generic label like "SubScript account" — that hid who
   was actually paid. */
const shortenWalletsInText = (value: string | null | undefined) => {
  if (!value) return value || null;
  return value
    .replace(txHashPattern, (hash) => `${hash.slice(0, 10)}…${hash.slice(-6)}`)
    .replace(walletAddressPattern, (address) => `${address.slice(0, 6)}…${address.slice(-4)}`);
};

const dmRequestDurationOptions = [
  { value: "1", label: "1 hour" },
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
] as const;

const formatUsdc = (amount: string | null) => {
  if (!amount) return "0.00";
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? (numeric / 1_000_000).toFixed(2) : "0.00";
};

/* Display amounts on the overview cards and activity rows, in USDC or in the local-currency estimate
   beside it. Cents are load-bearing under 1,000: rounding 0.40 to "0" claims an empty wallet rather
   than forty cents. Past that they're noise, and dropping them keeps these strings as short as they
   are today — the balance renders at 52px on a 390px viewport, where the mobile audit allows no
   horizontal protrusion at all. The threshold suits both scales: sub-$1,000 USDC keeps its cents,
   while a naira estimate is large enough to stay whole. */
const formatHeadlineAmount = (value: number) => {
  /* Threshold on the rounded value, or 999.999 picks the cents branch and renders "1,000.00" while
     1000 renders "1,000". */
  const digits = Math.abs(Math.round(value * 100) / 100) < 1000 ? 2 : 0;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

/* Convert a USDC micro-amount (6dp) into a plain decimal string without losing
   precision — used when re-sending a requested amount through the transfer APIs. */
const microsToUsdcString = (micros: string | null) => {
  if (!micros) return "0";
  try {
    const value = BigInt(micros);
    const micro = BigInt(1_000_000);
    const whole = value / micro;
    const fraction = (value % micro).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
};

const splitDmDescription = (description: string | null) => {
  if (!description) return [];
  return description.split("\n").map((item) => item.trim()).filter(Boolean);
};

const isReactionMessage = (messageType: string) => messageType === "PEER_REACTION";

const getDmPeerAddress = (dm: DmMessage, userWallet: string | null) => {
  const ownWallet = userWallet?.toLowerCase();
  return dm.senderAddress.toLowerCase() === ownWallet ? dm.receiverAddress : dm.senderAddress;
};

export default function UserDashboard() {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const dmBottomRef = useRef<HTMLDivElement | null>(null);
  const desktopDmScrollRef = useRef<HTMLDivElement | null>(null);
  /* False once the reader deliberately scrolls up, so an arriving message doesn't yank the
     view back down mid-read. Reset to true whenever a thread's scroller mounts. */
  const autoPinDmRef = useRef(true);
  const dmScrollObserverRef = useRef<ResizeObserver | null>(null);
  const dmScrollMutationRef = useRef<MutationObserver | null>(null);

  /* Callback ref for the message scroller. Runs the instant the node mounts — which, unlike a
     timeout, is guaranteed to be after AnimatePresence has swapped the pane in — and pins the
     view to the newest message. The observers keep it pinned while bubbles settle to their
     final heights after first paint. */
  const attachDmScroller = useCallback((node: HTMLDivElement | null) => {
    dmScrollObserverRef.current?.disconnect();
    dmScrollObserverRef.current = null;
    dmScrollMutationRef.current?.disconnect();
    dmScrollMutationRef.current = null;
    desktopDmScrollRef.current = node;
    if (!node) return;

    autoPinDmRef.current = true;
    const pin = () => {
      node.scrollTop = node.scrollHeight;
    };
    pin();
    requestAnimationFrame(pin);

    if (typeof ResizeObserver === "undefined") return;
    /* Observing the scroller itself only reports its own box, which is flex-sized and doesn't
       change with content — so watch the children, and re-sync that list as bubbles are added. */
    const observer = new ResizeObserver(() => {
      if (autoPinDmRef.current) pin();
    });
    const observeChildren = () => {
      for (const child of Array.from(node.children)) observer.observe(child);
    };
    observeChildren();
    dmScrollObserverRef.current = observer;

    const mutations = new MutationObserver(() => {
      observeChildren();
      if (autoPinDmRef.current) pin();
    });
    mutations.observe(node, { childList: true });
    dmScrollMutationRef.current = mutations;
  }, []);

  /* Track whether the reader is parked at the bottom. Anything more than a bubble's worth of
     distance means they scrolled up on purpose. */
  const handleDmScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    autoPinDmRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => () => {
    dmScrollObserverRef.current?.disconnect();
    dmScrollMutationRef.current?.disconnect();
  }, []);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [activeTab, setActiveTab] = useState<UserTab>("home");

  /* A tab switch always starts at the top — otherwise a scroll depth carried over
     from a longer tab can sit past the end of a shorter one, showing only background. */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

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
    requiredMatchText?: string;
    matchPlaceholder?: string;
  } | null>(null);

  const triggerToast = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  };

  const [focusIntentId, setFocusIntentId] = useState<string | null>(null);
  const [selectedDmPeer, setSelectedDmPeer] = useState<string | null>(null);
  const [dmRequestOpen, setDmRequestOpen] = useState(false);
  const [dmRequestAmount, setDmRequestAmount] = useState("");
  const [dmRequestNote, setDmRequestNote] = useState("");
  const [dmRequestDuration, setDmRequestDuration] = useState<(typeof dmRequestDurationOptions)[number]["value"]>("24");
  const [dmRequestBillingType, setDmRequestBillingType] = useState<"ONE_TIME" | "RECURRING">("ONE_TIME");
  const [dmRequestInterval, setDmRequestInterval] = useState<"monthly" | "weekly" | "daily" | "yearly">("monthly");
  const [dmRequestStatus, setDmRequestStatus] = useState<string | null>(null);
  const [linkAmount, setLinkAmount] = useState("");
  const [linkMemo, setLinkMemo] = useState("");
  const [linkBillingType, setLinkBillingType] = useState<"ONE_TIME" | "RECURRING">("ONE_TIME");
  const [linkInterval, setLinkInterval] = useState<"monthly" | "weekly" | "daily" | "yearly">("monthly");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkResultUrl, setLinkResultUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkQrShown, setLinkQrShown] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrTargetIndex, setQrTargetIndex] = useState<number | null>(null); // null = single send, number = batch row index
  const [loading, setLoading] = useState(true);
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [emailPromptValue, setEmailPromptValue] = useState("");
  const [emailPromptSaving, setEmailPromptSaving] = useState(false);
  const [emailPromptError, setEmailPromptError] = useState<string | null>(null);
  const [emailPromptStep, setEmailPromptStep] = useState<"email" | "code">("email");
  const [emailPromptCode, setEmailPromptCode] = useState("");
  const [vaultInfoOpen, setVaultInfoOpen] = useState(false);
  const [vaultActionOpen, setVaultActionOpen] = useState(false);
  const [vaultActionMode, setVaultActionMode] = useState<"commit" | "withdraw">("commit");
  const [vaultActionMerchant, setVaultActionMerchant] = useState("");
  const [vaultActionMerchantLocked, setVaultActionMerchantLocked] = useState(false);
  const [vaultActionAmount, setVaultActionAmount] = useState("");
  const [vaultActionBusy, setVaultActionBusy] = useState(false);
  const [vaultActionError, setVaultActionError] = useState<string | null>(null);
  const [expandedCommitAction, setExpandedCommitAction] = useState<"refresh" | "commit" | "hold" | null>(null);
  const [accountHoldModalOpen, setAccountHoldModalOpen] = useState(false);
  const [isAccountOnHold, setIsAccountOnHold] = useState(false);
  /* Unverified-merchant commit warning (informed consent before escrowing to an unverified merchant). */
  const [vaultUnverifiedWarning, setVaultUnverifiedWarning] = useState(false);
  const [isEmbeddedWalletSession, setIsEmbeddedWalletSession] = useState(false);
  const [detectedCurrency, setDetectedCurrency] = useState({ code: "USD", symbol: "$" });
  const [exchangeRate, setExchangeRate] = useState(1.0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  const [dmConnections, setDmConnections] = useState<Array<{
    id: string;
    peerAddress: string;
    peerName: string;
    peerRole: string | null;
    peerProfilePic: string | null;
    peerVerified: boolean;
    isBlocked: boolean;
    establishedAt: string;
    lastInteractionAt: string;
  }>>([]);
  const [blockedAddresses, setBlockedAddresses] = useState<string[]>([]);
  const [dmRequestsModalOpen, setDmRequestsModalOpen] = useState(false);
  const [dmInviteModalOpen, setDmInviteModalOpen] = useState(false);
  const [blockedUsersModalOpen, setBlockedUsersModalOpen] = useState(false);
  /* In-DM subscription review. Set to the SUBSCRIPTION_OFFER DM being confirmed so the user
     can review terms and subscribe without leaving the thread. */
  const [subscribeReviewDm, setSubscribeReviewDm] = useState<DmMessage | null>(null);
  const [subscribeReviewBusy, setSubscribeReviewBusy] = useState(false);
  const [subscribeReviewError, setSubscribeReviewError] = useState<string | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [readDmIds, setReadDmIds] = useState<Set<string>>(new Set());
  const [threadPlans, setThreadPlans] = useState<MerchantPlan[]>([]);
  const [plansMerchantAddress, setPlansMerchantAddress] = useState<string | null>(null);

  const [isThreadPlansLoading, setIsThreadPlansLoading] = useState(false);
  const [planManagerOpen, setPlanManagerOpen] = useState(false);
  const [planManagerStatus, setPlanManagerStatus] = useState<string | null>(null);
  const [planManagerError, setPlanManagerError] = useState<string | null>(null);
  const [giftPlan, setGiftPlan] = useState<MerchantPlan | null>(null);
  const [giftTab, setGiftTab] = useState<"friends" | "link">("friends");
  const [selectedGiftFriendAddress, setSelectedGiftFriendAddress] = useState<string>("");
  const [giftFriendUsername, setGiftFriendUsername] = useState("");
  const [giftRequestUrl, setGiftRequestUrl] = useState<string | null>(null);
  const [giftRequestError, setGiftRequestError] = useState<string | null>(null);
  const [giftRequestCopied, setGiftRequestCopied] = useState(false);
  const [giftRequestBusyPlanId, setGiftRequestBusyPlanId] = useState<string | null>(null);
  const [registeredDomain, setRegisteredDomain] = useState<string | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("subscript_balance_visible");
      return stored !== "false";
    }
    return true;
  });

  const toggleBalanceVisible = () => {
    setBalanceVisible((prev) => {
      const newVal = !prev;
      localStorage.setItem("subscript_balance_visible", String(newVal));
      window.dispatchEvent(new Event("storage"));
      return newVal;
    });
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleStorageChange = () => {
        const current = localStorage.getItem("subscript_balance_visible");
        setBalanceVisible(current !== "false");
      };
      window.addEventListener("storage", handleStorageChange);
      return () => window.removeEventListener("storage", handleStorageChange);
    }
  }, []);
  const [txFilter, setTxFilter] = useState<"all" | "recurring" | "one-time" | "transfers" | "withdrawals" | "deposits">("all");
  const [deposits, setDeposits] = useState<Array<{
    id: string;
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountUsdc: string;
    amountFormatted: string;
    timestamp: number;
    blockNumber: number;
    status: string;
    senderName: string | null;
  }>>([]);
  const [allTxOpen, setAllTxOpen] = useState(false);
  const [allTxSearch, setAllTxSearch] = useState("");
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  /* Browser Web Push registration state for this device. */
  const [browserPushOn, setBrowserPushOn] = useState(false);
  const [browserPushBusy, setBrowserPushBusy] = useState(false);
  const [browserPushTestBusy, setBrowserPushTestBusy] = useState(false);
  const [browserPushSupported, setBrowserPushSupported] = useState(true);

  useEffect(() => {
    const supported = pushSupported();
    setBrowserPushSupported(supported);
    if (supported) {
      isPushEnabled().then(setBrowserPushOn).catch(() => {});
    }
  }, []);

  /* Detect browser local currency and fetch real-time exchange rate */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const detectLocalCurrency = () => {
      try {
        // Prioritize timezone detection (most reliable indicator of current physical location)
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (tz.includes("Lagos") || tz.includes("Nigeria") || tz.includes("Africa/Lagos")) return { code: "NGN", symbol: "₦" };
        if (tz.includes("London") || tz.includes("Europe/London")) return { code: "GBP", symbol: "£" };
        if (tz.includes("Europe")) return { code: "EUR", symbol: "€" };
        if (tz.includes("Calcutta") || tz.includes("Kolkata") || tz.includes("Asia/Kolkata")) return { code: "INR", symbol: "₹" };
        if (tz.includes("Tokyo") || tz.includes("Asia/Tokyo")) return { code: "JPY", symbol: "¥" };
        if (tz.includes("Sydney") || tz.includes("Melbourne") || tz.includes("Australia")) return { code: "AUD", symbol: "A$" };
        if (tz.includes("Toronto") || tz.includes("Vancouver") || tz.includes("America/Toronto")) return { code: "CAD", symbol: "C$" };
        if (tz.includes("Nairobi") || tz.includes("Kenya")) return { code: "KES", symbol: "KSh" };
        if (tz.includes("Accra") || tz.includes("Ghana")) return { code: "GHS", symbol: "GH₵" };
        if (tz.includes("Johannesburg") || tz.includes("South_Africa")) return { code: "ZAR", symbol: "R" };

        // Next check browser language preferences
        const languages = navigator.languages || [];
        if (languages.some(lang => lang.toLowerCase().includes("ng"))) return { code: "NGN", symbol: "₦" };

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
      } catch (e) {
        console.error("Failed to detect currency from locale/timezone fallback:", e);
      }
      return { code: "USD", symbol: "$" };
    };

    const initialCurrency = detectLocalCurrency();
    setDetectedCurrency(initialCurrency);

    const fetchGeoCurrencyAndRate = async () => {
      try {
        const res = await fetch(`/api/rates?currency=${encodeURIComponent(initialCurrency.code)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            const resolvedCode = data.currency || initialCurrency.code;
            const resolvedSymbol = resolvedCode === "NGN" ? "₦" : (data.symbol && data.symbol !== "E" ? data.symbol : initialCurrency.symbol);
            setDetectedCurrency({
              code: resolvedCode,
              symbol: resolvedSymbol
            });
            setExchangeRate(Number(data.rate) || 1.0);
          }
        }
      } catch (e) {
        console.error("Failed to fetch exchange rates from local API:", e);
      }
    };

    fetchGeoCurrencyAndRate();
  }, []);

  const handleToggleBrowserPush = async () => {
    setBrowserPushBusy(true);
    try {
      if (browserPushOn) {
        await disablePush();
        setBrowserPushOn(false);
        triggerToast("Browser push disabled on this device.");
      } else {
        const res = await enablePush();
        if (res.ok) {
          setBrowserPushOn(true);
          triggerToast("Browser push enabled on this device.");
        } else {
          triggerToast(res.error || "Could not enable browser push.");
        }
      }
    } finally {
      setBrowserPushBusy(false);
    }
  };
  const handleTestBrowserPush = async () => {
    setBrowserPushTestBusy(true);
    try {
      const result = await sendTestPush();
      triggerToast(result.ok ? (result.message || "Test notification sent.") : (result.error || "Could not send a test notification."));
    } finally {
      setBrowserPushTestBusy(false);
    }
  };
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [sendFundsOpen, setSendFundsOpen] = useState(false);
  const [sendFundsRecipient, setSendFundsRecipient] = useState("");

  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsSuccess, setDnsSuccess] = useState<string | null>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [userSettings, setUserSettings] = useState<any>(null);
  const mustBackupWallet = Boolean(
    userSettings?.walletBackup?.available && 
    !userSettings?.walletBackup?.completedAt
  );
  const [settingsTransactions, setSettingsTransactions] = useState<any[]>([]);
  const [settingsTxCategory, setSettingsTxCategory] = useState<string>("all");
  const [settingsTxStatus, setSettingsTxStatus] = useState<string>("all");
  const [settingsTxDatePreset, setSettingsTxDatePreset] = useState<string>("all");
  const [settingsTxStartDate, setSettingsTxStartDate] = useState<string>("");
  const [settingsTxEndDate, setSettingsTxEndDate] = useState<string>("");
  const [settingsTxSearch, setSettingsTxSearch] = useState<string>("");
  /* "All transactions" used to render every row it had in one pass, which is a long DOM and a
     visible jank spike on a busy account. It now reveals a page at a time; the sentinel under the
     last row pulls the next page in as it scrolls into view. */
  const [settingsTxVisible, setSettingsTxVisible] = useState(SETTINGS_TX_PAGE_SIZE);
  const [settingsTxLoadingMore, setSettingsTxLoadingMore] = useState(false);
  const settingsTxFetchingRef = useRef(false);
  const settingsTxObserverRef = useRef<IntersectionObserver | null>(null);

  /* Reset the window whenever the filters change, so a narrowed result set starts from the top
     instead of inheriting a page count from the previous query. */
  useEffect(() => {
    setSettingsTxVisible(SETTINGS_TX_PAGE_SIZE);
  }, [settingsTxSearch, settingsTxCategory, settingsTxStatus, settingsTxDatePreset, settingsTxStartDate, settingsTxEndDate]);

  /* A callback ref rather than an effect: the sentinel mounts and unmounts with the transactions
     view, and this re-attaches the observer on every mount without needing to enumerate the view
     state in a dependency array. */
  const attachSettingsTxSentinel = useCallback((node: HTMLDivElement | null) => {
    settingsTxObserverRef.current?.disconnect();
    settingsTxObserverRef.current = null;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || settingsTxFetchingRef.current) return;
        settingsTxFetchingRef.current = true;
        setSettingsTxLoadingMore(true);
        /* Short hold so the skeleton rows register as loading rather than flashing past. */
        window.setTimeout(() => {
          setSettingsTxVisible((previous) => previous + SETTINGS_TX_PAGE_SIZE);
          setSettingsTxLoadingMore(false);
          settingsTxFetchingRef.current = false;
        }, 400);
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    settingsTxObserverRef.current = observer;
  }, []);

  useEffect(() => () => settingsTxObserverRef.current?.disconnect(), []);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [savingSettingsField, setSavingSettingsField] = useState<string | null>(null);
  const [walletBackupLoading, setWalletBackupLoading] = useState(false);
  const [walletBackupError, setWalletBackupError] = useState<string | null>(null);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);
  /* Step-up verification state for private key export. */
  const [exportOtpStage, setExportOtpStage] = useState(false);
  const [exportOtpCode, setExportOtpCode] = useState("");
  const [exportOtpSending, setExportOtpSending] = useState(false);

  // Prepaid Metered Vault States
  const [vaults, setVaults] = useState<any[]>([]);
  const [isVaultsLoading, setIsVaultsLoading] = useState(false);
  const [configVaultOpen, setConfigVaultOpen] = useState(false);
  const [topupVaultOpen, setTopupVaultOpen] = useState(false);
  const [editingVault, setEditingVault] = useState<any | null>(null);
  const vaultCarouselRef = useRef<HTMLDivElement | null>(null);
  const [activeVaultIndex, setActiveVaultIndex] = useState(0);

  // Referrals States
  const [referrals, setReferrals] = useState<any[]>([]);
  const [referralLink, setReferralLink] = useState<string>("");
  const [referralsCount, setReferralsCount] = useState<number>(0);
  const [referralsLoading, setReferralsLoading] = useState<boolean>(false);
  /* Distinct from `referralsLoading`, which is still false on the first render pass before the
     fetch effect fires. Without this the section would flash its empty state before shimmering. */
  const [referralsLoaded, setReferralsLoaded] = useState<boolean>(false);
  const [referralCopySuccess, setReferralCopySuccess] = useState<boolean>(false);

  const { theme, setTheme } = useTheme();
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [accountSubView, setAccountSubView] = useState<AccountSubView>("menu");
  const [spendSearchQuery, setSpendSearchQuery] = useState("");
  const [spendCategory, setSpendCategory] = useState("all");
  const [spendStatus, setSpendStatus] = useState("all");
  const [spendDatePreset, setSpendDatePreset] = useState("all");
  const [spendStartDate, setSpendStartDate] = useState("");
  const [spendEndDate, setSpendEndDate] = useState("");
  /* "" = every month. Otherwise "YYYY-MM", which both scopes the list and picks the month whose
     In/Out totals are summarised above it. */
  const [spendMonth, setSpendMonth] = useState("");

  /* Cross-tab navigation aims at a sub-view, but the reset below fires on every activeTab
     change and would clobber it. Parking the intent here lets the reset itself perform the
     handoff, in order — the previous setTimeout only worked because the effect happened to
     flush first, which a slow frame or an edit to that effect would silently break. */
  const pendingAccountSubView = useRef<AccountSubView | null>(null);
  const [dataViewLoading, setDataViewLoading] = useState<AccountSubView | null>(null);

  const openSubView = useCallback((subView: AccountSubView) => {
    if (subView === "spend-analysis" || subView === "transactions") {
      setDataViewLoading(subView);
      window.setTimeout(() => setDataViewLoading((current) => current === subView ? null : current), 400);
    }
    setAccountSubView(subView);
  }, []);

  const goToAccountSubView = useCallback((tab: UserTab, subView: AccountSubView) => {
    pendingAccountSubView.current = subView;
    if (subView === "spend-analysis" || subView === "transactions") {
      setDataViewLoading(subView);
      window.setTimeout(() => setDataViewLoading((current) => current === subView ? null : current), 400);
    }
    setActiveTab(tab);
    /* Also applied directly, so the navigation still lands when activeTab is already `tab`
       and the effect never runs. Both paths set the same value, so ordering cannot matter. */
    setAccountSubView(subView);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    const pending = pendingAccountSubView.current;
    pendingAccountSubView.current = null;
    setAccountSubView(pending ?? "menu");
  }, [activeTab]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab") as UserTab | null;
      const urlSubView = params.get("subview") as AccountSubView | null;
      if (urlSubView === "spend-analysis" || window.location.hash === "#spend-analysis") {
        goToAccountSubView("dns", "spend-analysis");
      } else if (urlTab) {
        setActiveTab(urlTab);
        if (urlSubView) setAccountSubView(urlSubView);
      }
    }
  }, [goToAccountSubView]);

  const fetchReferrals = useCallback(async () => {
    setReferralsLoading(true);
    try {
      const res = await fetch("/api/user/referrals");
      const data = await res.json();
      if (data.success) {
        setReferrals(data.referrals || []);
        setReferralLink(data.referralLink || "");
        setReferralsCount(data.count || 0);
      }
    } catch (err) {
      console.error("Failed to fetch referrals:", err);
    } finally {
      setReferralsLoading(false);
      setReferralsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "referrals") {
      fetchReferrals();
    }
  }, [activeTab, fetchReferrals]);

  const loadUserSettings = async () => {
    setIsSettingsLoading(true);
    try {
      const [res, depositsRes] = await Promise.all([
        fetch("/api/user/settings"),
        fetch("/api/user/deposits").catch(() => null),
      ]);
      const data = await res.json();
      const depData = depositsRes ? await depositsRes.json().catch(() => ({})) : {};
      if (data.success) {
        setUserSettings(data.settings);
        setSettingsTransactions(data.receipts);
        if (data.settings.profilePic) setProfilePic(data.settings.profilePic);
        if (data.settings.alias) setRegisteredDomain(data.settings.alias);
      }
      if (depData.success && Array.isArray(depData.deposits)) {
        setDeposits(depData.deposits);
      }
    } catch (err) {
      console.error("Failed to load user settings:", err);
    } finally {
      setIsSettingsLoading(false);
    }
  };

  const loadVaults = async () => {
    setIsVaultsLoading(true);
    try {
      const [res, haltRes] = await Promise.all([
        fetch("/api/user/vault/config"),
        fetch("/api/user/commit/halt").catch(() => null),
      ]);
      const data = await res.json();
      if (data.success) {
        setVaults(data.vaults);
      }
      if (haltRes && haltRes.ok) {
        const haltData = await haltRes.json().catch(() => ({}));
        if (typeof haltData.onHold === "boolean") {
          setIsAccountOnHold(haltData.onHold);
        }
      }
    } catch (err) {
      console.error("Failed to load metered vaults:", err);
    } finally {
      setIsVaultsLoading(false);
    }
  };

  const handleToggleSetting = async (field: string, currentValue: boolean) => {
    if (comingSoonUserSettings.has(field)) return;
    setSavingSettingsField(field);
    try {
      const res = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !currentValue }),
      });
      const data = await res.json();
      if (data.success) {
        setUserSettings((prev: any) => ({ ...prev, [field]: !currentValue }));
      }
    } catch (err) {
      console.error(`Error saving user setting ${field}:`, err);
    } finally {
      setSavingSettingsField(null);
    }
  };

  /* Step 1: exporting a private key is the single most destructive action available, so it
     requires a fresh email verification code before the key is disclosed. */
  const requestExportOtp = async () => {
    const email = userSettings?.walletBackup?.email || userEmail;
    if (!email) {
      setWalletBackupError("No verified email is linked to this wallet, so the key cannot be exported here.");
      return;
    }
    setExportOtpSending(true);
    setWalletBackupError(null);
    setExportedPrivateKey(null);
    setPrivateKeyVisible(false);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not send a verification code. Try again.");
      }
      setExportOtpStage(true);
      setExportOtpCode("");
      triggerToast(`Verification code sent to ${email}.`);
    } catch (err: any) {
      setWalletBackupError(err.message || "Could not send a verification code.");
    } finally {
      setExportOtpSending(false);
    }
  };

  /* Step 2: confirm the code and reveal the key. */
  const handleExportWallet = async () => {
    setWalletBackupLoading(true);
    setWalletBackupError(null);
    setExportedPrivateKey(null);
    setPrivateKeyVisible(false);
    try {
      const res = await fetch("/api/user/wallet/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpCode: exportOtpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not export this wallet key.");
      }
      setExportedPrivateKey(data.privateKey);
      setPrivateKeyVisible(true);
      setExportOtpStage(false);
      setExportOtpCode("");
      triggerToast("Private key unlocked. Store it somewhere safe.");
    } catch (err: any) {
      setWalletBackupError(err.message || "Could not export this wallet key.");
    } finally {
      setWalletBackupLoading(false);
    }
  };

  const handleCopyPrivateKey = async () => {
    if (!exportedPrivateKey) return;
    await navigator.clipboard.writeText(exportedPrivateKey);
    triggerToast("Private key copied.");
  };

  const handleDownloadPrivateKey = () => {
    if (!exportedPrivateKey || !userWallet) return;
    const blob = new Blob([
      [
        "SubScript generated wallet private key backup",
        `Wallet: ${userWallet}`,
        `Created: ${new Date().toISOString()}`,
        "",
        exportedPrivateKey,
        "",
        "Store this offline. Anyone with this key can control this wallet.",
      ].join("\n"),
    ], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `subscript-wallet-${userWallet.slice(2, 10)}-backup.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const [batchRows, setBatchRows] = useState([{ address: "", amount: "" }]);

  /* Single Send lives in a pop-up modal now, so the tab body is dedicated to Batch Payouts.
     The single/batch sub-tab swap (and its swipe handler) is gone with it. */
  const [sendSingleModalOpen, setSendSingleModalOpen] = useState(false);
  const batchFormRef = useRef<HTMLDivElement | null>(null);

  /* "Send to multiple people" in the single-send sheet. The batch form is only mounted once the
     tab is active, so the scroll waits a frame for it to exist. On mobile the tab renders below
     the header, and landing on the header instead of the form reads as if nothing happened. */
  const handleGoToBatch = useCallback(() => {
    setSendSingleModalOpen(false);
    setActiveTab("batch");
    requestAnimationFrame(() => {
      batchFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);
  const [singleRecipient, setSingleRecipient] = useState("");
  const [singleAmount, setSingleAmount] = useState("");
  const [singleResolved, setSingleResolved] = useState<{ address: string | null; alias: string | null; profilePic: string | null } | null>(null);
  const [singleResolving, setSingleResolving] = useState(false);
  const [singleSendStatus, setSingleSendStatus] = useState<string | null>(null);
  const [singleSendLoading, setSingleSendLoading] = useState(false);

  const [batchSendStatus, setBatchSendStatus] = useState<string | null>(null);
  const [batchSendLoading, setBatchSendLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const { address: accountAddress, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  /* Operators can pause browser-wallet signing. A cross-chain withdrawal from a browser wallet needs
     three signatures from it, so the Send sheet has to know before it offers the route. */
  const { externalWalletEnabled } = usePlatformFlags();

  /* balanceOf only. useBalance({ token }) also reads decimals() and symbol() on every refetch, so a
     single balance cost 3 calls against Arc's public RPC — which rate-limits per RPC call (429,
     ~1/sec/IP), not per HTTP request. The extra reads raced the one we needed, readContracts runs
     with allowFailure:false, and the whole query rejected. USDC's decimals are fixed at 6 (the
     formatUnits below has always assumed it) and the symbol was never read, so both were pure cost. */
  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: userWallet ? [userWallet as `0x${string}`] : undefined,
    chainId: activeArcChain.id,
    query: { enabled: Boolean(userWallet) },
  });

  /* Every chain a deposit can start from, straight out of CCTP_CONFIG, so adding a chain there shows
     up in the Deposit sheet without a second edit. One balanceOf per chain, batched. This replaced a
     pair of hand-written Sepolia and Ethereum-mainnet reads whose addresses and chain ids were
     hardcoded here and drifted from the bridge config. */
  const depositOriginChains = useMemo(
    () =>
      Object.entries(CCTP_CONFIG)
        .filter(([, info]) => info.allowDeposits !== false)
        .map(([chainId, info]) => ({ chainId: Number(chainId), info }))
        /* Cheapest fee first, so Ethereum's 1% tier is not the default pick. */
        .sort((a, b) => a.info.feeBps - b.info.feeBps || a.info.name.localeCompare(b.info.name)),
    [],
  );

  const { data: originBalanceReads, refetch: refetchOriginBalances } = useReadContracts({
    contracts: depositOriginChains.map(({ chainId, info }) => ({
      address: info.usdc,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf" as const,
      args: userWallet ? [userWallet as `0x${string}`] : undefined,
      chainId,
    })),
    query: { enabled: Boolean(userWallet) },
  });

  const originBalances: DepositOriginBalance[] = depositOriginChains.map(({ chainId, info }, index) => {
    const read = originBalanceReads?.[index];
    const micros = read?.status === "success" ? BigInt(read.result as bigint) : 0n;
    return {
      chainId,
      name: info.name,
      feeBps: info.feeBps,
      feePercentage: formatFeeBps(info.feeBps),
      isL1: Boolean(info.isL1),
      balance: Number(formatUnits(micros, 6)),
      balanceMicros: micros,
    };
  });

  /* Drives whether the Deposit sheet opens on the chooser or straight to the address. Based on the
     CCTP chains we can actually bridge from, not on a fixed pair of them. */
  const hasExternalUsdc = originBalances.some((chain) => chain.balance > 0);

  /* Total USDC the user holds off Arc, for the send-routing notice. */
  const elsewhereUsdc = originBalances.reduce((sum, chain) => sum + chain.balance, 0);

  const walletBalance = usdcBalance !== undefined ? Number(formatUnits(usdcBalance, 6)) : 0;

  const handleManualRefreshBalances = async () => {
    if (isRefreshingBalances) return;
    setIsRefreshingBalances(true);
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      await Promise.race([
        Promise.all([
          refetchUsdc().catch(console.error),
          refetchOriginBalances().catch(console.error),
          loadVaults().catch(console.error),
          /* The 30D spending figure is derived from subscriptions and paid DMs, so a refresh that
             only touched wallet and vault balances left it showing a stale number underneath two
             fresh ones. */
          loadSubscriptions().catch(console.error),
          loadDms().catch(console.error),
          loadUserSettings().catch(console.error),
        ]),
        timeoutPromise,
      ]);
      triggerToast("Balance Refreshed");
    } catch (err) {
      console.error("Failed to refresh balances manually:", err);
      triggerToast("Balance Refreshed");
    } finally {
      setIsRefreshingBalances(false);
    }
  };

  const loadSubscriptions = async (): Promise<Subscription[] | null> => {
    try {
      const res = await fetch("/api/user/subscriptions");
      const data = await res.json();
      if (data.success) {
        setSubscriptions(data.subscriptions);
        /* Returned as well as stored. A caller that has just learned a row exists cannot read it
           back out of state in the same tick, and the resume hand-off below needs it immediately. */
        return data.subscriptions as Subscription[];
      }
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    }
    return null;
  };

  const loadRequestsCount = useCallback(async () => {
    try {
      const res = await fetch("/api/user/dm/requests");
      if (res.ok) {
        const data = await res.json();
        setPendingRequestsCount(data.pendingCount || 0);
      }
    } catch (err) {
      console.error("Failed to load requests count:", err);
    }
  }, []);

  const dmRequestSequence = useRef(0);
  const loadDms = useCallback(async () => {
    const requestSequence = ++dmRequestSequence.current;
    try {
      const res = await fetch("/api/user/dms");
      const data = await res.json();
      if (data.success && requestSequence === dmRequestSequence.current) setDms(data.dms);
      if (data.success && requestSequence === dmRequestSequence.current) {
        if (data.connections) setDmConnections(data.connections);
        if (data.blockedAddresses) setBlockedAddresses(data.blockedAddresses);
      }
      void loadRequestsCount();
    } catch (err) {
      console.error("Failed to load DMs:", err);
    }
  }, [loadRequestsCount]);

  /* Live inbox: poll DMs while visible. On focus/visibility or a checkout completion from another
     tab, refresh every payment-backed surface so balances, receipts, subscriptions and DMs agree. */
  useEffect(() => {
    if (!userWallet) return;
    const refreshAll = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void Promise.all([
          loadDms(),
          loadSubscriptions(),
          loadUserSettings(),
          refetchUsdc().catch(console.error),
        ]);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "subscript_payment_settled") refreshAll();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDms();
    }, 8000);
    window.addEventListener("focus", refreshAll);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", refreshAll);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshAll);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", refreshAll);
    };
    // loadSubscriptions/loadUserSettings are page-local fetchers; this effect is re-established
    // whenever the authenticated wallet changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userWallet, loadDms]);

  const loadRegisteredDns = async (walletAddress: string) => {
    try {
      const res = await fetch(`/api/merchant/alias?address=${walletAddress.toLowerCase()}`);
      const data = await res.json();
      if (data.success && data.alias) setRegisteredDomain(data.alias);
      if (data.success && data.profile_pic) setProfilePic(data.profile_pic);
    } catch (err) {
      console.warn("Failed to check registered domain:", err);
    }
  };

  const redirectTo = useCallback((url: string, message: string) => {
    setRedirectMessage(message);
    setRedirectUrl(url);
    setLoading(false);
  }, []);

  const verifySession = useCallback(async () => {
    try {
      setRedirectMessage(null);
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (!data.loggedIn) {
        redirectTo(getDashboardUrl("USER", "/login"), "Redirecting to login...");
        return;
      }

      if (!data.role) {
        redirectTo(getDashboardUrl("USER", "/signup"), "Redirecting to sign up...");
        return;
      }

      if (data.role !== "USER") {
        console.warn("Unauthorized role for user dashboard, redirecting to merchant dashboard");
        redirectTo(getDashboardUrl("ENTERPRISE", "/merchant"), "Redirecting to merchant dashboard...");
        return;
      }

      if (!data.isEmbedded && accountAddress && data.wallet.toLowerCase() !== accountAddress.toLowerCase()) {
        console.warn("Session wallet mismatch, logging out");
        await fetch("/api/auth/logout", { method: "POST" });
        redirectTo(getDashboardUrl("USER", "/login"), "Signing you out...");
        return;
      }

      setUserWallet(data.wallet);
      setUserEmail(data.email);
      setIsAdmin(Boolean(data.isAdmin));
      setIsEmbeddedWalletSession(Boolean(data.isEmbedded));
      await Promise.all([loadSubscriptions(), loadDms(), loadUserSettings(), loadVaults()]);
    } catch (e) {
      console.error("Session verification error:", e);
      redirectTo(getDashboardUrl("USER", "/login"), "Redirecting to login...");
    } finally {
      setLoading(false);
    }
  }, [accountAddress, redirectTo]);

  useEffect(() => {
    verifySession();
  }, [verifySession, accountAddress]);

  useEffect(() => {
    if (receiveOpen && userWallet) {
      refetchOriginBalances().catch(console.error);
      refetchUsdc().catch(console.error);
    }
  }, [receiveOpen, userWallet, refetchOriginBalances, refetchUsdc]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const intent = params.get("intent");
    if (requestedTab === "inbox") setActiveTab("inbox");
    if (requestedTab === "commit") setActiveTab("commit");
    if (intent) setFocusIntentId(intent);
  }, []);

  useEffect(() => {
    if (!focusIntentId || !userWallet || selectedDmPeer || dms.length === 0) return;
    const focusedDm = dms.find((dm) => dm.paymentLinkId === focusIntentId);
    if (focusedDm) {
      setSelectedDmPeer(getDmPeerAddress(focusedDm, userWallet).toLowerCase());
    }
  }, [dms, focusIntentId, selectedDmPeer, userWallet]);

  useEffect(() => {
    if (!userWallet || typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(`subscript_read_dms_${userWallet.toLowerCase()}`);
      if (stored) {
        setReadDmIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // ignore storage errors
    }
  }, [userWallet]);

  useEffect(() => {
    if (!selectedDmPeer || !userWallet || dms.length === 0) return;
    const threadDms = dms.filter(
      (dm) => getDmPeerAddress(dm, userWallet).toLowerCase() === selectedDmPeer.toLowerCase()
    );
    if (threadDms.length === 0) return;
    const ids = threadDms.map((dm) => dm.id);
    setReadDmIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (changed) {
        try {
          localStorage.setItem(
            `subscript_read_dms_${userWallet.toLowerCase()}`,
            JSON.stringify(Array.from(next))
          );
        } catch {
          // ignore
        }
        return next;
      }
      return prev;
    });
  }, [selectedDmPeer, userWallet, dms]);

  useEffect(() => {
    setDmRequestOpen(false);
    setDmRequestAmount("");
    setDmRequestNote("");
    setDmRequestDuration("24");
    setDmRequestStatus(null);
    setPlanManagerOpen(false);
    setPlanManagerStatus(null);
    setPlanManagerError(null);
  }, [selectedDmPeer]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.error("Logout request error:", e);
    }
    disconnect();
    redirectTo(getDashboardUrl("USER", "/login"), "Signing you out...");
  };

  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const handleDeleteAccount = () => {
    setConfirmModal({
      open: true,
      title: "Delete your account?",
      description: "This erases your profile, alias, and settings, and signs you out everywhere. Your payment receipts remain part of the shared ledger. Active subscriptions must be cancelled and vault funds withdrawn before deleting. This cannot be undone.",
      confirmLabel: "Delete Account",
      variant: "danger",
      requiredMatchText: "DELETE",
      matchPlaceholder: "Type DELETE",
      onConfirm: async () => {
        setConfirmModal(null);
        setDeleteAccountLoading(true);
        try {
          const res = await fetch("/api/user/account", { method: "DELETE" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            triggerToast(data.error || "Account deletion failed.");
            return;
          }
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          disconnect();
          redirectTo(getDashboardUrl("USER", "/signup"), "Deleting your account...");
        } catch {
          triggerToast("Account deletion failed. Please try again.");
        } finally {
          setDeleteAccountLoading(false);
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const copyAddress = async () => {
    if (!userWallet) return;
    await navigator.clipboard.writeText(userWallet);
    setCopiedAddress(true);
    triggerToast("Address copied to clipboard");
    setTimeout(() => setCopiedAddress(false), 1600);
  };

  const isOwnWalletAddress = (address: string | null | undefined) => {
    return Boolean(address && userWallet && address.toLowerCase() === userWallet.toLowerCase());
  };

  const sendFromEmbeddedWallet = async (payload: {
    receiverAddress?: string;
    amountUsdc?: string;
    recipients?: { receiverAddress: string; amountUsdc: string }[];
    /* Stable per logical send attempt; the server derives each transfer's Circle idempotency
       key from it, so a retry with the same key cannot pay a recipient twice. */
    requestKey?: string;
  }) => {
    const { requestKey, ...body } = payload;
    const res = await fetch("/api/user/wallet/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(requestKey ? { "x-request-id": requestKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const err = new Error(data.error || "Failed to send USDC from your generated wallet.");
      /* On a partial batch failure the API returns the transfers that already settled; surface
         them so a retry only covers the remaining recipients instead of double-paying. */
      (err as any).partial = Boolean(data.partial);
      (err as any).settledTransfers = data.transfers || [];
      throw err;
    }
    return data.transfers as { receiverAddress: string; amountUsdc: string; txHash: string }[];
  };

  const runAction = async (key: string, task: () => Promise<void>) => {
    setLoadingAction(key);
    try {
      await task();
    } finally {
      setTimeout(() => setLoadingAction(null), 450);
    }
  };

  const handleUpdateDmStatus = async (dmId: string, newStatus: string) => {
    const res = await fetch("/api/user/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dmId, status: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to update DM status");
    await loadDms();
  };

  const getActiveSubscriptionForMerchant = (merchantAddress: string | null | undefined) => {
    if (!merchantAddress) return null;
    return subscriptions.find(
      (sub) => sub.merchantAddress.toLowerCase() === merchantAddress.toLowerCase() && sub.status === "ACTIVE"
    ) || null;
  };

  /* Mirror-gap self-heal: a subscription can be live on-chain (the user was charged and
     has the SUBSCRIPTION_STARTED DM) while the local mirror row is missing, which hides
     the Manage/Cancel controls. When a merchant thread is opened and we know of no active
     subscription with them, ask the server to reconcile from the chain once per peer. */
  const reconciledPeersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedDmPeer || !userWallet) return;
    const peer = selectedDmPeer.toLowerCase();
    if (reconciledPeersRef.current.has(peer)) return;
    const hasActive = subscriptions.some(
      (sub) => sub.merchantAddress.toLowerCase() === peer && sub.status === "ACTIVE"
    );
    if (hasActive) return;
    reconciledPeersRef.current.add(peer);
    fetch(`/api/user/subscriptions?reconcileMerchant=${encodeURIComponent(peer)}`)
      .then((res) => res.json())
      .then((data) => { if (data.success) setSubscriptions(data.subscriptions); })
      .catch((err) => console.error("[dashboard] merchant reconcile failed:", err));
  }, [selectedDmPeer, userWallet, subscriptions]);

  const loadPlansForMerchant = async (merchantAddress: string) => {
    setIsThreadPlansLoading(true);
    setPlanManagerError(null);
    try {
      const res = await fetch(`/api/merchant/plans?merchantAddress=${encodeURIComponent(merchantAddress)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to load merchant plans.");
      setThreadPlans(data.plans || []);
      setPlansMerchantAddress(merchantAddress.toLowerCase());
    } catch (err: any) {
      setPlanManagerError(err.message || "Failed to load merchant plans.");
    } finally {
      setIsThreadPlansLoading(false);
    }
  };

  const handleTogglePlanManager = async () => {
    if (!selectedDmPeer) return;
    const nextOpen = !planManagerOpen;
    setPlanManagerOpen(nextOpen);
    setPlanManagerStatus(null);
    setPlanManagerError(null);
    if (nextOpen && plansMerchantAddress !== selectedDmPeer.toLowerCase()) {
      await loadPlansForMerchant(selectedDmPeer);
    }
  };

  /* Subscribing is no longer something the dashboard does.
   *
   * There used to be a handleSubscribeOrSwitchPlan here that authorized on-chain straight from the
   * merchant thread. It carried the whole rate-comparison rulebook in the client — refuse an equal
   * rate, refuse a reduction, send upgrades to the merchant's own page — and still disclosed none of
   * the terms /subscribe/[planId] shows before someone commits money. Both callers now open that
   * page instead: the offer DM (handleConfirmPaymentDm) and the plan catalogue, which is read-only.
   *
   * The rate rules were never really the client's to enforce. The plan-change endpoint returns
   * PLAN_REDUCTION_NOT_ALLOWED and the upgrade endpoint returns NOT_AN_UPGRADE, and those remain the
   * guards.
   *
   * Resume is deliberately untouched and still settles in-app — it mints a free bridge authorization
   * for time already paid for, which is not a checkout and must not become one. */

  /* Resume a subscription the user canceled but is still inside the paid period.
     Cancel revokes the on-chain PSA authorization immediately (see subscription/cancel), so this
     cannot be a flag flip — but it must not be a re-subscribe either, which is what it used to be:
     it ran the canceled terms back through /subscribe and charged the full amount a second time for
     a period the user had already paid for. /api/user/subscription/resume mints a bridge
     authorization whose first cycle is free and whose length is the time still remaining, so nothing
     is charged today and the next charge lands on the original billing date. */
  const [resumingSubscriptionId, setResumingSubscriptionId] = useState<string | null>(null);

  /* Jump from a subscription straight into that merchant's conversation.
   *
   * The Active Subscriptions panel states what a subscriber is paying and when it renews, but every
   * action beyond resume lives in the thread — the plan catalogue (and so the upgrade link out to the
   * merchant's own page), cancel, and the lifecycle notices for that merchant. Without this the only
   * route was to switch to Inbox and find the merchant by name in the thread list, which on a busy
   * inbox is a search rather than a click. */
  const openMerchantThread = (merchantAddress: string) => {
    setSelectedDmPeer(merchantAddress.toLowerCase());
    setActiveTab("inbox");
  };

  const handleResumeSubscription = async (subscription: Subscription) => {
    if (resumingSubscriptionId) return;

    const paidThrough = subscription.nextBillingDate ? new Date(subscription.nextBillingDate) : null;
    const paidThroughLabel = paidThrough ? paidThrough.toLocaleDateString() : "your next billing date";

    setConfirmModal({
      open: true,
      title: "Resume this subscription",
      /* States the two facts a returning subscriber actually wants: nothing leaves their wallet now,
         and exactly when it will. The old flow promised neither and then debited them. */
      description: `You won't be charged anything today — you've already paid through ${paidThroughLabel}. Billing resumes on ${paidThroughLabel} at the same price.`,
      confirmLabel: "Resume",
      cancelLabel: "Not now",
      variant: "default",
      onConfirm: async () => {
        setConfirmModal(null);
        setResumingSubscriptionId(subscription.subscriptionId);
        await runAction(`resume-sub-${subscription.subscriptionId}`, async () => {
          setPlanManagerStatus("Restoring your subscription on-chain...");
          setPlanManagerError(null);
          const res = await fetch("/api/user/subscription/resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscriptionId: subscription.subscriptionId }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            /* The period is ending or has ended, so no free bridge exists. Say that rather than
               reporting a generic failure — resubscribing from here is a new paid period. */
            if (data.code === "RESUME_WINDOW_TOO_SHORT" || data.code === "PERIOD_ALREADY_ENDED") {
              throw new Error(`${data.error} Pick the plan again from the merchant's thread to start a new period.`);
            }
            throw new Error(data.error || "Could not resume this subscription.");
          }
          const nextCharge = data.nextChargeAt ? new Date(data.nextChargeAt).toLocaleDateString() : null;
          setPlanManagerStatus(
            nextCharge
              ? `Subscription resumed. Nothing was charged — next payment ${nextCharge}.`
              : "Subscription resumed. Nothing was charged today."
          );
          triggerToast("Subscription resumed — no charge today");
          await Promise.all([loadSubscriptions(), loadDms(), refetchUsdc().catch(() => {})]);
        }).catch((err: any) => {
          setPlanManagerError(err?.message || "Could not resume this subscription.");
          triggerToast(err?.message || "Could not resume this subscription.");
        });
        setResumingSubscriptionId(null);
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  /* Deliberately unreferenced for now.
   *
   * "Ask a Friend to Pay" was the only caller, and that button is gone from the plan cards along with
   * Subscribe — the catalogue is read-only. The rest of the flow is kept whole and working (this
   * opener, the modal, handleCreateGiftPlanRequest, /api/user/requests/merchant-plan) because
   * sponsoring someone else's plan is a feature we want back, just not from a browse-only card.
   * Wire this to a new entry point rather than rebuilding it. */
  const openGiftPlanModal = (plan: MerchantPlan) => {
    setGiftPlan(plan);
    setGiftTab("friends");
    setSelectedGiftFriendAddress("");
    setGiftFriendUsername("");
    setGiftRequestUrl(null);
    setGiftRequestError(null);
    setGiftRequestCopied(false);
  };

  const copyGiftRequestUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setGiftRequestCopied(true);
    triggerToast("Gift checkout link copied!");
    setTimeout(() => setGiftRequestCopied(false), 1600);
  };

  const handleCreateGiftPlanRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!giftPlan) return;
    setGiftRequestError(null);
    setGiftRequestBusyPlanId(giftPlan.id);
    try {
      const res = await fetch("/api/user/requests/merchant-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantAddress: giftPlan.merchantAddress,
          planId: giftPlan.id,
          amountUsdcMicros: giftPlan.amountUsdc,
          title: `Sponsor ${giftPlan.name}`,
          description: giftPlan.description || `Gift checkout for ${giftPlan.name}`,
          targetAddress: selectedGiftFriendAddress || undefined,
          friendUsername: giftFriendUsername.trim() || undefined,
          sendDirectMessage: giftTab === "friends",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Could not create gift request.");

      if (giftTab === "friends") {
        triggerToast("Sponsorship request sent to friend in DM!");
        setGiftPlan(null);
      } else {
        const absoluteUrl = typeof data.checkoutUrl === "string" && /^https?:\/\//i.test(data.checkoutUrl)
          ? data.checkoutUrl
          : `${window.location.origin}${data.checkoutUrl || `/pay/${data.paymentLinkId}`}`;
        setGiftRequestUrl(absoluteUrl);
        await copyGiftRequestUrl(absoluteUrl).catch(() => {});
      }
    } catch (err: any) {
      setGiftRequestError(err.message || "Could not create gift request.");
    } finally {
      setGiftRequestBusyPlanId(null);
    }
  };

  const handleCancelSubscriptionForMerchant = async (merchantAddress: string) => {
    const activeSub = getActiveSubscriptionForMerchant(merchantAddress);
    if (!activeSub) {
      setPlanManagerError("No active subscription found for this merchant.");
      return;
    }
    await new Promise<void>((resolve) => {
      setConfirmModal({
        open: true,
        title: "Cancel Subscription",
        description: "This will cancel the subscription on-chain. Access may stop immediately, and the cancellation cannot be undone.",
        confirmLabel: "Cancel Plan",
        variant: "warning",
        onConfirm: async () => {
          setConfirmModal(null);
          await runAction(`cancel-sub-${activeSub.subscriptionId}`, async () => {
            setPlanManagerStatus("Cancelling subscription...");
            setPlanManagerError(null);
            const res = await fetch("/api/user/subscription/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subscriptionId: activeSub.subscriptionId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || "Cancel transaction failed.");
            if (data.message) {
              setPlanManagerStatus(data.message);
              triggerToast("Subscription cancelled");
            } else if (data.cancelAtPeriodEnd && data.accessUntil) {
              const until = new Date(data.accessUntil).toLocaleDateString();
              setPlanManagerStatus(`Cancelled. You keep access until ${until}.`);
              triggerToast(`Cancelled: access until ${until}`);
            } else {
              setPlanManagerStatus("Subscription cancelled on-chain.");
              triggerToast("Subscription cancelled on-chain");
            }
            await Promise.all([loadSubscriptions(), loadDms(), refetchUsdc().catch(() => {})]);
          }).catch((err: any) => {
            setPlanManagerError(err.message || "Cancel transaction failed.");
          });
          resolve();
        },
        onCancel: () => {
          setConfirmModal(null);
          resolve();
        },
      });
    });
  };

  const handleConfirmPaymentDm = async (dm: DmMessage) => {
    /* An assigned subscription offer opens the real checkout rather than authorizing from inside the
       thread.

       Subscribing in place meant the terms a subscriber agreed to — promotion, minimum commitment,
       the price the intro reverts to, the email-verified gate — were all disclosed on
       /subscribe/[planId] and none of them on the way through this button. The offer carries its own
       checkout session id, and that route accepts one directly (it falls back from merchant_plans to
       payment_links), so the link needs no plan lookup. */
    /* Assigned subscription offer: show a review modal inside the thread instead of navigating
       to the external checkout page. The user sees the terms and confirms without leaving the DM. */
    if (dm.messageType === "SUBSCRIPTION_OFFER") {
      if (!dm.paymentLinkId) return;
      const _subscribeUrl = buildSubscribeUrl(dm.paymentLinkId);
      setSubscribeReviewDm(dm);
      setSubscribeReviewError(null);
      return;
    }

    /* Other merchant requests settle through the hosted one-time checkout. */
    if (dm.messageType !== "PEER_REQUEST") {
      if (!dm.paymentLinkId) return;
      const checkoutUrl = `/pay/${dm.paymentLinkId}`;
      const opened = window.open("about:blank", "_blank");
      if (opened) {
        opened.opener = null;
        opened.location.href = checkoutUrl;
      } else {
        router.push(checkoutUrl);
      }
      return;
    }

    /* Peer (user-to-user) requests are NOT merchant payments — they settle as a direct
       USDC transfer to the requester, exactly like "Send Funds". Routing them through the
       merchant /pay checkout (depositForMerchant) is why paying a peer request stalled. */
    if (!dm.amountUsdc) return;
    const amountMicros = dm.amountUsdc;
    const requesterAddress = dm.senderAddress;
    const humanAmount = microsToUsdcString(amountMicros);

    await runAction(`pay-${dm.id}`, async () => {
      let txHash: string | undefined;

      if (isEmbeddedWalletSession) {
        const transfers = await sendFromEmbeddedWallet({
          receiverAddress: requesterAddress,
          amountUsdc: humanAmount,
          /* A peer request is paid at most once — keying on the DM id makes any retry of
             this payment dedupe at Circle instead of paying the requester twice. */
          requestKey: `dm-pay:${dm.id}`,
        });
        txHash = transfers[0]?.txHash;
      } else {
        if (!accountAddress) {
          throw new Error("Connect your wallet to pay this request.");
        }
        /* Connected-wallet accounts must be on Arc before the USDC transfer settles. */
        if (chainId !== activeArcChain.id) {
          await switchChainAsync({ chainId: activeArcChain.id });
        }
        txHash = await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: [
            {
              type: "function",
              name: "transfer",
              stateMutability: "nonpayable",
              inputs: [
                { name: "recipient", type: "address" },
                { name: "value", type: "uint256" },
              ],
              outputs: [{ name: "success", type: "bool" }],
            },
          ] as const,
          functionName: "transfer",
          args: [requesterAddress as `0x${string}`, BigInt(amountMicros)],
        });
      }

      /* Mark the request handled and keep the transfer receipt in the thread. */
      await handleUpdateDmStatus(dm.id, "APPROVED");
      if (txHash) {
        await fetch("/api/user/dms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "log-transfer",
            receiverAddress: requesterAddress,
            amountUsdc: humanAmount,
            txHash,
            title: `${humanAmount} USDC Sent`,
            description: dm.title ? `Paid request: ${dm.title}` : "Paid in-DM payment request.",
          }),
        });
      }
      triggerToast(`Sent ${humanAmount} USDC`);
      await Promise.all([loadDms(), refetchUsdc().catch(() => {})]);
    }).catch((err: any) => triggerToast(err?.message || "Could not complete the payment."));
  };

  const handleConfirmSubscription = async () => {
    if (!subscribeReviewDm?.paymentLinkId) return;
    setSubscribeReviewBusy(true);
    setSubscribeReviewError(null);
    try {
      const subscribeEndpoint = ["/api/user/subscription", "subscribe"].join("/");
      const res = await fetch(subscribeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: subscribeReviewDm.paymentLinkId,
          checkoutSessionId: subscribeReviewDm.paymentLinkId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || json?.message || "Could not complete subscription.");
      }
      /* Mark the DM as handled and refresh subscriptions */
      await handleUpdateDmStatus(subscribeReviewDm.id, "APPROVED");
      triggerToast("Subscription activated!");
      await Promise.all([loadSubscriptions(), loadDms(), refetchUsdc().catch(() => {})]);
      setSubscribeReviewDm(null);
    } catch (err: any) {
      setSubscribeReviewError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubscribeReviewBusy(false);
    }
  };

  const handleDeclineDm = async (dm: DmMessage) => {
    await runAction(`decline-${dm.id}`, async () => handleUpdateDmStatus(dm.id, "DECLINED"));
  };

  const handleDismissDm = async (dm: DmMessage) => {
    await runAction(`dismiss-${dm.id}`, async () => handleUpdateDmStatus(dm.id, "DISMISSED"));
  };

  const sendDmReaction = async (dm: DmMessage, title: string, description: string) => {
    const res = await fetch("/api/user/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "log-reaction",
        receiverAddress: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverAddress : dm.senderAddress,
        title,
        description,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Surface rate-limit (429) and other failures in-app; nothing is emailed.
      triggerToast(data.error || "Could not send that reaction.");
      return;
    }
    await loadDms();
  };

  const handleNudgeSuggestion = async (dm: DmMessage) => {
    await runAction(`nudge-${dm.id}`, async () => {
      // Brief shimmer for tactile feedback before the reaction posts.
      await new Promise(resolve => setTimeout(resolve, 700));
      await sendDmReaction(dm, "Payment Nudge", "Nudged to approve the pending payment request.");
    });
  };

  const handleThanksSuggestion = async (dm: DmMessage) => {
    await runAction(`thanks-${dm.id}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await sendDmReaction(dm, "Thanks ❤️", "Sent thanks response");
    });
  };

  const handleCancelPlanSuggestion = async (dm: DmMessage) => {
    const merchantAddress = dm.senderAddress.toLowerCase();
    await handleCancelSubscriptionForMerchant(merchantAddress);
    await handleUpdateDmStatus(dm.id, "DECLINED").catch(() => {});
  };

  const handleSurveySubmit = async (dm: DmMessage, response: string) => {
    await runAction(`survey-${dm.id}-${response}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await handleUpdateDmStatus(dm.id, response);
    });
  };

  const handleCreateDmRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDmPeer) return;

    setDmRequestStatus(null);
    await runAction("create-dm-request", async () => {
      const res = await fetch("/api/user/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverAddress: selectedDmPeer,
          amountUsdc: dmRequestAmount,
          title: dmRequestBillingType === "RECURRING" ? "Recurring Subscription" : "DM payment request",
          description: dmRequestNote || (dmRequestBillingType === "RECURRING" ? "SubScript recurring subscription request" : "SubScript in-DM payment request"),
          expiresInHours: Number(dmRequestDuration),
          billingType: dmRequestBillingType,
          interval: dmRequestInterval,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send DM request");

      setDmRequestStatus(dmRequestBillingType === "RECURRING" ? "Recurring subscription request sent." : "Request sent inside this DM.");
      setDmRequestOpen(false);
      setDmRequestAmount("");
      setDmRequestNote("");
      setDmRequestDuration("24");
      setDmRequestBillingType("ONE_TIME");
      await loadDms();
    }).catch((err) => setDmRequestStatus(err.message));
  };

  /* Step 1: email a verification code (the email isn't bound until the code is confirmed). */
  const handleSendEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailPromptError(null);
    const value = emailPromptValue.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailPromptError("Enter a valid email address.");
      return;
    }
    setEmailPromptSaving(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, purpose: "bind_wallet_email" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not send a verification code.");
      setEmailPromptCode("");
      setEmailPromptStep("code");
    } catch (err: any) {
      setEmailPromptError(err.message || "Could not send a verification code.");
    } finally {
      setEmailPromptSaving(false);
    }
  };

  /* Step 2: confirm the code — only then is the email bound to this wallet account. */
  const handleVerifyEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailPromptError(null);
    const code = emailPromptCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setEmailPromptError("Enter the 6-digit code we emailed you.");
      return;
    }
    setEmailPromptSaving(true);
    try {
      const res = await fetch("/api/user/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailPromptValue.trim(), code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not confirm your email.");
      setUserEmail(data.email);
      setEmailPromptValue("");
      setEmailPromptCode("");
      setEmailPromptStep("email");
    } catch (err: any) {
      setEmailPromptError(err.message || "Could not confirm your email.");
    } finally {
      setEmailPromptSaving(false);
    }
  };

  const openVaultCommit = (merchant?: string) => {
    setVaultActionMode("commit");
    setVaultActionMerchant(merchant || "");
    setVaultActionMerchantLocked(Boolean(merchant));
    setVaultActionAmount("");
    setVaultActionError(null);
    setVaultUnverifiedWarning(false);
    setVaultActionOpen(true);
  };

  const openVaultWithdraw = (merchant: string) => {
    setVaultActionMode("withdraw");
    setVaultActionMerchant(merchant);
    setVaultActionMerchantLocked(true);
    setVaultActionAmount("");
    setVaultActionError(null);
    setVaultUnverifiedWarning(false);
    setVaultActionOpen(true);
  };

  /* Liveness escape hatch: reclaim the full escrow from a matured-but-never-settled vault
     once the contract's 7-day grace has elapsed. Embedded wallets sign server-side; external
     wallets sign reclaimAbandonedEscrow directly. */
  const [vaultReclaimBusyId, setVaultReclaimBusyId] = useState<string | null>(null);
  const handleVaultReclaim = async (vault: any) => {
    if (vaultReclaimBusyId) return;
    setVaultReclaimBusyId(String(vault.id || vault.merchantAddress));
    try {
      if (isEmbeddedWalletSession) {
        const res = await fetch("/api/user/vault/reclaim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantAddress: vault.merchantAddress }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || "Reclaim failed.");
      } else {
        if (!accountAddress) throw new Error("Connect your browser wallet to reclaim.");
        if (chainId !== activeArcChain.id) {
          await switchChainAsync({ chainId: activeArcChain.id });
        }
        const reclaimHash = await writeContractAsync({
          address: SUBSCRIPT_VAULT_ADDRESS,
          abi: [{ type: "function", name: "reclaimAbandonedEscrow", stateMutability: "nonpayable", inputs: [{ name: "merchant", type: "address" }], outputs: [] }] as const,
          functionName: "reclaimAbandonedEscrow",
          args: [vault.merchantAddress as `0x${string}`],
        });
        const reclaimReceipt = await publicClient.waitForTransactionReceipt({ hash: reclaimHash });
        if (reclaimReceipt.status !== "success") {
          throw new Error("The reclaim transaction reverted. Your vault remains unchanged.");
        }
        const syncRes = await fetch("/api/user/vault/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantAddress: vault.merchantAddress }),
        });
        if (!syncRes.ok) {
          throw new Error("Reclaim confirmed on-chain, but the vault could not be refreshed. Retry to synchronize it.");
        }
      }
      await loadVaults();
    } catch (err: any) {
      setVaultActionError(err?.message || "Reclaim failed.");
      setVaultActionOpen(true);
      setVaultActionMode("withdraw");
      setVaultActionMerchant(vault.merchantAddress);
      setVaultActionMerchantLocked(true);
    } finally {
      setVaultReclaimBusyId(null);
    }
  };

  /* Stop (pause) a metered service: tell the merchant to stop rendering + stop billing new
     usage. The escrow stays locked until the cycle ends (contract rule). Only usage already
     reported this cycle is settled; the user can resume anytime while their commit balance
     meets the 2 USDC platform minimum, or top up to resume. */
  const [vaultCancelBusyId, setVaultCancelBusyId] = useState<string | null>(null);
  const handleCancelService = (vault: any) => {
    setConfirmModal({
      open: true,
      variant: "warning",
      title: "Stop this service",
      description:
        "We'll notify the merchant to pause your service and stop billing new usage — further usage reports are rejected immediately. You're charged only for usage already reported this cycle. Resume anytime while your committed balance is at least 2 USDC; below that, top up to resume.",
      confirmLabel: "Stop service",
      onConfirm: async () => {
        setConfirmModal(null);
        const id = String(vault.id || vault.merchantAddress);
        setVaultCancelBusyId(id);
        try {
          const res = await fetch("/api/user/vault/cancel-service", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ merchantAddress: vault.merchantAddress }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) throw new Error(data.error || "Could not stop the service.");
          triggerToast("Service paused — the merchant has been notified.");
          await Promise.all([loadVaults(), loadDms()]);
        } catch (err: any) {
          triggerToast(err?.message || "Could not stop the service.");
        } finally {
          setVaultCancelBusyId(null);
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  /* Resume a paused service. The platform minimum (2 USDC) is enforced server-side; a
     TOP_UP_REQUIRED reply routes straight into the commit modal for this merchant. */
  const [vaultResumeBusyId, setVaultResumeBusyId] = useState<string | null>(null);
  const handleResumeService = async (merchantAddress: string) => {
    if (vaultResumeBusyId) return;
    setVaultResumeBusyId(merchantAddress);
    try {
      const res = await fetch("/api/user/vault/resume-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantAddress }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 && data.code === "TOP_UP_REQUIRED") {
        triggerToast("Top up to at least 2 USDC to resume this service.");
        openVaultCommit(merchantAddress);
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.error || "Could not resume the service.");
      triggerToast("Service resumed — the merchant has been notified.");
      await Promise.all([loadVaults(), loadDms()]);
    } catch (err: any) {
      triggerToast(err?.message || "Could not resume the service.");
    } finally {
      setVaultResumeBusyId(null);
    }
  };

  /* Stable per commit attempt: a retry after a timed-out response reuses the key, so the
     server-side Circle idempotency key dedupes instead of escrowing the amount twice. */
  const vaultCommitRequestKey = useRef<string | null>(null);

  const submitVaultAction = async (event?: React.FormEvent, opts?: { acknowledgedUnverified?: boolean }) => {
    event?.preventDefault();
    setVaultActionError(null);
    /* /api/auth/session only exposes emails returned by getVerifiedAccountEmail, so userEmail is
       the client-side source of truth for the same OTP/trusted-provider check enforced server-side. */
    if (vaultActionMode === "commit" && !userEmail) {
      setVaultActionError("Verify your email before committing.");
      return;
    }
    if (!vaultActionAmount || isNaN(Number(vaultActionAmount)) || Number(vaultActionAmount) <= 0) {
      setVaultActionError("Enter a valid amount.");
      return;
    }
    const acknowledgedUnverified = opts?.acknowledgedUnverified === true;
    setVaultActionBusy(true);
    try {
      // Customer-facing vault setup accepts a friendly SubScript name only.
      let merchantAddress = vaultActionMerchant.trim();
      if (!vaultActionMerchantLocked && merchantAddress.startsWith("0x")) {
        throw new Error("Enter the merchant's SubScript name instead of a wallet address.");
      }
      if (!merchantAddress.startsWith("0x")) {
        const response = await fetch(`/api/merchant/alias?alias=${encodeURIComponent(merchantAddress)}`);
        const data = await response.json().catch(() => ({}));
        if (!data.success || !data.address) throw new Error("Could not find that merchant name.");
        merchantAddress = data.address;
      }

      /* Committing escrows funds a merchant can bill metered usage against, so warn before
         committing to a merchant SubScript hasn't verified. Applies to BOTH wallet paths (the
         external-wallet path signs on-chain directly and never hits the server gate). Fail open on
         a lookup error — this is an informed-consent warning, not a hard gate. */
      if (vaultActionMode === "commit" && !acknowledgedUnverified) {
        const verified = await fetch(`/api/merchant/profile?address=${merchantAddress}`)
          .then((r) => r.json())
          .then((d) => d?.verified !== false)
          .catch(() => true);
        if (!verified) {
          setVaultUnverifiedWarning(true);
          setVaultActionBusy(false);
          return;
        }
      }

      if (isEmbeddedWalletSession) {
        // Embedded wallet: SubScript signs server-side (and sponsors gas).
        const endpoint = vaultActionMode === "commit" ? "/api/user/vault/commit" : "/api/user/vault/withdraw";
        const intentStorageKey = "subscript_vault_commit_intent";
        if (vaultActionMode === "commit") {
          /* Durable money-moving operation id: persisted in localStorage until terminal
             resolution, so a reload cannot mint a fresh id for the same commit. Any prior
             unresolved intent is resolved server-side BEFORE a new commit is allowed. */
          let storedIntent: { requestId?: string; merchantAddress?: string; amountUsdc?: string } | null = null;
          try { storedIntent = JSON.parse(localStorage.getItem(intentStorageKey) || "null"); } catch { storedIntent = null; }
          if (storedIntent?.requestId
              && (storedIntent.merchantAddress !== merchantAddress || storedIntent.amountUsdc !== vaultActionAmount)) {
            const priorResponse = await fetch(`/api/user/vault/commit?requestId=${encodeURIComponent(storedIntent.requestId)}`)
              .catch(() => null);
            if (!priorResponse?.ok) {
              throw new Error("Unable to verify the previous vault commit. Retry after its status can be confirmed.");
            }
            const prior = await priorResponse.json().catch(() => null);
            if (!prior || typeof prior.exists !== "boolean") {
              throw new Error("The previous vault commit returned an invalid status. Retry before starting a new commit.");
            }
            if (prior?.exists && (prior.status === "PENDING" || prior.status === "SUBMITTED")) {
              throw new Error("A previous vault commit is still resolving. Retry that exact commit (same merchant and amount), or wait for it to finish before starting a new one.");
            }
            const terminal = prior.exists === false
              || (prior.exists === true && (prior.status === "MIRRORED" || prior.status === "FAILED"));
            if (!terminal) {
              throw new Error("The previous vault commit has an unknown status. Retry before starting a new commit.");
            }
            try { localStorage.removeItem(intentStorageKey); } catch { /* no-op */ }
            storedIntent = null;
          }
          vaultCommitRequestKey.current = storedIntent?.requestId || vaultCommitRequestKey.current || crypto.randomUUID();
          try {
            localStorage.setItem(intentStorageKey, JSON.stringify({
              requestId: vaultCommitRequestKey.current,
              merchantAddress,
              amountUsdc: vaultActionAmount,
            }));
          } catch { /* the in-memory ref still guards this tab */ }
        }
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(vaultActionMode === "commit" && vaultCommitRequestKey.current
              ? { "x-request-id": vaultCommitRequestKey.current }
              : {}),
          },
          body: JSON.stringify({ merchantAddress, amountUsdc: vaultActionAmount, acknowledgeUnverified: acknowledgedUnverified || undefined }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          /* An ambiguous commit stays persisted — the retry reuses the same request id and
             dedupes at Circle instead of escrowing twice. */
          throw new Error(data.error || "Vault action failed.");
        }
        if (vaultActionMode === "commit") {
          vaultCommitRequestKey.current = null;
          try { localStorage.removeItem(intentStorageKey); } catch { /* no-op */ }
        }
      } else {
        // External/browser wallet: sign the vault transactions client-side, then refresh the mirror.
        if (!accountAddress) throw new Error("Connect your browser wallet to manage your vault.");
        if (chainId !== activeArcChain.id) {
          await switchChainAsync({ chainId: activeArcChain.id });
        }
        const amountMicros = parseUnits(limitDecimals(vaultActionAmount, 6), 6);

        if (vaultActionMode === "commit") {
          const allowance = (await publicClient.readContract({
            address: USDC_NATIVE_GAS_ADDRESS,
            abi: VAULT_TOKEN_ABI,
            functionName: "allowance",
            args: [accountAddress as `0x${string}`, SUBSCRIPT_VAULT_ADDRESS],
          })) as bigint;
          if (allowance < amountMicros) {
            const approveHash = await writeContractAsync({
              address: USDC_NATIVE_GAS_ADDRESS,
              abi: VAULT_TOKEN_ABI,
              functionName: "approve",
              args: [SUBSCRIPT_VAULT_ADDRESS, amountMicros],
            });
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
          const commitHash = await writeContractAsync({
            address: SUBSCRIPT_VAULT_ADDRESS,
            abi: VAULT_CONTRACT_ABI,
            functionName: "commit",
            args: [merchantAddress as `0x${string}`, amountMicros],
          });
          await publicClient.waitForTransactionReceipt({ hash: commitHash });
        } else {
          const withdrawHash = await writeContractAsync({
            address: SUBSCRIPT_VAULT_ADDRESS,
            abi: VAULT_CONTRACT_ABI,
            functionName: "withdrawSurplus",
            args: [merchantAddress as `0x${string}`, amountMicros],
          });
          await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
        }

        // Refresh the off-chain mirror from chain (read-only on the server).
        await fetch("/api/user/vault/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantAddress }),
        }).catch(() => {});
      }
      triggerToast(vaultActionMode === "commit" ? "Committed to vault" : "Withdrew from vault");
      setVaultActionOpen(false);
      await loadVaults().catch(() => {});
    } catch (err: any) {
      if (err.message?.includes("User rejected the request")) {
        setVaultActionError("Transaction signature was rejected by user.");
      } else {
        setVaultActionError(err.message || "Vault action failed.");
      }
    } finally {
      setVaultActionBusy(false);
    }
  };

  /**
   * Two scanners, two jobs.
   *
   * Inside Send (or a batch row) the only useful answer is a recipient: an address, or an alias we
   * can resolve. A checkout or DM-invite link is not a recipient, so it is refused rather than pasted
   * into the address box as a URL. The scanner on the dashboard itself is the opposite: it is there to
   * open payment links, subscriptions and receipts.
   */
  const handleScanQrResult = (scannedText: string) => {
    const target = resolveScannedTarget(scannedText);
    const scanningForRecipient = sendSingleModalOpen || qrTargetIndex !== null;

    if (scanningForRecipient) {
      setQrScannerOpen(false);

      if (target.kind === "link") {
        const complaint = "That code opens a SubScript page, not a wallet address. Scan an address instead.";
        if (qrTargetIndex === null) setSingleSendStatus(complaint);
        else setBatchSendStatus(complaint);
        return;
      }

      /* An address if the code carried one, otherwise the raw text so a .sub name still resolves. */
      const address = target.kind === "address" ? target.address : target.value;
      if (qrTargetIndex === null) {
        setSingleSendStatus(null);
        setSingleRecipient(address);
      } else if (typeof qrTargetIndex === "number") {
        setBatchSendStatus(null);
        setBatchRows((rows) =>
          rows.map((row, idx) => (idx === qrTargetIndex ? { ...row, address } : row))
        );
      }
      return;
    }

    if (target.kind === "link") {
      setQrScannerOpen(false);
      setSendFundsOpen(false);
      setSendSingleModalOpen(false);
      router.push(target.path);
      return;
    }

    const address = target.kind === "address" ? target.address : target.value;
    setSingleRecipient(address);
    setSendFundsRecipient(address);
    setQrScannerOpen(false);
  };

  const handleCreateShareableLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setLinkError(null);
    setLinkResultUrl(null);
    setLinkQrShown(false);
    if (!linkAmount || isNaN(Number(linkAmount)) || Number(linkAmount) <= 0) {
      setLinkError("Enter a valid USDC amount.");
      return;
    }
    setLinkLoading(true);
    try {
      const res = await fetch("/api/user/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsdc: linkAmount,
          title: linkMemo.trim() || (linkBillingType === "RECURRING" ? "Recurring Subscription" : "USDC payment"),
          description: linkMemo.trim() || (linkBillingType === "RECURRING" ? "SubScript recurring payment link." : "SubScript payment link."),
          billingType: linkBillingType,
          interval: linkInterval,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not create the payment link.");
      setLinkResultUrl(data.checkoutUrl as string);
      setLinkAmount("");
      setLinkMemo("");
    } catch (err: any) {
      setLinkError(err.message || "Could not create the link.");
    } finally {
      setLinkLoading(false);
    }
  };

  const copyLinkUrl = async () => {
    if (!linkResultUrl) return;
    try {
      await navigator.clipboard.writeText(linkResultUrl);
      setLinkCopied(true);
      triggerToast("Shareable link copied!");
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleRegisterDns = async (event: React.FormEvent) => {
    event.preventDefault();

    const domainName = dnsDomain.endsWith(".sub") ? dnsDomain : `${dnsDomain}.sub`;

    /* Make sure the user understands the once-a-year limit before they commit. */
    setConfirmModal({
      open: true,
      title: "Confirm DNS Name",
      description: `Set your DNS name to "${domainName}"? You can only change your .sub name once every 365 days, so make sure it is correct.`,
      confirmLabel: "Set Name",
      variant: "warning",
      onConfirm: async () => {
        setConfirmModal(null);
        setDnsLoading(true);
        setDnsError(null);
        setDnsSuccess(null);

        try {
          const res = await fetch("/api/merchant/alias", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alias: domainName }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "Failed to register domain.");
          setDnsSuccess(`Registered ${domainName}`);
          setRegisteredDomain(domainName);
          setDnsDomain("");
        } catch (err: any) {
          setDnsError(err.message || "Network error registering DNS domain.");
        } finally {
          setDnsLoading(false);
        }
      },
    });
  };

  const handleProfilePicUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image size must be smaller than 2MB.");
      return;
    }

    setUploadingPic(true);
    setUploadError(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const res = await fetch("/api/merchant/alias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profilePic: reader.result }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to upload profile picture.");
        setProfilePic(reader.result as string);
      } catch (err: any) {
        setUploadError(err.message || "Network error uploading image.");
      } finally {
        setUploadingPic(false);
      }
    };
    reader.onerror = () => {
      setUploadError("Failed to read image file.");
      setUploadingPic(false);
    };
  };

  const resolveRecipient = async (input: string): Promise<string | null> => {
    const trimmed = input.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    // Merchant (.hq/.biz) names are intentionally NOT resolvable for users — a user can only pay a
    // merchant via their payment link/request, or an on-chain address they looked up themselves.
    if (lower.endsWith(".hq") || lower.endsWith(".biz")) {
      return null;
    }
    if (lower.endsWith(".sub")) {
      try {
        const res = await fetch(`/api/merchant/alias?alias=${encodeURIComponent(lower)}`);
        const data = await res.json();
        if (data.success && data.address) {
          return data.address;
        }
      } catch (err) {
        console.error("DNS resolution error:", err);
      }
    }
    return null;
  };

  useEffect(() => {
    const trimmed = singleRecipient.trim().toLowerCase();
    if (!trimmed) {
      setSingleResolved(null);
      setSingleResolving(false);
      return;
    }

    setSingleResolving(true);
    const timer = setTimeout(async () => {
      if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        setSingleResolved({ address: trimmed, alias: null, profilePic: null });
        try {
          const res = await fetch(`/api/merchant/alias?address=${trimmed}`);
          const data = await res.json();
          if (data.success && data.alias) {
            setSingleResolved({ address: trimmed, alias: data.alias, profilePic: data.profile_pic });
          }
        } catch (e) {
          console.warn(e);
        } finally {
          setSingleResolving(false);
        }
        return;
      }

      // Merchant (.hq/.biz) names aren't resolvable for users — only .sub (user) names are.
      if (trimmed.endsWith(".hq") || trimmed.endsWith(".biz")) {
        setSingleResolved({ address: null, alias: trimmed, profilePic: null });
        setSingleResolving(false);
        return;
      }

      if (trimmed.endsWith(".sub")) {
        try {
          const res = await fetch(`/api/merchant/alias?alias=${encodeURIComponent(trimmed)}`);
          const data = await res.json();
          if (data.success && data.address) {
            setSingleResolved({ address: data.address, alias: data.alias, profilePic: data.profile_pic });
          } else {
            setSingleResolved({ address: null, alias: trimmed, profilePic: null });
          }
        } catch (err) {
          setSingleResolved({ address: null, alias: trimmed, profilePic: null });
        } finally {
          setSingleResolving(false);
        }
      } else {
        setSingleResolved(null);
        setSingleResolving(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [singleRecipient]);

  /* Idempotency keys for money-moving sends: minted per logical attempt, reused verbatim on a
     retry after a failure (so the server dedupes at Circle), cleared only on success so an
     intentional identical follow-up send gets a fresh key. */
  const singleSendRequestKey = useRef<string | null>(null);
  const batchSendRequestKey = useRef<string | null>(null);

  /**
   * Cross-chain withdrawal for a browser wallet, which holds its own keys and so cannot be signed
   * for server-side the way an in-app wallet is.
   *
   * Three transactions, in this order: pay the fee, approve the net, burn the net. The fee goes
   * first because reverting there costs the user nothing, whereas burning first and then failing to
   * collect would bridge the money and lose the fee with nothing to reconcile against. CCTP mints
   * exactly what was burned, which is why the split has to happen before the burn rather than being
   * recorded after it.
   */
  const withdrawCrossChainFromBrowserWallet = async (params: {
    destinationChainId: number;
    recipientAddress: string;
    amountMicros: bigint;
  }) => {
    const fee = calculateBridgeFee(params.amountMicros, params.destinationChainId, "outbound_withdrawal");

    if (chainId !== activeArcChain.id) {
      await switchChainAsync({ chainId: activeArcChain.id });
    }

    let feeTxHash: `0x${string}` | undefined;
    if (fee.feeMicros > 0n) {
      feeTxHash = await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: CCTP_ERC20_ABI,
        functionName: "transfer",
        args: [BRIDGE_FEE_TREASURY_ADDRESS, fee.feeMicros],
      });
      const feeReceipt = await publicClient.waitForTransactionReceipt({ hash: feeTxHash, timeout: 120_000 });
      if (feeReceipt.status !== "success") throw new Error("The bridge fee payment failed. Nothing was sent.");
    }

    /* Approve exactly the net. Approving the gross would leave the TokenMessenger able to pull the
       fee portion afterwards. */
    const approveHash = await writeContractAsync({
      address: USDC_NATIVE_GAS_ADDRESS,
      abi: CCTP_ERC20_ABI,
      functionName: "approve",
      args: [ARC_TOKEN_MESSENGER_ADDRESS, fee.netMicros],
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
    if (approveReceipt.status !== "success") throw new Error("Approving the transfer failed. Nothing was sent.");

    const burnTxHash = await writeContractAsync({
      address: ARC_TOKEN_MESSENGER_ADDRESS,
      abi: CCTP_TOKEN_MESSENGER_V2_ABI,
      functionName: "depositForBurn",
      args: [
        fee.netMicros,
        fee.domain,
        toBytes32Address(params.recipientAddress),
        USDC_NATIVE_GAS_ADDRESS,
        ANY_DESTINATION_CALLER,
        0n,
        CCTP_FINALITY_STANDARD,
      ],
    });
    const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnTxHash, timeout: 180_000 });
    if (burnReceipt.status !== "success") {
      throw new Error("The transfer didn't go through on Arc. The fee has been recorded and will be refunded.");
    }

    /* Register last. The keeper needs the burn hash to fetch Circle's attestation, and until this
       lands the transfer is invisible to us, so it retries rather than being fire-and-forget. */
    let registered = false;
    for (let attempt = 0; attempt < 3 && !registered; attempt++) {
      try {
        const res = await fetch("/api/user/cctp/withdraw/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinationChainIdOrDomain: params.destinationChainId,
            recipientAddress: params.recipientAddress,
            amountMicros: params.amountMicros.toString(),
            burnTxHash,
            feeTxHash,
          }),
        });
        registered = res.ok;
        if (!registered) await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (!registered) {
      throw new Error(
        `Your USDC was sent (${burnTxHash.slice(0, 10)}…) but we couldn't record it. Contact support with that hash and we'll finish the delivery.`,
      );
    }

    return { burnTxHash, feeTxHash };
  };

  const handleSingleSend = async (e: React.FormEvent, selectedNetwork: string = "arc") => {
    e.preventDefault();
    setSingleSendStatus(null);
    const recipientAddr = singleResolved?.address;

    if (!recipientAddr) {
      setSingleSendStatus("Please provide a valid recipient wallet address or registered SubScript DNS name.");
      return;
    }
    if (isOwnWalletAddress(recipientAddr)) {
      setSingleSendStatus("You cannot send USDC to your own connected wallet.");
      return;
    }
    if (!singleAmount || isNaN(Number(singleAmount)) || Number(singleAmount) <= 0) {
      setSingleSendStatus("Please provide a valid amount to send.");
      return;
    }

    setSingleSendLoading(true);
    try {
      /* Anything other than Arc is a CCTP withdrawal: the fee is skimmed to the treasury on Arc and
         only the remainder is burned, so the destination mints exactly the "will receive" figure the
         modal quoted. An in-app wallet has server-held keys and the route does all three steps; a
         browser wallet signs them itself in withdrawCrossChainFromBrowserWallet. */
      if (selectedNetwork !== "arc") {
        const amountMicros = parseUnits(limitDecimals(singleAmount, 6), 6);

        if (isEmbeddedWalletSession) {
          const res = await fetch("/api/user/cctp/withdraw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              destinationChainIdOrDomain: selectedNetwork,
              recipientAddress: recipientAddr,
              amountMicros: amountMicros.toString(),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "We couldn't start that withdrawal.");
        } else {
          await withdrawCrossChainFromBrowserWallet({
            destinationChainId: Number(selectedNetwork),
            recipientAddress: recipientAddr,
            amountMicros,
          });
        }

        setSingleSendStatus("Sent. The receiving address will have the funds in about five minutes.");
        setSingleRecipient("");
        setSingleAmount("");
        await refetchUsdc().catch(console.error);
        return;
      }

      if (isEmbeddedWalletSession) {
        singleSendRequestKey.current ||= crypto.randomUUID();
        const transfers = await sendFromEmbeddedWallet({
          receiverAddress: singleResolved!.address!,
          amountUsdc: singleAmount,
          requestKey: singleSendRequestKey.current,
        });
        singleSendRequestKey.current = null;
        const txHash = transfers[0]?.txHash;
        setSingleSendStatus("Sent! Funds delivered on Arc.");
        /* Only recorded when the embedded wallet returned a hash. reconcileOptimisticTxs()
           matches on hash alone, so a hashless row could never be retired and would sit next to
           the confirmed DM entry reading "Sending" for the full five-minute TTL. */
        if (txHash) {
          recordOptimisticTx({
            txHash,
            recipientAddress: recipientAddr,
            recipientLabel: singleResolved?.alias || formatAddress(recipientAddr),
            amountUsdc: singleAmount,
          });
        }
        setSingleRecipient("");
        setSingleAmount("");
        if (txHash) {
          await fetch("/api/user/dms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "log-transfer",
              receiverAddress: recipientAddr,
              amountUsdc: singleAmount,
              txHash,
              title: `${singleAmount} USDC Sent`,
              description: `Sent ${singleAmount} USDC directly from embedded wallet.`,
            }),
          }).catch((err) => console.error("Failed to log single send transfer:", err));
          await loadDms().catch(() => {});
        }
        await refetchUsdc().catch(console.error);
        return;
      }

      if (!accountAddress) {
        setSingleSendStatus("Connect your browser wallet before sending from an external wallet account.");
        return;
      }

      const usdcAbi = [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const;

      /* Connected-wallet accounts must be on Arc before the USDC transfer settles. */
      if (chainId !== activeArcChain.id) {
        await switchChainAsync({ chainId: activeArcChain.id });
      }
      const txHash = await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [recipientAddr as `0x${string}`, parseUnits(limitDecimals(singleAmount, 6), 6)],
      });

      setSingleSendStatus(`Success! Transfer transaction submitted: ${txHash}`);
      recordOptimisticTx({
        txHash: txHash || null,
        recipientAddress: recipientAddr,
        recipientLabel: singleResolved?.alias || formatAddress(recipientAddr),
        amountUsdc: singleAmount,
      });
      setSingleRecipient("");
      setSingleAmount("");
      if (txHash) {
        await fetch("/api/user/dms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "log-transfer",
            receiverAddress: recipientAddr,
            amountUsdc: singleAmount,
            txHash,
            title: `${singleAmount} USDC Sent`,
            description: `Sent ${singleAmount} USDC directly to recipient.`,
          }),
        }).catch((err) => console.error("Failed to log single send transfer:", err));
        await loadDms().catch(() => {});
      }
      refetchUsdc().catch(console.error);
    } catch (err: any) {
      if (err.message?.includes("User rejected the request")) {
        setSingleSendStatus("Transaction signature was rejected by user.");
      } else {
        setSingleSendStatus(err.message || "Failed to execute transfer.");
      }
    } finally {
      setSingleSendLoading(false);
    }
  };

  const handleBatchSend = async () => {
    setBatchSendStatus(null);
    setBatchProgress(null);
    if (batchRows.length === 0) {
      setBatchSendStatus("Add at least one recipient.");
      return;
    }

    setBatchSendLoading(true);
    try {
      const resolvedRows: { address: string; amount: string }[] = [];
      setBatchProgress("Resolving DNS names...");
      
      for (let i = 0; i < batchRows.length; i++) {
        const row = batchRows[i];
        const addr = await resolveRecipient(row.address);
        if (!addr) {
          throw new Error(`Recipient ${i + 1} ("${row.address}") is not a valid address or DNS name.`);
        }
        if (isOwnWalletAddress(addr)) {
          throw new Error(`Recipient ${i + 1} is your own connected wallet. Remove it before sending.`);
        }
        if (!row.amount || isNaN(Number(row.amount)) || Number(row.amount) <= 0) {
          throw new Error(`Recipient ${i + 1} has an invalid amount.`);
        }
        resolvedRows.push({ address: addr, amount: row.amount });
      }

      if (isEmbeddedWalletSession) {
        batchSendRequestKey.current ||= crypto.randomUUID();
        const transfers = await sendFromEmbeddedWallet({
          recipients: resolvedRows.map((row) => ({
            receiverAddress: row.address,
            amountUsdc: row.amount,
          })),
          requestKey: batchSendRequestKey.current,
        });
        batchSendRequestKey.current = null;
        setBatchSendStatus(`Sent ${transfers.length} transfers`);
        setBatchRows([{ address: "", amount: "" }]);
        setBatchProgress(null);
        for (const t of transfers) {
          if (t.txHash) {
            await fetch("/api/user/dms", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "log-transfer",
                receiverAddress: t.receiverAddress,
                amountUsdc: t.amountUsdc,
                txHash: t.txHash,
                title: `${t.amountUsdc} USDC Sent`,
                description: `Sent ${t.amountUsdc} USDC in a batch payout.`,
              }),
            }).catch(console.error);
          }
        }
        await loadDms().catch(() => {});
        await refetchUsdc().catch(console.error);
        return;
      }

      if (!accountAddress) {
        throw new Error("Connect your browser wallet before sending from an external wallet account.");
      }

      const usdcAbi = [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const;

      if (chainId !== activeArcChain.id) {
        await switchChainAsync({ chainId: activeArcChain.id });
      }
      for (let i = 0; i < resolvedRows.length; i++) {
        const row = resolvedRows[i];
        setBatchProgress(`Sending transfer ${i + 1} of ${resolvedRows.length}...`);
        
        const txHash = await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: usdcAbi,
          functionName: "transfer",
          args: [row.address as `0x${string}`, parseUnits(limitDecimals(row.amount, 6), 6)],
        });

        if (txHash) {
          await fetch("/api/user/dms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "log-transfer",
              receiverAddress: row.address,
              amountUsdc: row.amount,
              txHash,
              title: `${row.amount} USDC Sent`,
              description: `Sent ${row.amount} USDC in a batch payout.`,
            }),
          }).catch((err) => console.error("Failed to log batch send transfer:", err));
        }
      }

      setBatchSendStatus(`Sent ${resolvedRows.length} transfers`);
      setBatchRows([{ address: "", amount: "" }]);
      setBatchProgress(null);
      await loadDms().catch(() => {});
      refetchUsdc().catch(console.error);
    } catch (err: any) {
      const settled = Array.isArray(err.settledTransfers) ? err.settledTransfers : [];
      if (err.partial && settled.length > 0) {
        /* Transfers settle in order and the API stops at the first failure, so the first
           `settled.length` recipients are done. Drop them so a retry only sends the rest and
           never resends an already-settled transfer. */
        setBatchRows((rows) => {
          const remaining = rows.slice(settled.length);
          return remaining.length > 0 ? remaining : [{ address: "", amount: "" }];
        });
        setBatchSendStatus(
          `${err.message || "Batch partially completed."} ${settled.length} transfer${settled.length === 1 ? "" : "s"} already settled and ${settled.length === 1 ? "was" : "were"} removed. Retry sends only the remaining recipients.`
        );
        for (const t of settled) {
          if (t?.txHash) {
            await fetch("/api/user/dms", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "log-transfer",
                receiverAddress: t.receiverAddress,
                amountUsdc: t.amountUsdc,
                txHash: t.txHash,
                title: `${t.amountUsdc} USDC Sent`,
                description: `Sent ${t.amountUsdc} USDC in a batch payout.`,
              }),
            }).catch(console.error);
          }
        }
        await loadDms().catch(() => {});
        await refetchUsdc().catch(console.error);
      } else if (err.message?.includes("User rejected the request")) {
        setBatchSendStatus("Transaction signature was rejected by user.");
      } else {
        setBatchSendStatus(err.message || "Failed to execute batch send.");
      }
      setBatchProgress(null);
    } finally {
      setBatchSendLoading(false);
    }
  };

  /* The badge should reflect only what needs the user's attention: incoming PENDING requests they
     can actually act on. Outgoing requests can't be settled from this side, and informational
     notices (e.g. DEBIT_SUCCESS renewal receipts) are created PENDING but aren't "action needed" —
     neither should keep the badge lit. */
  const isActionableDm = (dm: DmMessage) =>
    dm.status === "PENDING" &&
    dm.receiverAddress.toLowerCase() === userWallet?.toLowerCase() &&
    ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING", "SUBSCRIPTION_OFFER"].includes(dm.messageType) &&
    !readDmIds.has(dm.id);
  const pendingDmCount = dms.filter(isActionableDm).length + pendingRequestsCount;
  const dmThreads = Array.from(dms.reduce((threads, dm) => {
    const peerAddress = getDmPeerAddress(dm, userWallet).toLowerCase();
    const existing = threads.get(peerAddress);
    const latestTime = new Date(dm.createdAt).getTime();
    const actionable = isActionableDm(dm);
    if (!existing) {
      threads.set(peerAddress, {
        peerAddress,
        peerName: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverName : dm.senderName,
        peerRole: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverRole : dm.senderRole,
        peerVerified: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverVerified : dm.senderVerified,
        peerProfilePic: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverProfilePic : dm.senderProfilePic,
        latest: dm as DmMessage | null,
        latestTime,
        pendingCount: actionable ? 1 : 0,
        totalCount: 1,
        isBlocked: blockedAddresses.includes(peerAddress),
      });
    } else {
      existing.totalCount += 1;
      if (actionable) existing.pendingCount += 1;
      if (latestTime > existing.latestTime || !existing.latest) {
        existing.latest = dm;
        existing.latestTime = latestTime;
        const isOwnSender = dm.senderAddress.toLowerCase() === userWallet?.toLowerCase();
        existing.peerName = isOwnSender ? dm.receiverName : dm.senderName;
        existing.peerRole = isOwnSender ? dm.receiverRole : dm.senderRole;
        existing.peerVerified = isOwnSender ? dm.receiverVerified : dm.senderVerified;
        existing.peerProfilePic = isOwnSender ? dm.receiverProfilePic : dm.senderProfilePic;
      }
      existing.isBlocked = blockedAddresses.includes(peerAddress);
    }
    return threads;
  }, (() => {
    const initialMap = new Map<string, {
      peerAddress: string;
      peerName: string;
      peerRole: string | null;
      peerVerified: boolean | undefined;
      peerProfilePic: string | null;
      latest: DmMessage | null;
      latestTime: number;
      pendingCount: number;
      totalCount: number;
      isBlocked: boolean;
    }>();
    // Pre-populate with accepted connections so newly accepted empty threads render
    for (const conn of dmConnections) {
      const peer = conn.peerAddress.toLowerCase();
      initialMap.set(peer, {
        peerAddress: peer,
        peerName: conn.peerName,
        peerRole: conn.peerRole,
        peerVerified: conn.peerVerified,
        peerProfilePic: conn.peerProfilePic,
        latest: null,
        latestTime: new Date(conn.lastInteractionAt || conn.establishedAt).getTime(),
        pendingCount: 0,
        totalCount: 0,
        isBlocked: conn.isBlocked || blockedAddresses.includes(peer),
      });
    }
    return initialMap;
  })()).values()).sort((a, b) => b.latestTime - a.latestTime);
  const selectedThreadDms = selectedDmPeer
    ? dms
        .filter((dm) => getDmPeerAddress(dm, userWallet).toLowerCase() === selectedDmPeer)
        /* The merchant-facing half of a two-row event is written to the merchant in their own terms
           and would read as the merchant narrating the subscriber's actions back at them. The
           subscriber-facing row of the same pair stays. See MERCHANT_OPS_DM_TYPES. */
        .filter((dm) => !isMerchantOpsDm(dm.messageType, dm.senderAddress, userWallet))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];
  const activeThread = selectedDmPeer
    ? dmThreads.find((t) => t.peerAddress.toLowerCase() === selectedDmPeer)
    : null;
  const activeThreadLabel = selectedDmPeer ? formatPeerDisplayName(activeThread?.peerName, selectedDmPeer) : "";
  /* The third clause here used to test activeThreadLabel for a .hq/.biz suffix, which could never
     match: peerName arrives from /api/user/dms already run through accountDisplayName, and
     titleCaseAlias strips /\.(?:sub|hq|biz)$/ — so the suffix is gone server-side and the raw
     alias never reaches the client at all. A business peer with no ENTERPRISE role row and no
     subscription therefore fell through as a personal contact and got offered Block and Send
     Funds, which is exactly what the note below says must not happen. peerRole is the real signal
     and is already first in the chain. */
  const isActiveDmMerchant = selectedDmPeer
    ? activeThread?.peerRole === "ENTERPRISE" ||
      subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase())
    : false;
  /* Kept strictly separate from isActiveDmMerchant above. That flag answers "is this
     counterparty a business?" and correctly drives whether Send Funds appears — you pay a
     business through its payment link, not by pushing USDC at it. It is NOT a trust signal: it
     fires on an account role or on merely having a subscription. The verification tick reads
     merchants.verified, server-reported, and nothing else. */
  const isActiveDmMerchantVerified = activeThread?.peerVerified === true;
  const activeThreadSubscription = selectedDmPeer ? getActiveSubscriptionForMerchant(selectedDmPeer) : null;
  const isActiveMobileDm = isMobile && activeTab === "inbox" && Boolean(selectedDmPeer);
  const isCurrentPeerBlocked = Boolean(selectedDmPeer && blockedAddresses.includes(selectedDmPeer.toLowerCase()));

  const handleBlockPeer = async (peerAddress: string) => {
    const peerLabel = formatPeerDisplayName(activeThread?.peerName, peerAddress);
    setConfirmModal({
      open: true,
      title: `Block ${peerLabel}?`,
      description: "Blocking this contact will immediately terminate your DM connection and prevent all future messages, payment requests, and transfers.",
      confirmLabel: "Block User",
      cancelLabel: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch("/api/user/dm/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "block", targetAddress: peerAddress }),
          });
          if (res.ok) {
            await loadDms();
            setSelectedDmPeer(null);
          }
        } catch (err) {
          console.error("Failed to block peer:", err);
        }
      },
    });
  };

  const handleUnblockPeer = async (peerAddress: string) => {
    try {
      const res = await fetch("/api/user/dm/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unblock", targetAddress: peerAddress }),
      });
      if (res.ok) {
        await loadDms();
      }
    } catch (err) {
      console.error("Failed to unblock peer:", err);
    }
  };
  /* Sending to your own wallet burns gas for a no-op, so both send surfaces block it up front.
     The batch variant keeps each offending row's original index so the warning can name the
     recipient by its position in the form. */
  const singleSelfSend = Boolean(singleResolved?.address && isOwnWalletAddress(singleResolved.address));
  const batchSelfSendRows = batchRows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => isOwnWalletAddress(row.address));

  /* Open every thread at the newest message.
     Timing this against the pane's entrance animation never worked reliably: with
     AnimatePresence mode="wait" the new scroller isn't mounted yet when this effect fires
     (the old pane is still exiting), and the spring that follows has no fixed duration, so any
     fixed timeout is a guess. `attachDmScroller` below is a callback ref instead — React calls
     it at the exact moment the node mounts — so the pin happens once the element genuinely
     exists. This effect now only handles messages arriving in an already-open thread. */
  useEffect(() => {
    if (activeTab !== "inbox" || !selectedDmPeer) return;
    if (!autoPinDmRef.current) return;

    const scrollToBottom = () => {
      const container = desktopDmScrollRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      dmBottomRef.current?.scrollIntoView({ block: "end" });
    };

    scrollToBottom();
    const rafId = requestAnimationFrame(scrollToBottom);

    return () => cancelAnimationFrame(rafId);
  }, [activeTab, selectedDmPeer, selectedThreadDms.length]);

  if (loading) {
    return (
      <div className="user-dashboard-loading relative overflow-x-hidden bg-[#FFFFF0] text-black font-sans md:h-[100dvh] md:overflow-hidden">

        <div className="fixed inset-0 pointer-events-none z-0 hidden bg-[#353935] md:block" />

        <div className="relative z-10 md:flex md:h-[calc(100dvh-4px)] md:min-h-0">
        {/* Desktop Sidebar Skeleton — mirrors UserDesktopSidebar: profile pill, 6 half-rounded
            nav pills that bleed into the content panel, promo card, then two footer links. */}
        <aside className="hidden md:flex h-full max-h-screen w-16 lg:w-52 shrink-0 flex-col justify-between overflow-y-auto bg-[#353935] p-2.5 lg:p-3.5">
          <div className="space-y-4">
            <div className="flex items-center justify-center lg:justify-start gap-2 rounded-full lg:px-2 lg:py-1">
              <div className="h-5 w-5 shrink-0 subscript-skeleton rounded-full" />
              <div className="hidden lg:block h-2 w-16 subscript-skeleton rounded-full" />
            </div>

            <nav className="space-y-1">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-3 py-2 lg:px-3.5 rounded-full lg:rounded-l-full lg:rounded-r-none">
                  <div className="h-4 w-4 subscript-skeleton rounded-md shrink-0" />
                  <div className="hidden lg:block h-2 w-20 subscript-skeleton rounded-full" />
                </div>
              ))}
            </nav>
          </div>
          <div className="hidden lg:block space-y-4">
            <div className="rounded-[20px] border border-white/5 bg-white/[0.02] p-4 space-y-2.5">
              <div className="h-2.5 w-28 subscript-skeleton rounded-full" />
              <div className="h-2 w-36 subscript-skeleton subscript-skeleton--faint rounded-full" />
              <div className="h-7 w-24 subscript-skeleton rounded-full" />
            </div>
            <div className="space-y-3 px-2">
              <div className="h-2.5 w-20 subscript-skeleton subscript-skeleton--faint rounded-full" />
              <div className="h-2.5 w-24 subscript-skeleton subscript-skeleton--faint rounded-full" />
            </div>
          </div>
        </aside>

        {/* Content Pane Skeleton — mirrors the mobile & desktop Home layout */}
        <div className="relative z-10 min-w-0 flex-1 flex flex-col bg-[#FFFFF0] md:mt-[14px] md:h-[calc(100vh-14px)] md:rounded-tl-[20px] md:border md:border-black/10 overflow-hidden">
          <div className="md:hidden fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
            <div className="flex w-full max-w-md items-center justify-between px-1 py-2 pointer-events-auto">
              <div className="flex items-center gap-2 rounded-full border border-black/15 bg-white/95 px-3 py-1.5 shadow-sm">
                <div className="h-7 w-7 subscript-skeleton rounded-full shrink-0" />
                <div className="h-3 w-20 subscript-skeleton rounded-full" />
              </div>
              <div className="h-10 w-10 subscript-skeleton rounded-full shrink-0" />
            </div>
          </div>

          <main className="flex-1 overflow-y-auto min-h-0 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-24 lg:pt-8 pb-28 lg:pb-12">
            {/* Title Header on Desktop */}
            <div className="hidden md:flex items-center justify-between gap-6 mb-8 pb-6 border-b border-black/10">
              <div className="h-8 w-64 subscript-skeleton rounded-lg" />
            </div>

            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[46fr_54fr]">
                {/* LEFT: Balance card + Actions */}
                <div className="flex flex-col gap-4 min-w-0">
                  <div className="flex flex-col items-center justify-center gap-4 px-3 py-3 text-center md:flex-row md:justify-between md:rounded-[20px] md:border md:border-black/35 md:bg-[#2775CA]/20 md:px-6 md:py-[22px] md:text-left">
                    <div className="flex flex-col items-center gap-2 md:items-start">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-24 subscript-skeleton rounded-full" />
                        <div className="h-3.5 w-3.5 subscript-skeleton rounded-full" />
                        <div className="h-3.5 w-3.5 subscript-skeleton rounded-full" />
                      </div>
                      <div className="h-10 w-48 subscript-skeleton rounded-2xl" />
                      <div className="h-3 w-24 subscript-skeleton subscript-skeleton--faint rounded-full" />
                    </div>
                    <div className="wallet-actions flex w-full shrink-0 flex-row justify-center gap-2 md:w-auto md:flex-col">
                      <div className="h-11 min-w-[110px] flex-1 md:flex-none subscript-skeleton rounded-full" />
                      <div className="flex flex-1 md:flex-none items-center gap-2">
                        <div className="h-11 min-w-[110px] flex-1 subscript-skeleton rounded-full" />
                        <div className="flex md:hidden h-11 w-11 shrink-0 subscript-skeleton rounded-full" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[42fr_58fr] gap-3.5">
                    <div className="dashboard-blue-panel flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 p-[18px]">
                      <div className="space-y-2.5">
                        <div className="h-2.5 w-24 subscript-skeleton rounded-full" />
                        <div className="h-3 w-8 subscript-skeleton subscript-skeleton--faint rounded-full" />
                        <div className="h-6 w-24 subscript-skeleton rounded-lg" />
                      </div>
                      <div className="h-2.5 w-24 subscript-skeleton rounded-full" />
                    </div>
                    <div className="dashboard-blue-panel flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 p-[18px]">
                      <div className="space-y-2.5">
                        <div className="h-2.5 w-20 subscript-skeleton rounded-full" />
                        <div className="flex gap-3">
                          <div className="h-6 w-16 subscript-skeleton rounded-lg" />
                          <div className="h-6 w-16 subscript-skeleton rounded-lg" />
                        </div>
                      </div>
                      <div className="h-2.5 w-24 subscript-skeleton rounded-full" />
                    </div>
                  </div>
                </div>

                {/* RIGHT: Active Subscriptions */}
                <div className="hidden md:flex min-h-[260px] h-full flex-col rounded-3xl border border-black/15 bg-white/80 p-5 shadow-sm">
                  <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                    <div className="h-3 w-36 subscript-skeleton rounded-full" />
                    <div className="h-5 w-16 subscript-skeleton rounded-full" />
                  </div>
                  <div className="flex-1 space-y-3 overflow-hidden">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-black/5">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 subscript-skeleton rounded-full" />
                          <div className="space-y-1.5">
                            <div className="h-3 w-28 subscript-skeleton rounded-full" />
                            <div className="h-2 w-16 subscript-skeleton subscript-skeleton--faint rounded-full" />
                          </div>
                        </div>
                        <div className="h-4 w-20 subscript-skeleton rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="rounded-3xl border border-black/10 bg-white/80 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-36 subscript-skeleton rounded-full" />
                  <div className="h-4 w-16 subscript-skeleton rounded-full" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["All", "Subscriptions", "One Time", "Transfers", "Withdrawals", "Deposits"].map((tab) => (
                    <div key={tab} className="h-7 w-20 subscript-skeleton rounded-full" />
                  ))}
                </div>
                <div className="mt-4 divide-y divide-black/5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-3">
                      <div className="h-10 w-10 subscript-skeleton rounded-full shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="h-3 w-32 subscript-skeleton rounded-full" />
                        <div className="h-2 w-20 subscript-skeleton subscript-skeleton--faint rounded-full" />
                      </div>
                      <div className="shrink-0 space-y-1.5 text-right">
                        <div className="h-3.5 w-16 subscript-skeleton rounded-full ml-auto" />
                        <div className="h-2 w-12 subscript-skeleton subscript-skeleton--faint rounded-full ml-auto" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
        </div>

        {/* Mobile Bottom Bar Skeleton */}
        <div className="fixed bottom-6 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3 md:hidden">
          <div className="flex flex-1 items-center justify-around rounded-full border border-black/15 bg-[#2775CA]/20 px-3 py-[1.1rem] backdrop-blur-2xl">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 w-6 subscript-skeleton rounded-full" />
            ))}
          </div>
          <div className="h-[3.3rem] w-[3.3rem] shrink-0 rounded-full subscript-skeleton" />
        </div>
      </div>
    );
  }

  if (redirectMessage) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#FFFFF0] px-6 text-black">

        <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-black/45 p-6 sm:p-8 text-center shadow-2xl backdrop-blur-xl">
          <span className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </span>
          <div className="space-y-2">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-white">Session Notice</p>
            <p className="text-xs leading-5 text-white/50">{redirectMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (redirectUrl) {
                window.location.href = redirectUrl;
              }
            }}
            className="subscript-primary-button w-full"
          >
            Proceed
          </button>
        </div>
      </div>
    );
  }

  const sortedSubscriptions = [...subscriptions]
    .filter((s) => s.status === "ACTIVE")
    .sort((a, b) => {
      const aNext = a.lastSettlementTimestamp ? new Date(a.lastSettlementTimestamp).getTime() + Number(a.billingIntervalSeconds) * 1000 : Infinity;
      const bNext = b.lastSettlementTimestamp ? new Date(b.lastSettlementTimestamp).getTime() + Number(b.billingIntervalSeconds) * 1000 : Infinity;
      return aNext - bNext;
    });

  /* ---- Home overview (derived from existing data; no dedicated analytics backend) ---- */
  // Display-only fiat estimate. Not a live oracle — clearly a rough naira reference for the balance.
  const localBalance = walletBalance * exchangeRate;
  // "30-day spend": sum of actual settled transactions over the past 30 days.
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const subSettledSpend = subscriptions.reduce((sum, s) => {
    const settlementTime = s.lastSettlementTimestamp ? new Date(s.lastSettlementTimestamp).getTime() : new Date(s.createdAt).getTime();
    if (settlementTime >= thirtyDaysAgoMs) {
      const amountUsdc = Number(s.amountCapUsdc) / 1_000_000;
      return sum + (Number.isFinite(amountUsdc) ? amountUsdc : 0);
    }
    return sum;
  }, 0);
  const dmPaidSpend = dms.reduce((sum, d) => {
    const isPaid = d.status === "PAID" || ["DEBIT_SUCCESS", "PAYMENT", "PEER_PAYMENT", "PAYMENT_SUCCESS", "PEER_TRANSFER"].includes(d.messageType);
    const dmTime = new Date(d.createdAt).getTime();
    if (isPaid && d.amountUsdc && dmTime >= thirtyDaysAgoMs) {
      const amountUsdc = Number(d.amountUsdc) / 1_000_000;
      return sum + (Number.isFinite(amountUsdc) ? amountUsdc : 0);
    }
    return sum;
  }, 0);
  const actual30DaySpend = subSettledSpend + dmPaidSpend;
  const projectedMonthlySpend = subscriptions
    .filter((s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd)
    .reduce((sum, s) => {
      const period = Math.max(1, Number(s.billingIntervalSeconds));
      const monthly = (Number(s.amountCapUsdc) / 1_000_000) * (2_592_000 / period);
      return sum + (Number.isFinite(monthly) ? monthly : 0);
    }, 0);
  const monthlySpendUsdc = actual30DaySpend > 0 ? actual30DaySpend : projectedMonthlySpend;
  // Total value currently locked across prepaid metered vaults.
  const totalCommitLockedUsdc = vaults.reduce(
    (sum, v: any) => sum + Number(v?.balanceUsdc || 0) / 1_000_000,
    0,
  );
  /* Merchant-reported draw against those locked balances. Sits beside the locked figure so the
     Home card answers "how much have I committed" and "how much is actually gone" together —
     balanceUsdc is the gross commit, so the two are additive, not overlapping. */
  const totalCommitUsedUsdc = vaults.reduce(
    (sum, v: any) => sum + Number(v?.accruedUsageUsdc || 0) / 1_000_000,
    0,
  );
  /* The Home panel is headed "Active Subscriptions & Commits" — a label the Master Spec wireframe
     fixes — so the commits half has to actually appear under it. Full commit management
     (commit / withdraw / reclaim / cancel) stays on the Commit tab; these are read-only rows that
     link there. A vault with a residual balance is still the user's money, so it is listed even
     once the service goes inactive. */
  const homeCommitRows = vaults.filter(
    (v: any) => Boolean(v?.active) || Number(v?.balanceUsdc || 0) > 0,
  );
  // Unified recent-activity feed: subscriptions are "recurring", paid/settled payment DMs are "one-time".
  /* Each row carries `amountUsdc` (unsigned magnitude; read `incoming` for direction) and a
     normalized `status`. Spend Analysis needs real numbers to total In/Out per month — it used to
     recover amounts by stripping non-digits out of the formatted `amountLabel`, which silently
     mis-parsed anything with a thousands separator and had no way to tell a credit from a debit. */
  const recentTransactions = [
    ...subscriptions.map((s) => {
      const usdVal = Number(s.amountCapUsdc) / 1_000_000;
      const localVal = usdVal * exchangeRate;
      const localLabel = `${detectedCurrency.symbol}${formatHeadlineAmount(localVal)}`;
      return {
        id: `sub-${s.subscriptionId}`,
        kind: "recurring" as const,
        name: merchantDisplayName(s.merchantName),
        pic: s.merchantProfilePic,
        detail: `Plan • ${formatPlanPeriod(s.billingIntervalSeconds)}`,
        amountLabel: `-$${formatUsdc(s.amountCapUsdc)}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
        localAmountLabel: `-${localLabel}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
        /* The per-period cap, not a settled amount — see the caveat rendered under the month
           summary in Spend Analysis. */
        amountUsdc: usdVal,
        status: subscriptionTxStatus(s.status),
        time: s.lastSettlementTimestamp ? new Date(s.lastSettlementTimestamp).getTime() : new Date(s.createdAt).getTime(),
        incoming: false,
      };
    }),
    ...dms
      .filter((d) => d.amountUsdc && (
        ["DEBIT_SUCCESS", "PAYMENT", "PEER_PAYMENT", "PAYMENT_SUCCESS", "PEER_TRANSFER", "WITHDRAWAL", "WITHDRAW"].includes(d.messageType) ||
        d.status === "PAID"
      ))
      .map((d) => {
        const isWithdrawal = d.messageType === "WITHDRAWAL" || d.messageType === "WITHDRAW";
        const isPeerTransfer = d.messageType === "PEER_TRANSFER" || d.messageType === "PEER_PAYMENT";
        /* A settlement receipt is sent BY the merchant TO the payer, so the viewer is the receiver
           even though the money left them. The sign already accounted for that; the counterparty
           did not — `incoming ? senderName : receiverName` resolved to the receiver, i.e. the
           viewer's own name, so a checkout row showed the payer instead of who they paid. */
        const isSettlementReceipt = d.messageType === "DEBIT_SUCCESS" || d.messageType === "PAYMENT_SUCCESS";
        const incoming = d.receiverAddress.toLowerCase() === userWallet?.toLowerCase() && !isSettlementReceipt && !isWithdrawal;
        const counterpartyIsSender = isSettlementReceipt || incoming;
        const usdVal = Number(d.amountUsdc) / 1_000_000;
        const localVal = usdVal * exchangeRate;
        const localLabel = `${detectedCurrency.symbol}${formatHeadlineAmount(localVal)}`;

        let kind: "one-time" | "transfers" | "withdrawals" = "one-time";
        if (isWithdrawal) kind = "withdrawals";
        else if (isPeerTransfer) kind = "transfers";

        return {
          id: `dm-${d.id}`,
          kind,
          name: isWithdrawal
            ? "Sent from balance to wallet"
            : (counterpartyIsSender ? d.senderName : d.receiverName) || "Payment",
          pic: counterpartyIsSender ? d.senderProfilePic : d.receiverProfilePic,
          detail: isWithdrawal
            ? "SubScript Balance Withdrawal"
            : d.title || d.description || (incoming ? "Received payment" : "Sent payment"),
          amountLabel: `${incoming ? "+" : "-"}$${formatUsdc(d.amountUsdc)}`,
          localAmountLabel: `${incoming ? "+" : "-"}${localLabel}`,
          amountUsdc: usdVal,
          status: dmTxStatus(d.status),
          time: new Date(d.createdAt).getTime(),
          incoming,
        };
      }),
    ...deposits
      .filter((d) => !dms.some((dm) => dm.txHash && dm.txHash.toLowerCase() === d.txHash.toLowerCase()))
      .map((d) => {
        const usdVal = Number(d.amountUsdc) / 1_000_000;
        const localVal = usdVal * exchangeRate;
        const localLabel = `${detectedCurrency.symbol}${formatHeadlineAmount(localVal)}`;
        return {
          id: `dep-${d.txHash}`,
          kind: "transfers" as const,
          name: d.senderName ? `Deposit from @${d.senderName}` : `Deposit from ${formatAddress(d.fromAddress)}`,
          pic: null as string | null,
          detail: "USDC Deposit • Arc Network",
          amountLabel: `+$${formatUsdc(d.amountUsdc)}`,
          localAmountLabel: `+${localLabel}`,
          amountUsdc: usdVal,
          status: "CONFIRMED",
          time: d.timestamp,
          incoming: true,
          txHash: d.txHash,
        };
      }),
  ].sort((a, b) => b.time - a.time);
  const filteredTransactions = recentTransactions.filter((t) => {
    if (txFilter === "all") return true;
    if (txFilter === "deposits") return t.incoming && t.detail.toLowerCase().includes("deposit");
    return t.kind === txFilter;
  });




  return (
    <div className={`user-dashboard-redesign relative overflow-x-hidden bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black md:h-[100dvh] md:overflow-hidden ${
      isActiveMobileDm ? "h-[100dvh] overflow-hidden" : "h-[100dvh] overflow-y-auto overscroll-y-contain md:h-auto md:overflow-y-auto"
    }`}>
      {!isMobile && <div className="fixed inset-0 pointer-events-none z-0 bg-[#353935]" />}

      <div className={`relative z-10 md:flex md:h-[calc(100dvh-4px)] md:min-h-0 ${
        isActiveMobileDm ? "h-full overflow-hidden" : ""
      }`}>
        {mustBackupWallet ? (
          <div className="flex-1 flex items-center justify-center p-6 md:h-full overflow-y-auto">
            <div className="max-w-xl w-full space-y-6 py-12">
              <div className="liquid-glass border border-red-500/20 bg-red-500/5 backdrop-blur-xl rounded-[28px] p-6 text-center shadow-2xl space-y-4">
                <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
                  <Lock className="h-6 w-6 text-red-400" />
                </div>
                <h2 className="text-xl font-bold uppercase tracking-tight text-white">Private Key Backup Required</h2>
                <p className="text-sm text-white/60 leading-relaxed font-sans">
                  Your SubScript wallet has been generated, but its private key is not backed up yet.
                  This wallet type supports key export, so download your recovery key now to ensure you never lose access to your funds.
                </p>
                <p className="text-xs text-[#ccff00]/80 font-bold uppercase tracking-wide">
                  The dashboard remains locked until backup is completed.
                </p>
              </div>

              <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-[28px] p-6 sm:p-8 space-y-5 shadow-2xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-[#ccff00]" /> Export & Verify Wallet Backup
                    </h3>
                    <p className="text-[10px] text-white/40 leading-relaxed">
                      Export the private key for your SubScript-generated email wallet. Store it offline; anyone with this key can control the wallet.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-black/30 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/35">Account Email</span>
                    <span className="min-w-0 truncate text-right text-[11px] font-mono text-white/70">{userSettings?.walletBackup?.email || userEmail || "Not linked"}</span>
                  </div>
                </div>

                {exportedPrivateKey && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                      <p className="break-all font-mono text-[11px] leading-relaxed text-red-100">
                        {privateKeyVisible ? exportedPrivateKey : "*".repeat(Math.min(exportedPrivateKey.length, 64))}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button type="button" onClick={() => setPrivateKeyVisible((value) => !value)} className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-white transition flex items-center justify-center gap-2">
                        {privateKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {privateKeyVisible ? "Hide" : "Show"}
                      </button>
                      <button type="button" onClick={handleCopyPrivateKey} className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition flex items-center justify-center gap-2">
                        <Copy className="h-4 w-4" /> Copy
                      </button>
                      <button type="button" onClick={handleDownloadPrivateKey} className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition flex items-center justify-center gap-2">
                        <Download className="h-4 w-4" /> Download
                      </button>
                    </div>
                    
                    <button
                      type="button"
                      onClick={loadUserSettings}
                      className="w-full mt-4 rounded-2xl bg-[#ccff00] hover:bg-[#ccff00]/90 text-black py-4 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition"
                    >
                      I have saved my key, Proceed to Dashboard
                    </button>
                  </div>
                )}

                {walletBackupError && <p className="text-[11px] text-red-300">{walletBackupError}</p>}

                {!exportedPrivateKey && (
                  exportOtpStage ? (
                    <div className="space-y-3">
                      <p className="text-[10px] text-white/50 leading-relaxed text-center">
                        Enter the 6-digit verification code sent to your email to reveal your private key.
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={exportOtpCode}
                        onChange={(e) => setExportOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-white focus:border-[#ccff00]/50 focus:outline-none"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleExportWallet}
                          disabled={walletBackupLoading || exportOtpCode.length !== 6}
                          className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition"
                        >
                          {walletBackupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          Confirm & Reveal
                        </button>
                        <button
                          type="button"
                          onClick={() => { setExportOtpStage(false); setExportOtpCode(""); setWalletBackupError(null); }}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white/70 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={requestExportOtp}
                      disabled={exportOtpSending}
                      className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition"
                    >
                      {exportOtpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Export Private Key to Unlock
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            {!isMobile && (
          <DashboardSidebar
            /* Built inline rather than memoised: DashboardSidebar is not memoised either, so a
               stable array buys nothing, and hoisting these into consts would put them below the
               early returns above. */
            items={[
              ...userDesktopTabs.map((tab) => ({
                id: tab.id,
                label: tab.label,
                icon: tab.icon,
                badgeCount: tab.id === "inbox" ? pendingDmCount : undefined,
              })),
              /* Separate from the tab list because it navigates out to /admin rather than switching
                 a tab, so it cannot be a UserTab. Visibility is cosmetic: the /admin layout and
                 every /api/admin route re-check admin status server-side. */
              ...(isAdmin ? [{ id: "admin", label: "Admin", icon: Shield, href: "/admin" }] : []),
            ]}
            footerItems={[
              { id: "dns", label: "Settings", icon: Sliders },
              { id: "support", label: "Help center", icon: HelpCircle, href: "/support", newTab: true },
            ]}
            activeId={activeTab}
            onSelect={(id) => {
              setSelectedDmPeer(null);
              setActiveTab(id as UserTab);
            }}
            identity={{
              label: registeredDomain || formatAddress(userWallet) || "Your account",
              avatarUrl: profilePic,
              fallback: registeredDomain ? registeredDomain[0].toUpperCase() : "S",
              onClick: () => setActiveTab("dns"),
              title: registeredDomain || "Your account",
            }}
            promo={{
              badge: "New",
              title: "New Campaign Unlocked",
              body: "Run your own affiliate program with zero overhead",
              ctaLabel: "Try it",
              onCta: () => setActiveTab("referrals"),
            }}
            accent="#FFFFF0"
            panelColor="#353935"
            ariaLabel="User dashboard navigation"
          />
        )}

        {/* The wireframe's 14px top slit + 28px inner radius, with a refined translucent surface. */}
        <div className={`user-dashboard-content relative z-10 min-w-0 flex-1 bg-[#FFFFF0] md:mt-[14px] md:rounded-tl-[20px] md:border md:border-black/10 flex flex-col ${
          activeTab === "inbox" || isActiveMobileDm
            ? "h-[100dvh] md:h-[calc(100vh-14px)] min-h-0 overflow-hidden"
            : "h-[100dvh] md:h-[calc(100vh-14px)] overflow-y-auto overscroll-y-contain md:overflow-y-auto"
        }`}>
          <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-30 h-32 bg-[#FFFFF0]/90 backdrop-blur-3xl saturate-150 [mask-image:linear-gradient(to_bottom,black_0%,black_35%,transparent_100%)] md:hidden" />
          {/* Mobile headers (only shown on small screens) */}
          {isMobile && (
            <div className="w-full">
              {activeTab === "inbox" && selectedDmPeer ? (
                <ChatHeader
                  peerName={activeThreadLabel}
                  peerProfilePic={activeThread?.peerProfilePic || null}
                  peerAddress={selectedDmPeer}
                  isMerchant={isActiveDmMerchant}
                  isVerifiedMerchant={isActiveDmMerchantVerified}
                  isBlocked={isCurrentPeerBlocked}
                  activeSubscription={activeThreadSubscription}
                  onBack={() => setSelectedDmPeer(null)}
                  onBlock={() => handleBlockPeer(selectedDmPeer)}
                  onUnblock={() => handleUnblockPeer(selectedDmPeer)}
                  onSendFunds={() => {
                    setSendFundsRecipient(activeThreadLabel || selectedDmPeer);
                    setSendFundsOpen(true);
                  }}
                />
              ) : (
                <HomeHeader
                  registeredDomain={registeredDomain}
                  profilePic={profilePic}
                  userWallet={userWallet}
                  onDns={() => setActiveTab("dns")}
                  onLogout={handleLogout}
                />
              )}
            </div>
          )}

      {/* Main Grid View Container */}
      <main className={`w-full flex flex-col ${
        activeTab === "inbox"
          ? (isMobile ? "flex-1 h-full min-h-0 max-w-none px-3 overflow-hidden" : "flex-1 h-full min-h-0 max-w-none p-3 lg:p-6 overflow-hidden")
          : "mx-auto max-w-7xl px-5 lg:px-8 pt-24 lg:pt-8 lg:pb-12 " + (isActiveMobileDm ? "h-full overflow-hidden pb-0" : "pb-[calc(8rem+env(safe-area-inset-bottom))]")
      }`}>
        {/* Title Header (Desktop only — hidden on inbox so the chat frame fills the viewport) */}
        {!isMobile && activeTab !== "inbox" && (
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6 mb-8 pb-6 border-b border-black/10">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold text-[#111827] uppercase tracking-tight">
                User Dashboard
              </h1>
              {/* Beside the title, per the desktop placement. This header is already desktop-only,
                  so no breakpoint class is needed here; the mobile header carries its own bell. */}
              <NotificationBell audience="USER" accent="#2775CA" />
            </div>
          </div>
        )}

        <div className={`grid grid-cols-1 items-start ${
          activeTab === "inbox" || isActiveMobileDm
            ? "h-full min-h-0 flex-1 flex flex-col overflow-hidden gap-0"
            : "gap-8"
        }`}>
          {/* Right main view content */}
          <div className={`col-span-1 ${
            activeTab === "inbox" || isActiveMobileDm
              ? "h-full min-h-0 flex-1 flex flex-col overflow-hidden"
              : "min-h-[500px]"
          }`}>
            {/* Keyed enter-only animation — deliberately NO AnimatePresence/exit here. Gating the
                incoming tab on the outgoing tab's exit spring (mode="wait") dropped the presence
                whenever a re-render or second tap landed mid-exit on slow mobile frames, leaving
                the content area permanently blank. */}
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 16, filter: "blur(1.5px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
              className={activeTab === "inbox" || isActiveMobileDm ? "h-full min-h-0 flex-1 flex flex-col overflow-hidden" : "min-h-0"}
            >
            {activeTab === "home" && (
              /* Wireframe layout: a 46fr/54fr two-column grid (left stack + tall panel) with a
                 full-width ledger beneath. Collapses to one column at <1024px, per the mock. */
              <div className="flex flex-col gap-5 md:gap-5">
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[46fr_54fr]">
                  {/* LEFT COLUMN */}
                  <div className="flex min-w-0 flex-col gap-4">
                    {/* ===== Wallet balance: figures left, stacked circle actions right ===== */}
                    <section data-testid="wallet-summary" className="dashboard-wallet-summary relative flex flex-col items-center justify-center gap-4 overflow-hidden px-3 py-3 text-center text-black md:flex-row md:justify-between md:rounded-[20px] md:border md:border-black/35 md:bg-[#2775CA]/20 md:px-6 md:py-[22px] md:text-left">
                      <div className="flex min-w-0 flex-col items-center md:items-start">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-black uppercase tracking-[0.08em] text-black/75">Wallet Balance</span>
                          <button
                            type="button"
                            onClick={toggleBalanceVisible}
                            className="text-black/55 hover:text-black transition-colors"
                            aria-label="Toggle balance visibility"
                          >
                            {balanceVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={handleManualRefreshBalances}
                            disabled={isRefreshingBalances}
                            className="text-black/55 hover:text-black disabled:opacity-50 transition-all"
                            title="Refresh balance"
                          >
                            <RefreshCw className={`h-3 w-3 ${isRefreshingBalances ? "animate-spin" : ""}`} />
                          </button>
                        </div>
                        <div className="mt-1.5 max-w-full text-[42px] font-extrabold leading-none text-black select-all sm:text-[38px]">
                          {isRefreshingBalances
                            ? <span className="block h-[42px] w-[190px] rounded-2xl subscript-skeleton sm:h-[38px]" />
                            : balanceVisible ? `$${formatHeadlineAmount(walletBalance)}` : "••••••"}
                        </div>
                        <p className="mt-1.5 w-full text-center font-mono text-sm font-bold text-black/65 sm:text-xs md:text-left">
                          {isRefreshingBalances
                            ? <span className="mx-auto block h-4 w-24 rounded-full subscript-skeleton md:mx-0" />
                            : balanceVisible ? `${detectedCurrency.symbol}${formatHeadlineAmount(localBalance)}` : "••••"}
                        </p>
                      </div>

                      <div data-testid="wallet-actions" className="wallet-actions flex w-full shrink-0 flex-row justify-center gap-2 md:w-auto md:flex-col">
                        <button
                          type="button"
                          onClick={() => setReceiveOpen(true)}
                          className="flex h-11 min-w-[110px] items-center justify-center gap-2 rounded-full border border-[#353935] bg-[#353935] px-4 text-[#FFFFF0] transition hover:bg-black active:scale-95 shadow-sm"
                          aria-label="Deposit"
                        >
                          <span className="text-xs font-bold">Deposit</span>
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { setSelectedDmPeer(null); setSendFundsOpen(true); }}
                            className="flex h-11 flex-1 min-w-[110px] items-center justify-center gap-2 rounded-full border border-[#2775CA] bg-[#2775CA] px-4 text-white transition hover:bg-[#1f62ab] active:scale-95 shadow-sm"
                            aria-label="Send"
                          >
                            <span className="text-xs font-bold">Send</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setQrTargetIndex(null);
                              setQrScannerOpen(true);
                            }}
                            className="flex md:hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/15 bg-white text-[#111827] hover:bg-black/5 active:scale-95 transition shadow-sm"
                            aria-label="Scan QR Code"
                            title="Scan SubScript QR code or link"
                          >
                            <QrCode className="h-4.5 w-4.5 text-[#2775CA]" />
                          </button>
                        </div>
                      </div>
                    </section>

                    {/* ===== Two equal square cards ===== */}
                    <div data-testid="home-summary-cards" className="grid grid-cols-[42fr_58fr] gap-3.5">
                      <div className="dashboard-blue-panel flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 p-[18px] text-black">
                        <div>
                          <p className="font-mono text-[10px] font-black uppercase tracking-[0.06em] text-white/50">30D spending</p>
                          <p className="mt-2 text-[11px] font-black text-white/40">30D</p>
                          <p className="mt-0.5 text-xl font-extrabold tracking-tight text-white">
                            {isRefreshingBalances
                              ? <span className="block h-6 w-20 rounded-lg subscript-skeleton" />
                              : balanceVisible ? `$${formatHeadlineAmount(monthlySpendUsdc)}` : "••••"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => goToAccountSubView("dns", "spend-analysis")}
                          className="mt-2 inline-flex items-center text-[10px] font-black uppercase tracking-wider text-[#ccff00] hover:opacity-70 transition-opacity"
                        >
                          Manage Spending
                        </button>
                      </div>
                      <div className="dashboard-blue-panel flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 p-[18px] text-black">
                        <div>
                          <p className="font-mono text-[10px] font-black uppercase tracking-[0.06em] text-white/50">Total Commit</p>
                          <div className="mt-2 flex items-baseline gap-3">
                            <div className="min-w-0">
                              <p className="text-xl font-extrabold tracking-tight text-white">
                                {isRefreshingBalances
                                  ? <span className="block h-6 w-16 rounded-lg subscript-skeleton" />
                                  : balanceVisible ? `$${formatHeadlineAmount(totalCommitLockedUsdc)}` : "••••"}
                              </p>
                              <p className="mt-0.5 font-mono text-[9px] font-black uppercase tracking-[0.06em] text-white/40">Locked</p>
                            </div>
                            <div className="min-w-0 border-l border-white/10 pl-3">
                              <p className="text-xl font-extrabold tracking-tight text-[#ccff00]">
                                {isRefreshingBalances
                                  ? <span className="block h-6 w-16 rounded-lg subscript-skeleton" />
                                  : balanceVisible ? `$${formatHeadlineAmount(totalCommitUsedUsdc)}` : "••••"}
                              </p>
                              <p className="mt-0.5 font-mono text-[9px] font-black uppercase tracking-[0.06em] text-white/40">Used</p>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab("commit")}
                          className="mt-2 inline-flex items-center text-[10px] font-black uppercase tracking-wider text-[#2775CA] hover:opacity-70 transition-opacity"
                        >
                          Manage Commits
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT TALL PANEL - Active Subscriptions (hidden on mobile) */}
                  <section className="dashboard-blue-panel hidden md:flex min-h-[260px] flex-col rounded-[20px] border border-black/15 bg-white/80 p-5 shadow-sm text-black">
                    <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                      <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-black/70">Active Subscriptions</h2>
                      <span className="w-fit rounded-full border border-[#2775CA]/20 bg-[#2775CA]/10 px-3 py-1 text-[10px] font-bold text-[#2775CA]">
                        {subscriptions.filter((s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd).length} active
                      </span>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                      {sortedSubscriptions.length === 0 ? (
                        <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 bg-black/[0.02] text-center">
                          <CreditCard className="mb-3 h-8 w-8 text-black/25" />
                          <p className="text-xs text-black/50">No active subscriptions</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {sortedSubscriptions.map((sub) => (
                            <SubscriptionRow
                              key={sub.subscriptionId}
                              subscription={sub}
                              balanceVisible={balanceVisible}
                              onResume={handleResumeSubscription}
                              resuming={resumingSubscriptionId === sub.subscriptionId}
                              onOpenThread={openMerchantThread}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* ===== Bottom full-width panel ===== */}
                <section className="dashboard-blue-panel min-h-[390px] rounded-[20px] border border-black/35 p-5 text-black">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[11px] font-black uppercase tracking-[0.16em] text-white/70">Transaction History</h2>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => router.push("/dashboard/user/transactions")}
                        className="inline-flex items-center text-[10px] font-black uppercase tracking-wider text-black/70 hover:text-black transition-colors"
                      >
                        View All
                      </button>
                    </div>
                  </div>

                  <div className="dashboard-filter-scroll mt-4 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {([["all", "All"], ["recurring", "Subscriptions"], ["one-time", "One Time"], ["transfers", "Transfers"], ["withdrawals", "Withdrawals"], ["deposits", "Deposits"]] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTxFilter(value)}
                        className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                          txFilter === value
                            ? "bg-[#353935] text-[#FFFFF0]"
                            : "bg-transparent text-black/70 hover:bg-black/5"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 divide-y divide-white/[0.06]">
                    {filteredTransactions.length === 0 ? (
                      <div className="flex h-24 items-center justify-center text-center text-xs text-white/40">
                        No {txFilter === "all" ? "" : txFilter === "recurring" ? "recurring " : "one-time "}transactions yet.
                      </div>
                    ) : (
                      filteredTransactions.slice(0, 6).map((tx) => (
                        <div key={tx.id} className="flex items-center gap-3 py-3">
                          <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center overflow-hidden">
                            {tx.pic ? (
                              <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-sm font-black text-[#ccff00]">{(tx.name || "?").charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-white">{tx.name}</p>
                            <p className="truncate text-[10px] font-bold text-white/40">
                              {tx.detail} • {new Date(tx.time).toLocaleString()}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`block text-xs font-black ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>
                              {balanceVisible ? tx.amountLabel : "••••"}
                            </span>
                            <span className="block text-[9px] font-bold text-[#ccff00] mt-0.5">
                              {balanceVisible ? tx.localAmountLabel : "••••"}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === "commit" && (
              <section className="mx-auto max-w-3xl space-y-6">
                <SectionTitle
                  title="Manage Commit"
                  subtitle="Fund prepaid balances for metered services"
                />

                <section className="commit-vault-shell p-0 sm:rounded-3xl sm:border sm:border-black/35 sm:bg-[#2775CA]/20 sm:p-8">
                  <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Prepaid Metered Vaults</h2>
                        <button
                          type="button"
                          onClick={toggleBalanceVisible}
                          className="text-white/40 transition-colors hover:text-white"
                          aria-label={balanceVisible ? "Hide balances" : "Show balances"}
                          title={balanceVisible ? "Hide sensitive amounts" : "Show sensitive amounts"}
                        >
                          {balanceVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVaultInfoOpen(true)}
                          className="grid h-4 w-4 place-items-center rounded-full border border-white/20 text-[9px] font-black text-white/50 transition hover:border-[#ccff00]/50 hover:text-[#ccff00]"
                          aria-label="What is a vault?"
                        >
                          ?
                        </button>
                      </div>
                      <p className="mt-1 text-[9px] text-white/40">
                        Prepaid balance for a metered service.{" "}
                        <button type="button" onClick={() => setVaultInfoOpen(true)} className="font-bold text-[#ccff00]/80 hover:underline">
                          what&apos;s this?
                        </button>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="hidden sm:flex items-center gap-1.5 mr-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (vaultCarouselRef.current) {
                              vaultCarouselRef.current.scrollBy({ left: -vaultCarouselRef.current.clientWidth, behavior: "smooth" });
                            }
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-black/20 bg-white/70 hover:bg-white text-black transition-all active:scale-95 shadow-sm"
                          title="Previous vault"
                          aria-label="Previous vault"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (vaultCarouselRef.current) {
                              vaultCarouselRef.current.scrollBy({ left: vaultCarouselRef.current.clientWidth, behavior: "smooth" });
                            }
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-black/20 bg-white/70 hover:bg-white text-black transition-all active:scale-95 shadow-sm"
                          title="Next vault"
                          aria-label="Next vault"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (expandedCommitAction !== "refresh") return setExpandedCommitAction("refresh");
                          await loadVaults();
                          triggerToast("Commit usage updated");
                          setExpandedCommitAction(null);
                        }}
                        disabled={isVaultsLoading}
                        className={`flex h-12 items-center justify-center gap-2 overflow-hidden rounded-2xl border border-black/30 bg-[#D5E3EE] text-black transition-all duration-300 disabled:opacity-50 ${expandedCommitAction === "refresh" ? "w-36 px-3" : "w-12"}`}
                        title="Refresh vault usage for committed apps"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isVaultsLoading ? "animate-spin text-[#2775CA]" : ""}`} />
                        {expandedCommitAction === "refresh" && <span className="whitespace-nowrap text-[10px] font-bold">{isVaultsLoading ? <>Refreshing<LoadingDots /></> : "Refresh Usage"}</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (expandedCommitAction !== "commit") return setExpandedCommitAction("commit");
                          setExpandedCommitAction(null);
                          openVaultCommit();
                        }}
                        className={`flex h-12 items-center justify-center gap-2 overflow-hidden rounded-2xl border border-black/30 bg-[#D5E3EE] text-black transition-all duration-300 ${expandedCommitAction === "commit" ? "w-44 px-3" : "w-12"}`}
                        title="Commit to a service"
                        aria-label="Commit to a service"
                      >
                        <Plus className="h-6 w-6 shrink-0" />
                        {expandedCommitAction === "commit" && <span className="whitespace-nowrap text-[10px] font-bold">Commit to a service</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (expandedCommitAction !== "hold") return setExpandedCommitAction("hold");
                          setExpandedCommitAction(null);
                          setAccountHoldModalOpen(true);
                        }}
                        className={`flex h-12 items-center justify-center gap-2 overflow-hidden rounded-2xl border transition-all duration-300 ${
                          isAccountOnHold
                            ? "border-amber-400/50 bg-amber-400/20 text-amber-300"
                            : "border-black/30 bg-[#D5E3EE] text-black"
                        } ${expandedCommitAction === "hold" ? "w-36 px-3" : "w-12"}`}
                        title={isAccountOnHold ? "Account is on hold" : "Manage account hold"}
                        aria-label={isAccountOnHold ? "Account is on hold" : "Manage account hold"}
                      >
                        <Shield className={`h-4.5 w-4.5 shrink-0 ${isAccountOnHold ? "text-amber-400" : "text-black"}`} />
                        {expandedCommitAction === "hold" && (
                          <span className="whitespace-nowrap text-[10px] font-bold">
                            {isAccountOnHold ? "On hold" : "Account hold"}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {isVaultsLoading ? (
                    <div ref={vaultCarouselRef} data-testid="vault-carousel" className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scroll-snap-type:x_mandatory] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <VaultCardSkeleton />
                      <VaultCardSkeleton />
                    </div>
                  ) : vaults.length === 0 ? (
                    <div ref={vaultCarouselRef} data-testid="vault-carousel" className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scroll-snap-type:x_mandatory] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <button
                        type="button"
                        onClick={() => openVaultCommit()}
                        data-testid="add-vault-card"
                        className="relative flex min-h-[360px] w-full min-w-full shrink-0 snap-center [scroll-snap-stop:always] items-center justify-center overflow-hidden rounded-3xl border border-black/20 bg-[#2775CA]/20 backdrop-blur-2xl"
                        aria-label="Commit to another vault"
                      >
                        <div className="absolute inset-0 bg-[#FFFFF0]/35 blur-2xl" aria-hidden="true" />
                        <Plus className="relative z-10 h-12 w-12 text-black" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        ref={vaultCarouselRef}
                        data-testid="vault-carousel"
                        onScroll={(e) => {
                          const el = e.currentTarget;
                          if (el.clientWidth > 0) {
                            const idx = Math.round(el.scrollLeft / el.clientWidth);
                            setActiveVaultIndex(idx);
                          }
                        }}
                        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3 scroll-smooth [scroll-snap-type:x_mandatory] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        {vaults.map((vault) => (
                          <div key={vault.id} className="w-full min-w-full shrink-0 snap-center [scroll-snap-stop:always]">
                            <MeteredVaultRow
                              vault={vault}
                              onCommit={(v) => openVaultCommit(v.merchantAddress)}
                              onWithdraw={(v) => openVaultWithdraw(v.merchantAddress)}
                              onReclaim={handleVaultReclaim}
                              onCancelService={handleCancelService}
                              onResumeService={(v) => handleResumeService(v.merchantAddress)}
                              onConfigureAutoTopUp={(v) => {
                                setEditingVault(v);
                                setConfigVaultOpen(true);
                              }}
                              cancelBusy={vaultCancelBusyId === String(vault.id || vault.merchantAddress)}
                              resumeBusy={vaultResumeBusyId === String(vault.id || vault.merchantAddress)}
                              reclaimBusy={vaultReclaimBusyId === String(vault.id || vault.merchantAddress)}
                              balanceVisible={balanceVisible}
                            />
                          </div>
                        ))}
                        <button type="button" onClick={() => openVaultCommit()} data-testid="add-vault-card" className="relative flex min-h-[360px] w-full min-w-full shrink-0 snap-center [scroll-snap-stop:always] items-center justify-center overflow-hidden rounded-3xl border border-black/20 bg-[#2775CA]/20 backdrop-blur-2xl" aria-label="Commit to another vault">
                          <div className="absolute inset-0 bg-[#FFFFF0]/35 blur-2xl" aria-hidden="true" />
                          <Plus className="relative z-10 h-12 w-12 text-black" />
                        </button>
                      </div>

                      {/* Mobile Pagination Indicator Dots */}
                      <div className="mt-3 flex items-center justify-center gap-1.5 md:hidden">
                        {Array.from({ length: vaults.length + 1 }).map((_, idx) => {
                          const isActive = activeVaultIndex === idx;
                          return (
                            <button
                              key={idx}
                              type="button"
                              aria-label={`Go to vault card ${idx + 1}`}
                              onClick={() => {
                                if (vaultCarouselRef.current) {
                                  vaultCarouselRef.current.scrollTo({
                                    left: idx * vaultCarouselRef.current.clientWidth,
                                    behavior: "smooth",
                                  });
                                }
                                setActiveVaultIndex(idx);
                              }}
                              className={`transition-all duration-300 rounded-full ${
                                isActive
                                  ? "h-2 w-5 bg-[#111827]"
                                  : "h-2 w-2 bg-black/20 hover:bg-black/40"
                              }`}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>

              </section>
            )}

            {activeTab === "inbox" && (
              <section
                className={`mx-auto flex w-full max-w-[430px] min-h-0 flex-1 flex-col gap-5 md:h-full md:max-w-none md:flex-row overflow-hidden ${
                  isActiveMobileDm ? "h-full overflow-hidden" : ""
                }`}
              >
                {isMobile ? (
                  <div className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden w-full">
                    {!selectedDmPeer ? (
                      <div className="w-full space-y-4 pt-24 pb-32 overflow-y-auto">
                        <DmThreadSelect
                          threads={dmThreads}
                          onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                          selectedPeerAddress={selectedDmPeer}
                          pendingRequestsCount={pendingRequestsCount}
                          onOpenRequests={() => setDmRequestsModalOpen(true)}
                          onOpenInvite={() => setDmInviteModalOpen(true)}
                          onOpenBlocked={() => setBlockedUsersModalOpen(true)}
                        />
                      </div>
                    ) : (
                      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden pt-20">
                        <div
                          ref={attachDmScroller}
                          onScroll={handleDmScroll}
                          data-testid="mobile-dm-message-scroller"
                          className="min-h-0 flex-1 overflow-y-auto overscroll-contain will-change-transform translate-z-0 space-y-4 px-1 pt-1 pb-4"
                        >
                          <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55 mt-3">
                            {isActiveDmMerchant
                              ? "Updates from this merchant — you can't reply here"
                              : "Direct peer-to-peer system messages only"}
                          </div>
                          <div className="mx-auto w-fit rounded-full bg-white/10 px-6 py-1 text-[10px] font-bold text-white/55">
                            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </div>

                          {isCurrentPeerBlocked && (
                            <div className="mx-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3.5 flex items-center justify-between gap-3 text-xs text-rose-300">
                              <div className="flex items-center gap-2">
                                <UserX className="h-4 w-4 shrink-0 text-rose-400" />
                                <span>Contact blocked. Messaging and sends disabled.</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => selectedDmPeer && handleUnblockPeer(selectedDmPeer)}
                                className="rounded-xl border border-white/10 bg-white/10 hover:bg-white/20 px-3 py-1 text-[10px] font-bold text-white transition-all shrink-0"
                              >
                                Unblock
                              </button>
                            </div>
                          )}

                          {selectedThreadDms.length === 0 && !isCurrentPeerBlocked && (
                            <div className="py-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-center p-6 space-y-3 mx-2">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2775CA]/10 border border-[#2775CA]/20 text-[#2775CA]">
                                <MessageSquare className="h-6 w-6" />
                              </div>
                              <div className="space-y-1">
                                <h3 className="text-sm font-bold text-[#111827]">Connection Established</h3>
                                <p className="text-xs text-black/60 max-w-sm">
                                  You and {activeThreadLabel} are connected. Send funds or request a payment to begin transacting.
                                </p>
                              </div>
                            </div>
                          )}

                          {selectedThreadDms.map((dm) => (
                            <DmBubble
                              key={dm.id}
                              dm={dm}
                              focused={focusIntentId === dm.paymentLinkId}
                              incoming={dm.senderAddress.toLowerCase() !== userWallet?.toLowerCase()}
                              forceMerchantVoice={isActiveDmMerchant}
                              loadingAction={loadingAction}
                              onPay={() => handleConfirmPaymentDm(dm)}
                              onDecline={() => handleDeclineDm(dm)}
                              onDismiss={() => handleDismissDm(dm)}
                              onNudge={() => handleNudgeSuggestion(dm)}
                              onThanks={() => handleThanksSuggestion(dm)}
                              onCancelPlan={() => handleCancelPlanSuggestion(dm)}
                              onSurveySubmit={(dmMsg, ans) => handleSurveySubmit(dmMsg, ans)}
                              onResumeService={() => handleResumeService(dm.senderAddress)}
                              onTopUpCommit={() => openVaultCommit(dm.senderAddress)}
                              onViewCommit={() => setActiveTab("commit")}
                              onManagePlan={handleTogglePlanManager}
                              onCancelSubscription={() => handleCancelSubscriptionForMerchant(dm.senderAddress)}
                              onResumeSubscription={() => activeThreadSubscription && handleResumeSubscription(activeThreadSubscription)}
                              resumeBusy={vaultResumeBusyId === dm.senderAddress || vaultResumeBusyId === dm.senderAddress?.toLowerCase()}
                            />
                          ))}
                          <div ref={dmBottomRef} />
                        </div>

                        {/* Bottom Action Footer for Mobile */}
                        <div
                          data-testid="mobile-dm-action-footer"
                          className="relative z-30 shrink-0 border-t border-black/10 bg-[#FFFFF0] px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl rounded-t-2xl shadow-md text-black"
                        >
                          {isCurrentPeerBlocked ? (
                            <p className="text-center text-[11px] text-white/40 py-2">
                              Messaging is disabled for blocked contacts.
                            </p>
                          ) : isActiveDmMerchant ? (
                            <MerchantPlanManager
                              open={planManagerOpen}
                              merchantLabel={activeThreadLabel}
                              plans={threadPlans}
                              activeSubscription={activeThreadSubscription}
                              loading={isThreadPlansLoading}
                              loadingAction={loadingAction}
                              status={planManagerStatus}
                              error={planManagerError}
                              onToggle={handleTogglePlanManager}
                              onCancel={() => selectedDmPeer && handleCancelSubscriptionForMerchant(selectedDmPeer)}
                              onResume={handleResumeSubscription}
                            />
                          ) : (
                            <div className="flex flex-col gap-2">
                              <DmRequestComposer
                                open={dmRequestOpen}
                                amount={dmRequestAmount}
                                note={dmRequestNote}
                                duration={dmRequestDuration}
                                billingType={dmRequestBillingType}
                                interval={dmRequestInterval}
                                status={dmRequestStatus}
                                loading={loadingAction === "create-dm-request"}
                                onToggle={() => {
                                  setDmRequestOpen((open) => !open);
                                  setDmRequestStatus(null);
                                }}
                                onSubmit={handleCreateDmRequest}
                                onAmountChange={setDmRequestAmount}
                                onNoteChange={setDmRequestNote}
                                onDurationChange={setDmRequestDuration}
                                onBillingTypeChange={setDmRequestBillingType}
                                onIntervalChange={setDmRequestInterval}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Desktop Split Multi-Column DM Layout */
                  <div className="flex flex-1 flex-row gap-5 h-full min-h-0 overflow-hidden items-stretch w-full">
                    {/* List of opened DMs (middle column in blueprint) */}
                    <div className="w-[280px] lg:w-[340px] border-r border-black/5 dark:border-white/5 pr-4 lg:pr-5 flex flex-col overflow-y-auto will-change-transform translate-z-0 space-y-3 shrink-0">
                      <DmThreadSelect
                        threads={dmThreads}
                        onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                        selectedPeerAddress={selectedDmPeer}
                        pendingRequestsCount={pendingRequestsCount}
                        onOpenRequests={() => setDmRequestsModalOpen(true)}
                        onOpenInvite={() => setDmInviteModalOpen(true)}
                        onOpenBlocked={() => setBlockedUsersModalOpen(true)}
                      />
                    </div>

                    {/* Active thread message bubble display (right column in blueprint) */}
                    <div className="flex-1 flex flex-col overflow-hidden liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-4 min-h-0 justify-between">
                      <AnimatePresence mode="wait">
                        {selectedDmPeer ? (
                          <motion.div
                            key={selectedDmPeer}
                            initial={{ opacity: 0, scale: 0.96, y: 12, filter: "blur(1.5px)" }}
                            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, scale: 0.96, y: -12, filter: "blur(1.5px)" }}
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                            className="flex flex-col h-full justify-between overflow-hidden"
                          >
                            {/* Desktop Chat Pane Header */}
                            <div
                              data-testid="desktop-dm-header"
                              className="sticky top-0 z-20 flex shrink-0 items-center justify-between border border-white/10 bg-black/40 px-4 py-2.5 rounded-2xl backdrop-blur-xl shadow-xl mb-2"
                            >
                              <div className="flex items-center gap-3">
                                <Avatar profilePic={activeThread?.peerProfilePic || null} name={activeThreadLabel} />
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <h4 className="text-xs font-black uppercase tracking-wider text-white">
                                      {activeThreadLabel}
                                    </h4>
                                    {isActiveDmMerchant && (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                    )}
                                  </div>
                                  {/* Recurring subscription indicator — pulsing dot + label */}
                                  {activeThreadSubscription && (
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {/* Beacon: outer ping ring + inner solid dot */}
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        {!activeThreadSubscription.cancelAtPeriodEnd && (
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                                        )}
                                        <span className={`relative inline-flex h-2 w-2 rounded-full ${activeThreadSubscription.cancelAtPeriodEnd ? "bg-amber-400" : "bg-emerald-400"}`} />
                                      </span>
                                      <span className={`text-[8px] font-black uppercase tracking-[0.12em] ${activeThreadSubscription.cancelAtPeriodEnd ? "text-amber-400" : "text-emerald-400"}`}>
                                        {activeThreadSubscription.cancelAtPeriodEnd ? "Cancelling" : "Recurring active"}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                {/* Back to thread select on tablet only */}
                                <button
                                  type="button"
                                  onClick={() => setSelectedDmPeer(null)}
                                  className="md:hidden p-2 text-white/60 hover:text-white bg-white/[0.02] border border-white/5 rounded-full transition-all shrink-0 animate-fade-in"
                                >
                                  <ArrowLeft className="h-4 w-4" />
                                </button>
                                
                                {isCurrentPeerBlocked ? (
                                  <button
                                    type="button"
                                    onClick={() => selectedDmPeer && handleUnblockPeer(selectedDmPeer)}
                                    className="px-3 py-1 bg-white/10 border border-white/20 text-white font-bold text-[9px] rounded-full hover:bg-white/20 transition active:scale-95 shrink-0"
                                  >
                                    Unblock
                                  </button>
                                ) : (
                                  <>
                                    {!isActiveDmMerchant && (
                                      <button
                                        type="button"
                                        onClick={() => selectedDmPeer && handleBlockPeer(selectedDmPeer)}
                                        className="p-1.5 text-white/40 hover:text-rose-400 bg-white/[0.02] hover:bg-rose-500/10 border border-white/5 rounded-full transition-all shrink-0"
                                        title="Block user"
                                      >
                                        <UserX className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    {!isActiveDmMerchant && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSendFundsRecipient(activeThreadLabel || selectedDmPeer);
                                          setSendFundsOpen(true);
                                        }}
                                        className="px-3 py-1 bg-[#ccff00] text-black border border-black/20 font-black uppercase tracking-wider text-[9px] rounded-full hover:bg-[#b8e600] transition shadow-sm active:scale-95 shrink-0"
                                      >
                                        Send Funds
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Message bubbles pane */}
                            <div ref={attachDmScroller} onScroll={handleDmScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain will-change-transform translate-z-0 pr-1 space-y-3 py-2">
                              <div className="mx-auto w-fit max-w-full rounded-full border border-[#2775CA]/20 bg-[#2775CA]/10 px-4 py-1.5 text-center text-[9px] font-black uppercase tracking-[0.14em] text-[#2775CA] backdrop-blur-md shadow-sm">
                                {isActiveDmMerchant
                                  ? "Updates from this merchant — you can't reply here"
                                  : "Direct peer-to-peer system messages only"}
                              </div>
                              <div className="mx-auto w-fit rounded-full border border-black/10 bg-black/5 backdrop-blur-md px-4 py-0.5 text-[9px] font-bold text-black/60">
                                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </div>

                              {isCurrentPeerBlocked && (
                                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 flex items-center justify-between gap-3 text-xs text-rose-700">
                                  <div className="flex items-center gap-2">
                                    <UserX className="h-4 w-4 shrink-0 text-rose-600" />
                                    <span>Contact blocked. Messaging and sends disabled.</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => selectedDmPeer && handleUnblockPeer(selectedDmPeer)}
                                    className="rounded-xl border border-black/15 bg-white hover:bg-black/5 px-3 py-1 text-[10px] font-bold text-black transition-all shrink-0 shadow-sm"
                                  >
                                    Unblock
                                  </button>
                                </div>
                              )}

                              {selectedThreadDms.length === 0 && !isCurrentPeerBlocked && (
                                <div className="py-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-center p-6 space-y-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2775CA]/10 border border-[#2775CA]/20 text-[#2775CA]">
                                    <MessageSquare className="h-5 w-5" />
                                  </div>
                                  <div className="space-y-1">
                                    <h3 className="text-xs font-bold text-[#111827]">Connection Established</h3>
                                    <p className="text-[11px] text-black/60 max-w-sm">
                                      You and {activeThreadLabel} are connected. Send funds or request a payment below to start transacting.
                                    </p>
                                  </div>
                                </div>
                              )}

                              {selectedThreadDms.map((dm) => (
                                <DmBubble
                                  key={dm.id}
                                  dm={dm}
                                  focused={focusIntentId === dm.paymentLinkId}
                                  incoming={dm.senderAddress.toLowerCase() !== userWallet?.toLowerCase()}
                                  forceMerchantVoice={isActiveDmMerchant}
                                  loadingAction={loadingAction}
                                  onPay={() => handleConfirmPaymentDm(dm)}
                                  onDecline={() => handleDeclineDm(dm)}
                                  onDismiss={() => handleDismissDm(dm)}
                                  onNudge={() => handleNudgeSuggestion(dm)}
                                  onThanks={() => handleThanksSuggestion(dm)}
                                  onCancelPlan={() => handleCancelPlanSuggestion(dm)}
                                  onSurveySubmit={(dmMsg, ans) => handleSurveySubmit(dmMsg, ans)}
                                  onResumeService={() => handleResumeService(dm.senderAddress)}
                                  onTopUpCommit={() => openVaultCommit(dm.senderAddress)}
                                  onViewCommit={() => setActiveTab("commit")}
                                  onManagePlan={handleTogglePlanManager}
                                  onCancelSubscription={() => handleCancelSubscriptionForMerchant(dm.senderAddress)}
                                  onResumeSubscription={() => activeThreadSubscription && handleResumeSubscription(activeThreadSubscription)}
                                  resumeBusy={vaultResumeBusyId === dm.senderAddress || vaultResumeBusyId === dm.senderAddress?.toLowerCase()}
                                />
                              ))}
                              <div ref={dmBottomRef} />
                            </div>

                            {/* Bottom Action Footer for Desktop */}
                            <div
                              data-testid="desktop-dm-action-footer"
                              className="sticky bottom-0 z-20 shrink-0 mt-2 text-white w-full"
                            >
                              {isCurrentPeerBlocked ? (
                                <p className="text-center text-[11px] text-white/40 py-2">
                                  Messaging is disabled for blocked contacts.
                                </p>
                              ) : isActiveDmMerchant ? (
                                <MerchantPlanManager
                                  open={planManagerOpen}
                                  merchantLabel={activeThreadLabel}
                                  plans={threadPlans}
                                  activeSubscription={activeThreadSubscription}
                                  loading={isThreadPlansLoading}
                                  loadingAction={loadingAction}
                                  status={planManagerStatus}
                                  error={planManagerError}
                                  onToggle={handleTogglePlanManager}
                                  onCancel={() => selectedDmPeer && handleCancelSubscriptionForMerchant(selectedDmPeer)}
                                  onResume={handleResumeSubscription}
                                />
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <DmRequestComposer
                                    open={dmRequestOpen}
                                    amount={dmRequestAmount}
                                    note={dmRequestNote}
                                    duration={dmRequestDuration}
                                    billingType={dmRequestBillingType}
                                    interval={dmRequestInterval}
                                    status={dmRequestStatus}
                                    loading={loadingAction === "create-dm-request"}
                                    onToggle={() => {
                                      setDmRequestOpen((open) => !open);
                                      setDmRequestStatus(null);
                                    }}
                                    onSubmit={handleCreateDmRequest}
                                    onAmountChange={setDmRequestAmount}
                                    onNoteChange={setDmRequestNote}
                                    onDurationChange={setDmRequestDuration}
                                    onBillingTypeChange={setDmRequestBillingType}
                                    onIntervalChange={setDmRequestInterval}
                                  />
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="no-chat"
                            initial={{ opacity: 0, scale: 0.98, filter: "blur(1.5px)" }}
                            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                            exit={{ opacity: 0, scale: 0.98, filter: "blur(1.5px)" }}
                            className="flex flex-col items-center justify-center h-full text-center py-20 text-white/40 space-y-3"
                          >
                            <MessageSquare className="w-12 h-12 text-white/15 animate-pulse" />
                            <h3 className="text-sm font-black uppercase tracking-wider text-white/60">Select a Chat to continue</h3>
                            <p className="text-xs max-w-xs leading-relaxed text-white/45">Choose a merchant or user thread from the list on the left to view receipts, approve payment requests, or view transaction status.</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === "links" && (
              <section className="space-y-5 max-w-lg pb-6 lg:pb-0">
                <SectionTitle title="Payment Links" subtitle="Create a shareable link to receive USDC. Anyone who pays is auto-onboarded and a DM opens with them." />

                <form onSubmit={handleCreateShareableLink} className="border border-black/10 bg-white/80 rounded-3xl p-5 sm:p-8 space-y-5 shadow-sm text-black">
                  {/* Link Billing Type Toggle */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-[0.14em] text-black/60">Payment Type</label>
                    <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-black/[0.04] border border-black/10">
                      <button
                        type="button"
                        onClick={() => setLinkBillingType("ONE_TIME")}
                        className={`py-2 px-3 rounded-xl text-xs font-bold transition ${linkBillingType === "ONE_TIME" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"}`}
                      >
                        One-Time
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkBillingType("RECURRING")}
                        className={`py-2 px-3 rounded-xl text-xs font-bold transition ${linkBillingType === "RECURRING" ? "bg-[#2775CA] text-white shadow-sm" : "text-black/60 hover:text-black"}`}
                      >
                        Recurring
                      </button>
                    </div>
                  </div>

                  {linkBillingType === "RECURRING" && (
                    <Field label="Billing Frequency">
                      <select
                        value={linkInterval}
                        onChange={(event) => setLinkInterval(event.target.value as any)}
                        className="subscript-input bg-white border border-black/15 text-[#111827]"
                      >
                        <option value="monthly">Monthly (every 30 days)</option>
                        <option value="weekly">Weekly (every 7 days)</option>
                        <option value="daily">Daily (every 24 hours)</option>
                        <option value="yearly">Yearly (every 365 days)</option>
                      </select>
                    </Field>
                  )}

                  <Field label={linkBillingType === "RECURRING" ? "Recurring USDC Amount" : "USDC Amount"}>
                    <input
                      value={linkAmount}
                      onChange={(event) => setLinkAmount(event.target.value)}
                      placeholder="25.00"
                      inputMode="decimal"
                      className="subscript-input bg-white border border-black/15 text-[#111827]"
                      required
                    />
                  </Field>

                  <Field label="What's it for (optional)">
                    <input
                      value={linkMemo}
                      onChange={(event) => setLinkMemo(event.target.value)}
                      placeholder={linkBillingType === "RECURRING" ? "e.g. Monthly newsletter, community membership, software retainer..." : "e.g. Graphic design work, dinner split, coffee..."}
                      className="subscript-input bg-white border border-black/15 text-[#111827]"
                      maxLength={120}
                    />
                  </Field>

                  {linkError && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-red-700">
                      {linkError}
                    </div>
                  )}
                  
                  <button
                    type="submit"
                    disabled={linkLoading}
                    className={`w-full py-3.5 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white text-xs font-black uppercase tracking-[0.16em] shadow-sm transition flex items-center justify-center gap-1.5 ${linkLoading ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    {linkLoading ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Creating payment link...
                      </span>
                    ) : (
                      <span>Create payment link</span>
                    )}
                  </button>
                </form>

                {linkResultUrl && (
                  <div className="border border-black/10 bg-white/90 rounded-3xl p-5 sm:p-6 space-y-3 shadow-sm text-black">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-[#2775CA]">Your shareable link</h3>
                    <p className="break-all rounded-2xl border border-black/10 bg-black/5 px-4 py-3 font-mono text-xs text-black/80">{linkResultUrl}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={copyLinkUrl}
                        className="rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-3 text-xs font-bold transition shadow-sm"
                      >
                        {linkCopied ? "Copied ✓" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkQrShown((shown) => !shown)}
                        aria-expanded={linkQrShown}
                        className="rounded-2xl border border-black/15 bg-white text-black hover:bg-black/5 py-3 text-xs font-bold transition shadow-sm flex items-center justify-center gap-1.5"
                      >
                        {linkQrShown ? "Hide QR" : "Show QR"} <QrCode className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {linkQrShown && (
                      <div className="flex flex-col items-center gap-3 pt-1">
                        <div className="rounded-3xl bg-white p-4 border border-black/10 shadow-md">
                          <QRCode
                            value={linkResultUrl}
                            size={isMobile ? 196 : 280}
                            ecLevel="H"
                            bgColor="#ffffff"
                            fgColor="#000000"
                            qrStyle="dots"
                            eyeRadius={[
                              [10, 10, 0, 10],
                              [10, 10, 10, 0],
                              [10, 0, 10, 10]
                            ]}
                            logoImage="/logo.png"
                            logoWidth={40}
                            logoHeight={40}
                            removeQrCodeBehindLogo={true}
                            logoPadding={2}
                          />
                        </div>
                        <p className="text-[11px] leading-relaxed text-center text-black/60">
                          Let the payer scan this with their phone camera to open the payment link.
                        </p>
                      </div>
                    )}
                    <p className="text-[11px] leading-relaxed text-black/60">
                      Share this anywhere. When someone pays, they&apos;re auto-onboarded as a SubScript user and a DM thread opens between you.
                    </p>
                  </div>
                )}

                <div className="flex items-start gap-3 rounded-3xl border border-black/10 bg-white/70 p-4 text-black shadow-sm">
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-black/40" />
                  <p className="text-[11px] leading-relaxed text-black/60">
                    Want to bill a specific person privately instead? Open their thread in <button type="button" onClick={() => setActiveTab("inbox")} className="font-bold text-[#2775CA] underline-offset-2 hover:underline">DMs</button> and tap Request.
                  </p>
                </div>
              </section>
            )}

            {activeTab === "batch" && (
              <section className="space-y-5 max-w-lg pb-6 lg:pb-0">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <SectionTitle title="Batch payouts" subtitle="Pay many people in one run, or just one." />

                  {/* Blue rather than the charcoal this used to be. #353935 sits within a couple of
                      shades of the dark canvas (#17181a), so the button read as a label instead of a
                      control. #2775CA with cream is the page's own primary-action pairing — the same
                      one Copy Link uses — and neither token is rewritten by the light or the dark
                      layer, so it holds its contrast in both themes without new CSS. Lime was the
                      other candidate and is wrong here: the light layer repaints bg-[#ccff00]
                      charcoal, which would have put dark text on a dark fill in light mode. */}
                  <button
                    type="button"
                    onClick={() => setSendSingleModalOpen(true)}
                    className="flex w-full sm:w-auto shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#2775CA] bg-[#2775CA] px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#FFFFF0] shadow-sm transition hover:bg-[#1f62ab] active:scale-[0.98]"
                  >
                    <Send className="h-3.5 w-3.5" /> Single Send
                  </button>
                </div>
                  <div ref={batchFormRef} className="border border-black/10 bg-white/80 rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm text-black">
                    {/* Batch payouts are Arc-only. There is no CCTP path here on purpose: a run of
                        twenty recipients would be twenty separate burns, twenty attestations and
                        twenty relayed mints, and a partial failure halfway through would leave the
                        user reconciling it by hand. Cross-chain stays in Single Send, one at a time. */}
                    <p className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/10 p-3 text-[11px] leading-relaxed text-black/75">
                      Batch payouts go out on Arc only. To send USDC to another chain, use Single Send.
                    </p>
                    {batchRows.map((row, index) => (
                      <div key={index} className="rounded-3xl border border-black/10 bg-black/5 p-4 space-y-3 relative text-black">
                        {batchRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setBatchRows((rows) => rows.filter((_, idx) => idx !== index))}
                            className="absolute right-3 top-3 text-black/40 hover:text-black transition"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/60">Recipient {index + 1}</p>
                        
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] uppercase font-bold text-black/60">Address or DNS name</span>
                            <button
                              type="button"
                              onClick={() => {
                                setQrTargetIndex(index);
                                setQrScannerOpen(true);
                              }}
                              className="flex md:hidden items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#2775CA] hover:underline"
                            >
                              <QrCode className="h-3.5 w-3.5 text-[#2775CA]" /> Scan QR
                            </button>
                          </div>
                          <div className="relative flex items-center gap-2">
                            <input
                              value={row.address}
                              onChange={(event) => setBatchRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))}
                              placeholder="alice.sub or 0x..."
                              className="subscript-input bg-white border border-black/15 text-[#111827]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setQrTargetIndex(index);
                                setQrScannerOpen(true);
                              }}
                              title={`Scan QR Code for Recipient #${index + 1}`}
                              className="flex md:hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/15 bg-white text-black hover:bg-black/5 transition shadow-sm"
                            >
                              <QrCode className="h-4 w-4 text-black" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] uppercase font-bold text-black/60">USDC Amount</span>
                            <button
                              type="button"
                              onClick={() => {
                                const otherRowsSum = batchRows.reduce((sum, item, itemIdx) => {
                                  if (itemIdx === index) return sum;
                                  const val = parseFloat(item.amount);
                                  return sum + (isNaN(val) ? 0 : val);
                                }, 0);
                                const remainder = Math.max(0, walletBalance - otherRowsSum);
                                const formatted = remainder > 0 ? parseFloat(remainder.toFixed(6)).toString() : "0";
                                setBatchRows((rows) =>
                                  rows.map((item, itemIdx) =>
                                    itemIdx === index ? { ...item, amount: formatted } : item
                                  )
                                );
                              }}
                              className="text-[9px] font-black uppercase tracking-wider text-[#2775CA] hover:underline"
                            >
                              The Rest
                            </button>
                          </div>
                          <div className="relative flex items-center">
                            <input
                              value={row.amount}
                              onChange={(event) => setBatchRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))}
                              placeholder="USDC amount"
                              className="subscript-input bg-white border border-black/15 text-[#111827] pr-20 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const otherRowsSum = batchRows.reduce((sum, item, itemIdx) => {
                                  if (itemIdx === index) return sum;
                                  const val = parseFloat(item.amount);
                                  return sum + (isNaN(val) ? 0 : val);
                                }, 0);
                                const remainder = Math.max(0, walletBalance - otherRowsSum);
                                const formatted = remainder > 0 ? parseFloat(remainder.toFixed(6)).toString() : "0";
                                setBatchRows((rows) =>
                                  rows.map((item, itemIdx) =>
                                    itemIdx === index ? { ...item, amount: formatted } : item
                                  )
                                );
                              }}
                              className="absolute right-2.5 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg bg-[#2775CA]/10 text-[#2775CA] hover:bg-[#2775CA]/20 border border-[#2775CA]/30 transition z-10"
                            >
                              The Rest
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {batchProgress && (
                      <div className="bg-[#2775CA]/10 border border-[#2775CA]/20 rounded-2xl p-4 flex items-center gap-3 text-black">
                        <Loader2 className="w-4 h-4 animate-spin text-[#2775CA]" />
                        <span className="text-xs text-black font-medium">{batchProgress}</span>
                      </div>
                    )}

                    {batchSelfSendRows.length > 0 && (
                      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-700">
                        Recipient {batchSelfSendRows.map((row) => row.index + 1).join(", ")} uses your connected wallet address. Remove it before running the batch.
                      </div>
                    )}

                    <BalanceRoutingNotice
                      amount={batchRows.reduce((sum, row) => sum + (isNaN(Number(row.amount)) ? 0 : Number(row.amount)), 0)}
                      walletBalance={walletBalance}
                      elsewhereUsdc={elsewhereUsdc}
                    />

                    {batchSendStatus && (
                      <p className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${
                        batchSendStatus.startsWith("Success") 
                          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-800" 
                          : "bg-red-500/15 border-red-500/30 text-red-800"
                      }`}>
                        {batchSendStatus}
                      </p>
                    )}

                    {/* Capped client-side against the same constant the send route enforces. Without
                        this the button appended without limit and the only feedback for overshooting
                        was a 400 after every row had been filled in. */}
                    <button
                      type="button"
                      onClick={() => setBatchRows((rows) => (
                        rows.length >= MAX_BATCH_RECIPIENTS ? rows : [...rows, { address: "", amount: "" }]
                      ))}
                      disabled={batchRows.length >= MAX_BATCH_RECIPIENTS}
                      className="w-full rounded-2xl border border-black/15 bg-white hover:bg-black/5 text-black py-3.5 text-xs font-black uppercase tracking-[0.16em] transition shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {batchRows.length >= MAX_BATCH_RECIPIENTS
                        ? `Limit reached — ${MAX_BATCH_RECIPIENTS} recipients max`
                        : "Add Recipient"}
                    </button>
                    <p className="text-center text-[10px] font-medium text-black/50">
                      {batchRows.length} of {MAX_BATCH_RECIPIENTS} recipients
                    </p>

                    <button
                      type="button"
                      onClick={handleBatchSend}
                      disabled={batchSendLoading || batchSelfSendRows.length > 0}
                      className={`w-full rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-sm ${
                        batchSendLoading || batchSelfSendRows.length > 0 ? "opacity-60 cursor-not-allowed" : ""
                      }`}
                    >
                      {batchSendLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Executing Batch...
                        </>
                      ) : (
                        <>
                          <Users className="h-4 w-4" /> Batch Send Payouts
                        </>
                      )}
                    </button>
                  </div>
              </section>
            )}

              {activeTab === "dns" && (
                <section className="pb-20 max-w-2xl font-sans text-black">
                {/* 1. MAIN MENU VIEW */}
                {accountSubView === "menu" && (
                  <div className="space-y-6">
                    <SectionTitle title="Account Settings" subtitle="Manage your identity, spending limits, and security." />

                    {/* Refer & Earn Banner */}
                    <div 
                      onClick={() => setActiveTab("referrals")}
                      className="cursor-pointer relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-emerald-50 hover:bg-emerald-100/70 p-5 flex items-center justify-between transition-all duration-300 shadow-sm group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-emerald-500/15 text-emerald-700">
                          <Gift className="h-6 w-6" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black uppercase tracking-wider text-emerald-950 group-hover:text-emerald-800 transition-colors">Refer and Earn</h4>
                          <p className="text-[11px] text-emerald-800/70 leading-relaxed mt-0.5">Invite your friends and earn on SubScript</p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-emerald-700/40 group-hover:text-emerald-700 group-hover:translate-x-1 transition-all" />
                    </div>

                    {/* Settings Menu Options Card */}
                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-3 space-y-1 shadow-sm">
                      {/* Admin console. The desktop sidebar link is inside `hidden md:flex`, so on a
                          phone this is the ONLY way in. A Link rather than a sub-view because /admin
                          is its own route; visibility is cosmetic, since the /admin layout re-checks
                          admin status server-side on every request. */}
                      {isAdmin && (
                        <Link
                          href="/admin"
                          className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 transition-all">
                              <Shield className="h-4 w-4" />
                            </div>
                            <div>
                              <span className="block text-xs font-bold text-black uppercase tracking-wide">Admin</span>
                              <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Platform controls, analytics and moderation</span>
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      )}

                      <button
                        onClick={() => setAccountSubView("profile")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <User className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Account Profile</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Manage your alias and avatar</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("appearance")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <Sliders className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Appearance &amp; Theme</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Switch between Light, Dark, and System mode</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("kyc")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <Shield className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">KYC Verification</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Identity verification & compliance</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => openSubView("spend-analysis")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <TrendingUp className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Spend Analysis</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">View spending breakdown and categories</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => openSubView("transactions")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <Activity className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Transactions</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">See all transaction logs and history</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("notifications")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <Sliders className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Notifications</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Set your notification preferences</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("security")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <Lock className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Security</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Change privacy settings and export private key</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("support")}
                        className="w-full text-left p-4 hover:bg-black/[0.04] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-black/5 text-black/70 group-hover:bg-[#353935] group-hover:text-white transition-all">
                            <MessageSquare className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-black uppercase tracking-wide">Support</span>
                            <span className="block text-[9px] text-black/50 font-sans mt-0.5 font-normal normal-case">Contact support team</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleteAccountLoading}
                        className="w-full text-left p-4 hover:bg-red-500/[0.08] rounded-2xl flex items-center justify-between transition-all group disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-red-500/10 text-red-600 group-hover:bg-red-500/20 transition-all">
                            {deleteAccountLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-red-600 uppercase tracking-wide">Delete Account</span>
                            <span className="block text-[9px] text-red-600/70 font-sans mt-0.5 font-normal normal-case">Permanently erase your profile and sign out</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-red-600/40 group-hover:text-red-600 group-hover:translate-x-0.5 transition-all" />
                      </button>
                    </div>
                  </div>
                )}

                {/* APPEARANCE & THEME VIEW */}
                {accountSubView === "appearance" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 font-sans text-xs">
                      <button
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-black">Appearance &amp; Theme</h2>
                    </div>

                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm">
                      <div>
                        <h3 className="text-base font-bold text-black">Dashboard Theme</h3>
                        <p className="text-xs text-black/60 mt-1">
                          Choose your preferred appearance for the SubScript dashboard.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        {[
                          {
                            id: "light" as const,
                            title: "Light Mode",
                            previewBg: "bg-[#FFFFF0] border-black/20 text-[#082824]",
                            badge: "bg-[#D4E3E8] text-[#082824]",
                          },
                          {
                            id: "dark" as const,
                            title: "Dark Mode",
                            previewBg: "bg-[#082824] border-white/20 text-white",
                            badge: "bg-[#8AB4DB] text-[#082824]",
                          },
                          {
                            id: "system" as const,
                            title: "System Default",
                            previewBg: "bg-slate-100 border-slate-300 text-slate-900",
                            badge: "bg-slate-200 text-slate-800",
                          },
                        ].map((t) => {
                          const isSelected = theme === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setTheme(t.id)}
                              className={`flex flex-col justify-between p-4 rounded-2xl border text-left transition-all relative ${
                                isSelected
                                  ? "border-[#082824] ring-2 ring-[#082824]/20 shadow-md bg-black/[0.02]"
                                  : "border-black/10 hover:border-black/25 bg-white"
                              }`}
                            >
                              <div className="space-y-2">
                                <div data-theme-preview="true" className={`h-16 w-full rounded-xl border p-2.5 flex flex-col justify-between ${t.previewBg}`}>
                                  <div className="flex items-center justify-between">
                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${t.badge}`}>
                                      {t.title}
                                    </span>
                                    {isSelected && <Check className="h-4 w-4 text-emerald-600" />}
                                  </div>
                                  <div className="h-2 w-16 rounded-full bg-current opacity-30" />
                                </div>
                                <div className="pt-1">
                                  <p className="font-bold text-xs text-black">{t.title}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. KYC VIEW */}
                {accountSubView === "kyc" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 font-sans text-xs">
                      <button
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-black">KYC Verification</h2>
                    </div>
                    <KycVerificationPanel accent="#2775CA" variant="user" />
                  </div>
                )}

                {/* 2. PROFILE VIEW */}
                {accountSubView === "profile" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 font-sans text-xs">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-black">My Profile</h2>
                    </div>

                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <div className="relative group">
                        <Avatar profilePic={profilePic} size="lg" />
                        <label className="absolute bottom-0 right-0 p-1.5 rounded-full bg-[#353935] text-white border-2 border-[#FFFFF0] cursor-pointer hover:scale-105 transition-all">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                          <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                        </label>
                      </div>
                      <span className="rounded-full bg-black/5 px-3 py-1 text-[9px] font-bold text-black/60 uppercase tracking-widest">
                        User account
                      </span>
                      {uploadError && <p className="text-[10px] text-red-600 font-sans">{uploadError}</p>}
                    </div>

                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-6 space-y-4 shadow-sm">
                      {/* SubScript DNS alias (Spenda ID / Username) */}
                      <div className="pb-3 border-b border-black/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-black/50">SubScript DNS (Display Name)</label>
                            <span className="block font-mono text-xs font-bold text-[#2775CA] mt-1">
                              {registeredDomain ? `@${registeredDomain}` : "No DNS Alias"}
                            </span>
                          </div>
                        </div>

                        {/* Inline Name Change / Register Form right next to DNS */}
                        <div className="pt-1">
                          {registeredDomain ? (
                            <div className="flex items-center justify-between text-xs font-sans pt-1">
                              <span className="text-[10px] text-black/60">DNS Alias active</span>
                              <button
                                onClick={async () => {
                                  setDnsLoading(true);
                                  setDnsError(null);
                                  try {
                                    const res = await fetch("/api/merchant/alias", { method: "DELETE" });
                                    if (res.ok) {
                                      setRegisteredDomain(null);
                                      setDnsDomain("");
                                      setDnsSuccess("Alias removed");
                                      setTimeout(() => setDnsSuccess(null), 3000);
                                    } else {
                                      const data = await res.json().catch(() => ({}));
                                      setDnsError(data.error || "Could not unregister this name.");
                                    }
                                  } catch (err) {
                                    setDnsError("Network error removing DNS name.");
                                  } finally {
                                    setDnsLoading(false);
                                  }
                                }}
                                className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 text-[10px] font-bold uppercase tracking-wider rounded-xl transition"
                              >
                                {dnsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Unregister Name"}
                              </button>
                            </div>
                          ) : (
                            <form onSubmit={handleRegisterDns} className="space-y-2 font-sans text-xs">
                              <div className="flex gap-2">
                                <div className="relative flex-1">
                                  <input
                                    type="text"
                                    value={dnsDomain}
                                    onChange={(e) => setDnsDomain(e.target.value)}
                                    placeholder="Enter custom alias / display name"
                                    className="w-full bg-white border border-black/15 rounded-xl px-3 py-2 text-xs text-black placeholder:text-black/35 focus:outline-none focus:border-[#2775CA] font-mono pr-12"
                                    required
                                  />
                                  <span className="absolute right-3 top-2 text-xs font-black text-black/40">.sub</span>
                                </div>
                                <button
                                  type="submit"
                                  disabled={dnsLoading}
                                  className="px-4 py-2 bg-[#353935] hover:bg-black text-white text-xs font-bold uppercase tracking-wider rounded-xl transition"
                                >
                                  {dnsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Name"}
                                </button>
                              </div>
                            </form>
                          )}
                          {dnsError && <p className="text-[10px] text-red-600 font-sans mt-1">{dnsError}</p>}
                          {dnsSuccess && <p className="text-[10px] text-emerald-600 font-sans mt-1">{dnsSuccess}</p>}
                        </div>
                      </div>

                      {/* Linked Wallet Address */}
                      <div className="pb-3 border-b border-black/10 flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-black/50">Wallet Address</label>
                          <span className="block font-mono text-[11px] text-black/80 mt-1 truncate max-w-[170px] xs:max-w-[210px] sm:max-w-xs">{userWallet}</span>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(userWallet || "");
                            triggerToast("Address copied to clipboard");
                          }}
                          className="p-2 rounded-xl bg-black/5 text-black/60 hover:text-black transition"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Linked Email */}
                      <div className="pb-3 border-b border-black/10 flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-black/50">Email Address</label>
                          <span className="block font-sans text-xs text-black/70 mt-1">
                            {userSettings?.walletBackup?.email || userEmail || "Not linked"}
                          </span>
                        </div>
                        <Lock className="h-4 w-4 text-black/30 shrink-0" />
                      </div>

                      {/* Linked Role */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-black/50">Account Role</label>
                          <span className="block font-sans text-xs text-black/70 mt-1">User Account</span>
                        </div>
                        <Lock className="h-4 w-4 text-black/30 shrink-0" />
                      </div>
                    </div>

                    {/* Help & Support Panel */}
                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 space-y-3 shadow-sm">
                      <h4 className="text-[10px] font-black uppercase tracking-wider text-black/70 flex items-center gap-1.5">
                        <HelpCircle className="h-3.5 w-3.5 text-[#2775CA]" /> Help &amp; Support
                      </h4>
                      <p className="text-[10px] leading-relaxed text-black/60 font-sans">
                        Billing question, incorrect charge, or something not working? Real humans read every
                        message. Include your wallet address and a receipt ID or transaction hash if it&apos;s
                        about a payment.
                      </p>
                      <div className="space-y-2 font-sans text-xs">
                        <a
                          href="mailto:support@subscriptonarc.com"
                          className="flex items-center justify-between rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3 transition hover:border-[#2775CA]/30 hover:bg-[#2775CA]/5"
                        >
                          <span className="text-black/70">General support</span>
                          <span className="font-mono text-[11px] font-bold text-[#2775CA]">support@subscriptonarc.com</span>
                        </a>
                        <a
                          href="mailto:compliance@subscriptonarc.com"
                          className="flex items-center justify-between rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3 transition hover:border-[#2775CA]/30 hover:bg-[#2775CA]/5"
                        >
                          <span className="text-black/70">Billing, refunds &amp; privacy</span>
                          <span className="font-mono text-[11px] font-bold text-[#2775CA]">compliance@subscriptonarc.com</span>
                        </a>
                        <a
                          href="/support"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full rounded-2xl border border-[#2775CA]/30 bg-[#2775CA]/10 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-[#2775CA] transition hover:bg-[#2775CA]/20"
                        >
                          Open the Help Center
                        </a>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="w-full py-4 border border-red-500/30 hover:bg-red-500/10 text-red-600 rounded-3xl text-xs font-black uppercase tracking-widest transition shadow-sm flex items-center justify-center gap-2"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out
                    </button>
                  </div>
                )}

                {/* 3. SPEND ANALYSIS VIEW */}
                {accountSubView === "spend-analysis" && (loading || dataViewLoading === "spend-analysis" ? (
                  <SpendAnalysisSkeleton />
                ) : (() => {
                  const now = Date.now();
                  const windowMs =
                    spendDatePreset === "today" ? 24 * 60 * 60 * 1000
                    : spendDatePreset === "7days" ? 7 * 24 * 60 * 60 * 1000
                    : spendDatePreset === "30days" ? 30 * 24 * 60 * 60 * 1000
                    : spendDatePreset === "90days" ? 90 * 24 * 60 * 60 * 1000
                    : spendDatePreset === "1year" ? 365 * 24 * 60 * 60 * 1000
                    : 0;

                  const periodTxs = recentTransactions.filter((tx) => {
                    if (windowMs > 0 && tx.time < now - windowMs) return false;
                    if (spendDatePreset === "custom") {
                      if (spendStartDate) {
                        const startMs = new Date(spendStartDate).getTime();
                        if (!Number.isNaN(startMs) && tx.time < startMs) return false;
                      }
                      if (spendEndDate) {
                        const endMs = new Date(spendEndDate).setHours(23, 59, 59, 999);
                        if (!Number.isNaN(endMs) && tx.time > endMs) return false;
                      }
                    }
                    return true;
                  });

                  /* Category classification */
                  const spendCategories: Record<string, { label: string; color: string; bgColor: string; borderColor: string; Icon: LucideIcon; total: number; count: number }> = {
                    subscriptions: { label: "Subscriptions", color: "#2775CA", bgColor: "rgba(39,117,202,0.08)", borderColor: "rgba(39,117,202,0.25)", Icon: Shield, total: 0, count: 0 },
                    payments: { label: "One-Time Payments", color: "#0284c7", bgColor: "rgba(2,132,199,0.08)", borderColor: "rgba(2,132,199,0.25)", Icon: CreditCard, total: 0, count: 0 },
                    transfers: { label: "Transfers", color: "#7c3aed", bgColor: "rgba(124,58,237,0.08)", borderColor: "rgba(124,58,237,0.25)", Icon: ArrowUpRight, total: 0, count: 0 },
                    withdrawals: { label: "Withdrawals", color: "#ea580c", bgColor: "rgba(234,88,12,0.08)", borderColor: "rgba(234,88,12,0.25)", Icon: ArrowDownToLine, total: 0, count: 0 },
                  };

                  const bucketFor = (kind: string) =>
                    kind === "recurring" ? "subscriptions"
                    : kind === "transfers" ? "transfers"
                    : kind === "withdrawals" ? "withdrawals"
                    : "payments";

                  let totalInflow = 0;
                  let totalOutflow = 0;
                  const merchantSpendMap: Record<string, { name: string; amount: number; count: number; pic?: string | null }> = {};

                  periodTxs.forEach((tx) => {
                    if (tx.status === "FAILED") return;
                    if (tx.incoming) {
                      totalInflow += tx.amountUsdc;
                    } else {
                      totalOutflow += tx.amountUsdc;
                      const bucket = spendCategories[bucketFor(tx.kind)];
                      if (bucket) {
                        bucket.total += tx.amountUsdc;
                        bucket.count += 1;
                      }

                      const mName = tx.name || "Unknown Merchant";
                      if (!merchantSpendMap[mName]) {
                        merchantSpendMap[mName] = { name: mName, amount: 0, count: 0, pic: tx.pic };
                      }
                      merchantSpendMap[mName].amount += tx.amountUsdc;
                      merchantSpendMap[mName].count += 1;
                    }
                  });

                  const totalSpending = totalOutflow;
                  const categoryEntries = Object.entries(spendCategories).filter(([, c]) => c.total > 0);
                  const allCategoryEntries = Object.entries(spendCategories);
                  const topMerchants = Object.values(merchantSpendMap).sort((a, b) => b.amount - a.amount).slice(0, 5);

                  /* Monthly Trend calculation (last 6 months) */
                  const monthData: Array<{ key: string; label: string; amount: number; isPeak?: boolean }> = [];
                  const currDate = new Date();
                  for (let i = 5; i >= 0; i--) {
                    const d = new Date(currDate.getFullYear(), currDate.getMonth() - i, 1);
                    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                    const label = d.toLocaleDateString("en-US", { month: "short" });
                    monthData.push({ key: monthKey, label, amount: 0 });
                  }

                  recentTransactions.forEach((tx) => {
                    if (tx.incoming || tx.status === "FAILED") return;
                    const d = new Date(tx.time);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                    const match = monthData.find((m) => m.key === key);
                    if (match) {
                      match.amount += tx.amountUsdc;
                    }
                  });

                  const maxMonthSpend = Math.max(1, ...monthData.map((m) => m.amount));
                  let peakIndex = -1;
                  let highestSpend = 0;
                  monthData.forEach((m, idx) => {
                    if (m.amount > highestSpend && m.amount > 0) {
                      highestSpend = m.amount;
                      peakIndex = idx;
                    }
                  });
                  if (peakIndex >= 0) {
                    monthData[peakIndex].isPeak = true;
                  }

                  const daysCount =
                    spendDatePreset === "today" ? 1
                    : spendDatePreset === "7days" ? 7
                    : spendDatePreset === "30days" ? 30
                    : spendDatePreset === "90days" ? 90
                    : spendDatePreset === "1year" ? 365
                    : 30;
                  const avgDailySpend = totalSpending / (daysCount || 1);
                  const netCashFlow = totalInflow - totalOutflow;

                  const money = (value: number) =>
                    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                  return (
                    <div className="space-y-6">
                      {/* Header */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setAccountSubView("menu")}
                            className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                            aria-label="Back to settings menu"
                          >
                            <ChevronLeft className="h-5 w-5" />
                          </button>
                          <div>
                            <h2 className="text-base font-black uppercase tracking-wider text-black">Spend Analysis</h2>
                            <p className="text-[10px] text-black/50">Comprehensive cash flow and categorical expenditure breakdown</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleBalanceVisible}
                            className="p-2 rounded-xl border border-black/10 bg-white text-black/70 hover:bg-black/5 transition-all shadow-sm"
                            aria-label={balanceVisible ? "Hide balances" : "Show balances"}
                            title={balanceVisible ? "Hide sensitive amounts" : "Show sensitive amounts"}
                          >
                            {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Period Presets Selector */}
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {[
                          { id: "30days", label: "Last 30 Days" },
                          { id: "90days", label: "Last 90 Days" },
                          { id: "1year", label: "Past Year" },
                          { id: "all", label: "All Time" },
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSpendDatePreset(tab.id)}
                            className={`px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${
                              spendDatePreset === tab.id
                                ? "bg-[#353935] text-white shadow-sm"
                                : "bg-black/5 hover:bg-black/10 text-black/70"
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {/* Skeleton State */}
                      {isRefreshingBalances ? (
                        <div className="space-y-6 animate-pulse">
                          <div className="h-44 rounded-3xl bg-black/5 border border-black/10 p-6 space-y-4">
                            <div className="h-4 w-28 rounded bg-black/10" />
                            <div className="h-10 w-44 rounded-lg bg-black/10" />
                            <div className="h-3 w-full rounded-full bg-black/10" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="h-28 rounded-2xl bg-black/5 border border-black/10 p-4 space-y-3">
                                <div className="h-3 w-20 rounded bg-black/10" />
                                <div className="h-6 w-24 rounded bg-black/10" />
                              </div>
                            ))}
                          </div>
                          <div className="h-56 rounded-3xl bg-black/5 border border-black/10 p-6 space-y-4">
                            <div className="h-4 w-36 rounded bg-black/10" />
                            <div className="h-36 w-full rounded bg-black/10" />
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Hero: Total Spending & Distribution */}
                          <div data-spend-card className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-sm">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/50">Total Outflow</p>
                              <div className="p-2 rounded-xl bg-black/5">
                                <BarChart3 className="h-4 w-4 text-[#2775CA]" />
                              </div>
                            </div>
                            <p className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-black">
                              {balanceVisible ? money(totalSpending) : "••••"}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              {monthlySpendUsdc > 0 ? (
                                <div className="inline-flex items-center gap-1.5 rounded-full bg-[#2775CA]/10 px-2.5 py-1 text-[10px] font-bold text-[#2775CA] border border-[#2775CA]/20">
                                  <TrendingUp className="h-3.5 w-3.5" />
                                  <span>{balanceVisible ? `${money(monthlySpendUsdc)}/mo active commitment` : "••••/mo active commitment"}</span>
                                </div>
                              ) : (
                                <span className="text-[10px] font-bold text-black/40">No active recurring commitments</span>
                              )}
                              <span className="text-[10px] font-mono text-black/45">
                                {periodTxs.filter((t) => !t.incoming && t.status !== "FAILED").length} outgoing transactions
                              </span>
                            </div>

                            {/* Segmented Category Distribution Bar */}
                            {totalSpending > 0 ? (
                              <div className="mt-5 space-y-2">
                                <div className="flex h-3.5 w-full overflow-hidden rounded-full gap-0.5 bg-black/5 p-0.5">
                                  {categoryEntries.map(([key, cat]) => (
                                    <div
                                      key={key}
                                      className="h-full rounded-full transition-all duration-700"
                                      style={{
                                        width: `${Math.max(4, (cat.total / totalSpending) * 100)}%`,
                                        backgroundColor: cat.color,
                                      }}
                                      title={`${cat.label}: ${money(cat.total)}`}
                                    />
                                  ))}
                                </div>
                                <div className="flex flex-wrap items-center gap-3 pt-1 text-[9px] font-bold">
                                  {categoryEntries.map(([key, cat]) => (
                                    <div key={key} className="flex items-center gap-1.5 text-black/70">
                                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color }} />
                                      <span>{cat.label}</span>
                                      <span className="font-mono text-black/40">({((cat.total / totalSpending) * 100).toFixed(0)}%)</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-5 flex h-3.5 w-full overflow-hidden rounded-full bg-black/5" />
                            )}
                          </div>

                          {/* Category Breakdown Cards */}
                          <div className="grid grid-cols-2 gap-3">
                            {allCategoryEntries.map(([key, cat]) => {
                              const CategoryIcon = cat.Icon;
                              const pct = totalSpending > 0 ? ((cat.total / totalSpending) * 100).toFixed(0) : "0";
                              return (
                                <div
                                  key={key}
                                  data-spend-category
                                  className="rounded-2xl p-4 border border-black/10 bg-black/[0.02] transition-all hover:scale-[1.01] shadow-sm"
                                >
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-1.5">
                                      <CategoryIcon className="h-4 w-4" style={{ color: cat.color }} />
                                      <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: cat.color }}>
                                        {cat.label}
                                      </span>
                                    </div>
                                    <span className="text-[9px] font-mono font-bold text-black/50">
                                      {cat.count} {cat.count === 1 ? "item" : "items"}
                                    </span>
                                  </div>
                                  <p className="text-xl font-extrabold tracking-tight text-black spend-category-value">
                                    {balanceVisible ? money(cat.total) : "••••"}
                                  </p>
                                  <div className="mt-2 flex items-center justify-between text-[9px] font-bold text-black/50">
                                    <span>Share of spend</span>
                                    <span className="font-mono text-black/80">{pct}%</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Monthly Spending Trend — bar on mobile, area graph on desktop */}
                          <div data-spend-card data-spend-chart className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-7 shadow-sm space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/70 flex items-center gap-2">
                                  <BarChart3 className="h-4 w-4 text-[#2775CA]" /> Monthly Spending Trend
                                </h3>
                                <p className="text-[10px] text-black/50 mt-0.5">Historical outflow across recent billing cycles</p>
                              </div>
                              <span className="rounded-full bg-black/5 border border-black/10 px-2.5 py-1 text-[9px] font-mono font-bold text-black/60">
                                6-Month Window
                              </span>
                            </div>

                            {/* ── Mobile: vertical bar chart ─────────────────────────── */}
                            <div className="md:hidden pt-4 pb-2">
                              <div className="flex items-end justify-between gap-2 h-40 pt-6 px-2">
                                {monthData.map((m) => {
                                  const heightPct = Math.max(8, Math.round((m.amount / maxMonthSpend) * 100));
                                  return (
                                    <div key={m.key} className="flex-1 flex flex-col items-center h-full justify-end group">
                                      <span className="text-[9px] font-mono font-black text-black/60 mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {balanceVisible ? `$${m.amount.toFixed(0)}` : "••••"}
                                      </span>
                                      <div className="w-full max-w-[48px] bg-black/5 rounded-t-xl overflow-hidden flex items-end relative h-full">
                                        <div
                                          className={`w-full rounded-t-xl transition-all duration-700 ${
                                            m.isPeak
                                              ? "bg-[#2775CA] shadow-sm"
                                              : m.amount > 0
                                              ? "bg-black/30 group-hover:bg-[#2775CA]/70"
                                              : "bg-black/10"
                                          }`}
                                          style={{ height: `${heightPct}%` }}
                                        />
                                        {m.isPeak && m.amount > 0 && (
                                          <div className="absolute top-1 left-1/2 -translate-x-1/2 rounded bg-[#2775CA] px-1 py-0.2 text-[7px] font-black text-white uppercase tracking-wider">
                                            Peak
                                          </div>
                                        )}
                                      </div>
                                      <span className="mt-2 text-[10px] font-bold uppercase tracking-wider text-black/60">
                                        {m.label}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* ── Desktop: SVG area + line graph ─────────────────────── */}
                            {(() => {
                              /* Build scales for the SVG graph */
                              const SVG_H = 180;
                              const PAD_L = 52;  /* wide enough for "$1,200" labels */
                              const PAD_R = 16;
                              const PAD_T = 18;
                              const PAD_B = 28;  /* x-axis label space */
                              const plotW = 600 - PAD_L - PAD_R; /* viewBox is 600 wide */
                              const plotH = SVG_H - PAD_T - PAD_B;
                              const n = monthData.length;

                              /* Nice scale: round the domain ceiling to a clean step */
                              const rawMax = maxMonthSpend;
                              const rawStep = rawMax / 4;
                              const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1))));
                              const norm = rawStep / mag;
                              const stepMult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
                              const step = stepMult * mag;
                              const domainMax = Math.max(step * 4, Math.ceil(rawMax / step) * step);

                              const scaleX = (i: number) => PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
                              const scaleY = (v: number) => PAD_T + plotH - (v / domainMax) * plotH;

                              /* Gridlines: 4 horizontal ticks */
                              const gridTicks = [0, 1, 2, 3, 4].map((k) => (domainMax / 4) * k);

                              /* SVG cubic bezier path (monotone-ish) */
                              const pts = monthData.map((m, i) => ({ x: scaleX(i), y: scaleY(m.amount) }));
                              let linePath = "";
                              let areaPath = "";
                              if (pts.length >= 2) {
                                const segments: string[] = [`M ${pts[0].x},${pts[0].y}`];
                                for (let i = 0; i < pts.length - 1; i++) {
                                  const cpx = (pts[i].x + pts[i + 1].x) / 2;
                                  segments.push(`C ${cpx},${pts[i].y} ${cpx},${pts[i + 1].y} ${pts[i + 1].x},${pts[i + 1].y}`);
                                }
                                linePath = segments.join(" ");
                                const baseline = scaleY(0);
                                areaPath = `${linePath} L ${pts[pts.length - 1].x},${baseline} L ${pts[0].x},${baseline} Z`;
                              } else if (pts.length === 1) {
                                linePath = `M ${pts[0].x},${pts[0].y}`;
                              }

                              const gradId = "spend-area-grad";

                              return (
                                <div className="hidden md:block">
                                  <svg
                                    viewBox={`0 0 600 ${SVG_H}`}
                                    className="w-full overflow-visible"
                                    style={{ height: SVG_H }}
                                    aria-hidden="true"
                                  >
                                    <defs>
                                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#2775CA" stopOpacity="0.22" />
                                        <stop offset="100%" stopColor="#2775CA" stopOpacity="0.01" />
                                      </linearGradient>
                                    </defs>

                                    {/* Horizontal gridlines + y-axis labels */}
                                    {gridTicks.map((tick) => {
                                      const y = scaleY(tick);
                                      const label = tick >= 1000
                                        ? `$${(tick / 1000).toFixed(tick % 1000 === 0 ? 0 : 1)}k`
                                        : `$${tick.toFixed(0)}`;
                                      return (
                                        <g key={tick}>
                                          <line
                                            x1={PAD_L}
                                            y1={y}
                                            x2={600 - PAD_R}
                                            y2={y}
                                            stroke="rgba(0,0,0,0.07)"
                                            strokeWidth="1"
                                            strokeDasharray={tick === 0 ? "none" : "4 3"}
                                          />
                                          <text
                                            x={PAD_L - 6}
                                            y={y + 4}
                                            textAnchor="end"
                                            fontSize="9"
                                            fontFamily="ui-monospace, monospace"
                                            fill="rgba(0,0,0,0.38)"
                                          >
                                            {balanceVisible ? label : "••"}
                                          </text>
                                        </g>
                                      );
                                    })}

                                    {/* Area fill under the line */}
                                    {areaPath && (
                                      <path d={areaPath} fill={`url(#${gradId})`} />
                                    )}

                                    {/* Line */}
                                    {linePath && (
                                      <path
                                        d={linePath}
                                        fill="none"
                                        stroke="#2775CA"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    )}

                                    {/* Data points + x-axis labels */}
                                    {pts.map((pt, i) => {
                                      const m = monthData[i];
                                      const isPeak = m.isPeak && m.amount > 0;
                                      return (
                                        <g key={m.key} className="group">
                                          {/* Hover area */}
                                          <rect
                                            x={pt.x - 18}
                                            y={PAD_T}
                                            width="36"
                                            height={plotH}
                                            fill="transparent"
                                          />
                                          {/* Vertical guide on hover */}
                                          <line
                                            x1={pt.x} y1={PAD_T}
                                            x2={pt.x} y2={scaleY(0)}
                                            stroke="#2775CA"
                                            strokeWidth="1"
                                            strokeDasharray="3 3"
                                            opacity="0"
                                            className="group-hover:opacity-40 transition-opacity"
                                          />
                                          {/* Outer glow ring */}
                                          <circle
                                            cx={pt.x} cy={pt.y} r={isPeak ? 7 : 6}
                                            fill="white"
                                            stroke={isPeak ? "#2775CA" : "rgba(39,117,202,0.4)"}
                                            strokeWidth={isPeak ? 2.5 : 1.5}
                                          />
                                          {/* Inner dot */}
                                          <circle
                                            cx={pt.x} cy={pt.y} r={isPeak ? 3.5 : 2.5}
                                            fill={isPeak ? "#2775CA" : "rgba(39,117,202,0.6)"}
                                          />

                                          {/* Tooltip on hover */}
                                          <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            <rect
                                              x={pt.x - 28} y={pt.y - 28}
                                              width="56" height="18"
                                              rx="5"
                                              fill="#1a1a2e"
                                              opacity="0.88"
                                            />
                                            <text
                                              x={pt.x} y={pt.y - 16}
                                              textAnchor="middle"
                                              fontSize="9"
                                              fontWeight="700"
                                              fontFamily="ui-monospace, monospace"
                                              fill="white"
                                            >
                                              {balanceVisible ? `$${m.amount.toFixed(0)}` : "••••"}
                                            </text>
                                          </g>

                                          {/* Peak label */}
                                          {isPeak && (
                                            <text
                                              x={pt.x} y={pt.y - 14}
                                              textAnchor="middle"
                                              fontSize="8"
                                              fontWeight="900"
                                              fill="#2775CA"
                                              letterSpacing="0.08em"
                                            >
                                              PEAK
                                            </text>
                                          )}

                                          {/* X-axis label */}
                                          <text
                                            x={pt.x}
                                            y={SVG_H - 4}
                                            textAnchor="middle"
                                            fontSize="9"
                                            fontWeight="700"
                                            fontFamily="system-ui, sans-serif"
                                            fill="rgba(0,0,0,0.5)"
                                            letterSpacing="0.06em"
                                          >
                                            {m.label.toUpperCase()}
                                          </text>
                                        </g>
                                      );
                                    })}
                                  </svg>

                                  {/* Inflow vs Outflow dual-line legend */}
                                  <div className="mt-4 flex items-center gap-5 px-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="h-2.5 w-6 rounded-full bg-[#2775CA] block" />
                                      <span className="text-[9px] font-bold text-black/50 uppercase tracking-wider">Outflow</span>
                                    </div>
                                    {totalInflow > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="h-2.5 w-6 rounded-full bg-emerald-500 block" />
                                        <span className="text-[9px] font-bold text-black/50 uppercase tracking-wider">Inflow</span>
                                      </div>
                                    )}
                                    <span className="ml-auto text-[9px] font-mono text-black/35">
                                      Peak: {balanceVisible ? `$${Math.max(0, ...monthData.map(m => m.amount)).toFixed(0)}` : "••••"}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Cash Flow & Net Balance Breakdown */}
                          <div data-spend-card className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-7 shadow-sm space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/70 flex items-center gap-2">
                                <Activity className="h-4 w-4 text-[#2775CA]" /> Cash Flow Summary
                              </h3>
                              <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                netCashFlow >= 0
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                                  : "border-amber-500/30 bg-amber-500/10 text-amber-700"
                              }`}>
                                {netCashFlow >= 0 ? "Surplus" : "Net Outflow"}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div data-spend-inflow className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                                <span className="block text-[9px] font-black uppercase tracking-wider text-emerald-800/70">Total Inflow (Credits)</span>
                                <p className="mt-1 text-lg font-extrabold text-emerald-700">
                                  {balanceVisible ? money(totalInflow) : "••••"}
                                </p>
                              </div>
                              <div data-spend-outflow className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                                <span className="block text-[9px] font-black uppercase tracking-wider text-red-800/70">Total Outflow (Debits)</span>
                                <p className="mt-1 text-lg font-extrabold text-red-700">
                                  {balanceVisible ? money(totalOutflow) : "••••"}
                                </p>
                              </div>
                              <div data-spend-net className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                                <span className="block text-[9px] font-black uppercase tracking-wider text-black/50">Net Movement</span>
                                <p className={`mt-1 text-lg font-extrabold ${netCashFlow >= 0 ? "text-emerald-700" : "text-black"}`}>
                                  {balanceVisible ? `${netCashFlow >= 0 ? "+" : ""}${money(netCashFlow)}` : "••••"}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Top Merchants / Destinations Outflow Leaderboard */}
                          <div data-spend-card className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-7 shadow-sm space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/70 flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-[#2775CA]" /> Top Outflow Destinations
                              </h3>
                              <span className="text-[10px] font-mono text-black/45">By volume</span>
                            </div>

                            {topMerchants.length === 0 ? (
                              <div className="flex h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 bg-black/[0.02] text-center p-4">
                                <CreditCard className="h-5 w-5 text-black/25 mb-1.5" />
                                <p className="text-xs text-black/40">No outflow data recorded yet</p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {topMerchants.map((merchant, rank) => {
                                  const sharePct = totalSpending > 0 ? (merchant.amount / totalSpending) * 100 : 0;
                                  return (
                                    <div key={merchant.name} data-spend-card className="rounded-2xl border border-black/10 bg-white p-3.5 space-y-2 shadow-xs">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/5 border border-black/10 text-[10px] font-black text-[#2775CA]">
                                            #{rank + 1}
                                          </div>
                                          <div className="min-w-0">
                                            <p className="truncate text-xs font-bold text-black uppercase tracking-wider">{merchant.name}</p>
                                            <p className="text-[9px] font-medium text-black/45">{merchant.count} {merchant.count === 1 ? "payment" : "payments"}</p>
                                          </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <span className="text-xs font-black text-black">{balanceVisible ? money(merchant.amount) : "••••"}</span>
                                          <span className="block text-[9px] font-mono text-black/40">{sharePct.toFixed(0)}%</span>
                                        </div>
                                      </div>
                                      {/* Progress line */}
                                      <div className="h-1.5 w-full rounded-full bg-black/5 overflow-hidden">
                                        <div className="h-full rounded-full bg-[#2775CA]" style={{ width: `${Math.min(100, Math.max(4, sharePct))}%` }} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Spending Insights & Runway */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div data-spend-card className="rounded-2xl border border-black/10 bg-white/80 p-4 space-y-1">
                              <span className="text-[9px] font-black uppercase tracking-wider text-black/50">Average Daily Spend</span>
                              <p className="text-lg font-extrabold text-black">
                                {balanceVisible ? money(avgDailySpend) : "••••"} <span className="text-xs font-normal text-black/40">/ day</span>
                              </p>
                              <p className="text-[9px] text-black/45">Computed across selected time window</p>
                            </div>
                            <div data-spend-card className="rounded-2xl border border-black/10 bg-white/80 p-4 space-y-1">
                              <span className="text-[9px] font-black uppercase tracking-wider text-black/50">Estimated 30D Run Rate</span>
                              <p className="text-lg font-extrabold text-[#2775CA]">
                                {balanceVisible ? money(monthlySpendUsdc + (avgDailySpend * 30)) : "••••"} <span className="text-xs font-normal text-black/40">/ mo</span>
                              </p>
                              <p className="text-[9px] text-black/45">Projected combined fixed &amp; variable burn</p>
                            </div>
                          </div>

                          {/* Navigation Link to All Transactions */}
                          <div className="pt-2">
                            <button
                              type="button"
                              data-spend-card
                              onClick={() => router.push("/dashboard/user/transactions")}
                              className="w-full rounded-2xl border border-black/15 bg-white py-3.5 text-xs font-black uppercase tracking-[0.14em] text-black hover:bg-black/5 transition shadow-sm flex items-center justify-center gap-2"
                            >
                              <Activity className="h-4 w-4 text-[#2775CA]" />
                              View Full Transaction History
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })())}

                {/* 4. TRANSACTIONS VIEW */}
                {accountSubView === "transactions" && (loading || dataViewLoading === "transactions" ? (
                  <SettingsTransactionsSkeleton />
                ) : (() => {
                  const combinedSettingsTx = [
                    ...settingsTransactions,
                    ...deposits
                      .filter((d) => !settingsTransactions.some((r) => r.txHash && r.txHash.toLowerCase() === d.txHash.toLowerCase()))
                      .map((d) => ({
                        receiptId: `dep-${d.txHash}`,
                        txHash: d.txHash,
                        payerAddress: d.fromAddress,
                        merchantAddress: d.toAddress,
                        counterpartyName: d.senderName ? `@${d.senderName}` : formatAddress(d.fromAddress),
                        memoNote: "USDC Deposit • Arc Network",
                        amountUsdc: d.amountUsdc,
                        direction: "received" as const,
                        status: "COMPLETED",
                        createdAt: new Date(d.timestamp).toISOString(),
                        paymentLinkId: null,
                        isExternalDeposit: true,
                      })),
                  ];

                  const filteredSettingsTx = combinedSettingsTx.filter((tx) => {
                    if (settingsTxSearch.trim()) {
                      const q = settingsTxSearch.trim().toLowerCase();
                      const matchId = (tx.receiptId || "").toLowerCase().includes(q);
                      const matchHash = (tx.txHash || "").toLowerCase().includes(q);
                      const matchName = (tx.counterpartyName || "").toLowerCase().includes(q);
                      const matchMemo = (tx.memoNote || "").toLowerCase().includes(q);
                      const matchPayer = (tx.payerAddress || "").toLowerCase().includes(q);
                      const matchMerchant = (tx.merchantAddress || "").toLowerCase().includes(q);
                      if (!matchId && !matchHash && !matchName && !matchMemo && !matchPayer && !matchMerchant) {
                        return false;
                      }
                    }

                    if (settingsTxCategory !== "all") {
                      const memo = (tx.memoNote || "").toLowerCase();
                      const isSub = memo.includes("sub") || memo.includes("plan") || memo.includes("recurring") || !!tx.paymentLinkId;
                      const isTransfer = memo.includes("transfer") || memo.includes("peer");
                      const isWithdrawal = memo.includes("withdraw") || memo.includes("balance to wallet");
                      const isDeposit = memo.includes("deposit") || tx.isExternalDeposit;
                      const isOneTime = !isSub && !isTransfer && !isWithdrawal && !isDeposit;

                      if (settingsTxCategory === "subscriptions") {
                        if (!isSub) return false;
                      } else if (settingsTxCategory === "one-time") {
                        if (!isOneTime) return false;
                      } else if (settingsTxCategory === "transfers") {
                        if (!isTransfer) return false;
                      } else if (settingsTxCategory === "withdrawals") {
                        if (!isWithdrawal) return false;
                      } else if (settingsTxCategory === "deposits") {
                        if (!isDeposit) return false;
                      } else if (settingsTxCategory === "sent") {
                        if (tx.direction !== "sent") return false;
                      } else if (settingsTxCategory === "received") {
                        if (tx.direction !== "received") return false;
                      }
                    }

                    if (settingsTxStatus !== "all") {
                      if (normalizeReceiptStatus(tx.status) !== settingsTxStatus.toUpperCase()) {
                        return false;
                      }
                    }

                    if (settingsTxDatePreset !== "all" || settingsTxStartDate || settingsTxEndDate) {
                      const txDate = new Date(tx.createdAt).getTime();
                      const now = Date.now();

                      if (settingsTxDatePreset === "today") {
                        const todayStart = new Date();
                        todayStart.setHours(0, 0, 0, 0);
                        if (txDate < todayStart.getTime()) return false;
                      } else if (settingsTxDatePreset === "7days") {
                        if (txDate < now - 7 * 24 * 60 * 60 * 1000) return false;
                      } else if (settingsTxDatePreset === "30days") {
                        if (txDate < now - 30 * 24 * 60 * 60 * 1000) return false;
                      } else if (settingsTxDatePreset === "custom") {
                        if (settingsTxStartDate) {
                          const startMs = new Date(settingsTxStartDate).getTime();
                          if (!isNaN(startMs) && txDate < startMs) return false;
                        }
                        if (settingsTxEndDate) {
                          const endMs = new Date(settingsTxEndDate).setHours(23, 59, 59, 999);
                          if (!isNaN(endMs) && txDate > endMs) return false;
                        }
                      }
                    }

                    return true;
                  });

                  /* Only the current page is rendered; the sentinel at the end of the list grows
                     the window as the reader scrolls. */
                  const visibleSettingsTx = filteredSettingsTx.slice(0, settingsTxVisible);
                  const settingsTxHasMore = filteredSettingsTx.length > visibleSettingsTx.length;

                  return (
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => setAccountSubView("menu")}
                          className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <h2 className="text-sm font-black uppercase tracking-wider text-black">Transactions</h2>
                      </div>

                      <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2">
                            <Activity className="h-4 w-4 text-[#2775CA]" /> Recent Transactions History
                          </h3>
                          <span className="text-[10px] font-mono font-semibold text-black/50">
                            Showing {visibleSettingsTx.length} of {filteredSettingsTx.length}
                          </span>
                        </div>

                        {/* Interactive Filter Toolbar */}
                        <div className="space-y-3 p-4 rounded-2xl bg-black/[0.02] border border-black/10 font-sans">
                          <div className="flex flex-wrap items-center gap-3">
                            {/* Search */}
                            <div className="relative flex-1 min-w-[200px]">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-black/40" />
                              <input
                                type="text"
                                value={settingsTxSearch}
                                onChange={(e) => setSettingsTxSearch(e.target.value)}
                                placeholder="Search name, receipt ID, memo..."
                                className="w-full bg-white border border-black/15 rounded-xl pl-9 pr-8 py-1.5 text-xs text-black placeholder:text-black/35 focus:outline-none focus:border-[#2775CA]"
                              />
                              {settingsTxSearch && (
                                <button
                                  onClick={() => setSettingsTxSearch("")}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-black/40 hover:text-black text-xs"
                                >
                                  ✕
                                </button>
                              )}
                            </div>

                            {/* Category Dropdown */}
                            <select
                              value={settingsTxCategory}
                              onChange={(e) => setSettingsTxCategory(e.target.value)}
                              className="bg-white border border-black/15 rounded-xl px-3 py-1.5 text-xs text-black focus:outline-none focus:border-[#2775CA]"
                            >
                              <option value="all">All Categories</option>
                              <option value="subscriptions">Subscriptions</option>
                              <option value="one-time">One Time</option>
                              <option value="transfers">Transfers</option>
                              <option value="withdrawals">Withdrawals</option>
                              <option value="deposits">Deposits</option>
                              <option value="sent">Sent (Debit)</option>
                              <option value="received">Received (Credit)</option>
                            </select>

                            {/* Status Dropdown */}
                            <select
                              value={settingsTxStatus}
                              onChange={(e) => setSettingsTxStatus(e.target.value)}
                              className="bg-white border border-black/15 rounded-xl px-3 py-1.5 text-xs text-black focus:outline-none focus:border-[#2775CA]"
                            >
                              <option value="all">All Statuses</option>
                              <option value="CONFIRMED">Confirmed</option>
                              <option value="PENDING">Pending</option>
                              <option value="FAILED">Failed</option>
                            </select>

                            {/* Date Preset Dropdown */}
                            <select
                              value={settingsTxDatePreset}
                              onChange={(e) => {
                                setSettingsTxDatePreset(e.target.value);
                                if (e.target.value !== "custom") {
                                  setSettingsTxStartDate("");
                                  setSettingsTxEndDate("");
                                }
                              }}
                              className="bg-white border border-black/15 rounded-xl px-3 py-1.5 text-xs text-black focus:outline-none focus:border-[#2775CA]"
                            >
                              <option value="all">All Time</option>
                              <option value="today">Today</option>
                              <option value="7days">Last 7 Days</option>
                              <option value="30days">Last 30 Days</option>
                              <option value="custom">Custom Date Range...</option>
                            </select>

                            {/* Clear Filters */}
                            {(settingsTxSearch || settingsTxCategory !== "all" || settingsTxStatus !== "all" || settingsTxDatePreset !== "all" || settingsTxStartDate || settingsTxEndDate) && (
                              <button
                                onClick={() => {
                                  setSettingsTxSearch("");
                                  setSettingsTxCategory("all");
                                  setSettingsTxStatus("all");
                                  setSettingsTxDatePreset("all");
                                  setSettingsTxStartDate("");
                                  setSettingsTxEndDate("");
                                }}
                                className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-[11px] font-bold text-black/80 transition-all"
                              >
                                Reset Filters
                              </button>
                            )}
                          </div>

                          {/* Custom Date Pickers */}
                          {settingsTxDatePreset === "custom" && (
                            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-black/70">
                              <div className="flex items-center gap-1.5">
                                <span>From:</span>
                                <input
                                  type="date"
                                  value={settingsTxStartDate}
                                  onChange={(e) => setSettingsTxStartDate(e.target.value)}
                                  className="bg-white border border-black/15 rounded-xl px-2.5 py-1 text-xs text-black focus:outline-none focus:border-[#2775CA]"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span>To:</span>
                                <input
                                  type="date"
                                  value={settingsTxEndDate}
                                  onChange={(e) => setSettingsTxEndDate(e.target.value)}
                                  className="bg-white border border-black/15 rounded-xl px-2.5 py-1 text-xs text-black focus:outline-none focus:border-[#2775CA]"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="overflow-x-auto hidden md:block">
                          <table className="w-full text-left font-sans text-xs">
                            <thead>
                              <tr className="border-b border-black/10 text-black/50 uppercase text-[9px] tracking-wider">
                                <th className="pb-3">Payment</th>
                                <th className="pb-3">Date &amp; Time</th>
                                <th className="pb-3">Amount</th>
                                <th className="pb-3">Status</th>
                                <th className="pb-3 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredSettingsTx.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="text-center py-6 text-black/40">
                                    No payments match your active filters.
                                  </td>
                                </tr>
                              ) : (
                                visibleSettingsTx.map((tx) => {
                                  const counterparty = tx.counterpartyName
                                    || formatAddress(tx.direction === "sent" ? tx.merchantAddress : tx.payerAddress);
                                  const txStatus = normalizeReceiptStatus(tx.status);
                                  return (
                                  <tr key={tx.receiptId} className="border-b border-black/5 hover:bg-black/[0.02] transition-all">
                                    <td className="py-4 font-semibold text-black/90">
                                      {tx.direction === "sent" ? `Paid ${counterparty}` : `Received from ${counterparty}`}
                                    </td>
                                    <td className="py-4 text-black/60">{new Date(tx.createdAt).toLocaleString()}</td>
                                    <td className="py-4 font-mono font-bold text-black">
                                      ${(Number(tx.amountUsdc) / 1_000_000).toFixed(2)} USDC
                                    </td>
                                    <td className="py-4">
                                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${txStatus === "CONFIRMED" ? "bg-emerald-500/15 text-emerald-700" : txStatus === "FAILED" ? "bg-red-500/15 text-red-700" : "bg-amber-500/15 text-amber-700"}`}>
                                        {humanStatus(txStatus)}
                                      </span>
                                    </td>
                                    <td className="py-4 text-right">
                                      <div className="inline-flex items-center gap-3">
                                        {tx.isExternalDeposit ? (
                                          <a
                                            href={getExplorerTxUrl(tx.txHash)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[#2775CA] hover:underline inline-flex items-center gap-1 font-semibold"
                                            title="View deposit on Arcscan Explorer"
                                          >
                                            <ExternalLink className="h-3 w-3" /> Explorer
                                          </a>
                                        ) : (
                                          <>
                                            <a
                                              href={`/receipt/${tx.receiptId}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-[#2775CA] hover:underline inline-flex items-center gap-1 font-semibold"
                                              title="Open this receipt in a new tab"
                                            >
                                              View receipt
                                            </a>
                                            <a
                                              href={`/receipt/${tx.receiptId}?invite=1`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-black/60 hover:text-[#2775CA] hover:underline inline-flex items-center gap-1"
                                              title="Grant another address permission to view this private receipt"
                                            >
                                              Share
                                            </a>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Card-Stack View */}
                        <div className="block md:hidden space-y-3">
                          {filteredSettingsTx.length === 0 ? (
                            <div className="text-center py-6 text-black/40 text-xs font-sans">
                              No payments match your active filters.
                            </div>
                          ) : (
                            visibleSettingsTx.map((tx) => {
                              const counterparty = tx.counterpartyName
                                || formatAddress(tx.direction === "sent" ? tx.merchantAddress : tx.payerAddress);
                              const txStatus = normalizeReceiptStatus(tx.status);
                              return (
                                <div key={tx.receiptId} className="p-4 rounded-2xl bg-black/[0.02] border border-black/10 space-y-2 text-xs font-mono">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-black/90">
                                      {tx.direction === "sent" ? `Paid ${counterparty}` : `Received ${counterparty}`}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${txStatus === "CONFIRMED" ? "bg-emerald-500/15 text-emerald-700" : txStatus === "FAILED" ? "bg-red-500/15 text-red-700" : "bg-amber-500/15 text-amber-700"}`}>
                                      {humanStatus(txStatus)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] pt-1">
                                    <span className="text-black/50">{new Date(tx.createdAt).toLocaleDateString()}</span>
                                    <span className="font-bold text-black">${(Number(tx.amountUsdc) / 1_000_000).toFixed(2)} USDC</span>
                                  </div>
                                  <div className="pt-2 flex items-center justify-end gap-3 border-t border-black/10 text-[10px]">
                                    {tx.isExternalDeposit ? (
                                      <a
                                        href={getExplorerTxUrl(tx.txHash)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#2775CA] font-semibold inline-flex items-center gap-1"
                                      >
                                        <ExternalLink className="h-3 w-3" /> View on Explorer
                                      </a>
                                    ) : (
                                      <>
                                        <a href={`/receipt/${tx.receiptId}`} target="_blank" rel="noopener noreferrer" className="text-[#2775CA] font-semibold">View receipt</a>
                                        <a href={`/receipt/${tx.receiptId}?invite=1`} target="_blank" rel="noopener noreferrer" className="text-black/60">Share</a>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Next-page loader, shared by the table and the card stack. */}
                        {settingsTxLoadingMore && (
                          <div className="space-y-3" aria-hidden="true">
                            {Array.from({ length: 4 }).map((_, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4"
                              >
                                <div className="h-4 flex-1 rounded-full subscript-skeleton" />
                                <div className="h-4 w-20 rounded-full subscript-skeleton subscript-skeleton--faint" />
                                <div className="h-4 w-16 rounded-full subscript-skeleton" />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Zero-height tripwire: crossing it pulls in the next page. Keyed on the
                            page count so it remounts after each growth — an observer only reports
                            threshold crossings, so a sentinel that stayed in view after a short
                            page would never fire again and pagination would stall. */}
                        {settingsTxHasMore && (
                          <div
                            key={settingsTxVisible}
                            ref={attachSettingsTxSentinel}
                            className="h-px w-full"
                            aria-hidden="true"
                          />
                        )}

                        <p aria-live="polite" className="sr-only">
                          {settingsTxLoadingMore ? "Loading more transactions" : ""}
                        </p>
                      </div>
                    </div>
                  );
                })())}

                {/* 5. NOTIFICATIONS VIEW */}
                {accountSubView === "notifications" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-black">Notifications</h2>
                    </div>

                    {userSettings && (
                      <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm">
                        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2">
                          <Sliders className="h-4 w-4 text-[#2775CA]" /> Notification Preferences
                        </h3>
                        <div className="space-y-4 font-sans text-xs">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-black font-bold">Push Notifications</p>
                              <p className="text-[10px] text-black/50">Enable alerts inside the browser portal</p>
                            </div>
                            <button
                              onClick={() => handleToggleSetting("pushEnabled", userSettings.pushEnabled)}
                              disabled={savingSettingsField === "pushEnabled"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.pushEnabled ? "bg-[#2775CA]" : "bg-black/15"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.pushEnabled ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-black font-bold">Browser Push (This Device)</p>
                              <p className="text-[10px] text-black/50">
                                {browserPushSupported
                                  ? "Receive alerts even when SubScript is closed"
                                  : "Not supported in this browser"}
                              </p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={browserPushOn}
                              aria-label="Browser Push on this device"
                              onClick={handleToggleBrowserPush}
                              disabled={browserPushBusy || !browserPushSupported}
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${browserPushOn ? "bg-[#2775CA]" : "bg-black/15"} ${browserPushBusy || !browserPushSupported ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${browserPushOn ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>

                          {browserPushOn && (
                            <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3">
                              <div className="space-y-0.5">
                                <p className="text-black font-bold">Verify this device</p>
                                <p className="text-[10px] text-black/50">Send a private test alert to your registered browsers</p>
                              </div>
                              <button
                                type="button"
                                onClick={handleTestBrowserPush}
                                disabled={browserPushTestBusy}
                                className="rounded-xl border border-[#2775CA]/30 bg-[#2775CA]/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-[#2775CA] transition hover:bg-[#2775CA]/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {browserPushTestBusy ? <>Sending<LoadingDots /></> : "Send test"}
                              </button>
                            </div>
                          )}

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-black font-bold">Debit Success</p>
                              <p className="text-[10px] text-black/50">Notify immediately when a subscription billing succeeds</p>
                            </div>
                            <button
                              onClick={() => handleToggleSetting("debitSuccessEnabled", userSettings.debitSuccessEnabled)}
                              disabled={savingSettingsField === "debitSuccessEnabled"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.debitSuccessEnabled ? "bg-[#2775CA]" : "bg-black/15"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.debitSuccessEnabled ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-black font-bold">Expiry Warnings</p>
                              <p className="text-[10px] text-black/50">Alert 3 days before any subscription renewal or cap expiry</p>
                            </div>
                            <button
                              onClick={() => handleToggleSetting("expiryWarningEnabled", userSettings.expiryWarningEnabled)}
                              disabled={savingSettingsField === "expiryWarningEnabled"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.expiryWarningEnabled ? "bg-[#2775CA]" : "bg-black/15"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.expiryWarningEnabled ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 6. SECURITY & KEY EXPORT VIEW */}
                {accountSubView === "security" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-black">Security & Keys</h2>
                    </div>

                    {/* Account Standing / Hold Status Card */}
                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-4 shadow-sm">
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2">
                        <Shield className="h-4 w-4 text-[#2775CA]" /> Account Status &amp; Standing
                      </h3>
                      
                      {userSettings?.accountHold?.isHeld ? (
                        <div className="rounded-2xl border border-red-500/30 bg-red-50 p-4 space-y-2">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <h4 className="text-xs font-bold text-red-950">Withdrawals On Hold</h4>
                              <p className="text-xs text-red-800/90 leading-relaxed">
                                Withdrawals from this account are temporarily restricted.
                                {userSettings.accountHold.expiresAt ? ` This hold is scheduled to lift on ${new Date(userSettings.accountHold.expiresAt).toLocaleDateString()}.` : ""}
                              </p>
                              <p className="text-[11px] text-red-800/80 leading-relaxed pt-1">
                                If you believe this is an error or have questions, please contact <a href="mailto:support@subscriptonarc.com" className="underline font-bold">support@subscriptonarc.com</a>.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50 px-4 py-3 flex items-start gap-3">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <h4 className="text-xs font-bold text-emerald-950">Good Standing</h4>
                            <p className="text-[10px] text-emerald-800/80 leading-relaxed mt-0.5">
                              Your account has no active withdrawal holds or security restrictions.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Wallet Security Card */}
                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-4 shadow-sm">
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-[#2775CA]" /> Wallet Security &amp; Compatibility
                      </h3>
                      
                      {userSettings?.walletBackup ? (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-50 px-4 py-3 flex items-start gap-3">
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-bold text-emerald-950">Server-Signed Wallet (Embedded)</h4>
                              <p className="text-[10px] text-emerald-800/80 leading-relaxed mt-1">
                                Your account is secured with a server-signed embedded wallet generated via email/social login.
                              </p>
                              <span className="inline-block mt-2 rounded-md bg-emerald-500/20 text-emerald-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                Mobile App Compatible
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-black/50 leading-relaxed">
                            This wallet will be automatically portable to our upcoming mobile app. All transaction signatures are co-signed by the SubScript server.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-50 px-4 py-3 flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-bold text-amber-950">Client-Connected Wallet (Web3)</h4>
                              <p className="text-[10px] text-amber-800/80 leading-relaxed mt-1">
                                Your account uses an external browser/Web3 wallet (e.g. MetaMask, WalletConnect).
                              </p>
                              <span className="inline-block mt-2 rounded-md bg-amber-500/20 text-amber-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                Web Only (No Mobile App Support)
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-black/50 leading-relaxed">
                            Note: External Web3 wallets are compatible with our web dashboard only. Our upcoming mobile app will strictly support email/Apple/Google login (Server-Signed wallets). To use the mobile app, we recommend creating a new account using your email.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Transaction PIN Card (Coming Soon) */}
                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2">
                              <KeyRound className="h-4 w-4 text-[#2775CA]" /> Transaction PIN
                            </h3>
                            <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-purple-700">
                              Coming soon
                            </span>
                          </div>
                          <p className="text-[10px] text-black/50 leading-relaxed">
                            Require a 6-digit security PIN to authorize high-value transfers, subscriptions, and vault withdrawals.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 flex items-center justify-between">
                        <div className="space-y-0.5">
                          <span className="block text-xs font-bold text-black/80">PIN Protection</span>
                          <span className="block text-[10px] text-black/45">Prompt on outgoing payments</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600/80">In Development</span>
                          <div className="h-5 w-9 rounded-full bg-black/10 p-0.5 cursor-not-allowed opacity-60">
                            <div className="h-4 w-4 rounded-full bg-white shadow-sm" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Key export exists only for wallet providers that expose a recoverable key. */}
                    {userSettings?.walletBackup?.available && (
                      <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-8 space-y-5 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-2">
                            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/60 flex items-center gap-2">
                              <Lock className="h-4 w-4 text-[#2775CA]" /> Wallet Backup
                            </h3>
                            <p className="text-[10px] text-black/50 leading-relaxed">
                              Export the private key for your SubScript-generated email wallet. Store it offline; anyone with this key can control the wallet.
                            </p>
                          </div>
                          <span className="rounded-full border border-[#2775CA]/30 bg-[#2775CA]/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#2775CA]">
                            Exportable
                          </span>
                        </div>

                        <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-black/50">Account Email</span>
                            <span className="min-w-0 truncate text-right text-[11px] font-mono text-black/80">{userSettings.walletBackup.email || userEmail || "Not linked"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-black/50">Provider</span>
                            <span className="text-[11px] font-mono text-black/80">{userSettings.walletBackup.provider || "embedded"}</span>
                          </div>
                        </div>

                        {exportedPrivateKey && (
                          <div className="space-y-3">
                            <div className="rounded-2xl border border-red-500/30 bg-red-50 p-3">
                              <p className="break-all font-mono text-[11px] leading-relaxed text-red-900">
                                {privateKeyVisible ? exportedPrivateKey : "*".repeat(Math.min(exportedPrivateKey.length, 64))}
                              </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <button type="button" onClick={() => setPrivateKeyVisible((value) => !value)} className="rounded-2xl border border-black/10 bg-white hover:bg-black/5 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-black transition flex items-center justify-center gap-2 shadow-sm">
                                {privateKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {privateKeyVisible ? "Hide" : "Show"}
                              </button>
                              <button type="button" onClick={handleCopyPrivateKey} className="rounded-2xl border border-[#2775CA]/30 bg-[#2775CA]/10 hover:bg-[#2775CA]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#2775CA] transition flex items-center justify-center gap-2">
                                <Copy className="h-4 w-4" /> Copy
                              </button>
                              <button type="button" onClick={handleDownloadPrivateKey} className="rounded-2xl border border-[#2775CA]/30 bg-[#2775CA]/10 hover:bg-[#2775CA]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#2775CA] transition flex items-center justify-center gap-2">
                                <Download className="h-4 w-4" /> Download
                              </button>
                            </div>
                          </div>
                        )}

                        {walletBackupError && <p className="text-[11px] text-red-600">{walletBackupError}</p>}

                        {exportOtpStage ? (
                          <div className="space-y-3">
                            <p className="text-[10px] text-black/60 leading-relaxed">
                              For your security, enter the 6-digit verification code we emailed you to reveal your private key.
                            </p>
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              value={exportOtpCode}
                              onChange={(e) => setExportOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="000000"
                              className="w-full rounded-2xl border border-black/15 bg-white px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-black placeholder:text-black/30 focus:border-[#2775CA] focus:outline-none"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={handleExportWallet}
                                disabled={walletBackupLoading || exportOtpCode.length !== 6}
                                className="w-full rounded-2xl bg-[#353935] hover:bg-black text-white py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition disabled:opacity-50"
                              >
                                {walletBackupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                Confirm & Reveal
                              </button>
                              <button
                                type="button"
                                onClick={() => { setExportOtpStage(false); setExportOtpCode(""); setWalletBackupError(null); }}
                                disabled={walletBackupLoading}
                                className="w-full rounded-2xl border border-black/10 bg-white hover:bg-black/5 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-black/70 transition"
                              >
                                Cancel
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={requestExportOtp}
                              disabled={exportOtpSending}
                              className="w-full text-center text-[10px] uppercase tracking-[0.14em] text-[#2775CA] hover:underline transition disabled:opacity-50"
                            >
                              {exportOtpSending ? <>Resending<LoadingDots /></> : "Resend code"}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={requestExportOtp}
                            disabled={exportOtpSending}
                            className="w-full rounded-2xl bg-[#353935] hover:bg-black text-white py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition disabled:opacity-50"
                          >
                            {exportOtpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Export Private Key
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 7. SUPPORT VIEW */}
                {accountSubView === "support" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-black">Support</h2>
                    </div>

                    <div className="border border-black/10 bg-white/80 backdrop-blur-md rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm flex flex-col items-center justify-center text-center">
                      <div className="p-4 rounded-full bg-[#2775CA]/10 text-[#2775CA] border border-[#2775CA]/30">
                        <MessageSquare className="h-10 w-10 animate-bounce" />
                      </div>
                      
                      <div className="space-y-2">
                        <h3 className="text-base font-black uppercase tracking-wider text-black">Here for you 24/7!</h3>
                        <p className="text-xs text-black/60 max-w-sm leading-relaxed font-sans">
                          Talk to a SubScript rep or explore self-serve options below.
                        </p>
                      </div>

                      <div className="w-full space-y-3 pt-4">
                        <button
                          type="button"
                          onClick={() => setSupportChatOpen(true)}
                          className="w-full p-4 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white flex items-center justify-between transition-all group font-bold text-xs uppercase tracking-wider shadow-md"
                        >
                          <span className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" /> Open In-App Support Chat
                          </span>
                          <ChevronRight className="h-4 w-4 text-white/70 group-hover:text-white transition" />
                        </button>

                        <a
                          href="https://t.me/subscriptsupport"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full p-4 rounded-2xl border border-[#2775CA]/30 bg-[#2775CA]/10 hover:bg-[#2775CA]/20 flex items-center justify-between transition-all group font-bold text-xs uppercase tracking-wider text-[#2775CA]"
                        >
                          <span>Join Telegram Support Group</span>
                          <ChevronRight className="h-4 w-4 text-[#2775CA]/50 group-hover:text-[#2775CA] transition" />
                        </a>

                        <a
                          href="https://www.subscriptonarc.com/support"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full p-4 rounded-2xl border border-black/10 hover:bg-black/[0.03] flex items-center justify-between transition-all group font-bold text-xs uppercase tracking-wider text-black"
                        >
                          <span>Help Center & FAQs</span>
                          <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 transition" />
                        </a>

                        <a
                          href="mailto:support@subscriptonarc.com"
                          className="w-full p-4 rounded-2xl border border-black/10 hover:bg-black/[0.03] flex items-center justify-between transition-all group font-bold text-xs uppercase tracking-wider text-black"
                        >
                          <span>Email Support</span>
                          <ChevronRight className="h-4 w-4 text-black/30 group-hover:text-black/60 transition" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === "referrals" && (
              <section className="space-y-6 pb-20 max-w-2xl">
                <SectionTitle title="Referrals Program" subtitle="Invite friends to join SubScript and view your referred signups." />

                {referralsLoading || !referralsLoaded ? (
                  <ReferralsSkeleton />
                ) : (
                  <>
                {/* Referral Link Card */}
                <div className="border border-black/15 bg-white rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm text-black">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/70 flex items-center gap-2">
                    <Gift className="h-4 w-4 text-[#2775CA]" /> Your Referral Link
                  </h3>
                  <p className="text-[10px] text-black/70 leading-relaxed font-medium">
                    Share your invite link with others. When they create an account and register a role, their signup is logged in your referral registry.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 rounded-2xl border border-black/15 bg-[#f8fafc] px-4 py-3 font-mono text-xs text-black font-semibold overflow-x-auto whitespace-nowrap select-all flex items-center">
                      {referralLink}
                    </div>
                    <button
                      type="button"
                      disabled={!referralLink}
                      onClick={() => {
                        if (!referralLink) return;
                        navigator.clipboard.writeText(referralLink);
                        setReferralCopySuccess(true);
                        triggerToast("Referral link copied!");
                        setTimeout(() => setReferralCopySuccess(false), 3000);
                      }}
                      className="rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white px-6 py-3.5 text-xs font-black uppercase tracking-[0.16em] transition flex items-center justify-center gap-2 shrink-0 shadow-sm disabled:opacity-50"
                    >
                      {referralCopySuccess ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </div>

                {/* Referral Statistics Card */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-black/15 bg-white rounded-3xl p-5 shadow-sm flex flex-col justify-between text-black">
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-black/60">Total Signups</span>
                    <span className="mt-2 font-mono text-3xl font-black text-[#2775CA]">{referralsCount}</span>
                  </div>
                  <div className="border border-black/15 bg-white rounded-3xl p-5 shadow-sm flex flex-col justify-between text-black">
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-black/60">Program Status</span>
                    <span className="mt-2 font-mono text-base font-black text-emerald-700">Active</span>
                  </div>
                </div>

                {/* Referrals Registry List */}
                <div className="border border-black/15 bg-white rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm text-black">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-black/70 flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#2775CA]" /> Referred Signups
                  </h3>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-sans text-xs">
                      <thead>
                        <tr className="border-b border-black/10 text-black/50 uppercase text-[9px] tracking-wider">
                          <th className="pb-3">Referred Account</th>
                          <th className="pb-3">Alias</th>
                          <th className="pb-3">Registered</th>
                          <th className="pb-3 text-right">KYC Verification</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referrals.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-black/40">
                              No signups registered under your link yet.
                            </td>
                          </tr>
                        ) : (
                          referrals.map((ref) => (
                            <tr key={ref.id} className="border-b border-black/5 hover:bg-black/[0.02] transition-all">
                              <td className="py-4 font-semibold text-black"><Identity address={ref.referredAddress} knownAlias={ref.alias} /></td>
                              <td className="py-4 font-semibold text-black/70">{ref.alias ? `@${ref.alias}` : "-"}</td>
                              <td className="py-4 text-black/60">{new Date(ref.createdAt).toLocaleDateString()}</td>
                              <td className="py-4 text-right">
                                {ref.kycStatus === "APPROVED" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-800 border border-emerald-500/30">
                                    <ShieldCheck className="w-3 h-3 text-emerald-700" />
                                    {ref.kycLevel === "ENHANCED" ? "Level 2 (Enhanced)" : "Level 1 (Verified)"}
                                  </span>
                                ) : ref.kycStatus === "PENDING" || ref.kycStatus === "IN_REVIEW" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-800 border border-amber-500/30">
                                    <Clock className="w-3 h-3 text-amber-700" />
                                    In Review
                                  </span>
                                ) : ref.kycStatus === "NEEDS_INPUT" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-orange-500/15 text-orange-800 border border-orange-500/30">
                                    <AlertTriangle className="w-3 h-3 text-orange-700" />
                                    Needs Input
                                  </span>
                                ) : ref.kycStatus === "REJECTED" || ref.kycStatus === "REVOKED" ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-800 border border-red-500/30">
                                    <ShieldAlert className="w-3 h-3 text-red-700" />
                                    Rejected
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-black/5 text-black/50 border border-black/10">
                                    <Shield className="w-3 h-3 text-black/40" />
                                    No KYC
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                  </>
                )}
              </section>
            )}
            </motion.div>
          </div>
        </div>
      </main>
        </div>
          </>
        )}
      </div>

      {/* Mobile-only Bottom Navigation Bar */}
      {isMobile && userWallet && !isActiveMobileDm && !mustBackupWallet && (
        <div className="fixed bottom-6 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3">
          {/* Capsule Navigation Menu */}
          <nav
            aria-label="Primary navigation"
            className="liquid-glass flex flex-1 items-center justify-around rounded-full backdrop-blur-lg px-3 py-[1.1rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]"
            style={{ backgroundColor: "rgb(39 117 202 / 20%)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" }}
          >
            <LiquidGlassEffect />
            {userBottomTabs.map((tab) => (
              <AnimatedBottomNavButton
                key={tab.id}
                label={tab.label}
                icon={tab.icon}
                active={activeTab === tab.id}
                accentClassName="text-[#FFFFF0]"
                onClick={() => {
                  setSelectedDmPeer(null);
                  setActiveTab(tab.id);
                }}
                compact
              />
            ))}
          </nav>

          {/* DMs Icon Outside Bottom Bar Capsule */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedDmPeer(null);
                setActiveTab("inbox");
              }}
              className={`relative h-[3.3rem] flex items-center justify-center rounded-full border transition-all duration-300 gap-2 px-3 overflow-hidden ${
                activeTab === "inbox"
                  ? "bg-[#353935] border-[#353935] text-[#FFFFF0] scale-105 w-[108px]"
                  : "bg-[#2775CA]/20 border-black/15 text-black/60 hover:text-black w-[3.3rem]"
              }`}
              aria-label="Open DMs"
            >
              <MessageSquare className="h-5 w-5 shrink-0" />
              {activeTab === "inbox" && <span className="text-[7px] font-bold uppercase tracking-wider shrink-0">DMs</span>}
            </button>
            {/* Badge lives outside the button so its overflow-hidden never clips it. */}
            {pendingDmCount > 0 && (
              <span className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-[#060608] bg-red-500 px-1 text-[10px] font-black leading-none text-white">
                {pendingDmCount > 9 ? "9+" : pendingDmCount}
              </span>
            )}
          </div>
        </div>
      )}

      {/* All Transactions (full list) */}
      <AnimatePresence>
        {allTxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-md"
            onClick={() => setAllTxOpen(false)}
          >
            <motion.div
              initial={{ y: 28, opacity: 0, filter: "blur(1.5px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ y: 28, opacity: 0, filter: "blur(1.5px)" }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onClick={(event) => event.stopPropagation()}
              className="mx-auto mt-auto sm:my-auto flex w-full sm:max-w-lg h-[92dvh] sm:h-[80vh] flex-col liquid-glass border border-white/10 bg-[#060608]/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5">
                <h2 className="text-sm font-black uppercase tracking-wider text-white">All Transactions</h2>
                <button
                  type="button"
                  onClick={() => setAllTxOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 border-b border-white/5 px-5 py-3">
                <input
                  value={allTxSearch}
                  onChange={(event) => setAllTxSearch(event.target.value)}
                  placeholder="Search by name or memo…"
                  className="subscript-input"
                />
                <div className="flex gap-2">
                  {([["all", "All"], ["recurring", "Subscriptions"], ["one-time", "One Time"], ["transfers", "Transfers"], ["withdrawals", "Withdrawals"]] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTxFilter(value)}
                      className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                        txFilter === value ? "bg-[#ccff00] text-black" : "bg-white/[0.06] text-white/50 hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-1 divide-y divide-white/[0.06]">
                {(() => {
                  const query = allTxSearch.trim().toLowerCase();
                  const list = filteredTransactions.filter(
                    (t) => !query || t.name.toLowerCase().includes(query) || t.detail.toLowerCase().includes(query),
                  );
                  if (list.length === 0) {
                    return (
                      <div className="flex h-40 items-center justify-center text-center text-xs text-white/40">
                        No transactions found.
                      </div>
                    );
                  }
                  return list.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 py-3">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center overflow-hidden">
                        {tx.pic ? (
                          <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-sm font-black text-[#ccff00]">{(tx.name || "?").charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-white">{tx.name}</p>
                        <p className="truncate text-[10px] font-bold text-white/40">{tx.detail}</p>
                      </div>
                      <span className={`shrink-0 text-base font-extrabold ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>{tx.amountLabel}</span>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DepositModal
        open={receiveOpen}
        userWallet={userWallet} 
        copied={copiedAddress} 
        onCopy={copyAddress} 
        onClose={() => setReceiveOpen(false)}
        originBalances={originBalances}
        hasExternalUsdc={hasExternalUsdc}
        chainId={chainId}
        switchChainAsync={switchChainAsync}
        writeContractAsync={writeContractAsync}
        refetchBalances={() => {
          refetchUsdc().catch(console.error);
          refetchOriginBalances().catch(console.error);
          refetchOriginBalances().catch(console.error);
        }}
      />
      <QrScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(value) => {
          /* The scanner reports the code verbatim now, so this can tell a SubScript link from an
             address instead of pattern-matching whatever survived a shared pre-parse. That also
             fixes DM invites and `/commit/0x…`, neither of which used to reach here intact. */
          const target = resolveScannedTarget(value);
          if (target.kind === "link") {
            router.push(target.path);
            return;
          }
          if (target.kind === "address") {
            setSendFundsRecipient(target.address);
            setSendFundsOpen(true);
            return;
          }
          /* An alias or handle — the Send Funds box resolves it. */
          setSendFundsRecipient(target.value);
          setSendFundsOpen(true);
        }}
      />
      
      <SendFundsModal
        open={sendFundsOpen}
        recipient={sendFundsRecipient}
        onClose={() => setSendFundsOpen(false)}
        onGoToBatch={() => {
          setSendFundsOpen(false);
          setActiveTab("batch");
        }}
        walletBalance={walletBalance}
        elsewhereUsdc={elsewhereUsdc}
        userWallet={userWallet}
        isEmbeddedWalletSession={isEmbeddedWalletSession}
        chainId={chainId}
        switchChainAsync={switchChainAsync}
        writeContractAsync={writeContractAsync}
        onScanQr={() => setScannerOpen(true)}
        refetchUsdc={refetchUsdc}
      />

      <ConfigureVaultModal
        open={configVaultOpen}
        onClose={() => {
          setConfigVaultOpen(false);
          setEditingVault(null);
        }}
        editingVault={editingVault}
        refetchVaults={loadVaults}
      />

      <TopupVaultModal
        open={topupVaultOpen}
        onClose={() => {
          setTopupVaultOpen(false);
          setEditingVault(null);
        }}
        vault={editingVault}
        refetchVaults={loadVaults}
      />

      <VaultInfoModal open={vaultInfoOpen} onClose={() => setVaultInfoOpen(false)} />

      <AccountHoldModal
        isOpen={accountHoldModalOpen}
        onClose={() => setAccountHoldModalOpen(false)}
        onHoldChange={(onHold) => setIsAccountOnHold(onHold)}
      />

      <AnimatePresence>
        {giftPlan && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-5 backdrop-blur-md"
            onClick={() => giftRequestBusyPlanId === null && setGiftPlan(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 16, opacity: 0, filter: "blur(1.5px)" }}
              animate={{ scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ scale: 0.96, opacity: 0, filter: "blur(1.5px)" }}
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="gift-plan-title"
              className="w-full max-w-md space-y-5 rounded-3xl border border-[#00d2b4]/20 bg-[#0c0c10] p-6 text-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#00d2b4]">Gift checkout</p>
                  <h2 id="gift-plan-title" className="mt-1 text-lg font-black text-white">{giftPlan.name}</h2>
                  <p className="mt-1 text-xs font-bold text-[#ccff00]">
                    {formatUsdc(giftPlan.amountUsdc)} USDC / {formatPlanPeriod(giftPlan.periodSeconds)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setGiftPlan(null)}
                  disabled={giftRequestBusyPlanId !== null}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 disabled:opacity-40"
                  aria-label="Close gift checkout modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tab Selector */}
              <div className="grid grid-cols-2 rounded-2xl bg-white/[0.04] p-1 border border-white/10">
                <button
                  type="button"
                  onClick={() => setGiftTab("friends")}
                  className={`rounded-xl py-2 text-xs font-bold transition ${giftTab === "friends" ? "bg-[#00d2b4]/20 text-[#00d2b4] border border-[#00d2b4]/30" : "text-white/50 hover:text-white"}`}
                >
                  SubScript Friends
                </button>
                <button
                  type="button"
                  onClick={() => setGiftTab("link")}
                  className={`rounded-xl py-2 text-xs font-bold transition ${giftTab === "link" ? "bg-[#00d2b4]/20 text-[#00d2b4] border border-[#00d2b4]/30" : "text-white/50 hover:text-white"}`}
                >
                  Shareable Link
                </button>
              </div>

              {giftRequestUrl ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-emerald-200">Gift link ready</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                          Share this checkout anywhere. The payment is one-time, single-use, and credits access to your account.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                    <p className="break-all font-mono text-[11px] leading-relaxed text-white/70">{giftRequestUrl}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => copyGiftRequestUrl(giftRequestUrl)}
                      className="dm-quick-button justify-center border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]"
                    >
                      <Copy className="h-3.5 w-3.5" /> {giftRequestCopied ? "Copied!" : "Copy"}
                    </button>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(giftRequestUrl)}&text=${encodeURIComponent(`Sponsor my ${giftPlan.name} plan on SubScript`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dm-quick-button justify-center border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4]"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Telegram
                    </a>
                    <a
                      href={`mailto:?subject=${encodeURIComponent(`Sponsor ${giftPlan.name}`)}&body=${encodeURIComponent(`You can sponsor this SubScript plan here:\n\n${giftRequestUrl}`)}`}
                      className="dm-quick-button justify-center border-white/10 bg-white/[0.05] text-white/70"
                    >
                      <Mail className="h-3.5 w-3.5" /> Email
                    </a>
                  </div>
                </div>
              ) : giftTab === "friends" ? (
                <form onSubmit={handleCreateGiftPlanRequest} className="space-y-4">
                  <p className="text-xs leading-relaxed text-white/55">
                    Select an active contact or type a username to send an actionable sponsorship request card directly to their DM inbox.
                  </p>

                  {/* Friends List from active DM threads */}
                  {dmThreads.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Active DM Contacts</p>
                      <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                        {dmThreads.map((thread) => {
                          const isSelected = selectedGiftFriendAddress.toLowerCase() === thread.peerAddress.toLowerCase();
                          return (
                            <button
                              key={thread.peerAddress}
                              type="button"
                              onClick={() => {
                                setSelectedGiftFriendAddress(thread.peerAddress);
                                setGiftFriendUsername("");
                              }}
                              className={`w-full flex items-center justify-between gap-3 rounded-2xl border p-2.5 text-left transition ${isSelected ? "border-[#00d2b4] bg-[#00d2b4]/10" : "border-white/5 bg-white/[0.02] hover:bg-white/5"}`}
                            >
                              <div className="flex items-center gap-2.5 overflow-hidden">
                                <Avatar profilePic={thread.peerProfilePic} name={formatPeerDisplayName(thread.peerName, thread.peerAddress)} />
                                <div className="truncate">
                                  <p className="text-xs font-bold text-white truncate">
                                    {formatPeerDisplayName(thread.peerName, thread.peerAddress)}
                                  </p>
                                  <p className="text-[10px] text-white/40 truncate">{thread.peerAddress}</p>
                                </div>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isSelected ? "bg-[#00d2b4] text-black" : "bg-white/5 text-white/40"}`}>
                                {isSelected ? "Selected" : "Select"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <Field label="Or type a friend's username">
                    <input
                      value={giftFriendUsername}
                      onChange={(event) => {
                        setGiftFriendUsername(event.target.value);
                        if (event.target.value.trim()) setSelectedGiftFriendAddress("");
                      }}
                      placeholder="friend.sub or friend"
                      className="subscript-input"
                      disabled={giftRequestBusyPlanId !== null}
                    />
                  </Field>

                  {giftRequestError && <p className="text-[11px] font-bold text-red-300">{giftRequestError}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setGiftPlan(null)}
                      disabled={giftRequestBusyPlanId !== null}
                      className="dm-quick-button min-w-0 border-white/10 bg-white/[0.06] text-white/55"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={giftRequestBusyPlanId !== null || (!selectedGiftFriendAddress && !giftFriendUsername.trim())}
                      className={`dm-quick-button dm-action-menu-trigger relative min-w-0 overflow-hidden text-white border-[#00d2b4]/30 bg-[#00d2b4]/20 hover:bg-[#00d2b4]/30 disabled:opacity-40 ${giftRequestBusyPlanId !== null ? "quick-action-loading" : ""}`}
                    >
                      {giftRequestBusyPlanId !== null ? "Sending DM..." : "Send Request in DM"}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleCreateGiftPlanRequest} className="space-y-4">
                  <p className="text-xs leading-relaxed text-white/55">
                    Generates a shareable single-use gift checkout link. Send it to anyone on Telegram, WhatsApp, or Email.
                  </p>
                  <Field label="Lock to a friend's username (optional)">
                    <input
                      value={giftFriendUsername}
                      onChange={(event) => setGiftFriendUsername(event.target.value)}
                      placeholder="friend.sub or friend"
                      className="subscript-input"
                      disabled={giftRequestBusyPlanId !== null}
                    />
                  </Field>
                  <p className="text-[10px] leading-relaxed text-white/40">
                    Leave blank to make a public link. If specified, only that SubScript user can pay it.
                  </p>
                  {giftRequestError && <p className="text-[11px] font-bold text-red-300">{giftRequestError}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setGiftPlan(null)}
                      disabled={giftRequestBusyPlanId !== null}
                      className="dm-quick-button min-w-0 border-white/10 bg-white/[0.06] text-white/55"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={giftRequestBusyPlanId !== null}
                      className={`dm-quick-button dm-action-menu-trigger relative min-w-0 overflow-hidden text-white ${giftRequestBusyPlanId !== null ? "quick-action-loading" : ""}`}
                    >
                      {giftRequestBusyPlanId !== null ? <>Creating<LoadingDots /></> : "Create Link"}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {vaultActionOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-5 backdrop-blur-md"
            onClick={() => !vaultActionBusy && setVaultActionOpen(false)}
          >
            <motion.form
              initial={{ scale: 0.94, y: 16, opacity: 0, filter: "blur(1.5px)" }}
              animate={{ scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ scale: 0.96, opacity: 0, filter: "blur(1.5px)" }}
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
              onClick={(event) => event.stopPropagation()}
              onSubmit={submitVaultAction}
              className="w-full max-w-sm space-y-4 rounded-3xl border border-black/10 bg-[#FFFFF0] text-black p-6 shadow-2xl"
            >
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#111827]">
                  {vaultActionMode === "commit" ? "Commit to a service" : "Withdraw from vault"}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-black/60">
                  {vaultActionMode === "commit"
                    ? "Escrow USDC for a merchant's metered service. This clears any owed balance first, then activates the service for the cycle once the commit is met."
                    : "Withdraw unused committed balance back to your wallet. Dropping below the required commit pauses the service until you re-commit."}
                </p>
              </div>
              <Field label="Merchant">
                {vaultActionMerchantLocked ? (
                  <div className="subscript-input flex items-center bg-white border border-black/15 text-[#111827]">
                    {merchantDisplayName(vaults.find((vault: any) => vault.merchantAddress?.toLowerCase() === vaultActionMerchant.toLowerCase())?.merchantName)}
                  </div>
                ) : (
                  <input
                    value={vaultActionMerchant}
                    onChange={(event) => setVaultActionMerchant(event.target.value)}
                    placeholder="Merchant name"
                    className="subscript-input bg-white border border-black/15 text-[#111827]"
                    required
                  />
                )}
              </Field>
              <Field label="Amount (USDC)">
                <input
                  value={vaultActionAmount}
                  onChange={(event) => setVaultActionAmount(event.target.value)}
                  placeholder="25.00"
                  inputMode="decimal"
                  className="subscript-input bg-white border border-black/15 text-[#111827]"
                  autoFocus
                  required
                />
              </Field>
              {vaultActionError && <p className="text-[11px] font-bold text-red-600 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{vaultActionError}</p>}
              {vaultUnverifiedWarning ? (
                <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="space-y-1">
                      <p className="text-[11px] font-black uppercase tracking-wide text-amber-900">Unverified merchant</p>
                      <p className="text-[11px] leading-relaxed text-amber-800">
                        SubScript has not verified this merchant. Committing escrows funds they can bill
                        metered usage against. Only commit to merchants you trust and have independently
                        verified. Funds lost to a fraudulent merchant may not be recoverable.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setVaultUnverifiedWarning(false); }}
                      disabled={vaultActionBusy}
                      className="rounded-2xl border border-black/15 bg-black/5 text-black hover:bg-black/10 py-2.5 text-xs font-bold transition"
                    >
                      Go back
                    </button>
                    <button
                      type="button"
                      onClick={() => { setVaultUnverifiedWarning(false); submitVaultAction(undefined, { acknowledgedUnverified: true }); }}
                      disabled={vaultActionBusy}
                      className="rounded-2xl border border-amber-500/40 bg-amber-500/20 text-amber-900 py-2.5 text-xs font-bold transition"
                    >
                      Commit anyway
                    </button>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVaultActionOpen(false)}
                  disabled={vaultActionBusy}
                  className="rounded-2xl border border-black/15 bg-black/5 text-black hover:bg-black/10 py-2.5 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={vaultActionBusy}
                  className={`rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-2.5 text-xs font-bold transition shadow-sm ${vaultActionBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {vaultActionBusy ? <>Working<LoadingDots /></> : vaultActionMode === "commit" ? "Commit" : "Withdraw"}
                </button>
              </div>
              )}
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmModal && (
        <ConfirmModal
          open={confirmModal.open}
          title={confirmModal.title}
          description={confirmModal.description}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          variant={confirmModal.variant}
          requiredMatchText={confirmModal.requiredMatchText}
          matchPlaceholder={confirmModal.matchPlaceholder}
          onConfirm={() => {
            const action = confirmModal.onConfirm;
            setConfirmModal(null);
            if (action) action();
          }}
          onCancel={() => {
            const action = confirmModal.onCancel;
            setConfirmModal(null);
            if (action) action();
          }}
        />
      )}

      {/* ── In-DM Subscription Review Modal ────────────────────────────────────── */}
      <SubscribeReviewModal
        dm={subscribeReviewDm}
        busy={subscribeReviewBusy}
        error={subscribeReviewError}
        onClose={() => setSubscribeReviewDm(null)}
        onConfirm={handleConfirmSubscription}
      />

      <SupportChatModal
        open={supportChatOpen}
        onClose={() => setSupportChatOpen(false)}
        currentWallet={userWallet || accountAddress || undefined}
        userRole="USER"
      />

      <QrScannerModal
        isOpen={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        onScan={handleScanQrResult}
        title={qrTargetIndex !== null ? `Scan QR for Recipient #${qrTargetIndex + 1}` : "Scan QR"}
      />

      {/* Single Send is a modal now; the Send tab body belongs to Batch Payouts. The routing
          notice is passed down rather than re-derived so Arc/CCTP rules live in one place. */}
      <SendSingleModal
        open={sendSingleModalOpen}
        onClose={() => setSendSingleModalOpen(false)}
        onGoToBatch={handleGoToBatch}
        onSubmit={handleSingleSend}
        recipient={singleRecipient}
        onRecipientChange={setSingleRecipient}
        amount={singleAmount}
        onAmountChange={setSingleAmount}
        resolving={singleResolving}
        resolved={singleResolved}
        selfSend={singleSelfSend}
        loading={singleSendLoading}
        status={singleSendStatus}
        walletBalance={walletBalance}
        balanceKnown={usdcBalance !== undefined}
        /* Both custody kinds can withdraw cross-chain: the in-app wallet through the server route,
           a browser wallet by signing the fee, approval and burn itself. */
        canWithdrawCrossChain={isEmbeddedWalletSession || externalWalletEnabled}
        onScanQr={() => {
          setQrTargetIndex(null);
          setQrScannerOpen(true);
        }}
        routingNotice={
          <BalanceRoutingNotice
            amount={singleAmount}
            walletBalance={walletBalance}
            elsewhereUsdc={elsewhereUsdc}
          />
        }
      />

      <DmRequestsModal
        open={dmRequestsModalOpen}
        onClose={() => setDmRequestsModalOpen(false)}
        onConnectionAccepted={(peer) => {
          setSelectedDmPeer(peer.toLowerCase());
          loadDms();
        }}
        onRequestsUpdated={() => {
          loadDms();
          loadRequestsCount();
        }}
      />

      <DmInviteManagerModal
        open={dmInviteModalOpen}
        onClose={() => setDmInviteModalOpen(false)}
      />

      <BlockedUsersModal
        open={blockedUsersModalOpen}
        onClose={() => setBlockedUsersModalOpen(false)}
        onUnblockSuccess={() => {
          loadDms();
        }}
      />

      {/* Blocking email capture — an email is required for receipts and notifications.
          Shown for accounts that don't have one yet (e.g. wallet-onboarded payers). */}
      {!loading && userWallet && !userEmail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-5 backdrop-blur-md">
          <form
            onSubmit={emailPromptStep === "email" ? handleSendEmailCode : handleVerifyEmailCode}
            className="w-full max-w-sm space-y-4 rounded-3xl border border-[#ccff00]/20 bg-[#0c0c10] p-6 shadow-2xl"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white">
                {emailPromptStep === "email" ? "Add your email" : "Verify your email"}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                {emailPromptStep === "email"
                  ? "We need an email to send you payment receipts, requests, and account notifications. This is required to continue."
                  : `Enter the 6-digit code we sent to ${emailPromptValue.trim()}.`}
              </p>
            </div>
            {emailPromptStep === "email" ? (
              <input
                type="email"
                value={emailPromptValue}
                onChange={(event) => setEmailPromptValue(event.target.value)}
                placeholder="you@example.com"
                className="subscript-input"
                autoFocus
                required
              />
            ) : (
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={emailPromptCode}
                onChange={(event) => setEmailPromptCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="subscript-input text-center tracking-[0.4em]"
                autoFocus
                required
              />
            )}
            {emailPromptError && (
              <p className="text-[11px] font-bold text-red-300">{emailPromptError}</p>
            )}
            <button
              type="submit"
              disabled={emailPromptSaving}
              className={`subscript-primary-button ${emailPromptSaving ? "opacity-60" : ""}`}
            >
              {emailPromptSaving
                ? (emailPromptStep === "email" ? <>Sending<LoadingDots /></> : <>Verifying<LoadingDots /></>)
                : (emailPromptStep === "email" ? "Send code" : "Verify & save")}
            </button>
            {emailPromptStep === "code" && (
              <button
                type="button"
                onClick={() => { setEmailPromptStep("email"); setEmailPromptError(null); }}
                className="w-full text-[11px] font-bold text-white/50 transition hover:text-white/80"
              >
                Use a different email
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

function VaultInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 16, opacity: 0, filter: "blur(1.5px)" }}
            animate={{ scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ scale: 0.96, opacity: 0, filter: "blur(1.5px)" }}
            transition={{ type: "spring", stiffness: 450, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vault-info-title"
            className="w-full max-w-md space-y-4 rounded-3xl border border-black/15 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-[#f8fafc] text-[#2775CA]">
                <Shield className="h-5 w-5" />
              </div>
              <h2 id="vault-info-title" className="text-sm font-black uppercase tracking-[0.14em] text-[#111827]">What is a prepaid vault?</h2>
            </div>
            <p className="text-xs leading-relaxed text-black/70">
              A vault is a small prepaid balance you commit to a single service. Instead of paying per
              call, you fund the vault once and the service draws from it as you use it, so usage-based
              products keep working without you approving every charge.
            </p>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/50">Typically used for</p>
              <ul className="space-y-1.5 text-xs text-black/70">
                <li>• API access billed per request</li>
                <li>• AI / LLM token usage</li>
                <li>• Storage, bandwidth, and media delivery</li>
                <li>• Any pay-per-use metered service</li>
              </ul>
            </div>
            <p className="rounded-2xl border border-black/10 bg-[#f8fafc] p-3 text-[11px] leading-relaxed text-black/60">
              SubScript fixes the commitment at 2 USDC for each user–merchant relationship per cycle.
              At cycle end the keeper settles reported usage and closes the vault; commit again to start the next cycle.
            </p>
            <button type="button" onClick={onClose} className="subscript-primary-button">
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HomeHeader({
  registeredDomain,
  profilePic,
  userWallet,
  onDns,
  onLogout,
}: {
  registeredDomain: string | null;
  profilePic: string | null;
  userWallet: string | null;
  onDns: () => void;
  onLogout: () => void;
}) {
  const [profileExpanded, setProfileExpanded] = useState(false);
  const profileLabel = registeredDomain || formatAddress(userWallet) || "Profile";

  const handleProfileClick = () => {
    if (!profileExpanded) {
      setProfileExpanded(true);
      return;
    }
    onDns();
    setProfileExpanded(false);
  };

  return (
    <div className="fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
      <header className="w-full max-w-md px-1 py-2 pointer-events-auto transition-all duration-300">
        <div className="flex items-center justify-between w-full">
          <button type="button" onClick={handleProfileClick} aria-label={profileExpanded ? "Open settings" : "Show DNS name"} className={profileExpanded ? "profile-trigger profile-trigger-expanded flex h-12 max-w-[calc(100vw-7rem)] items-center gap-2 overflow-hidden rounded-2xl border border-black/15 bg-[#2775CA]/20 px-2 text-black transition-all duration-300" : "profile-trigger flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 text-black transition-all duration-300"}>
            <Avatar profilePic={profilePic} name={profileLabel} size="xs" />
            {profileExpanded && <span className="truncate text-[11px] font-semibold">{profileLabel}</span>}
          </button>
          {/* Actions (Right) */}
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Mobile placement: the bell sits in the header bar. Same component the desktop title
                renders, so the unread count and read state cannot diverge between form factors. */}
            <NotificationBell audience="USER" accent="#ccff00" />
          </div>
        </div>
      </header>
    </div>
  );
}

function ChatHeader({
  peerName,
  peerProfilePic,
  peerAddress,
  isMerchant,
  isVerifiedMerchant,
  isBlocked,
  activeSubscription,
  onBack,
  onSendFunds,
  onBlock,
  onUnblock,
}: {
  peerName: string;
  peerProfilePic: string | null;
  peerAddress: string;
  isMerchant: boolean;
  isVerifiedMerchant: boolean;
  isBlocked?: boolean;
  activeSubscription?: { cancelAtPeriodEnd?: boolean | null } | null;
  onBack: () => void;
  onSendFunds: () => void;
  onBlock?: () => void;
  onUnblock?: () => void;
}) {
  return (
    <div className="fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
      <header className="w-full max-w-md liquid-glass rounded-full px-4 py-2.5 pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] bg-black/40 backdrop-blur-xl border border-white/10">
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Back button */}
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 text-white/60 hover:text-white bg-white/[0.04] border border-white/5 rounded-full transition-all shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            
            {/* Peer Info Capsule */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-white/[0.04] border border-white/5 rounded-full min-w-0">
              <Avatar profilePic={peerProfilePic} name={peerName} size="xs" />
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#ccff00] truncate max-w-[100px]">
                {peerName}
              </span>
              <MerchantVerifiedTick verified={isVerifiedMerchant} size="xs" />
              {/* Recurring subscription beacon */}
              {activeSubscription && (
                <span className="relative flex h-2 w-2 shrink-0" title={activeSubscription.cancelAtPeriodEnd ? "Subscription cancelling" : "Recurring subscription active"}>
                  {!activeSubscription.cancelAtPeriodEnd && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  )}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${activeSubscription.cancelAtPeriodEnd ? "bg-amber-400" : "bg-emerald-400"}`} />
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isBlocked ? (
              <button
                type="button"
                onClick={onUnblock}
                className="px-3 py-1 bg-white/10 border border-white/20 text-white font-bold text-[9px] rounded-full hover:bg-white/20 transition active:scale-95 shrink-0"
              >
                Unblock
              </button>
            ) : (
              <>
                {!isMerchant && onBlock && (
                  <button
                    type="button"
                    onClick={onBlock}
                    className="p-1.5 text-white/40 hover:text-rose-400 bg-white/[0.02] hover:bg-rose-500/10 border border-white/5 rounded-full transition-all shrink-0"
                    title="Block user"
                  >
                    <UserX className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isMerchant && (
                  <button
                    type="button"
                    onClick={onSendFunds}
                    className="px-3.5 py-1.5 bg-[#ccff00] text-black border border-black/20 font-black uppercase tracking-wider text-[10px] rounded-full hover:bg-[#b8e600] transition shadow-sm active:scale-95 shrink-0"
                  >
                    Send Funds
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}

/* Initials beat a generic glyph: they tell you *who* the empty circle belongs to. The onError
   fallback matters just as much — a dead or hotlink-protected avatar URL otherwise leaves the
   browser's broken-image icon in a 40px circle, which reads as our bug rather than a missing
   picture. `src` is tracked in state so a changed prop retries instead of staying failed. Same
   reasoning as PeerAvatar, which solves this for the DM request and block modals; this one stays
   local because it also renders the viewer's own avatar and the dark DM bubbles. */
function Avatar({ profilePic, name, size = "sm" }: { profilePic: string | null; name?: string | null; size?: "xs" | "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [profilePic]);

  const initials = (name || "").trim().slice(0, 2).toUpperCase();
  const showImage = Boolean(profilePic) && !failed;

  return (
    <div className={`${
      size === "lg" ? "h-16 w-16" : size === "xs" ? "h-7 w-7" : "h-10 w-10"
    } flex items-center justify-center overflow-hidden rounded-full border border-white/5 bg-black/30 shrink-0`}>
      {showImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={profilePic as string}
          alt={name || "Profile"}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : initials ? (
        <span className={`font-black text-white/70 ${size === "xs" ? "text-[9px]" : size === "lg" ? "text-base" : "text-[11px]"}`}>
          {initials}
        </span>
      ) : (
        <User className={`${size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4"} text-white/45`} />
      )}
    </div>
  );
}

function RoundAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button 
      type="button" 
      onClick={onClick} 
      aria-label={label} 
      className="flex h-14 w-14 items-center justify-center rounded-full border border-white/5 liquid-glass bg-black/30 backdrop-blur-lg text-[#ccff00]/80 hover:text-white hover:bg-[#ccff00]/10 hover:border-[#ccff00]/30 shadow-lg hover:shadow-[#ccff00]/5 transition-all duration-300 active:scale-95 group"
    >
      <Icon className="h-6 w-6 group-hover:scale-105 transition-transform" />
    </button>
  );
}

function SubscriptionRow({
  subscription,
  balanceVisible,
  onResume,
  resuming,
  onOpenThread,
}: {
  subscription: Subscription;
  balanceVisible: boolean;
  onResume?: (subscription: Subscription) => void;
  resuming?: boolean;
  /** Opens the merchant's DM thread — where the plan catalogue and cancel live. */
  onOpenThread?: (merchantAddress: string) => void;
}) {
  const intervalDays = Math.max(1, Math.round(Number(subscription.billingIntervalSeconds) / 86400));
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/20 hover:bg-black/35 hover:border-white/10 transition px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-black/30">
          {subscription.merchantProfilePic ? <img src={subscription.merchantProfilePic} alt={subscription.merchantName} className="h-full w-full object-cover" /> : <Shield className="h-5 w-5 text-[#ccff00]/70" />}
        </div>
        <div className="min-w-0">
          {/* The merchant's name opens their conversation. Everything a subscriber might want next
              — the plan catalogue, cancel, the billing history for this merchant — already lives in
              that thread, and this panel is desktop-only, where the thread is one pane away. A real
              button rather than a click handler on the row so it is reachable by keyboard and does
              not swallow the Resume button nested below it. */}
          <button
            type="button"
            onClick={onOpenThread ? () => onOpenThread(subscription.merchantAddress) : undefined}
            disabled={!onOpenThread}
            title={onOpenThread ? `Open your conversation with ${subscription.merchantName}` : undefined}
            className={`block w-full text-left ${onOpenThread ? "group cursor-pointer" : "cursor-default"}`}
          >
            <div className="flex items-center gap-1.5">
              <p className={`truncate text-xs font-black uppercase tracking-[0.1em] text-white ${onOpenThread ? "group-hover:text-[#ccff00] transition-colors" : ""}`}>{subscription.merchantName}</p>
              {subscription.merchantVerified && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
              {onOpenThread && <MessageSquare className="h-3 w-3 shrink-0 text-white/25 transition-colors group-hover:text-[#ccff00]" />}
            </div>
            <p className={`mt-1 text-[10px] ${subscription.cancelAtPeriodEnd ? "font-bold text-amber-400" : "text-white/40"}`}>
              {subscription.cancelAtPeriodEnd ? "Canceled · Access active until period end" : `Renews every ${intervalDays} days`}
            </p>
          </button>
          {/* Inline recovery while the paid period is still running — no need to open the DM. */}
          {subscription.cancelAtPeriodEnd && onResume && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
              type="button"
              onClick={() => onResume(subscription)}
              disabled={resuming}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#ccff00]/30 bg-[#ccff00]/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition hover:border-[#ccff00]/50 hover:bg-[#ccff00]/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {resuming ? <>Resuming<LoadingDots /></> : "Resume Subscription"}
            </motion.button>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-black text-[#ccff00]">
          {balanceVisible ? `${formatUsdc(subscription.amountCapUsdc)} USDC` : "•••• USDC"}
        </p>
        <p className={`text-[9px] uppercase ${subscription.cancelAtPeriodEnd ? "font-bold text-amber-400" : "text-white/35"}`}>
          {subscription.cancelAtPeriodEnd ? "Canceled (Period Active)" : humanSubscriptionStatus(subscription.status)}
        </p>
      </div>
    </div>
  );
}

function DmThreadSelect({
  threads,
  onSelect,
  selectedPeerAddress,
  pendingRequestsCount = 0,
  onOpenRequests,
  onOpenInvite,
  onOpenBlocked,
}: {
  threads: Array<{
    peerAddress: string;
    peerName: string;
    peerRole: string | null;
    peerVerified: boolean | undefined;
    peerProfilePic: string | null;
    latest: DmMessage | null;
    latestTime: number;
    pendingCount: number;
    totalCount: number;
    isBlocked?: boolean;
  }>;
  onSelect: (peerAddress: string) => void;
  selectedPeerAddress?: string | null;
  pendingRequestsCount?: number;
  onOpenRequests?: () => void;
  onOpenInvite?: () => void;
  onOpenBlocked?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="border border-black/10 bg-white/80 rounded-2xl p-4 shadow-sm relative space-y-2.5 text-black">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#2775CA]">SubScript DMs</p>
          <h1 className="mt-0.5 text-base font-black uppercase tracking-tight text-[#111827]">Payment Threads</h1>
        </div>
        <p className="text-[10px] font-medium leading-relaxed text-[#4b5563]">
          Receipts, peer payments, and connection requests.
        </p>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/10">
          {onOpenRequests && (
            <button
              type="button"
              onClick={onOpenRequests}
              className="relative flex items-center gap-1 rounded-full border border-black/15 bg-white hover:bg-black/5 px-2.5 py-1 text-[9px] font-bold text-black transition-all active:scale-95 shadow-sm"
            >
              <Inbox className="h-3 w-3 text-[#2775CA]" />
              <span>Requests</span>
              {pendingRequestsCount > 0 && (
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#2775CA] px-1 text-[8px] font-black text-white">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          )}

          {onOpenInvite && (
            <button
              type="button"
              onClick={onOpenInvite}
              className="flex items-center gap-1 rounded-full border border-black/15 bg-white hover:bg-black/5 px-2.5 py-1 text-[9px] font-bold text-black transition-all active:scale-95 shadow-sm"
            >
              <Link2 className="h-3 w-3 text-black/60" />
              <span>My Invite</span>
            </button>
          )}

          {onOpenBlocked && (
            <button
              type="button"
              onClick={onOpenBlocked}
              className="flex items-center gap-1 rounded-full border border-black/15 bg-white hover:bg-rose-50 px-2 py-1 text-[9px] font-bold text-black/60 hover:text-rose-600 transition-all active:scale-95 ml-auto shadow-sm"
              title="Blocked contacts"
            >
              <UserX className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {threads.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] p-6 text-center space-y-1.5 text-black">
          <Mail className="h-6 w-6 text-black/30" />
          <p className="text-[11px] text-black/60">No conversations or connections yet.</p>
          {onOpenInvite && (
            <button
              type="button"
              onClick={onOpenInvite}
              className="mt-1 text-[9px] font-bold text-[#2775CA] hover:underline"
            >
              Share your invite link
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => {
            const isSelected = thread.peerAddress.toLowerCase() === selectedPeerAddress?.toLowerCase();
            const peerLabel = formatPeerDisplayName(thread.peerName, thread.peerAddress);
            const latestPreview = thread.latest
              ? shortenWalletsInText(thread.latest.title || thread.latest.description || "SubScript payment message")
              : "Connected • Ready to transact";
            const dateLabel = thread.latest
              ? new Date(thread.latest.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : new Date(thread.latestTime).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const messageCountLabel = thread.totalCount > 0
              ? `${thread.totalCount} system message${thread.totalCount === 1 ? "" : "s"}`
              : "Active Connection";

            return (
              <motion.button
                key={thread.peerAddress}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                type="button"
                onClick={() => onSelect(thread.peerAddress)}
                className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left shadow-sm transition-colors duration-200 ${
                  isSelected
                    ? "border-[#2775CA] bg-[#2775CA]/10 text-black"
                    : "border-black/10 bg-white/80 hover:bg-white text-black"
                }`}
              >
                <Avatar profilePic={thread.peerProfilePic} name={peerLabel} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 truncate text-xs font-black uppercase tracking-[0.12em] text-[#111827]">
                      <span className="truncate">{peerLabel}</span>
                      <MerchantVerifiedTick verified={thread.peerVerified} size="xs" />
                    </p>
                    <span className="text-[9px] font-bold text-black/50 shrink-0">
                      {dateLabel}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-black/65">{latestPreview}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#2775CA]">
                      {messageCountLabel}
                    </span>
                    {thread.isBlocked && (
                      <span className="rounded-full bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.2 text-[8px] font-bold text-rose-700">
                        Blocked
                      </span>
                    )}
                  </div>
                </div>
                {thread.pendingCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2775CA] px-1.5 text-[9px] font-black text-white shrink-0">
                    {thread.pendingCount}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DmBubble({
  dm,
  focused,
  incoming: senderIsPeer,
  forceMerchantVoice = false,
  loadingAction,
  onPay,
  onDecline,
  onDismiss,
  onNudge,
  onThanks,
  onCancelPlan,
  onSurveySubmit,
  onResumeService,
  onTopUpCommit,
  onViewCommit,
  onManagePlan,
  onCancelSubscription,
  onResumeSubscription,
  resumeBusy,
}: {
  dm: DmMessage;
  focused: boolean;
  incoming: boolean;
  /* Merchant threads are a one-way notification feed, so every message in one is drawn in the
     merchant's voice — left, with their avatar and name — whatever `sender_address` says.
     A few lifecycle events (cancel, service pause/resume) are still written by the user's own
     wallet, and drawing those as the subscriber's outgoing messages made a notification feed look
     like a two-way chat. Presentation only: action gating keeps reading the real sender, or pay
     and decline buttons would appear on the user's own messages. */
  forceMerchantVoice?: boolean;
  loadingAction: string | null;
  onPay: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  onNudge?: () => void;
  onThanks?: () => void;
  onCancelPlan?: () => void;
  onSurveySubmit?: (dm: DmMessage, response: string) => void;
  onResumeService?: () => void;
  onTopUpCommit?: () => void;
  onViewCommit?: () => void;
  /* Subscription-lifecycle actions.
   *
   * Every lifecycle DM used to end with "manage or cancel from your dashboard" and carry no button,
   * so the message that told a subscriber their price was about to change was the one place they
   * could not act on it. These three cover what those notices actually ask for. */
  onManagePlan?: () => void;
  onCancelSubscription?: () => void;
  onResumeSubscription?: () => void;
  resumeBusy?: boolean;
}) {
  const isPending = dm.status === "PENDING";
  /* `incoming` drives every visual decision below — side, avatar, bubble fill, label colour.
     `senderIsPeer` is the real direction and is what the action gates use. */
  const incoming = forceMerchantVoice || senderIsPeer;
  const displayTitle = shortenWalletsInText(dm.title);
  const displayDescription = shortenWalletsInText(dm.description);
  const senderLabel = formatPeerDisplayName(dm.senderName, dm.senderAddress);
  /* When the user's own wallet wrote the row, the merchant is the receiver — so merchant voice has
     to read identity off that side instead. */
  const voiceLabel = forceMerchantVoice && !senderIsPeer
    ? formatPeerDisplayName(dm.receiverName, dm.receiverAddress)
    : senderLabel;
  const voiceProfilePic = forceMerchantVoice && !senderIsPeer ? dm.receiverProfilePic : dm.senderProfilePic;
  const lines = splitDmDescription(displayDescription);
  const canPay = senderIsPeer && isPending && Boolean(dm.paymentLinkId) && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING", "SUBSCRIPTION_OFFER", "SPONSORED_PLAN_REQUEST"].includes(dm.messageType);
  const canDecline = senderIsPeer && isPending && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING", "SUBSCRIPTION_OFFER", "SPONSORED_PLAN_REQUEST"].includes(dm.messageType);

  /* Parse lines to show a beautiful checkout details card for payment requests and shared commits */
  const isRequest = ["PAYMENT_REQUEST", "PEER_REQUEST", "SUBSCRIPTION_OFFER", "SPONSORED_PLAN_REQUEST", "SPONSORED_PLAN_CONFIRMED", "SHARE_COMMIT"].includes(dm.messageType);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionItems: Array<{
    key: string;
    label: string;
    onClick?: () => void;
    loadingKey?: string;
    href?: string;
  }> = [];

  if (canPay) {
    actionItems.push({
      key: "pay",
      label: dm.messageType === "EXPIRY_WARNING"
        ? "Resubscribe"
        : dm.messageType === "SUBSCRIPTION_OFFER"
          ? "Review & Subscribe"
          : dm.messageType === "SPONSORED_PLAN_REQUEST"
            ? "Confirm & Pay"
            : "Confirm",
      onClick: onPay,
      loadingKey: `pay-${dm.id}`,
    });
  }
  if (canDecline) {
    actionItems.push({
      key: "decline",
      label: dm.messageType === "EXPIRY_WARNING" ? "Cancel Plan" : "Decline",
      onClick: onDecline,
      loadingKey: `decline-${dm.id}`,
    });
  }
  if (dm.messageType === "SPONSORED_PLAN_CONFIRMED" && onPay) {
    actionItems.push({
      key: "resubscribe-self",
      label: "Resubscribe for Yourself",
      onClick: onPay,
      loadingKey: `resub-self-${dm.id}`,
    });
  }
  /* Only the recipient of a transfer can thank the sender — you don't thank yourself. */
  if (dm.messageType === "PEER_TRANSFER" && senderIsPeer && onThanks) {
    actionItems.push({ key: "thanks", label: "Thanks", onClick: onThanks, loadingKey: `thanks-${dm.id}` });
  }
  if (dm.messageType === "PEER_REQUEST" && isPending && !senderIsPeer && onNudge) {
    actionItems.push({ key: "nudge", label: "Nudge", onClick: onNudge, loadingKey: `nudge-${dm.id}` });
  }
  if (dm.messageType === "PAYMENT_REQUEST" && isPending && senderIsPeer && onCancelPlan) {
    actionItems.push({ key: "cancel", label: "Cancel Plan", onClick: onCancelPlan, loadingKey: `cancel-${dm.id}` });
  }
  /* The threshold notice tells the user to "review the usage breakdown in your dashboard" —
     this is that link. onViewCommit lands them on the Vault & Commits tab, scoped to the
     merchant that reported the usage. */
  if (dm.messageType === "USAGE_THRESHOLD" && onViewCommit) {
    actionItems.push({ key: "view-commit", label: "View usage", onClick: onViewCommit });
  }
  /* An auto top-up failure always names something the user can act on — add funds, re-approve,
     raise the cap — and every one of those starts at the commit/mandate surface. */
  if (dm.messageType === "AUTO_TOPUP_FAILED") {
    if (onTopUpCommit) {
      actionItems.push({ key: "topup-now", label: "Top up now", onClick: onTopUpCommit });
    }
    if (onViewCommit) {
      actionItems.push({ key: "view-commit", label: "Auto top-up settings", onClick: onViewCommit });
    }
  }
  /* Subscription-lifecycle notices. Each one names an action in its copy — this is that action,
     in the same message, instead of "from your dashboard".
     ALLOWANCE_LOW is deliberately absent: its remedy is re-authorizing the ERC-20 allowance, and
     there is no endpoint for that yet (extendAllowanceForCustodial has no callers), so a button
     would go nowhere. */
  if (dm.messageType === "SUBSCRIPTION_STARTED" || dm.messageType === "RENEWAL_UPCOMING") {
    if (onManagePlan) {
      actionItems.push({ key: "manage-plan", label: "Manage plan", onClick: onManagePlan });
    }
    if (onCancelSubscription) {
      actionItems.push({
        key: "cancel-subscription",
        label: dm.messageType === "RENEWAL_UPCOMING" ? "Cancel before renewal" : "Cancel plan",
        onClick: onCancelSubscription,
      });
    }
  }
  if (dm.messageType === "TRIAL_ENDING") {
    /* "Keep it" is a dismissal, not a purchase: staying subscribed is the default and needs no
       transaction. Saying so explicitly stops the notice reading like a demand. */
    actionItems.push({ key: "keep-plan", label: "Keep it", onClick: onDismiss, loadingKey: `dismiss-${dm.id}` });
    if (onCancelSubscription) {
      actionItems.push({ key: "cancel-subscription", label: "Cancel plan", onClick: onCancelSubscription });
    }
  }
  if (dm.messageType === "WINBACK_OFFER" && onResumeSubscription) {
    actionItems.push({ key: "resume-subscription", label: "Resume", onClick: onResumeSubscription });
  }
  if (dm.messageType === "SPONSORED_ACCESS_ENDING" && onManagePlan) {
    actionItems.push({ key: "subscribe-self", label: "View plans", onClick: onManagePlan });
  }
  if (dm.messageType === "CHURN_SURVEY" && isPending && onSurveySubmit) {
    actionItems.push(
      { key: "survey-expensive", label: "Too Expensive", onClick: () => onSurveySubmit(dm, "TOO_EXPENSIVE"), loadingKey: `survey-${dm.id}-TOO_EXPENSIVE` },
      { key: "survey-features", label: "Lack Features", onClick: () => onSurveySubmit(dm, "LACK_OF_FEATURES"), loadingKey: `survey-${dm.id}-LACK_OF_FEATURES` },
      { key: "survey-technical", label: "Tech Issues", onClick: () => onSurveySubmit(dm, "TECHNICAL_ISSUES"), loadingKey: `survey-${dm.id}-TECHNICAL_ISSUES` },
      { key: "survey-other", label: "Other", onClick: () => onSurveySubmit(dm, "OTHER"), loadingKey: `survey-${dm.id}-OTHER` },
      /* Opting out: the merchant is not emailed any reason. */
      { key: "survey-skip", label: "Prefer not to answer", onClick: () => onSurveySubmit(dm, "DISMISSED"), loadingKey: `survey-${dm.id}-DISMISSED` },
    );
  }
  const hasActionMenu = actionItems.length > 1;

  /* Crisp pop entrance: bubbles scale in from their own corner and settle immediately.
     Damping is kept near-critical so they land clean instead of rubber-banding. */
  const bubbleSpring = incoming
    ? { type: "spring" as const, stiffness: 420, damping: 30 }
    : { type: "spring" as const, stiffness: 450, damping: 32 };
  const bubbleOrigin = incoming ? "bottom left" : "bottom right";

  if (isReactionMessage(dm.messageType)) {
    return (
      <motion.div
        initial={{ scale: 0.5, opacity: 0, y: 8, filter: "blur(1.2px)" }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: "blur(0px)" }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 450, damping: 32 }}
        style={{ transformOrigin: bubbleOrigin }}
        className={`flex gap-2.5 ${incoming ? "justify-start" : "justify-end"}`}
      >
        {incoming && <Avatar profilePic={voiceProfilePic} name={voiceLabel} />}
        <div className={`flex flex-col gap-1 ${incoming ? "items-start" : "items-end"}`}>
          <div
            data-dm-bubble={incoming ? "dark" : undefined}
            data-dm-dark="true"
            className={`select-none rounded-full px-4 py-2 text-xs font-bold shadow-md ${
              incoming
                ? "border border-white/10 bg-[#262629]/95 text-white"
                : "bg-gradient-to-br from-[#00b2ff] to-[#007aff] text-white shadow-[0_4px_16px_rgba(0,122,255,0.2)]"
            }`}
          >
            {displayTitle || "Reaction"}
          </div>
          <span className="px-2 text-[9px] font-bold text-white/35">
            {new Date(dm.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </motion.div>
    );
  }

  /* Paused-service card: a full-width banner (not a chat bubble) in the merchant thread.
     While the pause is unresolved it carries the Resume / Top-up actions; once resolved
     (resume or a funding commit dismisses it) it stays as a quiet historical marker. */
  if (dm.messageType === "SERVICE_PAUSED") {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10, filter: "blur(1.2px)" }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={bubbleSpring}
        className="w-full"
      >
        <div className={`w-full rounded-[20px] border px-5 py-4 shadow-md ${isPending ? "border-orange-400/30 bg-orange-500/[0.08]" : "border-white/5 bg-black/25 opacity-70"}`}>
          <div className="flex items-center gap-2">
            <Lock className={`h-4 w-4 shrink-0 ${isPending ? "text-orange-300" : "text-white/35"}`} />
            <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${isPending ? "text-orange-300" : "text-white/45"}`}>
              {isPending ? "Service plan paused" : "Service pause resolved"}
            </p>
          </div>
          <p className={`mt-2 text-xs leading-relaxed ${isPending ? "text-white/75" : "text-white/40"}`}>
            {isPending
              ? "You paused payments for this service, so you can't use this merchant's service while paused. Resume it, or top up your commit if it's below the 2 USDC minimum."
              : "This pause was resolved: the service is active again."}
          </p>
          {isPending && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {onResumeService && (
                <button
                  type="button"
                  onClick={() => !resumeBusy && onResumeService()}
                  disabled={resumeBusy}
                  className={`relative overflow-hidden rounded-xl border px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${resumeBusy ? "quick-action-loading cursor-not-allowed border-emerald-300/20 bg-emerald-400/10 text-emerald-200/60" : "border-emerald-300/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"}`}
                >
                  {resumeBusy ? <>Resuming<LoadingDots /></> : "Resume"}
                </button>
              )}
              {onTopUpCommit && (
                <button
                  type="button"
                  onClick={onTopUpCommit}
                  className="rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] hover:bg-[#ccff00]/25 transition"
                >
                  Top up commit
                </button>
              )}
            </div>
          )}
          <p className="mt-2 text-[9px] font-bold text-white/30">
            {new Date(dm.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.82, opacity: 0, y: 14, filter: "blur(1.2px)" }}
      animate={{ scale: 1, opacity: 1, y: 0, filter: "blur(0px)" }}
      whileHover={{ scale: 1.01 }}
      transition={bubbleSpring}
      style={{ transformOrigin: bubbleOrigin }}
      className={`flex gap-2.5 ${incoming ? "justify-start" : "justify-end"}`}
    >
      {incoming && <Avatar profilePic={voiceProfilePic} name={voiceLabel} />}
      <div className={`max-w-[85%] sm:max-w-[75%] ${incoming ? "items-start" : "items-end"} flex flex-col gap-1.5 min-w-0`}>
        <div 
          data-dm-bubble={incoming ? "dark" : "sent"}
          className={`px-4 py-3 shadow-md select-none transition-all duration-200 w-full break-words [word-break:break-word] overflow-hidden ${
            incoming 
              ? `${focused ? "border-[#2775CA] bg-[#18181b]" : "border-black/20 bg-[#18181b] backdrop-blur-xl text-white"} rounded-[18px] rounded-bl-[4px] border shadow-xl` 
              : "bg-gradient-to-br from-[#00b2ff] to-[#007aff] text-white rounded-[18px] rounded-br-[4px] border-none shadow-[0_4px_16px_rgba(0,122,255,0.2)]"
          }`}
        >
          <p 
            className={`mb-1.5 text-[8px] font-black uppercase tracking-[0.16em] ${
              incoming ? "text-[#38bdf8]" : "text-white/80"
            }`}
          >
            {humanStatus(dm.messageType)}
          </p>
          
          {isRequest ? (
            <div className="space-y-2 font-sans text-xs">
              <h4 
                className={`text-xs font-black uppercase tracking-wider border-b pb-1.5 ${
                  incoming ? "text-white border-white/5" : "text-white border-white/10"
                }`}
              >
                {displayTitle || "Payment Details"}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                <div>
                  <span className={`block uppercase tracking-widest text-[7px] ${incoming ? "text-white/40" : "text-white/60"}`}>Plan / Purpose</span>
                  <span className="font-bold text-white">{displayTitle?.split(" requested")[0] || "Services / Payout"}</span>
                </div>
                <div>
                  <span className={`block uppercase tracking-widest text-[7px] ${incoming ? "text-white/40" : "text-white/60"}`}>Merchant / Sender</span>
                  <span className="font-bold text-white truncate block">{voiceLabel}</span>
                </div>
              </div>
              
              {displayDescription && (
                <div 
                  className={`rounded-lg p-2 border mt-1.5 ${
                    incoming ? "bg-black/25 border-white/5" : "bg-black/15 border-white/10"
                  }`}
                >
                  <span className={`block uppercase tracking-widest text-[7px] mb-0.5 ${incoming ? "text-white/40" : "text-white/60"}`}>Details</span>
                  <p className="text-white/90 text-[9px] leading-relaxed whitespace-pre-wrap break-words [word-break:break-word]">{displayDescription}</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-xs font-black uppercase leading-snug text-white break-words [word-break:break-word]">{displayTitle || "SubScript message"}</h3>
              <div className="mt-2 space-y-1">
                {lines.length > 0 ? lines.map((line) => {
                  /* Receipt references read as noise in a chat bubble — show a same-origin
                     "View receipt" action and never trust a host stored in legacy DM text. */
                  const receiptHref = receiptHrefFromDescriptionLine(line);
                  if (receiptHref) {
                    return (
                      <a
                        key={line}
                        href={receiptHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 text-[10px] font-bold underline underline-offset-2 ${incoming ? "text-[#ccff00]" : "text-white"}`}
                      >
                        View receipt <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    );
                  }
                  /* Older receipts embedded the raw tx hash — meaningless to a person, and
                     payment proof stays inside SubScript (the receipt page carries it), so the
                     line is simply dropped rather than linked to an external explorer. */
                  if (/^transaction\b/i.test(line)) return null;
                  return (
                    <p key={line} className={`text-[10px] leading-relaxed break-words [word-break:break-word] ${incoming ? "text-white/70" : "text-white/90"}`}>{line}</p>
                  );
                }) : <p className={`text-[10px] leading-relaxed break-words [word-break:break-word] ${incoming ? "text-white/70" : "text-white/90"}`}>System-generated SubScript payment update.</p>}
              </div>
            </>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span 
              className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${
                incoming ? "bg-white/5 text-white/40" : "bg-black/15 text-white/70"
              }`}
            >
              {new Date(dm.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
            {dm.amountUsdc && (
              <span className={`text-[10px] font-black ${incoming ? "text-[#ccff00]" : "text-white"}`}>
                {formatUsdc(dm.amountUsdc)} USDC
              </span>
            )}
          </div>
        </div>

        <div className={`w-full ${incoming ? "items-start" : "items-end"} flex flex-col gap-2`}>
          {hasActionMenu ? (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => setActionMenuOpen((open) => !open)}
                className={`dm-quick-button dm-action-menu-trigger relative overflow-hidden ${actionMenuOpen ? "dm-action-menu-trigger-open" : ""}`}
              >
                {actionMenuOpen ? "Close" : `${actionItems.length} Actions`}
              </motion.button>
              <AnimatePresence>
                {actionMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.92, filter: "blur(1.2px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -6, scale: 0.94, filter: "blur(1.2px)" }}
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    className={`dm-action-menu-grid ${incoming ? "origin-top-left" : "origin-top-right"}`}
                  >
                    {actionItems.map((action, index) => {
                      const className = `dm-quick-button dm-action-menu-button relative overflow-hidden ${action.loadingKey && loadingAction === action.loadingKey ? "quick-action-loading" : ""}`;
                      if (action.href) {
                        return (
                          <motion.a
                            key={action.key}
                            initial={{ opacity: 0, y: -4, scale: 0.94, filter: "blur(1px)" }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                            transition={{ type: "spring", stiffness: 450, damping: 32, delay: index * 0.025 }}
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            href={action.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={className}
                          >
                            {action.label} <ExternalLink className="h-3 w-3" />
                          </motion.a>
                        );
                      }
                      return (
                        <motion.button
                          key={action.key}
                          initial={{ opacity: 0, y: -4, scale: 0.94, filter: "blur(1px)" }}
                          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                          transition={{ type: "spring", stiffness: 450, damping: 32, delay: index * 0.025 }}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          type="button"
                          onClick={action.onClick}
                          className={className}
                        >
                          {action.label}
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <div className={`flex flex-wrap gap-2 ${incoming ? "justify-start" : "justify-end"}`}>
              {actionItems.map((action) => {
                const className = `dm-quick-button relative overflow-hidden ${action.loadingKey && loadingAction === action.loadingKey ? "quick-action-loading" : ""}`;
                if (action.href) {
                  return (
                    <motion.a
                      key={action.key}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      href={action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={className}
                    >
                      {action.label} <ExternalLink className="h-3 w-3" />
                    </motion.a>
                  );
                }
                return (
                  <motion.button
                    key={action.key}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    type="button"
                    onClick={action.onClick}
                    className={className}
                  >
                    {action.label}
                  </motion.button>
                );
              })}
            </div>
          )}

          {dm.messageType === "CHURN_SURVEY" && !isPending && (
            <span className="text-[10px] font-sans font-black uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-4 py-1.5 rounded-full select-none shadow-[0_2px_12px_rgba(204,255,0,0.06)]">
              Response: {humanStatus(dm.status)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Hostname of a merchant-authored link, for labelling where a tap will take the customer. */
function linkHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function MerchantPlanManager({
  open,
  merchantLabel,
  plans,
  activeSubscription,
  loading,
  loadingAction,
  status,
  error,
  onToggle,
  onCancel,
  onResume,
}: {
  open: boolean;
  merchantLabel: string;
  plans: MerchantPlan[];
  activeSubscription: Subscription | null;
  loading: boolean;
  loadingAction: string | null;
  status: string | null;
  error: string | null;
  onToggle: () => void;
  onCancel: () => void;
  /* Restoring a canceled subscription is not a fresh subscribe. Cancelling revoked the on-chain
     authorization, so subscribing again mints a second one and charges for a period the
     subscriber already paid for — /api/user/subscription/resume mints a free bridge instead.
     This prop is what routes the canceled branch there. */
  onResume?: (subscription: Subscription) => void;
}) {
  const hasActiveSubscription = !!activeSubscription;
  const isCanceledAtPeriodEnd = Boolean(activeSubscription?.cancelAtPeriodEnd);
  const activePlan = activeSubscription
    ? plans.find(
        (p) =>
          Number(activeSubscription.amountCapUsdc) === Number(p.amountUsdc) &&
          Number(activeSubscription.billingIntervalSeconds) === Number(p.periodSeconds)
      )
    : null;
  const planLabel = activePlan ? activePlan.name : "Active Plan";

  return (
    <div className="flex flex-col gap-3 text-black">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 450, damping: 32 }}
        className="order-2 flex flex-wrap items-center gap-2 rounded-2xl border border-black/15 bg-white p-3 shadow-sm text-black"
      >
        <div className="min-w-0 flex-1">
          <p className={`text-[9px] font-black uppercase tracking-[0.16em] ${isCanceledAtPeriodEnd ? "text-amber-700" : "text-[#2775CA]"}`}>
            {hasActiveSubscription
              ? (isCanceledAtPeriodEnd ? `${planLabel} (Canceled)` : planLabel)
              : "Merchant Plan Controls"}
          </p>
          <p className="truncate text-xs font-bold text-[#111827]">
            {hasActiveSubscription
              ? `${formatUsdc(activeSubscription.amountCapUsdc)} USDC / ${formatPlanPeriod(activeSubscription.billingIntervalSeconds)}${isCanceledAtPeriodEnd ? " · Access active" : ""}`
              : `Choose a plan from ${merchantLabel}`}
          </p>
        </div>
        {hasActiveSubscription && (
          isCanceledAtPeriodEnd ? (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
              type="button"
              /* activeSubscription, not activePlan. activePlan is matched by exact amount+period
                 against the merchant's published plans, so a plan edited or delisted after signup
                 resolves to null and used to disable the only way back. Resume needs the
                 subscription row alone. */
              onClick={() => onResume?.(activeSubscription)}
              disabled={loadingAction === `resume-sub-${activeSubscription.subscriptionId}`}
              className="dm-quick-button flex-1 min-w-0 text-center truncate relative overflow-hidden border-black/15 bg-white text-black shadow-sm font-black"
            >
              {/* "Resume", not "Resubscribe": nothing is charged and the paid period continues. */}
              {loadingAction === `resume-sub-${activeSubscription.subscriptionId}` ? "Resuming…" : "Resume"}
            </motion.button>
          ) : (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
              type="button"
              onClick={onCancel}
              disabled={loadingAction === `cancel-sub-${activeSubscription.subscriptionId}`}
              className={`dm-quick-button flex-1 min-w-0 text-center truncate relative overflow-hidden border-red-500/20 bg-red-50 text-red-700 font-black shadow-sm ${
                loadingAction === `cancel-sub-${activeSubscription.subscriptionId}` ? "quick-action-loading" : ""
              }`}
            >
              Cancel current plan
            </motion.button>
          )
        )}
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 450, damping: 32 }}
          type="button"
          onClick={onToggle}
          className={`dm-quick-button dm-action-menu-trigger relative overflow-hidden border-black/15 bg-white text-black font-black shadow-sm ${hasActiveSubscription ? "flex-1 min-w-0 text-center truncate" : ""}`}
        >
          {/* One label for every case. The list is a catalogue now — it shows what this merchant
              sells and nothing transacts from it — so "Manage Plan" and "Subscribe" both overstated
              what opening it does. Resume and Cancel above are the actions. */}
          {open ? "Hide plans" : "View plans"}
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.92, scaleY: 0.85, filter: "blur(1.5px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, scaleY: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 8, scale: 0.95, scaleY: 0.9, filter: "blur(1.5px)" }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            style={{ transformOrigin: "top center" }}
            className="order-1 max-h-[min(48dvh,28rem)] space-y-3 overflow-y-auto overscroll-contain rounded-2xl border border-black/15 bg-[#FFFFF0] p-3 text-black shadow-lg"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-5 text-[10px] font-black uppercase tracking-[0.16em] text-black/50">
                <Loader2 className="h-4 w-4 animate-spin text-[#2775CA]" />
                Loading plans
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-center text-xs text-black/60">
                This merchant has not published active plans yet.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.map((plan, index) => {
                  const isCurrent = activeSubscription
                    ? activeSubscription.amountCapUsdc === plan.amountUsdc &&
                      activeSubscription.billingIntervalSeconds === plan.periodSeconds
                    : false;
                  let isUnavailableChange = false;
                  if (activeSubscription) {
                    try {
                      isUnavailableChange = compareRecurringRates(
                        BigInt(plan.amountUsdc),
                        BigInt(plan.periodSeconds),
                        BigInt(activeSubscription.amountCapUsdc),
                        BigInt(activeSubscription.billingIntervalSeconds),
                      ) <= 0;
                    } catch {
                      isUnavailableChange = true;
                    }
                  }
                  /* Nothing transacts from this card any more, so there is no per-plan busy state to
                     track. Subscribing starts from the link in the merchant's message. */
                  const commitmentDays = plan.minCommitmentSeconds
                    ? Math.max(1, Math.round(Number(plan.minCommitmentSeconds) / 86_400))
                    : 0;
                  /* A one-line version of the disclosure the checkout page spells out in full. The
                     card is a compact grid cell, so it states the offer and the price it reverts to
                     and leaves the dates to checkout. */
                  const promo = plan.promotion;
                  const promoSpan = promo
                    ? promo.introductoryCycles > 1
                      ? `first ${promo.introductoryCycles} cycles`
                      : `first ${formatPlanPeriod(plan.periodSeconds)}`
                    : "";
                  const promoLine = promo
                    ? BigInt(promo.introductoryAmountUsdc) === BigInt(0)
                      ? `${promo.name}: your ${promoSpan} free, then ${formatUsdc(plan.amountUsdc)} USDC / ${formatPlanPeriod(plan.periodSeconds)}.`
                      : `${promo.name}: ${formatUsdc(promo.introductoryAmountUsdc)} USDC for your ${promoSpan}, then ${formatUsdc(plan.amountUsdc)} USDC / ${formatPlanPeriod(plan.periodSeconds)}.`
                    : "";
                  /* A higher tier the subscriber could move to, but not from here.
                   *
                   * The DM plan list is a catalogue of what the business offers, not a switcher. An
                   * upgrade is settled at checkout, and the business decides where that starts — so the
                   * action is the merchant's own page (its plan `detailsUrl`), and checking out there is
                   * what upgrades them. Rendering an in-thread upgrade button instead would put SubScript
                   * in the middle of a decision the business owns, and for a subscriber who had ever
                   * resumed it would have failed on-chain anyway (the PSA reads the new terms against the
                   * bridge period and reverts). */
                  const isUpgradePath = hasActiveSubscription && !isCurrent && !isUnavailableChange;
                  const merchantPlanHost = linkHostname(plan.detailsUrl);
                  return (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 10, scale: 0.92, filter: "blur(1.2px)" }}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                      transition={{ type: "spring", stiffness: 420, damping: 30, delay: index * 0.04 }}
                      whileHover={{ scale: 1.025, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      className="rounded-xl border border-black/10 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black uppercase tracking-[0.08em] text-[#111827]">{plan.name}</p>
                          <p className="mt-1 text-[10px] font-bold text-[#2775CA]">
                            {formatUsdc(plan.amountUsdc)} USDC / {formatPlanPeriod(plan.periodSeconds)}
                          </p>
                          {plan.description && (
                            <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-black/60">
                              {plan.description}
                            </p>
                          )}
                          {/* Both of these come back from /api/merchant/plans and were being dropped
                              on the floor. They are exactly the terms someone browsing plans needs
                              before they decide, and the checkout page already discloses them. */}
                          {promoLine && (
                            <p className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold leading-relaxed text-emerald-800">
                              {promoLine}
                            </p>
                          )}
                          {commitmentDays > 0 && (
                            <p className="mt-2 text-[9px] font-bold leading-relaxed text-amber-800">
                              {commitmentDays}-day minimum. Cancel sooner and it takes effect at the end of the period you&apos;ve paid for.
                            </p>
                          )}
                          {plan.detailsUrl && !isUpgradePath && (
                            <a
                              href={plan.detailsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#2775CA] hover:underline"
                            >
                              View full plan <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {isCurrent && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                            className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-emerald-700"
                          >
                            Current
                          </motion.span>
                        )}
                      </div>
                      {isUpgradePath && (
                        plan.detailsUrl ? (
                          /* The business's own page. Checking out there is what upgrades them — the
                             checkout credits the time they have already paid for. */
                          <motion.a
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.93 }}
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                            href={plan.detailsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-black/20 bg-[#D5E3EE] px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#111827] shadow-sm transition hover:bg-[#c2d7e6]"
                          >
                            {merchantPlanHost ? `View on ${merchantPlanHost}` : "View on merchant site"}
                            <ExternalLink className="h-3 w-3" />
                          </motion.a>
                        ) : (
                          /* No link published, so there is nowhere to send them. Said plainly rather
                             than rendered as a button that cannot do anything. */
                          <p className="mt-3 rounded-xl border border-dashed border-black/15 bg-black/[0.02] px-3 py-2 text-center text-[9px] font-bold uppercase tracking-[0.1em] text-black/40">
                            Switch to this plan on the merchant&apos;s site
                          </p>
                        )
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}

            {status && <p className="text-[10px] font-bold text-[#ccff00]">{status}</p>}
            {error && <p className="text-[10px] font-bold text-red-300">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function DmRequestComposer({
  open,
  amount,
  note,
  duration,
  billingType = "ONE_TIME",
  interval = "monthly",
  status,
  loading,
  onToggle,
  onSubmit,
  onAmountChange,
  onNoteChange,
  onDurationChange,
  onBillingTypeChange,
  onIntervalChange,
}: {
  open: boolean;
  amount: string;
  note: string;
  duration: (typeof dmRequestDurationOptions)[number]["value"];
  billingType?: "ONE_TIME" | "RECURRING";
  interval?: "monthly" | "weekly" | "daily" | "yearly";
  status: string | null;
  loading: boolean;
  onToggle: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onAmountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onDurationChange: (value: (typeof dmRequestDurationOptions)[number]["value"]) => void;
  onBillingTypeChange?: (value: "ONE_TIME" | "RECURRING") => void;
  onIntervalChange?: (value: "monthly" | "weekly" | "daily" | "yearly") => void;
}) {
  return (
    <div className="space-y-3">
      <AnimatePresence>
        {open && (
          <motion.form
            key="dm-request-form"
            initial={{ opacity: 0, y: 24, scaleY: 0.7, scaleX: 0.94, filter: "blur(1.5px)" }}
            animate={{ opacity: 1, y: 0, scaleY: 1, scaleX: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 16, scaleY: 0.8, scaleX: 0.96, filter: "blur(1.5px)" }}
            transition={{ type: "spring", stiffness: 450, damping: 32 }}
            style={{ transformOrigin: "bottom center" }}
            onSubmit={onSubmit}
            className="max-h-[min(55dvh,30rem)] overflow-y-auto overscroll-contain rounded-[28px] border border-black/10 bg-white/95 p-4 shadow-xl backdrop-blur-xl text-black"
          >
            {/* Request Type Selector */}
            <div className="mb-3 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-[0.14em] text-black/60">Request Type</label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-black/[0.04] border border-black/10">
                <button
                  type="button"
                  onClick={() => onBillingTypeChange && onBillingTypeChange("ONE_TIME")}
                  className={`py-1.5 px-3 rounded-xl text-xs font-bold transition ${billingType === "ONE_TIME" ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black"}`}
                >
                  One-Time
                </button>
                <button
                  type="button"
                  onClick={() => onBillingTypeChange && onBillingTypeChange("RECURRING")}
                  className={`py-1.5 px-3 rounded-xl text-xs font-bold transition ${billingType === "RECURRING" ? "bg-[#2775CA] text-white shadow-sm" : "text-black/60 hover:text-black"}`}
                >
                  Recurring
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={billingType === "RECURRING" ? "Recurring USDC" : "Amount"}>
                <input
                  value={amount}
                  onChange={(event) => onAmountChange(event.target.value)}
                  placeholder="25.00"
                  inputMode="decimal"
                  className="subscript-input bg-white border border-black/15 text-[#111827]"
                  required
                />
              </Field>
              {billingType === "RECURRING" ? (
                <Field label="Frequency">
                  <select
                    value={interval}
                    onChange={(event) => onIntervalChange && onIntervalChange(event.target.value as any)}
                    className="subscript-input bg-white border border-black/15 text-[#111827]"
                  >
                    <option value="monthly">Monthly (30d)</option>
                    <option value="weekly">Weekly (7d)</option>
                    <option value="daily">Daily (24h)</option>
                    <option value="yearly">Yearly (365d)</option>
                  </select>
                </Field>
              ) : (
                <Field label="Valid for">
                  <select
                    value={duration}
                    onChange={(event) => onDurationChange(event.target.value as (typeof dmRequestDurationOptions)[number]["value"])}
                    className="subscript-input bg-white border border-black/15 text-[#111827]"
                  >
                    {dmRequestDurationOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <div className="mt-3">
              <Field label="Memo">
                <textarea
                  value={note}
                  onChange={(event) => onNoteChange(event.target.value)}
                  placeholder={billingType === "RECURRING" ? "What is this recurring subscription for?" : "What is this request for?"}
                  rows={2}
                  className="subscript-input bg-white border border-black/15 text-[#111827] resize-none"
                />
              </Field>
            </div>
            {status && (
              <div className="mt-3 rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#2775CA]">
                {status}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                type="button"
                onClick={onToggle}
                disabled={loading}
                className="rounded-2xl border border-black/15 bg-white text-black hover:bg-black/5 py-2.5 text-xs font-bold transition shadow-sm"
              >
                Cancel
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                type="submit"
                disabled={loading}
                className={`rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-2.5 text-xs font-bold transition shadow-sm ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                Send
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {status && !open && (
        <div className="rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/10 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-[#2775CA]">
          {status}
        </div>
      )}

      {/* Styled to match the app's bottom nav capsule — a persistent action bar. */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 450, damping: 32 }}
        type="button"
        onClick={onToggle}
        disabled={loading}
        className={`relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full border py-2 text-center text-[11px] font-black uppercase tracking-[0.16em] shadow-sm backdrop-blur-lg transition-all ${
          open
            ? "border-[#2775CA]/40 bg-[#2775CA]/15 text-[#2775CA]"
            : "border-black/15 bg-white text-black hover:bg-black/5"
        }`}
      >
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 450, damping: 32 }}
          className={`grid h-5 w-5 place-items-center rounded-full text-sm leading-none ${open ? "bg-[#2775CA]/20 text-[#2775CA]" : "bg-[#2775CA]/15 text-[#2775CA]"}`}
        >
          +
        </motion.span>
        {loading ? "Sending Request" : open ? "Close" : "Request"}
      </motion.button>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-black uppercase tracking-tight text-[#111827]">{title}</h1>
      <p className="mt-1 text-xs text-black/60">{subtitle}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-black/50">{label}</span>
      {children}
    </label>
  );
}

function DepositModal({
  open,
  userWallet,
  copied,
  onCopy,
  onClose,
  originBalances,
  hasExternalUsdc,
  chainId,
  switchChainAsync,
  writeContractAsync,
  refetchBalances,
}: {
  open: boolean;
  userWallet: string | null;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  originBalances: DepositOriginBalance[];
  hasExternalUsdc: boolean;
  chainId: number | undefined;
  switchChainAsync: any;
  writeContractAsync: any;
  refetchBalances: () => void;
}) {
  const [activeSubMode, setActiveSubMode] = useState<"menu" | "direct" | "cctp">("menu");

  /* The CCTP bridge burns USDC on the origin chain through the browser wallet (switchChain +
     writeContract via wagmi), so it is an external-wallet feature and disappears with the rest
     of them when an operator pauses external wallets. Leaving the Bridge tab up would walk the
     user to a network switch that cannot complete — and unlike signing in, this one starts by
     moving real money. Presentation only, as ever: the burn happens in the user's own wallet,
     so this hides a dead end rather than enforcing a boundary.

     bridgeAvailable is computed below, once pendingRegistration is known — see the comment there for
     why a paused bridge must still let an interrupted one finish. */
  const { externalWalletEnabled } = usePlatformFlags();

  // CCTP State
  const [cctpAmount, setCctpAmount] = useState("");
  const [originChainId, setOriginChainId] = useState<number | null>(null);
  const [originMenuOpen, setOriginMenuOpen] = useState(false);
  const [cctpStatus, setCctpStatus] = useState<
    "idle" | "switching" | "paying_fee" | "approving" | "burning" | "registering" | "submitted" | "error"
  >("idle");
  const [cctpMessage, setCctpMessage] = useState<string | null>(null);
  const [cctpError, setCctpError] = useState<string | null>(null);
  const [cctpReviewOpen, setCctpReviewOpen] = useState(false);

  /* A burn we have not managed to tell the backend about yet. The burn is irreversible and the keeper
     cannot relay what it has never seen, so this survives a reload and the modal offers to finish
     registering rather than inviting a second burn. */
  const [pendingRegistration, setPendingRegistration] = useState<{
    burnTxHash: `0x${string}`;
    feeTxHash?: `0x${string}`;
    originChainId: number;
    grossAmountMicros: string;
    amount: string;
  } | null>(null);

  const fundedOrigins = originBalances.filter((chain) => chain.balance > 0);
  /* No initialising effect: the fallback chain here *is* the default, so an untouched picker already
     shows the funded network with the cheapest fee. */
  const selectedOrigin =
    originBalances.find((chain) => chain.chainId === originChainId) ?? fundedOrigins[0] ?? originBalances[0] ?? null;
  const bridgeableUsdc = selectedOrigin?.balance ?? 0;
  const cctpInProgress = !["idle", "submitted", "error"].includes(cctpStatus);
  const cctpRecoveryKey = userWallet ? `subscript:cctp-recovery:${userWallet.toLowerCase()}` : null;

  /* Quote straight from the fee engine the server charges with, so the "you'll be credited" figure
     cannot drift from the amount that actually arrives. */
  const cctpQuote = (() => {
    if (!selectedOrigin || !cctpAmount) return null;
    try {
      return calculateBridgeFee(
        parseUnits(limitDecimals(cctpAmount, 6), 6),
        selectedOrigin.chainId,
        "inbound_deposit",
      );
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (!open || !cctpRecoveryKey) return;
    try {
      const stored = window.localStorage.getItem(cctpRecoveryKey);
      setPendingRegistration(stored ? JSON.parse(stored) : null);
    } catch {
      setPendingRegistration(null);
    }
  }, [open, cctpRecoveryKey]);

  /* When external wallets are turned off, the bridge feature is hidden entirely. */
  const bridgeAvailable = externalWalletEnabled;

  // Reset sub-mode when modal opens
  useEffect(() => {
    if (open) {
      /* An unregistered burn is the most urgent thing in this modal, so land on it directly.
         Otherwise: with the bridge unavailable Direct is the only destination, and a chooser
         menu listing one option is just an extra click. */
      if (pendingRegistration) {
        setActiveSubMode("cctp");
      } else if (hasExternalUsdc && bridgeAvailable) {
        setActiveSubMode("menu");
      } else {
        setActiveSubMode("direct");
      }
    }
  }, [open, hasExternalUsdc, bridgeAvailable, pendingRegistration]);

  /* Covers the flag flipping while the modal is already open on the bridge pane. */
  useEffect(() => {
    if (!bridgeAvailable && activeSubMode === "cctp") setActiveSubMode("direct");
  }, [bridgeAvailable, activeSubMode]);

  /**
   * Tells the backend about a burn so the keeper can relay it onto Arc. Retried, and the burn is
   * parked in localStorage until it lands: an unregistered burn is money in flight that nothing is
   * watching.
   */
  const registerDeposit = async (record: NonNullable<typeof pendingRegistration>) => {
    setCctpStatus("registering");
    setCctpMessage("Handing the transfer to Circle...");

    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch("/api/user/cctp/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originChainId: record.originChainId,
            grossAmountMicros: record.grossAmountMicros,
            burnTxHash: record.burnTxHash,
            feeTxHash: record.feeTxHash,
          }),
        });
        if (res.ok) {
          if (cctpRecoveryKey) window.localStorage.removeItem(cctpRecoveryKey);
          setPendingRegistration(null);
          setCctpStatus("submitted");
          setCctpMessage(null);
          setCctpAmount("");
          setCctpReviewOpen(false);
          refetchBalances();
          return;
        }
        const data = await res.json().catch(() => ({}));
        lastError = data.error || `Server said ${res.status}`;
      } catch (error: any) {
        lastError = error?.message || "Network error";
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }

    throw new Error(
      `Your USDC was sent but we couldn't record it (${lastError}). Reopen this screen to finish, or contact support with ${record.burnTxHash.slice(0, 10)}…`,
    );
  };

  const handleResumeRegistration = async () => {
    if (!pendingRegistration) return;
    setCctpError(null);
    try {
      await registerDeposit(pendingRegistration);
    } catch (error: any) {
      setCctpStatus("error");
      setCctpError(error.message || "We couldn't record that transfer.");
    }
  };

  const handleStartCctp = async (bridgeAmountStr: string) => {
    setCctpError(null);

    if (!selectedOrigin) {
      setCctpError("Pick the network your USDC is on.");
      return;
    }
    if (!bridgeAmountStr || isNaN(Number(bridgeAmountStr)) || Number(bridgeAmountStr) <= 0) {
      setCctpError("Enter an amount to deposit.");
      return;
    }
    if (Number(bridgeAmountStr) > selectedOrigin.balance) {
      setCctpError(
        `You have ${selectedOrigin.balance.toFixed(2)} USDC on ${selectedOrigin.name}, which isn't enough.`,
      );
      return;
    }

    const originConfig = CCTP_CONFIG[selectedOrigin.chainId];
    if (!originConfig) {
      setCctpError(`We don't support deposits from ${selectedOrigin.name} yet.`);
      return;
    }

    let fee;
    try {
      fee = calculateBridgeFee(
        parseUnits(limitDecimals(bridgeAmountStr, 6), 6),
        selectedOrigin.chainId,
        "inbound_deposit",
      );
    } catch (quoteError: any) {
      setCctpError(quoteError.message || "That amount can't be deposited.");
      return;
    }

    if (!cctpReviewOpen) {
      setCctpReviewOpen(true);
      return;
    }

    const originClient = originPublicClient(selectedOrigin.chainId);

    try {
      /* Step 1: get onto the origin chain. */
      setCctpStatus("switching");
      setCctpMessage(`Switching your wallet to ${selectedOrigin.name}...`);
      if (chainId !== selectedOrigin.chainId) {
        await switchChainAsync({ chainId: selectedOrigin.chainId });
      }

      /* Step 2: pay the protocol fee on the origin chain, before anything is burned.
         CCTP mints exactly what it burns, so a fee not taken here is never taken at all. Doing it
         first also means a revert costs the user nothing: no burn has happened yet. */
      let feeTxHash: `0x${string}` | undefined;
      if (fee.feeMicros > 0n) {
        setCctpStatus("paying_fee");
        setCctpMessage(`Collecting the ${fee.feePercentage} bridge fee...`);
        feeTxHash = await writeContractAsync({
          address: originConfig.usdc,
          abi: CCTP_ERC20_ABI,
          functionName: "transfer",
          args: [BRIDGE_FEE_TREASURY_ADDRESS, fee.feeMicros],
          chainId: selectedOrigin.chainId,
        });
        const feeReceipt = await originClient.waitForTransactionReceipt({ hash: feeTxHash!, timeout: 240_000 });
        if (feeReceipt.status !== "success") {
          throw new Error("The fee payment didn't go through. Nothing was deposited.");
        }
      }

      /* Step 3: approve exactly the net. Approving the gross would leave the TokenMessenger able to
         pull the fee portion afterwards. */
      setCctpStatus("approving");
      setCctpMessage(`Approving ${formatMicros(fee.netMicros)} USDC on ${selectedOrigin.name}...`);
      const approveHash = await writeContractAsync({
        address: originConfig.usdc,
        abi: CCTP_ERC20_ABI,
        functionName: "approve",
        args: [originConfig.tokenMessenger, fee.netMicros],
        chainId: selectedOrigin.chainId,
      });
      const approveReceipt = await originClient.waitForTransactionReceipt({ hash: approveHash, timeout: 240_000 });
      if (approveReceipt.status !== "success") {
        throw new Error("The approval didn't go through. Nothing was deposited.");
      }

      /* Step 4: burn the net, with your Arc wallet as the mint recipient. */
      setCctpStatus("burning");
      setCctpMessage(`Sending ${formatMicros(fee.netMicros)} USDC to Arc...`);
      const burnTxHash: `0x${string}` = await writeContractAsync({
        address: originConfig.tokenMessenger,
        abi: CCTP_TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurn",
        args: [
          fee.netMicros,
          ARC_CCTP_DOMAIN_ID,
          toBytes32Address(userWallet!),
          originConfig.usdc,
          ANY_DESTINATION_CALLER,
          0n,
          CCTP_FINALITY_STANDARD,
        ],
        chainId: selectedOrigin.chainId,
      });
      const burnReceipt = await originClient.waitForTransactionReceipt({ hash: burnTxHash, timeout: 240_000 });
      if (burnReceipt.status !== "success") {
        throw new Error(`The transfer failed on ${selectedOrigin.name}.`);
      }

      /* Park the burn locally before telling the backend. From here on the money has left the origin
         chain and only our keeper can deliver it, so a reload has to be able to finish registering
         rather than tempting the user into a second burn. */
      const record = {
        burnTxHash,
        feeTxHash,
        originChainId: selectedOrigin.chainId,
        grossAmountMicros: fee.grossMicros.toString(),
        amount: bridgeAmountStr,
      };
      if (cctpRecoveryKey) window.localStorage.setItem(cctpRecoveryKey, JSON.stringify(record));
      setPendingRegistration(record);

      /* Step 5: hand it to the keeper. It polls Circle and mints on Arc, which is also what sends the
         "moving to Arc" and "arrived" notifications. Minting from the browser instead would race the
         keeper for the same nonce and leave one of them reverting forever. */
      await registerDeposit(record);
    } catch (err: any) {
      console.error(err);
      setCctpStatus("error");
      if (err.message?.includes("User rejected the request")) {
        setCctpError("You cancelled the signature, so nothing was sent.");
      } else {
        setCctpError(err.message || "We couldn't complete that deposit.");
      }
    }
  };

  useEffect(() => {
    if (!cctpInProgress) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [cctpInProgress]);

  const closeDepositModal = () => {
    if (cctpInProgress) return;
    onClose();
  };

  /* Mobile thumb-swipe across the Direct / Bridge deposit modes. Off on the chooser menu. */
  const depositSwipe = useSwipeTabs(
    ["direct", "cctp"] as const,
    activeSubMode as "direct" | "cctp",
    (mode) => {
      setActiveSubMode(mode);
      setCctpStatus("idle");
    },
    { enabled: activeSubMode !== "menu" && !cctpInProgress && bridgeAvailable },
  );
  const [prevActiveSubMode, setPrevActiveSubMode] = useState<"menu" | "direct" | "cctp">("menu");
  if (activeSubMode !== prevActiveSubMode) {
    setPrevActiveSubMode(activeSubMode);
  }
  const subModes = ["menu", "direct", "cctp"] as const;
  const subIndex = subModes.indexOf(activeSubMode);
  const prevSubIndex = subModes.indexOf(prevActiveSubMode);
  const subDirection = subIndex >= prevSubIndex ? 1 : -1;

  return (
    <AnimatePresence>
      {open && userWallet && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 sm:p-5 backdrop-blur-md">
          <motion.div initial={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} animate={{ scale: 1, y: 0, filter: "blur(0px)" }} exit={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} transition={{ type: "spring", stiffness: 450, damping: 32 }} role="dialog" aria-modal="true" aria-labelledby="deposit-dialog-title" className="relative flex flex-col max-h-[85vh] sm:max-h-[90vh] w-full max-w-sm overflow-hidden rounded-3xl border border-black/10 bg-[#FFFFF0] text-black p-5 sm:p-6 shadow-2xl" {...depositSwipe}>
            {/* Header (Pinned) */}
            <div className="shrink-0 flex items-center justify-between mb-3 border-b border-black/10 pb-3">
              <h3 id="deposit-dialog-title" className="text-sm font-black uppercase tracking-wider text-[#111827]">
                {activeSubMode === "menu" ? "Deposit USDC" : activeSubMode === "direct" ? "Direct Deposit" : "Circle CCTP Bridge"}
              </h3>
              <button type="button" onClick={closeDepositModal} disabled={cctpInProgress} aria-label="Close deposit dialog" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black/60 hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-30 transition-all"><X className="h-4 w-4" /></button>
            </div>
            
            {/* Tabs for non-menu active modes (Pinned) */}
            {activeSubMode !== "menu" && bridgeAvailable && (
              <div className="shrink-0 relative mb-4 grid grid-cols-2 w-full gap-1 rounded-2xl bg-black/5 p-1 border border-black/10">
                {(["direct", "cctp"] as const).map((tab) => {
                  const isActive = activeSubMode === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      disabled={cctpInProgress}
                      onClick={() => {
                        setActiveSubMode(tab);
                        setCctpStatus("idle");
                      }}
                      className={`relative flex items-center justify-center py-2 px-3 text-[10px] font-black uppercase tracking-wider rounded-xl z-10 transition-colors duration-200 ${
                        isActive ? "text-white" : "text-black/60 hover:text-black"
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="depositActivePill"
                          className="absolute inset-0 bg-[#353935] rounded-xl -z-10 shadow-sm"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-20">
                        {tab === "direct" ? "Direct" : "Bridge"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Scrollable Body Content */}
            <div className="flex-1 overflow-y-auto min-h-0 w-full relative pr-0.5 custom-scrollbar text-black">
              <AnimatePresence mode="wait" initial={false} custom={subDirection}>
                <motion.div
                  key={activeSubMode}
                  custom={subDirection}
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
                  {activeSubMode === "menu" && (
              <div className="space-y-4 py-1">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#353935] p-2.5 shadow-md">
                  <img src="/logo.png" alt="SubScript Logo" className="h-full w-full object-contain" />
                </div>
                <div className="rounded-3xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-left space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-yellow-800">What deposits cost</p>
                  <p className="text-[11px] text-black/80 leading-relaxed">
                    Sending USDC that&apos;s already on Arc is free. Bringing it in from another chain costs{" "}
                    <strong>{formatFeeBps(50)}</strong> from Base, Arbitrum, Optimism and Polygon, or{" "}
                    <strong>{formatFeeBps(100)}</strong> from Ethereum, which covers the gas we pay to deliver it.
                  </p>
                </div>
                <div className="space-y-3 pt-1">
                  {bridgeAvailable && (
                  <button
                    type="button"
                    onClick={() => setActiveSubMode("cctp")}
                    disabled={!hasExternalUsdc}
                    className="flex w-full items-center gap-4 rounded-3xl border border-black/15 bg-white p-4 text-left hover:bg-black/5 transition-all group shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2775CA] text-white group-hover:scale-105 transition-all shrink-0">
                      <Globe className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black uppercase tracking-wider text-[#111827]">Bring USDC from another chain</h4>
                      <p className="mt-1 text-[9px] text-black/60 leading-normal">
                        {hasExternalUsdc
                          ? `Up to ${originBalances.reduce((sum, chain) => sum + chain.balance, 0).toFixed(2)} USDC across ${fundedOrigins.length === 1 ? fundedOrigins[0].name : `${fundedOrigins.length} networks`}.`
                          : "We didn't find USDC on any supported network."}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-black/40 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveSubMode("direct")}
                    className="flex w-full items-center gap-4 rounded-3xl border border-black/15 bg-white p-4 text-left hover:bg-black/5 transition-all group shadow-sm"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#353935] text-[#FFFFF0] group-hover:scale-105 transition-all shrink-0">
                      <Wallet className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black uppercase tracking-wider text-[#111827]">Receive on Arc</h4>
                      <p className="mt-1 text-[9px] text-black/60 leading-normal">Show your address and QR code. No fee.</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-black/40 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>
                </div>
              </div>
            )}

            {activeSubMode === "direct" && (
              <div className="text-center space-y-2.5 py-1">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#353935] p-2.5 shadow-md">
                  <img src="/logo.png" alt="SubScript Logo" className="h-full w-full object-contain" />
                </div>
                <p className="text-[11px] text-black/70 leading-tight">Send native USDC on Arc Testnet to your SubScript wallet address.</p>
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-900">Arc Testnet only. Sending another token or using another network will not credit this balance.</p>
                <div className="mx-auto my-2 w-fit rounded-2xl bg-white p-3 shadow-md border border-black/10">
                  <QRCode
                    value={userWallet}
                    size={140}
                    ecLevel="H"
                    bgColor="#ffffff"
                    fgColor="#000000"
                    qrStyle="dots"
                    eyeRadius={[
                      [10, 10, 0, 10],
                      [10, 10, 10, 0],
                      [10, 0, 10, 10]
                    ]}
                    logoImage="/logo.png"
                    logoWidth={30}
                    logoHeight={30}
                    removeQrCodeBehindLogo={true}
                    logoPadding={2}
                  />
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-black transition-all ${
                    copied
                      ? "border-[#2775CA] bg-[#2775CA] text-white"
                      : "border-black/15 bg-white text-[#111827] hover:bg-black/5"
                  }`}
                >
                  {copied ? <Check className="h-4 w-4 text-white" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied to clipboard!" : formatAddress(userWallet)}
                </button>
              </div>
            )}

            {activeSubMode === "cctp" && (
              <div className="space-y-4 text-left">
                {selectedOrigin && (
                  <div className="flex justify-between items-center">
                    <span className="rounded-full bg-[#2775CA]/10 px-3 py-1 text-[9px] font-bold text-[#2775CA] border border-[#2775CA]/20">
                      {selectedOrigin.balance.toFixed(2)} USDC on {selectedOrigin.name}
                    </span>
                  </div>
                )}

                {cctpStatus === "idle" ? (
                  <div className="space-y-4">
                    {pendingRegistration && (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[10px] leading-relaxed text-amber-900">
                        <p className="font-bold uppercase tracking-wider text-amber-950">Unfinished deposit</p>
                        <p className="mt-2">
                          {pendingRegistration.amount} USDC already left{" "}
                          {CCTP_CONFIG[pendingRegistration.originChainId]?.name || "the origin chain"}, but we never
                          managed to record it. Finish here and it will land on Arc. Don&apos;t send again.
                        </p>
                      </div>
                    )}

                    {!pendingRegistration && (
                      <>
                        {originBalances.length === 0 ? (
                          <p className="rounded-xl border border-black/10 bg-black/5 p-3 text-[10px] leading-relaxed text-black/70">
                            No supported networks are configured for deposits right now.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">
                              Where is your USDC?
                            </span>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setOriginMenuOpen(!originMenuOpen)}
                                aria-expanded={originMenuOpen}
                                className="flex w-full items-center justify-between rounded-2xl border border-black/15 bg-white px-4 py-3 text-left text-xs font-bold text-[#111827] shadow-sm transition hover:bg-black/[0.02]"
                              >
                                <span className="flex flex-col">
                                  <span>{selectedOrigin?.name ?? "Pick a network"}</span>
                                  {/* The fee for this chain, right under its name. */}
                                  <span className="text-[10px] font-normal text-black/50">
                                    {selectedOrigin
                                      ? `${selectedOrigin.feePercentage} fee · ${selectedOrigin.balance.toFixed(2)} USDC available`
                                      : ""}
                                  </span>
                                </span>
                                <ChevronDown className="h-4 w-4 shrink-0 text-black/40" />
                              </button>

                              {originMenuOpen && (
                                <div className="custom-scrollbar absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl">
                                  {originBalances.map((chain) => {
                                    const isSelected = selectedOrigin?.chainId === chain.chainId;
                                    const empty = chain.balance <= 0;
                                    return (
                                      <button
                                        key={chain.chainId}
                                        type="button"
                                        disabled={empty}
                                        onClick={() => {
                                          setOriginChainId(chain.chainId);
                                          setOriginMenuOpen(false);
                                          setCctpReviewOpen(false);
                                          setCctpError(null);
                                        }}
                                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                                          empty
                                            ? "cursor-not-allowed text-black/35"
                                            : isSelected
                                              ? "bg-[#2775CA]/10 font-bold text-[#2775CA]"
                                              : "text-black hover:bg-black/5"
                                        }`}
                                      >
                                        <span className="min-w-0">
                                          <span className="block truncate">{chain.name}</span>
                                          <span className="block text-[10px] font-normal text-black/50">
                                            {chain.feePercentage} fee
                                            {empty ? " · nothing here" : ` · ${chain.balance.toFixed(2)} USDC`}
                                          </span>
                                        </span>
                                        {isSelected && !empty && (
                                          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2775CA]" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">
                            Amount (USDC)
                          </span>
                          <div className="relative">
                            <input
                              type="number"
                              value={cctpAmount}
                              onChange={(e) => { setCctpAmount(e.target.value); setCctpReviewOpen(false); setCctpError(null); }}
                              className="subscript-input bg-white border border-black/15 text-[#111827] pr-16"
                              placeholder="0.00"
                            />
                            <button
                              type="button"
                              onClick={() => { setCctpAmount(bridgeableUsdc.toString()); setCctpReviewOpen(false); }}
                              className="absolute right-3 top-2.5 px-2 py-1 rounded bg-black/10 text-[9px] font-black uppercase tracking-wider text-black hover:bg-black/20 transition-all"
                            >
                              Max
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {cctpError && <p className="text-[11px] text-red-700 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{cctpError}</p>}

                    {/* What lands on Arc, once the fee comes off. Quoted from the same engine the
                        server charges with, so this figure is what actually arrives. */}
                    {cctpReviewOpen && !pendingRegistration && cctpQuote && selectedOrigin && (
                      <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-black">
                        <div className="flex justify-between"><span className="text-black/60">From</span><span className="font-bold">{selectedOrigin.name}</span></div>
                        <div className="flex justify-between"><span className="text-black/60">To</span><span className="font-bold">Your Arc wallet</span></div>
                        <div className="flex justify-between"><span className="text-black/60">You deposit</span><span className="font-bold">{formatMicros(cctpQuote.grossMicros)} USDC</span></div>
                        <div className="flex justify-between font-medium text-amber-900">
                          <span>Bridge fee ({cctpQuote.feePercentage})</span>
                          <span>-{formatMicros(cctpQuote.feeMicros, 4)} USDC</span>
                        </div>
                        <div className="flex justify-between border-t border-black/10 pt-2 font-bold">
                          <span>Credited on Arc</span>
                          <span className="text-[#2775CA]">{formatMicros(cctpQuote.netMicros, 4)} USDC</span>
                        </div>
                        <p className="border-t border-black/10 pt-3 text-[10px] leading-relaxed text-amber-900">
                          You&apos;ll sign {cctpQuote.feeMicros > 0n ? "three transactions" : "two transactions"} on{" "}
                          {selectedOrigin.name}. After that you can close this: we&apos;ll notify you when the USDC lands
                          on Arc, usually within {selectedOrigin.isL1 ? "fifteen minutes" : "five minutes"}.
                        </p>
                        <button type="button" onClick={() => setCctpReviewOpen(false)} className="text-[10px] font-bold uppercase tracking-wider text-black/60 hover:text-black">Back to edit</button>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={!pendingRegistration && (!selectedOrigin || !cctpQuote)}
                      onClick={() => pendingRegistration ? handleResumeRegistration() : handleStartCctp(cctpAmount)}
                      className="w-full mt-2 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] disabled:cursor-not-allowed disabled:opacity-50 text-white py-3 font-bold text-xs shadow-sm transition flex items-center justify-center gap-2"
                    >
                      {pendingRegistration ? "Finish this deposit" : cctpReviewOpen ? "Confirm deposit" : "Review deposit"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5 py-4">
                    {cctpStatus === "submitted" ? (
                      <div className="flex flex-col items-center gap-4 text-center">
                        <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-[#111827]">On its way</h4>
                        <p className="text-xs leading-normal text-black/60">
                          Your USDC has left {selectedOrigin?.name ?? "the origin chain"}. We&apos;ll drop you a
                          notification the moment it lands on Arc, usually within five minutes. You can close this.
                        </p>
                        <button
                          type="button"
                          onClick={() => { setCctpStatus("idle"); setCctpError(null); }}
                          className="mt-4 rounded-xl border border-black/15 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wider text-black shadow-sm"
                        >
                          Done
                        </button>
                      </div>
                    ) : cctpStatus === "error" ? (
                      <div className="flex flex-col items-center gap-4 text-center">
                        <AlertCircle className="h-12 w-12 text-red-500" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-[#111827]">That didn&apos;t work</h4>
                        <p className="px-4 text-xs leading-normal text-red-700">{cctpError}</p>
                        <button
                          type="button"
                          onClick={() => setCctpStatus("idle")}
                          className="mt-4 rounded-xl border border-black/15 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wider text-black shadow-sm"
                        >
                          {pendingRegistration ? "Finish this deposit" : "Try again"}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="flex items-center gap-4 rounded-2xl border border-black/10 bg-black/5 p-4">
                          <Loader2 className="h-6 w-6 shrink-0 animate-spin text-[#2775CA]" />
                          <div className="space-y-1">
                            <p className="text-xs font-bold uppercase tracking-wider text-black">Depositing</p>
                            <p className="text-[10px] leading-normal text-black/60">{cctpMessage}</p>
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-black/10 pt-4 text-[10px] font-bold text-black/60">
                          {([
                            ["switching", `Switch to ${selectedOrigin?.name ?? "the origin chain"}`],
                            ["paying_fee", "Collect the bridge fee"],
                            ["approving", "Approve the transfer"],
                            ["burning", "Send the USDC"],
                            ["registering", "Hand it to Circle"],
                          ] as const).map(([step, label], index) => (
                            <div
                              key={step}
                              className={`flex items-center justify-between ${cctpStatus === step ? "text-[#2775CA]" : ""}`}
                            >
                              <span>{index + 1}. {label}</span>
                              <span>{cctpStatus === step ? "In progress" : ""}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SendFundsModal({
  open,
  recipient,
  onClose,
  onGoToBatch,
  walletBalance,
  elsewhereUsdc,
  userWallet,
  isEmbeddedWalletSession,
  chainId,
  switchChainAsync,
  writeContractAsync,
  onScanQr,
  refetchUsdc,
}: {
  open: boolean;
  recipient: string;
  onClose: () => void;
  onGoToBatch?: () => void;
  walletBalance: number;
  elsewhereUsdc: number;
  userWallet: string | null;
  isEmbeddedWalletSession: boolean;
  chainId: number | undefined;
  switchChainAsync: (parameters: { chainId: number }) => Promise<unknown>;
  writeContractAsync: any;
  onScanQr?: () => void;
  refetchUsdc: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [localRecipient, setLocalRecipient] = useState(recipient);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const isSelfSend = Boolean(resolvedAddress && userWallet && resolvedAddress.toLowerCase() === userWallet.toLowerCase());

  useEffect(() => {
    if (!open) return;
    setLocalRecipient(recipient);
    setAmount("");
  }, [open, recipient]);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setResolvedAddress(null);
    setReviewOpen(false);
    setTransactionHash(null);

    const trimmed = localRecipient.trim().toLowerCase();
    if (!trimmed) return;

    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      setResolvedAddress(trimmed);
      return;
    }

    setResolving(true);
    const timer = setTimeout(() => {
      fetch(`/api/merchant/alias?alias=${encodeURIComponent(trimmed)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.address) {
            setResolvedAddress(data.address);
          }
        })
        .catch(console.error)
        .finally(() => setResolving(false));
    }, 500);

    return () => {
      clearTimeout(timer);
      setResolving(false);
    };
  }, [open, localRecipient]);

  /* Stable per send attempt: reused on retry so the server's Circle idempotency key dedupes
     instead of transferring twice; cleared on success. */
  const sendRequestKey = useRef<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedAddress) {
      setStatus("Recipient address is not resolved.");
      return;
    }
    if (userWallet && resolvedAddress.toLowerCase() === userWallet.toLowerCase()) {
      setStatus("You cannot send USDC to your own connected wallet.");
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus("Please enter a valid amount.");
      return;
    }
    if (Number(amount) > walletBalance) {
      setStatus(`Insufficient Arc balance. Bridge or deposit ${(Number(amount) - walletBalance).toFixed(2)} more USDC before sending.`);
      return;
    }

    if (!reviewOpen) {
      setStatus(null);
      setReviewOpen(true);
      return;
    }

    setLoading(true);
    setStatus(isEmbeddedWalletSession ? "Submitting transfer securely…" : "Waiting for wallet signature…");

    try {
      if (isEmbeddedWalletSession) {
        sendRequestKey.current ||= crypto.randomUUID();
        const response = await fetch("/api/user/wallet/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-request-id": sendRequestKey.current },
          body: JSON.stringify({
            receiverAddress: resolvedAddress,
            amountUsdc: amount,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Transfer execution failed.");
        }
        if (data.transfers?.[0]?.txHash) setTransactionHash(data.transfers[0].txHash);
        sendRequestKey.current = null;
        setStatus("success");
        refetchUsdc();
        return;
      }

      const usdcAbi = [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const;

      if (chainId !== activeArcChain.id) {
        await switchChainAsync({ chainId: activeArcChain.id });
      }
      const hash = await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [resolvedAddress as `0x${string}`, parseUnits(limitDecimals(amount, 6), 6)],
      });

      setTransactionHash(hash);
      setStatus("Transaction submitted. Waiting for Arc confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The Arc transaction failed before confirmation.");

      setStatus("success");
      refetchUsdc();
    } catch (err: any) {
      if (err.message?.includes("User rejected the request")) {
        setStatus("Transaction signature was rejected by user.");
      } else {
        setStatus(err.message || "Transfer execution failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-5 backdrop-blur-md">
          <motion.div initial={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} animate={{ scale: 1, y: 0, filter: "blur(0px)" }} exit={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} transition={{ type: "spring", stiffness: 450, damping: 32 }} role="dialog" aria-modal="true" aria-labelledby="send-funds-title" className="w-full max-w-sm border border-black/10 rounded-3xl p-6 shadow-2xl bg-[#FFFFF0] text-black relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 id="send-funds-title" className="text-sm font-black uppercase tracking-wider text-[#111827]">Send USDC</h3>
              <button type="button" onClick={onClose} disabled={loading} aria-label="Close send dialog" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black/60 hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-30 transition-all"><X className="h-4 w-4" /></button>
            </div>

            {onGoToBatch && (
              <div className="mb-4 rounded-2xl border border-black/10 bg-black/5 p-3 text-xs flex items-center justify-between">
                <span className="text-black/70">Sending to multiple people?</span>
                <button
                  type="button"
                  onClick={onGoToBatch}
                  className="text-[#2775CA] hover:underline font-bold"
                >
                  Batch Send
                </button>
              </div>
            )}

            <form onSubmit={handleSend} className="space-y-4 text-left">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">To Recipient</span>
                <input
                  type="text"
                  value={localRecipient}
                  onChange={(e) => {
                    setLocalRecipient(e.target.value);
                    setReviewOpen(false);
                    setStatus(null);
                  }}
                  placeholder="Address or @alias"
                  className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-mono text-[#111827] focus:border-[#2775CA] focus:outline-none"
                />
                {onScanQr && (
                  <button type="button" onClick={onScanQr} className="mt-2 inline-flex md:hidden items-center gap-2 rounded-full border border-black/15 bg-white px-3 py-1.5 text-[10px] font-bold text-black shadow-sm" aria-label="Scan QR">
                    <QrCode className="h-3.5 w-3.5" /> Scan QR
                  </button>
                )}
                <div className="min-h-[20px] px-2">
                  {resolving && <span className="text-xs text-[#2775CA] animate-pulse">(Resolving...)</span>}
                  {resolvedAddress && resolvedAddress !== localRecipient && (
                    <div className="text-[10px] text-black/60 truncate font-mono">{resolvedAddress}</div>
                  )}
                </div>
                {resolvedAddress && userWallet && resolvedAddress.toLowerCase() === userWallet.toLowerCase() && (
                  <div className="mt-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-700">
                    This is your wallet address. Choose another recipient.
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">Amount (USDC)</span>
                <input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setReviewOpen(false); setStatus(null); setTransactionHash(null); }}
                  className="subscript-input bg-white border border-black/15 text-[#111827]"
                  placeholder="0.00"
                  required
                />
              </div>

              <BalanceRoutingNotice
                amount={amount}
                walletBalance={walletBalance}
                elsewhereUsdc={elsewhereUsdc}
              />

              {reviewOpen && status !== "success" && (
                <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-black">
                  <div className="flex justify-between gap-3"><span className="text-black/60">You send</span><span className="font-bold text-[#111827]">{Number(amount).toFixed(2)} USDC</span></div>
                  <div className="space-y-1"><span className="text-black/60">Recipient</span><p className="break-all font-mono text-[10px] text-black/80">{resolvedAddress}</p></div>
                  <div className="flex justify-between gap-3"><span className="text-black/60">Network</span><span className="font-bold text-[#111827]">Arc</span></div>
                  <p className="border-t border-black/10 pt-3 text-[10px] leading-relaxed text-amber-900">On-chain transfers cannot be reversed. Verify the recipient and amount before confirming.</p>
                  <button type="button" onClick={() => setReviewOpen(false)} disabled={loading} className="text-[10px] font-bold uppercase tracking-wider text-black/60 hover:text-black">Back to edit</button>
                </div>
              )}

              {status && status !== "success" && (
                <p className={`text-[11px] rounded-xl border p-3 ${loading ? "border-amber-500/30 bg-amber-500/10 text-amber-900" : "border-red-500/30 bg-red-500/10 text-red-700"}`} aria-live="polite">{status}</p>
              )}

              {status === "success" && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                  <p className="text-xs text-black font-bold">Transfer confirmed on Arc</p>
                  <button type="button" onClick={onClose} className="mt-2 w-full rounded-2xl border border-black/15 bg-white px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-black shadow-sm">Done</button>
                </div>
              )}

              {status !== "success" && <button
                type="submit"
                disabled={loading || !resolvedAddress || isSelfSend}
                className="w-full mt-2 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-3 font-bold text-xs shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Confirming…</> : reviewOpen ? "Confirm and send" : "Review transfer"}
              </button>}
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}



function BalanceRoutingNotice({
  amount,
  walletBalance,
  elsewhereUsdc,
}: {
  amount: string | number;
  walletBalance: number;
  /* USDC the user holds on the CCTP chains we can bridge from. */
  elsewhereUsdc: number;
}) {
  const numericAmount = Number(amount);
  /* USDC on another chain only counts toward a send if it can actually be brought over, and the CCTP
     bridge is a browser-wallet feature — so while external wallets are paused those funds are
     unreachable and must not be offered as a route. Without this the notice tells the user to
     "bring it over in Deposit first" and Deposit has no bridge option to go to. */
  const { externalWalletEnabled } = usePlatformFlags();
  const reachableElsewhere = externalWalletEnabled ? elsewhereUsdc : 0;
  if (!amount || isNaN(numericAmount) || numericAmount <= 0) return null;

  const combinedBalance = walletBalance + reachableElsewhere;

  if (numericAmount <= walletBalance) {
    return (
      <div className="bg-[#ccff00]/5 border border-[#ccff00]/25 rounded-2xl p-4 text-xs text-white/80 space-y-1">
        <p className="font-bold text-[#ccff00] uppercase tracking-wider text-[9px] flex items-center gap-1.5">
          Straight from your balance
          <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00] animate-pulse" />
        </p>
        <p className="text-[11px] leading-relaxed text-white/60">
          This one stays on Arc, so it lands in seconds and there&apos;s no fee.
        </p>
      </div>
    );
  }

  if (numericAmount <= combinedBalance) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/25 rounded-2xl p-4 text-xs text-white/80 space-y-1">
        <p className="font-bold text-amber-400 uppercase tracking-wider text-[9px] flex items-center gap-1.5">
          Top up first
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        </p>
        <p className="text-[11px] leading-relaxed text-white/60">
          You have {walletBalance.toFixed(2)} USDC on Arc. Bring over the other{" "}
          {(numericAmount - walletBalance).toFixed(2)} USDC in Deposit, then come back and send.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-red-500/5 border border-red-500/25 rounded-2xl p-4 text-xs text-white/80 space-y-1">
      <p className="font-bold text-red-400 uppercase tracking-wider text-[9px] flex items-center gap-1.5">
        Not enough USDC
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      </p>
      <p className="text-[11px] leading-relaxed text-white/60">
        You&apos;re trying to send {numericAmount.toFixed(2)} USDC but you have {combinedBalance.toFixed(2)} in total,
        with {walletBalance.toFixed(2)} of it on Arc
        {externalWalletEnabled
          ? `${elsewhereUsdc > 0 ? ` and ${elsewhereUsdc.toFixed(2)} on other chains` : ""}. Add more before sending.`
          : elsewhereUsdc > 0
            ? `. Bridging is paused right now, so the ${elsewhereUsdc.toFixed(2)} USDC you hold elsewhere can't move yet. Send USDC to your Arc address instead.`
            : ". Add more before sending."}
      </p>
    </div>
  );
}

function VaultCardSkeleton() {
  return (
    <div className="flex min-h-[360px] w-full shrink-0 snap-center flex-col gap-4 rounded-3xl border border-black/20 bg-[#2775CA]/20 p-4 text-black sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-11 w-11 rounded-2xl subscript-skeleton shrink-0" />
          <div className="space-y-2">
            <div className="h-4 w-36 rounded-lg subscript-skeleton" />
            <div className="h-3 w-16 rounded-full subscript-skeleton" />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-10 w-24 rounded-2xl subscript-skeleton" />
          <div className="h-10 w-24 rounded-2xl subscript-skeleton" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-h-[96px] flex-col justify-between rounded-2xl border border-black/15 bg-[#FFFFF0]/55 p-4 subscript-skeleton">
          <div className="h-3 w-20 rounded-md bg-black/10" />
          <div className="mt-2 h-6 w-32 rounded-lg bg-black/10" />
        </div>
        <div className="flex min-h-[96px] flex-col justify-between rounded-2xl border border-black/15 bg-[#FFFFF0]/55 p-4 subscript-skeleton">
          <div className="h-3 w-20 rounded-md bg-black/10" />
          <div className="mt-2 h-6 w-40 rounded-lg bg-black/10" />
        </div>
      </div>

      <div className="h-16 rounded-2xl border border-black/10 bg-[#FFFFF0]/45 subscript-skeleton" />

      <div className="flex items-center gap-3 pt-2">
        <div className="h-[92px] w-[90px] rounded-2xl subscript-skeleton shrink-0" />
        <div className="h-[92px] w-[90px] rounded-2xl subscript-skeleton shrink-0" />
      </div>
    </div>
  );
}

/* Mirrors the referrals section 1:1 (link card → 2 stat cards → registry table) so the
   swap to real content doesn't shift layout. */
function ReferralsSkeleton() {
  return (
    <>
      <div className="border border-black/15 bg-white rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm">
        <div className="h-3.5 w-40 rounded-md subscript-skeleton" />
        <div className="space-y-2">
          <div className="h-2.5 w-full rounded-md subscript-skeleton subscript-skeleton--faint" />
          <div className="h-2.5 w-4/5 rounded-md subscript-skeleton subscript-skeleton--faint" />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="h-[46px] flex-1 rounded-2xl border border-black/10 subscript-skeleton" />
          <div className="h-[46px] w-full sm:w-[132px] rounded-2xl border border-black/10 subscript-skeleton shrink-0" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="border border-black/15 bg-white rounded-3xl p-5 shadow-sm flex flex-col justify-between min-h-[104px]"
          >
            <div className="h-2.5 w-24 rounded-md subscript-skeleton subscript-skeleton--faint" />
            <div className="mt-2 h-8 w-20 rounded-lg subscript-skeleton" />
          </div>
        ))}
      </div>

      <div className="border border-black/15 bg-white rounded-3xl p-5 sm:p-8 space-y-6 shadow-sm">
        <div className="h-3.5 w-44 rounded-md subscript-skeleton" />

        <div className="space-y-4">
          <div className="flex items-center gap-4 border-b border-white/5 pb-3">
            <div className="h-2.5 flex-1 rounded-md subscript-skeleton subscript-skeleton--faint" />
            <div className="h-2.5 w-16 rounded-md subscript-skeleton subscript-skeleton--faint" />
            <div className="h-2.5 w-20 rounded-md subscript-skeleton subscript-skeleton--faint" />
            <div className="h-2.5 w-14 rounded-md subscript-skeleton subscript-skeleton--faint" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 border-b border-white/5 pb-4">
              <div className="h-3.5 flex-1 rounded-md subscript-skeleton" />
              <div className="h-3.5 w-16 rounded-md subscript-skeleton" />
              <div className="h-3.5 w-20 rounded-md subscript-skeleton" />
              <div className="h-5 w-14 rounded-full subscript-skeleton" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function MeteredVaultRow({
  vault,
  onCommit,
  onWithdraw,
  onReclaim,
  onCancelService,
  onResumeService,
  onConfigureAutoTopUp,
  cancelBusy,
  resumeBusy,
  reclaimBusy,
  balanceVisible,
}: {
  vault: any;
  onCommit: (vault: any) => void;
  onWithdraw: (vault: any) => void;
  onReclaim: (vault: any) => void;
  onCancelService: (vault: any) => void;
  onResumeService: (vault: any) => void;
  onConfigureAutoTopUp: (vault: any) => void;
  cancelBusy: boolean;
  resumeBusy: boolean;
  reclaimBusy: boolean;
  balanceVisible: boolean;
}) {
  const balance = Number(vault.balanceUsdc || 0);
  const commitNeeded = Number(vault.commitUsdc || 0);
  const blocked = !vault.active;
  const disputed = vault.disputed === true;
  const cancelled = Boolean(vault.cancelRequestedAt);
  const cycleStartDate = vault.cycleStart ? new Date(vault.cycleStart) : null;
  const lockedUntilDate = vault.lockedUntil ? new Date(vault.lockedUntil) : null;
  const RECLAIM_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  const reclaimDate = lockedUntilDate ? new Date(lockedUntilDate.getTime() + RECLAIM_GRACE_MS) : null;
  const now = Date.now();
  const locked = lockedUntilDate ? now < lockedUntilDate.getTime() : false;

  const canWithdraw = balance > 0 && blocked && !locked;
  const awaitingSettlement = !blocked && !disputed && lockedUntilDate !== null
    && now >= lockedUntilDate.getTime() && (reclaimDate === null || now < reclaimDate.getTime());
  const canReclaim = !blocked && !disputed && balance > 0 && reclaimDate !== null && now >= reclaimDate.getTime();
  const STANDARD_COMMIT_MICROS = 2_000_000;
  const drawableExposure = balance;

  const numericDate = (date: Date | null) => date
    ? date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "UTC" })
    : "-";

  const textDate = (date: Date | null) => date
    ? date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" })
    : "-";

  const isPaused = blocked || cancelled;
  /* Vault balance available = amount committed - amount used */
  const committedUsdc = Number(vault.balanceUsdc || 0);
  const accruedUsdc = Number(vault.accruedUsageUsdc || 0);
  const remainingBalanceUsdc = String(Math.max(0, committedUsdc - accruedUsdc));

  const autoTopUpOn = vault.autoTopUpEnabled === true;
  const autoTopUpFailure: string | null = vault.autoTopUpFailureCode || null;
  const AUTO_TOPUP_FAILURE_LABELS: Record<string, string> = {
    EXTERNAL_WALLET: "Needs a SubScript wallet",
    INSUFFICIENT_WALLET_BALANCE: "Add funds to refill",
    ALLOWANCE_EXHAUSTED: "Re-approve to continue",
    MONTHLY_CAP_REACHED: "Monthly cap reached",
    VAULT_DISPUTED: "Paused — in dispute",
    COMMIT_FAILED: "Last refill failed",
  };
  const autoTopUpLabel = !autoTopUpOn
    ? "Auto top-up off"
    : autoTopUpFailure
      ? AUTO_TOPUP_FAILURE_LABELS[autoTopUpFailure] || "Needs attention"
      : `Auto top-up on · ${formatUsdc(vault.topUpAmountUsdc)} at ${formatUsdc(vault.thresholdUsdc)}`;

  return (
    <div className="flex min-h-[360px] flex-col gap-4 rounded-3xl border border-black/20 bg-[#2775CA]/15 p-4 text-black transition sm:p-5">
      {/* Top Header: Vault Icon + Merchant Name (Left) | Manage Commit, Top up (+) & Pause (||) / Play (▶) buttons (Right) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-black/15 bg-[#2775CA]/20 shrink-0">
            {vault.merchantPic ? (
              <img src={vault.merchantPic} alt={vault.merchantName} className="h-full w-full object-cover" />
            ) : (
              <Building2 className="h-5 w-5 text-[#2775CA]" />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-sm sm:text-base font-black text-[#111827] uppercase tracking-wider">{vault.merchantName}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${blocked ? "bg-amber-500/15 text-amber-700 border border-amber-500/30" : disputed ? "bg-red-500/15 text-red-700 border border-red-500/30" : cancelled ? "bg-orange-500/15 text-orange-700 border border-orange-500/30" : awaitingSettlement ? "bg-sky-500/15 text-sky-700 border border-sky-500/30" : "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30"}`}>
                {blocked ? "Inactive" : disputed ? "Disputed" : cancelled ? "Paused" : awaitingSettlement ? "Settling" : "Active"}
              </span>
            </div>
          </div>
        </div>

        {/* Top Right Action Icons & Desktop Labels */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Top Up (+) Button */}
          <button
            type="button"
            onClick={() => onCommit(vault)}
            title="Top up commit"
            className="flex h-10 w-10 sm:w-auto sm:px-3.5 items-center justify-center gap-1.5 rounded-2xl border border-[#353935] bg-[#353935] text-[#FFFFF0] hover:bg-black transition text-[11px] font-bold shadow-sm"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Top up commit</span>
          </button>

          {/* Pause (||) / Play (▶) Service Button */}
          {!disputed && (
            isPaused ? (
              <button
                type="button"
                onClick={() => !resumeBusy && (balance >= STANDARD_COMMIT_MICROS ? onResumeService(vault) : onCommit(vault))}
                disabled={resumeBusy}
                title="Resume service"
                className={`relative overflow-hidden flex h-10 w-10 sm:w-auto sm:px-3.5 items-center justify-center gap-1.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 transition text-[11px] font-bold shadow-sm ${resumeBusy ? "quick-action-loading opacity-50 cursor-not-allowed" : ""}`}
              >
                <Play className="h-4 w-4 fill-current shrink-0" />
                <span className="hidden sm:inline">Resume service</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => !cancelBusy && onCancelService(vault)}
                disabled={cancelBusy}
                title="Pause service"
                className={`relative overflow-hidden flex h-10 w-10 sm:w-auto sm:px-3.5 items-center justify-center gap-1.5 rounded-2xl border border-black/15 bg-white/80 text-black hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-700 transition text-[11px] font-bold shadow-sm ${cancelBusy ? "quick-action-loading opacity-50 cursor-not-allowed" : ""}`}
              >
                <Pause className="h-4 w-4 fill-current shrink-0" />
                <span className="hidden sm:inline">Pause service</span>
              </button>
            )
          )}

          {canWithdraw && (
            <button
              type="button"
              onClick={() => onWithdraw(vault)}
              className="rounded-2xl border border-black/15 bg-white/80 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-black hover:bg-white transition shadow-sm"
            >
              Withdraw
            </button>
          )}

          {canReclaim && (
            <button
              type="button"
              onClick={() => !reclaimBusy && onReclaim(vault)}
              disabled={reclaimBusy}
              className={`rounded-2xl border px-3.5 py-2 text-[10px] font-black uppercase tracking-wider transition shadow-sm ${
                reclaimBusy
                  ? "cursor-not-allowed border-black/10 bg-black/10 text-black/30"
                  : "border-black/15 bg-white/90 hover:bg-black/5 text-[#111827] hover:border-black/25 active:scale-95"
              }`}
            >
              {reclaimBusy ? <>Reclaiming<LoadingDots /></> : "Reclaim escrow"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-black/15 bg-white/80 p-4 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-black/65">Vault Balance (Available)</span>
            <p className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-black">
              {balanceVisible ? formatUsdc(remainingBalanceUsdc) + " USDC" : "•••• USDC"}
            </p>
            {/* The headline is committed minus used, so the two figures it came from sit directly
                beneath it. Both honour the balance-visibility toggle — leaving them readable while
                the headline is masked would defeat the point of hiding it. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-black/65">
              <span>Total committed: <strong className="text-black">{balanceVisible ? formatUsdc(vault.balanceUsdc) : "••••"} USDC</strong></span>
              <span aria-hidden="true">•</span>
              <span>Used: <strong className="text-black">{balanceVisible ? formatUsdc(vault.accruedUsageUsdc) : "••••"} USDC</strong></span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onConfigureAutoTopUp(vault)}
            title={autoTopUpOn ? "Manage auto top-up" : "Set up auto top-up"}
            className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border border-black/15 bg-[#FFFFF0] px-2.5 py-1.5 text-[10px] font-bold text-black transition hover:bg-white shadow-sm"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <RefreshCw className="h-3 w-3 shrink-0" />
              <span className="truncate">{autoTopUpLabel}</span>
            </span>
            <ChevronRight className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        </div>
        <div className="space-y-2 rounded-2xl border border-black/15 bg-[#FFFFF0]/80 p-3.5 text-xs text-black/65 shadow-sm">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <p>Cycle started <span className="font-mono font-bold text-black">{numericDate(cycleStartDate)}</span></p>
            <p>Cycle matures <span className="font-mono font-bold text-black">{numericDate(lockedUntilDate)}</span></p>
            <p>Reported usage <span className="font-bold text-black">{balanceVisible ? formatUsdc(vault.accruedUsageUsdc) : "•••"} USDC</span></p>
            <p>Max drawable <span className="font-bold text-black">{balanceVisible ? formatUsdc(String(drawableExposure)) : "•••"} USDC</span></p>
            <p>Settlement due by <span className="font-mono font-bold text-black">{numericDate(reclaimDate)}</span></p>
            <p>Reclaimable from <span className="font-mono font-bold text-black">{numericDate(reclaimDate)}</span></p>
          </div>
          <p className="border-t border-black/10 pt-1.5 text-[10px] leading-relaxed text-black/60">
            The keeper settles usage after <span className="font-semibold text-black">{textDate(lockedUntilDate)}</span> and unused escrow returns to you automatically.
          </p>
        </div>
      </div>

      <div className="mt-0.5 rounded-2xl border border-black/10 bg-white/70 p-3 shadow-sm">
        <VaultShareManager
          vaultId={vault.id || vault.merchantAddress}
          merchantLabel={vault.merchantName}
          balanceVisible={balanceVisible}
        />
      </div>
    </div>
  );
}

/* Auto top-up mandate editor.
   Always scoped to an existing vault: a mandate cannot be the first money that moves toward a
   merchant, so the "create a vault here" path this modal used to carry is gone (it posted to
   /api/user/vault/config, which is a 410 tombstone for off-chain balance writes). */
function ConfigureVaultModal({
  open,
  onClose,
  editingVault,
  refetchVaults,
}: {
  open: boolean;
  onClose: () => void;
  editingVault: any | null;
  refetchVaults: () => void;
}) {
  const [threshold, setThreshold] = useState("2.00");
  const [topUpAmount, setTopUpAmount] = useState("10.00");
  const [monthlyLimit, setMonthlyLimit] = useState("50.00");
  const [acknowledgeUnverified, setAcknowledgeUnverified] = useState(false);
  const [needsAcknowledgement, setNeedsAcknowledgement] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const enabled = editingVault?.autoTopUpEnabled === true;
  const merchantName = editingVault?.merchantName || "this merchant";

  useEffect(() => {
    if (!open || !editingVault) return;
    setStatus(null);
    setNeedsAcknowledgement(false);
    setAcknowledgeUnverified(false);
    setThreshold((Number(editingVault.thresholdUsdc || 2_000_000) / 1_000_000).toString());
    setTopUpAmount((Number(editingVault.topUpAmountUsdc || 10_000_000) / 1_000_000).toString());
    setMonthlyLimit((Number(editingVault.monthlyLimitUsdc || 50_000_000) / 1_000_000).toString());
  }, [open, editingVault]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVault?.merchantAddress) return;

    if (Number(threshold) <= 0 || Number(topUpAmount) <= 0 || Number(monthlyLimit) <= 0) {
      setStatus("Threshold, top-up amount, and monthly cap must be positive numbers.");
      return;
    }
    if (Number(threshold) > Number(topUpAmount)) {
      setStatus("The threshold can't be larger than the top-up amount, or each refill would immediately trigger another one.");
      return;
    }
    if (Number(monthlyLimit) < Number(topUpAmount)) {
      setStatus("The monthly cap must be at least one top-up.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      /* Signs an on-chain approve, so the same stable-request-id contract as a commit applies:
         a retry after an ambiguous response must not grant a second allowance. */
      const requestId = `autotopup-${editingVault.merchantAddress}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch("/api/user/vault/auto-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({
          merchantAddress: editingVault.merchantAddress,
          thresholdUsdc: threshold,
          topUpAmountUsdc: topUpAmount,
          monthlyLimitUsdc: monthlyLimit,
          ...(acknowledgeUnverified ? { acknowledgeUnverified: true } : {}),
        }),
      });
      const data = await res.json();

      if (res.status === 409 && data.code === "UNVERIFIED_MERCHANT") {
        setNeedsAcknowledgement(true);
        setStatus(data.warning || data.error);
        return;
      }
      if (res.ok && data.success) {
        setStatus("success");
        refetchVaults();
        setTimeout(() => onClose(), 1500);
      } else {
        setStatus(data.error || "Failed to save auto top-up.");
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to save auto top-up.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!editingVault?.merchantAddress) return;
    setDisabling(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/user/vault/auto-topup?merchantAddress=${encodeURIComponent(editingVault.merchantAddress)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (res.ok && data.success) {
        refetchVaults();
        onClose();
      } else {
        setStatus(data.error || "Failed to turn off auto top-up.");
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to turn off auto top-up.");
    } finally {
      setDisabling(false);
    }
  };

  return (
    <AnimatePresence>
      {open && editingVault && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-5 backdrop-blur-md">
          <motion.div initial={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} animate={{ scale: 1, y: 0, filter: "blur(0px)" }} exit={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} transition={{ type: "spring", stiffness: 450, damping: 32 }} className="w-full max-w-sm border border-black/10 rounded-3xl p-6 shadow-2xl bg-[#FFFFF0] text-black relative overflow-hidden text-left max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-black uppercase tracking-wider text-[#111827]">Auto top-up</h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black/60 hover:bg-black/10 transition-all"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-4 text-[11px] text-black/60">{merchantName}</p>

            <form onSubmit={handleSubmit} className="space-y-4 text-left">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">Refill when below</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="subscript-input bg-white border border-black/15 text-[#111827]"
                    placeholder="2.00"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">Add each time</span>
                  <input
                    type="number"
                    step="any"
                    min="2"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    className="subscript-input bg-white border border-black/15 text-[#111827]"
                    placeholder="10.00"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">Monthly cap</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={monthlyLimit}
                  onChange={(e) => setMonthlyLimit(e.target.value)}
                  className="subscript-input bg-white border border-black/15 text-[#111827]"
                  placeholder="50.00"
                  required
                />
                <p className="text-[10px] leading-relaxed text-black/60 pt-1">
                  Turning this on approves <span className="font-semibold text-black">{monthlyLimit || "0"} USDC</span> to
                  the vault on-chain. That approval is the hard ceiling — we can never move more than it in a month,
                  and you can revoke it from any wallet. Refills come from your SubScript wallet balance.
                </p>
              </div>

              {enabled && (
                <div className="rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-[10px] text-black/70">
                  Used this month:{" "}
                  <span className="font-bold text-black">
                    {(Number(editingVault.monthlySpentUsdc || 0) / 1_000_000).toFixed(2)} /{" "}
                    {(Number(editingVault.monthlyLimitUsdc || 0) / 1_000_000).toFixed(2)} USDC
                  </span>
                </div>
              )}

              {needsAcknowledgement && (
                <label className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <input
                    type="checkbox"
                    checked={acknowledgeUnverified}
                    onChange={(e) => setAcknowledgeUnverified(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#2775CA]"
                  />
                  <span className="text-[10px] leading-relaxed text-amber-900 font-medium">
                    I understand {merchantName} is not verified by SubScript, and that they report the usage that
                    triggers each automatic refill.
                  </span>
                </label>
              )}

              {status && status !== "success" && !needsAcknowledgement && (
                <p className="text-[11px] text-red-700 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{status}</p>
              )}
              {status && needsAcknowledgement && (
                <p className="text-[11px] text-amber-800 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">{status}</p>
              )}

              {status === "success" && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                  <p className="text-xs text-black font-bold">Auto top-up saved</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || disabling || status === "success" || (needsAcknowledgement && !acknowledgeUnverified)}
                className="w-full mt-2 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-3 font-bold text-xs shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? "Update auto top-up" : "Approve & turn on"}
              </button>

              {enabled && (
                <button
                  type="button"
                  onClick={handleDisable}
                  disabled={loading || disabling}
                  className="w-full rounded-2xl border border-black/15 bg-black/5 px-4 py-2.5 text-[11px] font-bold text-black/70 hover:bg-black/10 transition disabled:opacity-50"
                >
                  {disabling ? "Turning off…" : "Turn off auto top-up"}
                </button>
              )}
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TopupVaultModal({
  open,
  onClose,
  vault,
  refetchVaults,
}: {
  open: boolean;
  onClose: () => void;
  vault: any | null;
  refetchVaults: () => void;
}) {
  const [amount, setAmount] = useState("10.00");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setAmount("10.00");
  }, [open]);

  const handleTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vault) return;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus("Please enter a valid amount.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/user/vault/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantAddress: vault.merchantAddress,
          amountUsdc: amount,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("success");
        refetchVaults();
        setTimeout(() => onClose(), 1500);
      } else {
        setStatus(data.error || "Top-up failed.");
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to execute top-up.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && vault && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-5 backdrop-blur-md">
          <motion.div initial={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} animate={{ scale: 1, y: 0, filter: "blur(0px)" }} exit={{ scale: 0.92, y: 18, filter: "blur(1.5px)" }} transition={{ type: "spring", stiffness: 450, damping: 32 }} className="w-full max-w-sm border border-black/10 rounded-3xl p-6 shadow-2xl bg-[#FFFFF0] text-black relative overflow-hidden text-left">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-[#111827]">Manual Deposit</h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black/60 hover:bg-black/10 transition-all"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleTopup} className="space-y-4 text-left">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">Merchant Vault</span>
                <div className="rounded-2xl border border-black/10 bg-black/5 px-4 py-3 text-xs font-mono text-black/80">
                  {merchantDisplayName(vault.merchantName)}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-black/60">Amount to Deposit (USDC)</span>
                <input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="subscript-input bg-white border border-black/15 text-[#111827]"
                  placeholder="10.00"
                  required
                />
              </div>

              {status && status !== "success" && (
                <p className="text-[11px] text-red-700 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{status}</p>
              )}

              {status === "success" && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                  <p className="text-xs text-black font-bold">Deposit success!</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || status === "success"}
                className="w-full mt-2 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white py-3 font-bold text-xs shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deposit USDC"}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SubscribeReviewModal({
  dm,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  dm: DmMessage | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!dm) return null;
  const rawAmount = dm.amountUsdc ? (Number(dm.amountUsdc) / 1_000_000).toFixed(2) : null;

  return (
    <AnimatePresence>
      <motion.div
        key="subscribe-review-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 sm:p-6"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
        onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      >
        <motion.div
          key="subscribe-review-sheet"
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="w-full max-w-md rounded-3xl border border-black/10 bg-[#FFFFF0] shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-black/8">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#2775CA]/80">Subscription Offer</p>
              <h2 className="mt-0.5 text-base font-black text-black truncate">{dm.title || "Review Plan"}</h2>
              <p className="text-[10px] text-black/50 mt-0.5">From {dm.senderName || dm.senderAddress.slice(0, 8) + "…"}</p>
            </div>
            <button
              type="button"
              onClick={() => !busy && onClose()}
              className="ml-4 shrink-0 p-1.5 rounded-full hover:bg-black/8 text-black/40 hover:text-black/70 transition"
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" /></svg>
            </button>
          </div>

          {/* Plan detail */}
          <div className="px-6 py-5 space-y-3">
            {rawAmount && (
              <div className="flex items-center justify-between rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/5 px-4 py-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-[#2775CA]/70">Recurring Amount</span>
                <span className="text-xl font-black text-[#2775CA]">${rawAmount} <span className="text-xs font-bold text-[#2775CA]/60">USDC</span></span>
              </div>
            )}

            {dm.description && (
              <div className="rounded-2xl border border-black/10 bg-white/60 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-black/40 mb-1">Plan Details</p>
                <p className="text-xs text-black/70 leading-relaxed">{dm.description}</p>
              </div>
            )}

            <div className="rounded-2xl border border-amber-400/25 bg-amber-50/60 px-4 py-3">
              <p className="text-[9px] font-bold text-amber-700/80 leading-relaxed">
                By confirming you authorise a recurring charge at the amount above. You can cancel at any time from your subscriptions dashboard.
              </p>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-400/30 bg-red-50/60 px-4 py-3">
                <p className="text-[10px] font-bold text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => !busy && onClose()}
              className="flex-1 rounded-2xl border border-black/15 bg-white py-3 text-xs font-black uppercase tracking-wider text-black/70 hover:bg-black/5 transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={`relative flex-1 overflow-hidden rounded-2xl bg-[#2775CA] py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-[#1e5fa8] transition disabled:opacity-60 ${busy ? "quick-action-loading cursor-not-allowed" : ""}`}
            >
              {busy ? "Subscribing…" : "Confirm & Subscribe"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function SpendAnalysisSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" data-testid="spend-analysis-skeleton">
      {/* Header controls skeleton */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-black/10">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded-xl bg-black/10" />
          <div className="h-3 w-64 rounded-lg bg-black/5" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-24 rounded-full bg-black/10" />
          <div className="h-9 w-24 rounded-full bg-black/10" />
        </div>
      </div>

      {/* 4 Stat Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-3xl border border-black/10 bg-white/80 p-5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-black/10" />
              <div className="h-8 w-8 rounded-2xl bg-black/10" />
            </div>
            <div className="h-8 w-32 rounded-xl bg-black/15" />
            <div className="h-3 w-20 rounded bg-black/5" />
          </div>
        ))}
      </div>

      {/* Chart Card Skeleton */}
      <div className="rounded-3xl border border-black/10 bg-white/80 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-4 w-40 rounded-lg bg-black/10" />
            <div className="h-3 w-56 rounded bg-black/5" />
          </div>
          <div className="h-6 w-28 rounded-full bg-black/10" />
        </div>
        <div className="h-44 w-full rounded-2xl bg-black/5 flex items-end justify-between p-4 gap-3">
          {[40, 65, 30, 85, 50, 70].map((h, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div className="w-full rounded-t-xl bg-black/15" style={{ height: `${h}%` }} />
              <div className="h-3 w-8 rounded bg-black/10" />
            </div>
          ))}
        </div>
      </div>

      {/* Insights & Categories Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-3xl border border-black/10 bg-white/80 p-6 space-y-4 shadow-sm">
          <div className="h-4 w-36 rounded-lg bg-black/10" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-2xl bg-black/5">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-xl bg-black/10" />
                  <div className="h-3 w-28 rounded bg-black/10" />
                </div>
                <div className="h-4 w-16 rounded bg-black/15" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-black/10 bg-white/80 p-6 space-y-4 shadow-sm">
          <div className="h-4 w-36 rounded-lg bg-black/10" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-2xl bg-black/5">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-black/10" />
                  <div className="h-3 w-32 rounded bg-black/10" />
                </div>
                <div className="h-4 w-20 rounded bg-black/15" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsTransactionsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" data-testid="transactions-skeleton">
      {/* Header controls & filter bar skeleton */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-black/10">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded-xl bg-black/10" />
          <div className="h-3 w-64 rounded-lg bg-black/5" />
        </div>
        <div className="h-10 w-full sm:w-64 rounded-2xl bg-black/10" />
      </div>

      {/* Filter pills skeleton */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-black/10 shrink-0" />
        ))}
      </div>

      {/* Transactions list skeleton */}
      <div className="rounded-3xl border border-black/10 bg-white/80 p-4 sm:p-6 space-y-3 shadow-sm">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/5 bg-black/[0.02]">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-black/10 shrink-0" />
              <div className="space-y-2">
                <div className="h-4 w-36 sm:w-48 rounded bg-black/15" />
                <div className="h-3 w-24 sm:w-32 rounded bg-black/5" />
              </div>
            </div>
            <div className="text-right space-y-1.5">
              <div className="h-4 w-20 rounded bg-black/15 ml-auto" />
              <div className="h-3 w-14 rounded bg-black/5 ml-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
