"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useWriteContract, useBalance, useWaitForTransactionReceipt, useChainId, useSwitchChain, usePublicClient, useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import { 
    Loader2, CheckCircle, AlertTriangle, AlertCircle,
    Wallet, ExternalLink, ArrowRight, Lock, QrCode, Shield, ShieldAlert, Gift, Users
} from "@/components/icons";
import { QRCode } from "react-qrcode-logo";
import { motion, AnimatePresence } from "framer-motion";
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
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";
import { merchantDisplayName } from "@/lib/identityDisplay";
import { shouldAutoReturnToMerchant, type CheckoutArrival } from "@/lib/paymentLinks/arrival";
import { getDashboardUrl } from "@/utils/navigation";
import CheckoutSkeleton from "./CheckoutSkeleton";

export interface PublicPayClientProps {
    id: string;
    initialLinkData?: any;
    displayCurrency?: string;
    displayAmount?: number;
    exchangeRate?: number;
    /* Merchant return URLs already validated server-side (validateStoredReturnUrl in page.tsx):
       same-origin/https only, no javascript:/data: — the redirect-safety boundary. */
    successUrl?: string | null;
    cancelUrl?: string | null;
    /* How the payer reached this page, classified server-side from Sec-Fetch-Site + Referer (see
       @/lib/paymentLinks/arrival). Only a "merchant" arrival auto-returns them to the merchant's
       site after settlement — a QR scan or a shared link keeps them inside SubScript. */
    arrival?: CheckoutArrival;
    initialSettlementVersion?: string | null;
}

type PendingCheckoutVerification = {
    txHash: `0x${string}`;
    receiptId: string | null;
    payer: string;
    chainId: number;
    attemptId: string;
    submittedAt: string;
    source: "wallet" | "embedded";
    phase: "broadcast" | "confirmed";
};

const CCTP_CHECKOUT_ENABLED = false;

function isPendingCheckoutVerification(value: unknown): value is PendingCheckoutVerification {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<PendingCheckoutVerification>;
    return /^0x[0-9a-f]{64}$/i.test(candidate.txHash || "")
        && typeof candidate.payer === "string"
        && Number.isInteger(candidate.chainId)
        && typeof candidate.attemptId === "string"
        && typeof candidate.submittedAt === "string"
        && (candidate.source === "wallet" || candidate.source === "embedded")
        && (candidate.phase === "broadcast" || candidate.phase === "confirmed")
        && (candidate.receiptId === null || typeof candidate.receiptId === "string");
}

function formatCheckoutAddress(address: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(address)
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : address;
}

/* The settled status line. Named because it used to double as the settlement *predicate* — see
   isSettled below. Edit the wording here freely now; nothing branches on its value. */
const SETTLED_STATUS = "Payment confirmed and settled successfully!";

export default function PublicPayClient({
    id,
    initialLinkData,
    displayCurrency = "USD",
    displayAmount,
    exchangeRate = 1.0,
    successUrl = null,
    cancelUrl = null,
    arrival = "direct",
    initialSettlementVersion = null,
}: PublicPayClientProps) {
    const router = useRouter();
    const routedIntentRef = useRef<string | null>(null);
    const paymentControlsRef = useRef<HTMLDivElement | null>(null);
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
    const [mounted, setMounted] = useState(false);
    const { address: realAddress, isConnected: realIsConnected } = useAccount();
    const { connectAsync, connectors, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const { writeContractAsync } = useWriteContract();
    const { signMessageAsync } = useSignMessage();
    const chainId = useChainId();
    const { switchChainAsync } = useSwitchChain();
    const publicClient = usePublicClient();
    const { externalWalletEnabled } = usePlatformFlags();

    useEffect(() => {
        setMounted(true);
    }, []);

    const address = mounted ? realAddress : undefined;
    const isConnected = mounted ? realIsConnected : false;

    const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [pendingVerification, setPendingVerification] = useState<PendingCheckoutVerification | null>(null);
    const [pendingVerificationHydrated, setPendingVerificationHydrated] = useState(false);
    const [verifiedHash, setVerifiedHash] = useState<string | null>(null);
    const [showQrCode, setShowQrCode] = useState(false);
    const [checkoutUrl, setCheckoutUrl] = useState("");
    const [merchantVerified, setMerchantVerified] = useState<boolean | null>(null);
    const [showUnverifiedWarning, setShowUnverifiedWarning] = useState(false);
    const [unverifiedAccepted, setUnverifiedAccepted] = useState(false);
    const [reviewPaymentMode, setReviewPaymentMode] = useState<"embedded" | "wallet" | null>(null);
    /* The unverified-merchant gate opens a modal instead of setting reviewPaymentMode. Remember
       which payment path (embedded vs wallet) the user was on so "Accept & Continue" can drop
       them straight into the final review instead of leaving them at the pay button. */
    const [pendingPaymentMode, setPendingPaymentMode] = useState<"embedded" | "wallet" | null>(null);

    const { data: balanceData } = useBalance({
        address: address,
        token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
    });

    const { data: txReceipt, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash: txHash,
        chainId: pendingVerification?.chainId,
    });

    const [linkData, setLinkData] = useState<any>(initialLinkData);
    const displayMerchantName = merchantDisplayName(linkData?.merchant_display_name);
    const [isLoading, setIsLoading] = useState(!initialLinkData);
    const [error, setError] = useState<string | null>(null);
    const hasInitialSingleUseSettlement = Boolean(
        initialSettlementVersion
        && Number(initialLinkData?.max_uses) === 1
        && Number(initialLinkData?.use_count || 0) > 0
    );
    const isTestMode = linkData?.sandbox_mode === true;
    const isTestnetLink = isTestMode
        || Number(linkData?.settlement_chain_id ?? ARC_TESTNET_CHAIN_ID) === ARC_TESTNET_CHAIN_ID;
    const isSimulationOnly = linkData?.simulation_only === true;
    const isLinkExhausted = linkData?.max_uses != null && linkData.use_count >= linkData.max_uses;
    const isLinkExpired = Boolean(linkData?.expires_at && new Date(linkData.expires_at) <= new Date());
    const isLinkInactive = linkData?.active === false || isLinkExpired;
    const hostedPaymentsDisabled = linkData?.hosted_payments_enabled === false;
    const cannotPayLink = isSimulationOnly || isLinkInactive || isLinkExhausted || hostedPaymentsDisabled;
    const unpayableTitle = !cannotPayLink ? null
        : isSimulationOnly ? "Simulation-Only Link"
        : isLinkExhausted ? "Payment Link Exhausted"
        : hostedPaymentsDisabled ? "Payments Paused"
        : "Payment Link Inactive";
    const unpayableReason = !cannotPayLink ? null
        : isSimulationOnly
            ? "This checkout was created with the shared public demo key. It can test the integration flow, but it will not submit an Arc payment. Create your own test key to settle test USDC on Arc Testnet."
        : isLinkExhausted ? "This payment link has reached its maximum number of uses and is no longer accepting payments."
        : hostedPaymentsDisabled ? "Hosted payments are temporarily unavailable. Try again shortly."
        : "This payment link is inactive or expired.";

    /* Derived variables — same peer/user-request predicate as the server (isPeerRequestLink). */
    const isUserRequest = Boolean(
        linkData?.merchant_name_snapshot === "SubScript user request" ||
        linkData?.external_reference?.startsWith("peer-request:") ||
        linkData?.external_reference?.startsWith("dm-peer-request:")
    );
    const giftBeneficiaryAddress = typeof linkData?.beneficiary_address === "string"
        ? linkData.beneficiary_address
        : typeof linkData?.beneficiaryAddress === "string"
            ? linkData.beneficiaryAddress
            : null;
    const giftBeneficiaryLabel = typeof linkData?.beneficiary_display_name === "string" && linkData.beneficiary_display_name
        ? linkData.beneficiary_display_name
        : giftBeneficiaryAddress
            ? formatCheckoutAddress(giftBeneficiaryAddress)
            : null;

    /* Merchant-site return URLs from the checkout intent (POST /api/intent successUrl/cancelUrl).
       A merchant integration opens this hosted checkout in a new tab, so after settlement the
       payer is routed back to the merchant's site instead of dead-ending on "payment completed".
       These come pre-validated from the server component (validateStoredReturnUrl) — never derive
       them from raw request input, which would be an open-redirect (finding 22). */
    const merchantSuccessUrl = typeof successUrl === "string" ? successUrl : null;
    const merchantCancelUrl = typeof cancelUrl === "string" ? cancelUrl : null;
    const hostOf = (value: string | null) => {
        if (!value) return null;
        try { return new URL(value).hostname; } catch { return null; }
    };
    const merchantSuccessHost = hostOf(merchantSuccessUrl);

    /* Absolute, cross-host, and a full navigation — not router.push.
     *
     * Checkout is served from pay.subscriptonarc.com while the dashboard lives on
     * dashboard.subscriptonarc.com. A client-side router.push("/user/transactions") stays on the
     * checkout host, where middleware treats any non-/pay path as a checkout rewrite and sends it
     * to /pay/user/transactions — so "Go to my dashboard" went nowhere. getDashboardUrl resolves
     * the dashboard origin (and no-ops to a relative path in local dev), and it wants the
     * /dashboard/... form or it doubles the /user segment. */
    const dashboardReturnUrl = isUserRequest
        ? `${getDashboardUrl("USER", "/dashboard/user")}?tab=inbox`
        : getDashboardUrl("USER", "/dashboard/user/transactions");

    const [shareOpen, setShareOpen] = useState(false);
    const [shareNotice, setShareNotice] = useState<string | null>(null);

    const shareLink = checkoutUrl || (typeof window !== "undefined" ? window.location.href : "");

    const handleCopyCheckoutLink = async () => {
        try {
            await navigator.clipboard.writeText(shareLink);
            setShareNotice("Link copied. Paste it wherever you like.");
        } catch {
            /* Clipboard is blocked without a user gesture in some in-app browsers, and on http
               origins. Say so rather than silently doing nothing. */
            setShareNotice("Couldn't copy automatically — long-press the address bar to copy the link.");
        }
    };

    /* Native share sheet where the platform has one (every mobile browser), which is what a payer
       actually wants for "send this to a friend". Falls back to copy on desktop. */
    const handleNativeShare = async () => {
        const title = linkData?.title ? `Pay for ${linkData.title}` : "SubScript payment";
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            try {
                await navigator.share({ title, url: shareLink });
                setShareOpen(false);
                return;
            } catch {
                /* User dismissed the sheet, or the platform refused — fall through to copy. */
            }
        }
        await handleCopyCheckoutLink();
    };

    const [isPaying, setIsPaying] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [paymentStep, setPaymentStep] = useState<"approving" | "sending" | "confirming" | "verifying" | null>(null);
    const [verificationStatus, setVerificationStatus] = useState<string | null>(
        hasInitialSingleUseSettlement ? SETTLED_STATUS : null
    );
    /* Settlement is tracked as its own flag rather than inferred by comparing verificationStatus
       against the sentence above. That comparison gated the entire success screen — receipt link,
       merchant return, step 3 of the indicator, and now the arrival-aware redirect — on an exact
       match with user-facing copy assigned in five different places, so any wording tweak silently
       broke all of it. markSettled below is the only writer, so the copy and the flag cannot drift. */
    const [isSettled, setIsSettled] = useState(hasInitialSingleUseSettlement);
    const [verificationError, setVerificationError] = useState<string | null>(null);
    const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
    const [receiptId, setReceiptId] = useState<string | null>(
        hasInitialSingleUseSettlement && isReceiptId(initialLinkData?.receipt_token)
            ? initialLinkData.receipt_token
            : null
    );
    const [shareableReceiptUrl, setShareableReceiptUrl] = useState<string | null>(null);
    const [payerRole, setPayerRole] = useState<string | null>(null);
    const [isRoleMismatch, setIsRoleMismatch] = useState(false);
    const settlementNotifiedRef = useRef(false);
    const paymentSubmissionGuardRef = useRef(false);
    const paymentBroadcastRef = useRef(false);
    const verificationInFlightRef = useRef<string | null>(null);
    const [remoteStatusError, setRemoteStatusError] = useState<string | null>(null);
    const [lastRemoteStatusCheck, setLastRemoteStatusCheck] = useState<Date | null>(null);
    const [isPollingExpired, setIsPollingExpired] = useState(false);
    const [isManualChecking, setIsManualChecking] = useState(false);
    const [manualCheckMessage, setManualCheckMessage] = useState<string | null>(null);

    const friendlyError = useCallback((raw: string): string => {
        const map: [RegExp, string][] = [
            [/USDC approval.*reverted/i, "Your wallet denied the spending approval. Please try again."],
            [/CCTP.*failed/i, "The cross-chain transfer could not be completed. Check your balance and try again."],
            [/payment transaction failed/i, "The payment could not be completed. Check your balance and try again."],
            [/reverted or failed/i, "The payment was rejected by the network. No funds were taken."],
            [/stream disconnected/i, "Lost connection while confirming. Your payment may still be processing — check your wallet."],
            [/payment verification failed/i, "We couldn't confirm your payment yet. If funds left your wallet, it may still be processing."],
            [/failed to initiate verification/i, "We couldn't start payment confirmation. Continue verification below; do not pay again."],
            [/user rejected/i, "You declined the transaction in your wallet."],
            [/insufficient funds/i, "Your wallet doesn't have enough funds for this transaction."],
        ];
        for (const [pattern, friendly] of map) {
            if (pattern.test(raw)) return friendly;
        }
        return raw;
    }, []);

    /* Inbox DM creation states */
    const [isCreatingDm, setIsCreatingDm] = useState(false);
    const [dmError, setDmError] = useState<string | null>(null);

    /* Detect an existing SubScript session so we can offer "go to DMs" instead of
       forcing a fresh wallet connection. */
    const [sessionInfo, setSessionInfo] = useState<{ loggedIn: boolean; wallet?: string; email?: string | null; role?: string | null; isEmbedded?: boolean; provider?: string | null } | null>(null);

    /* Share-with-a-friend, for personal accounts only.
     *
     * A merchant viewing their own checkout must not get this: sharing is a payer-to-payer action
     * ("cover this for me", "here's the split"), and a business surfacing it would be inviting the
     * merchant to redistribute their own payment request through a personal DM thread. Gated on a
     * signed-in non-ENTERPRISE session, so anonymous visitors do not see it either — the DM half
     * needs an account to send from. */
    const canShareCheckout = Boolean(
        sessionInfo?.loggedIn && sessionInfo.role !== "ENTERPRISE" && !isRoleMismatch,
    );
    const [isSessionLoading, setIsSessionLoading] = useState(true);
    const [isWalletAuthenticating, setIsWalletAuthenticating] = useState(false);
    const [walletAuthenticationError, setWalletAuthenticationError] = useState<string | null>(null);
    const [isEmbeddedPaying, setIsEmbeddedPaying] = useState(false);
    const [clientIntentId, setClientIntentId] = useState("");
    useEffect(() => {
        const storageKey = `subscript_checkout_attempt:${id}`;
        const url = new URL(window.location.href);
        const linkedAttempt = url.searchParams.get("attempt");
        const stored = sessionStorage.getItem(storageKey);
        const attemptId = (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(linkedAttempt || "")
            ? linkedAttempt
            : stored) || crypto.randomUUID();
        if (!stored) sessionStorage.setItem(storageKey, attemptId);
        setClientIntentId(attemptId);
        url.searchParams.set("attempt", attemptId);
        setCheckoutUrl(url.toString());
    }, [id]);

    const persistPendingVerification = useCallback((record: PendingCheckoutVerification) => {
        paymentSubmissionGuardRef.current = true;
        paymentBroadcastRef.current = true;
        setPendingVerification(record);
        try {
            sessionStorage.setItem(`subscript_pending_verification:${id}`, JSON.stringify(record));
        } catch {
            /* The in-memory guard still prevents a second submission when browser storage is denied. */
        }
    }, [id]);

    const clearPendingVerification = useCallback(() => {
        paymentBroadcastRef.current = false;
        setPendingVerification(null);
        try {
            sessionStorage.removeItem(`subscript_pending_verification:${id}`);
        } catch {
            /* Settlement and known reverts remain authoritative when browser storage is denied. */
        }
    }, [id]);

    /* A RELEASED attempt UUID is terminal server-side and can never be reserved again. Mint a
       fresh attempt, replace the sessionStorage copy and the ?attempt= URL parameter, and drop
       pending-verification state so the next payment starts from a clean reservation. */
    const rotateAttemptId = useCallback(() => {
        const fresh = crypto.randomUUID();
        paymentBroadcastRef.current = false;
        setPendingVerification(null);
        setReceiptId(null);
        try {
            sessionStorage.setItem(`subscript_checkout_attempt:${id}`, fresh);
            sessionStorage.removeItem(`subscript_pending_verification:${id}`);
        } catch {
            /* In-memory state still rotates when browser storage is denied. */
        }
        setClientIntentId(fresh);
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("attempt", fresh);
            window.history.replaceState(null, "", url.toString());
            setCheckoutUrl(url.toString());
        } catch {
            /* URL rotation is cosmetic once sessionStorage has rotated. */
        }
        return fresh;
    }, [id]);

    useEffect(() => {
        if (!clientIntentId) return;
        if (hasInitialSingleUseSettlement) {
            setPendingVerificationHydrated(true);
            return;
        }
        try {
            const stored = sessionStorage.getItem(`subscript_pending_verification:${id}`);
            if (!stored) return;
            const parsed: unknown = JSON.parse(stored);
            if (!isPendingCheckoutVerification(parsed) || parsed.attemptId !== clientIntentId) {
                sessionStorage.removeItem(`subscript_pending_verification:${id}`);
                return;
            }
            paymentSubmissionGuardRef.current = true;
            paymentBroadcastRef.current = true;
            setPendingVerification(parsed);
            setSuccessTxHash(parsed.txHash);
            if (parsed.receiptId) setReceiptId(parsed.receiptId);
            setVerificationError(null);
            setVerificationStatus(parsed.phase === "confirmed"
                ? "Payment submitted. Ready to continue settlement verification."
                : "Payment submitted. Waiting for on-chain confirmation...");
            setPaymentStep(parsed.phase === "confirmed" ? "verifying" : "confirming");
            if (parsed.source === "wallet") setTxHash(parsed.txHash);
        } catch {
            try { sessionStorage.removeItem(`subscript_pending_verification:${id}`); } catch { /* no-op */ }
        } finally {
            setPendingVerificationHydrated(true);
        }
    }, [clientIntentId, hasInitialSingleUseSettlement, id]);

    const refreshSession = useCallback(async () => {
        setIsSessionLoading(true);
        try {
            const response = await fetch("/api/auth/session", { cache: "no-store" });
            const data = await response.json().catch(() => ({ loggedIn: false }));
            setSessionInfo(data);
            return data;
        } catch {
            setSessionInfo(null);
            return null;
        } finally {
            setIsSessionLoading(false);
        }
    }, []);
    useEffect(() => { void refreshSession(); }, [refreshSession]);

    /* Returning-payer email prompt: an external wallet that already has a SubScript account
       but no email on file must verify one at checkout via OTP — the payment verifier no
       longer accepts a caller-supplied email, so binding happens only through the
       authenticated /api/user/email flow. */
    const [payerEmailInput, setPayerEmailInput] = useState("");
    const [payerEmailError, setPayerEmailError] = useState<string | null>(null);
    const [payerEmailCode, setPayerEmailCode] = useState("");
    const [payerEmailStep, setPayerEmailStep] = useState<"email" | "code">("email");
    const [isSendingPayerEmailCode, setIsSendingPayerEmailCode] = useState(false);
    const [isVerifyingPayerEmail, setIsVerifyingPayerEmail] = useState(false);
    const hasMatchingWalletSession = Boolean(
        sessionInfo?.loggedIn && sessionInfo.wallet && address &&
        sessionInfo.wallet.toLowerCase() === address.toLowerCase(),
    );
    const embeddedPaySession = Boolean(sessionInfo?.loggedIn && sessionInfo?.isEmbedded && sessionInfo?.wallet);
    const canBindPayerEmail = Boolean(hasMatchingWalletSession || embeddedPaySession);
    const payerNeedsEmail = Boolean(canBindPayerEmail && !sessionInfo?.email);

    const handleAuthenticateConnectedWallet = async () => {
        if (!address || isWalletAuthenticating) return;
        setIsWalletAuthenticating(true);
        setWalletAuthenticationError(null);
        setVerificationError(null);
        try {
            const accountResponse = await fetch("/api/auth/check-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address }),
            });
            const account = await accountResponse.json().catch(() => ({}));
            if (!accountResponse.ok) throw new Error(account.error || "Could not check this wallet account.");
            if (!account.exists) {
                throw new Error("This wallet does not have a SubScript user account yet. Create one, verify your email, then return to checkout.");
            }
            if (account.role === "ENTERPRISE") {
                setIsRoleMismatch(true);
                throw new Error("Business accounts cannot pay checkout links. Sign in with a personal account.");
            }
            const nonceResponse = await fetch("/api/auth/nonce", { cache: "no-store" });
            const nonceData = await nonceResponse.json().catch(() => ({}));
            if (!nonceResponse.ok || !nonceData.nonce) throw new Error(nonceData.error || "Could not start wallet verification.");
            const message = buildWalletAuthMessage({ address, nonce: nonceData.nonce, domain: window.location.host, uri: window.location.origin });
            const signature = await signMessageAsync({ message });
            const verifyResponse = await fetch("/api/auth/verify-signature", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address, signature, nonce: nonceData.nonce }),
            });
            const verified = await verifyResponse.json().catch(() => ({}));
            if (!verifyResponse.ok || !verified.success) throw new Error(verified.error || "Wallet verification failed.");
            await refreshSession();
        } catch (error: any) {
            setWalletAuthenticationError(error.message || "Could not verify this wallet.");
        } finally {
            setIsWalletAuthenticating(false);
        }
    };

    const handleSendPayerEmailCode = async () => {
        setPayerEmailError(null);
        const email = payerEmailInput.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setPayerEmailError("Enter a valid email address.");
            return;
        }
        if (!hasMatchingWalletSession) {
            setPayerEmailError("Sign in with this connected wallet before adding an email.");
            return;
        }
        setIsSendingPayerEmailCode(true);
        try {
            const response = await fetch("/api/auth/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, purpose: "bind_wallet_email" }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) throw new Error(data.error || "Could not send a verification code.");
            setPayerEmailStep("code");
            setPayerEmailCode("");
        } catch (error: any) {
            setPayerEmailError(error.message || "Could not send a verification code.");
        } finally {
            setIsSendingPayerEmailCode(false);
        }
    };

    const handleVerifyPayerEmail = async () => {
        setPayerEmailError(null);
        if (!/^\d{6}$/.test(payerEmailCode.trim())) {
            setPayerEmailError("Enter the 6-digit code we emailed you.");
            return;
        }
        setIsVerifyingPayerEmail(true);
        try {
            const response = await fetch("/api/user/email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: payerEmailInput.trim(), code: payerEmailCode.trim() }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) throw new Error(data.error || "Could not verify your email.");
            await refreshSession();
            setPayerEmailStep("email");
            setPayerEmailCode("");
        } catch (error: any) {
            setPayerEmailError(error.message || "Could not verify your email.");
        } finally {
            setIsVerifyingPayerEmail(false);
        }
    };

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

    /* Pre-payment only: files this request into the signed-in payer's inbox as a pending
       payment-request DM so they can pay from their dashboard wallet. Never call this after
       settlement — it would create a fresh PENDING request for something already paid. */
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
            /* Full navigation to an absolute dashboard URL for the same reason as
               dashboardReturnUrl above: a router.push from the checkout host never leaves it. */
            window.location.assign(
                dmData.dashboardUrl
                || `${getDashboardUrl("USER", "/dashboard/user")}?tab=inbox&intent=${linkData.id}`,
            );
        } catch (err: any) {
            setDmError(err.message || "Failed to initiate DM session. Please try again.");
            setIsCreatingDm(false);
        }
    };

    const isPaymentSettled = isSettled;

    /* The one place that marks a payment settled: sets the flag and the status line together, so
       the four call sites below cannot set one without the other. */
    const markSettled = useCallback(() => {
        setIsSettled(true);
        setVerificationStatus(SETTLED_STATUS);
    }, []);

    useEffect(() => {
        if (!mounted || !isPaymentSettled || !receiptId || shareableReceiptUrl) return;
        setShareableReceiptUrl(receiptUrl(receiptId, window.location.origin));
    }, [isPaymentSettled, mounted, receiptId, shareableReceiptUrl]);

    /* Post-settlement return to the merchant site, carrying receipt evidence the merchant
       integration can correlate server-side (webhooks remain the settlement authority). */
    const buildMerchantReturnUrl = (base: string) => {
        try {
            const url = new URL(base);
            url.searchParams.set("subscript_status", "success");
            url.searchParams.set("subscript_verification_status", "settled");
            url.searchParams.set("subscript_checkout_id", String(linkData?.id || id));
            if (receiptId) url.searchParams.set("subscript_receipt_id", receiptId);
            if (successTxHash) url.searchParams.set("subscript_tx_hash", successTxHash);
            return url.toString();
        } catch {
            return null;
        }
    };

    /* Auto-return is the merchant round trip: a merchant that redirected a buyer here expects that
       buyer back on its order-confirmation page. It fires ONLY for a merchant-initiated arrival.
       The same link also circulates as a printed QR code and gets pasted into chats, and those
       payers have no relationship with the merchant's site — navigating them there landed them on a
       stranger's page with no session, which is the whole reason this gate exists. They keep a
       manual "Return to <merchant>" link in the success panel instead. */
    const autoReturnsToMerchant = shouldAutoReturnToMerchant(arrival, merchantSuccessUrl);

    useEffect(() => {
        if (!isPaymentSettled || !autoReturnsToMerchant || !merchantSuccessUrl) return;
        const target = buildMerchantReturnUrl(merchantSuccessUrl);
        if (!target) return;
        const timer = setTimeout(() => { window.location.assign(target); }, 3500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPaymentSettled, autoReturnsToMerchant, merchantSuccessUrl, receiptId, successTxHash]);

    /* Wake a same-origin dashboard tab as soon as settlement is final. The storage event fires in
       other tabs; focus/visibility refresh remains the fallback when browsers throttle it. */
    useEffect(() => {
        if (!isPaymentSettled || settlementNotifiedRef.current) return;
        settlementNotifiedRef.current = true;
        clearPendingVerification();
        try {
            sessionStorage.removeItem(`subscript_checkout_attempt:${id}`);
            localStorage.setItem("subscript_payment_settled", JSON.stringify({
                checkoutId: String(linkData?.id || id),
                receiptId,
                settledAt: new Date().toISOString(),
            }));
        } catch {
            /* Private browsing/storage denial must not affect the completed payment. */
        }
    }, [clearPendingVerification, id, isPaymentSettled, linkData?.id, receiptId]);

    const baselineSettlementVersionRef = useRef(initialSettlementVersion);
    const baselineUseCountRef = useRef(Number(initialLinkData?.use_count || 0));

    /* Poll for a NEW finalized settlement (e.g. a phone pays while the PC displays the QR).
       Link.status is aggregate historical state and stays PAID on reusable links, so treating it as
       proof for this page visit would show success without a new transaction. */
    useEffect(() => {
        if (isPaymentSettled || !linkData?.id || !clientIntentId) return;
        
        let cancelled = false;
        let expired = false;
        let pollAttempts = 0;
        let interval: ReturnType<typeof setInterval> | null = null;
        setIsPollingExpired(false);

        const poll = async () => {
            if (pollAttempts >= 600) {
                expired = true;
                if (interval) clearInterval(interval);
                if (!cancelled) {
                    setIsPollingExpired(true);
                    setRemoteStatusError("Session expired, refresh to continue.");
                }
                return;
            }
            pollAttempts += 1;

            try {
                const res = await fetch(`/api/payment-links/${linkData.id}/status?attempt=${encodeURIComponent(clientIntentId)}`, { cache: "no-store" });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || "Unable to check payment status");
                if (!cancelled && !expired) {
                    setRemoteStatusError(null);
                    setLastRemoteStatusCheck(new Date());
                }
                const settlementVersion = typeof data?.settlementVersion === "string"
                    ? data.settlementVersion
                    : null;
                const useCount = Number(data?.useCount || 0);
                const hasNewSettlement = data?.attemptSettled === true && Boolean(settlementVersion);
                if (!cancelled && hasNewSettlement) {
                    baselineSettlementVersionRef.current = settlementVersion;
                    baselineUseCountRef.current = useCount;
                    clearPendingVerification();
                    paymentSubmissionGuardRef.current = false;
                    setVerificationError(null);
                    markSettled();
                    setPaymentStep(null);
                    setIsPaying(false);
                    setIsEmbeddedPaying(false);
                    setIsVerifying(false);
                    setIsPollingExpired(false);
                    setRemoteStatusError(null);
                    setManualCheckMessage(null);
                    if (data.receiptId) {
                        setReceiptId(data.receiptId);
                    }
                }
            } catch (e) {
                if (!cancelled && !expired) setRemoteStatusError("Live payment status is temporarily unavailable. Retrying automatically…");
            }
        };

        void poll();
        interval = setInterval(poll, 3000);
        return () => {
            cancelled = true;
            if (interval) clearInterval(interval);
        };
    }, [clearPendingVerification, clientIntentId, isPaymentSettled, linkData?.id, linkData?.max_uses, markSettled]);

    const defaultArcChainId = isProd ? 5042001 : 5042002;
    const expectedChainId = linkData?.settlement_chain_id
        ? Number(linkData.settlement_chain_id)
        : linkData?.chain_id
            ? Number(linkData.chain_id)
            : defaultArcChainId;
    const expectedChainName = expectedChainId === 5042001 ? "Arc Mainnet" : expectedChainId === 5042002 ? "Arc Testnet" : `Chain ${expectedChainId}`;

    const { data: arcBalanceData } = useBalance({
        address: address,
        token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
        chainId: expectedChainId,
    });

    /* Server-authoritative resume: if this attempt UUID (from the URL or sessionStorage) already
       has a transaction bound but the browser lost its local pending-verification record — new
       device, cleared storage, crashed tab — recover from the server instead of offering Pay
       again. A terminal (released) attempt UUID rotates immediately. */
    const serverResumeCheckedRef = useRef(false);
    useEffect(() => {
        if (serverResumeCheckedRef.current) return;
        if (!clientIntentId || !linkData?.id || !pendingVerificationHydrated) return;
        if (pendingVerification || isPaymentSettled || !sessionInfo?.loggedIn) return;
        serverResumeCheckedRef.current = true;
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetch(
                    `/api/payment-links/${linkData.id}/attempt?attempt=${encodeURIComponent(clientIntentId)}`,
                    { cache: "no-store", signal: controller.signal },
                );
                if (!res.ok) return;
                const data = await res.json().catch(() => null);
                if (!data?.exists) return;
                if (data.status === "RELEASED") {
                    rotateAttemptId();
                    return;
                }
                if (data.status === "SUBMITTED" && /^0x[0-9a-f]{64}$/i.test(data.txHash || "")) {
                    persistPendingVerification({
                        txHash: data.txHash as `0x${string}`,
                        receiptId: isReceiptId(data.receiptId) ? data.receiptId : null,
                        payer: sessionInfo?.wallet || "",
                        chainId: Number(data.settlementChainId) || expectedChainId,
                        attemptId: clientIntentId,
                        submittedAt: new Date().toISOString(),
                        source: "wallet",
                        phase: "confirmed",
                    });
                    setSuccessTxHash(data.txHash);
                    if (isReceiptId(data.receiptId)) setReceiptId(data.receiptId);
                    setVerificationStatus("Payment submitted; resuming verification…");
                }
            } catch {
                /* Best-effort; the reservation path reports the same state on the next Pay click. */
            }
        })();
        return () => controller.abort();
    }, [clientIntentId, expectedChainId, isPaymentSettled, linkData?.id, pendingVerification, pendingVerificationHydrated, persistPendingVerification, rotateAttemptId, sessionInfo?.loggedIn, sessionInfo?.wallet]);

    const arcUsdcBalance = arcBalanceData ? arcBalanceData.value : BigInt(0);
    const invoiceAmount = linkData ? (linkData.amount_usdc ? BigInt(linkData.amount_usdc) : BigInt(linkData.amount || 0)) : BigInt(0);
    const requiredAmount = invoiceAmount;
    const hasSufficientArcBalance = arcBalanceData ? (arcUsdcBalance >= invoiceAmount) : true;

    const cctpOriginChainId = expectedChainId === 5042001 ? 1 : 11155111;
    const cctpOriginChainName = expectedChainId === 5042001 ? "Ethereum Mainnet" : "Ethereum Sepolia";
    /* Hard-disabled until Arc-side memo settlement is production-ready. */
    const cctpCheckoutEnabled = CCTP_CHECKOUT_ENABLED;

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
                    if (data.role === "ENTERPRISE" && !isUserRequest) {
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
    }, [address, isUserRequest]);

    const handleConnect = async () => {
        /* Without an injected provider the wagmi connector is still registered but can never
           connect — attempting it produces no visible feedback. Fail with guidance instead. */
        if (typeof window !== "undefined" && !(window as any).ethereum) {
            setVerificationError(
                "No browser wallet was detected in this browser. Install or unlock MetaMask or Rabby — or sign in to SubScript to pay from your email wallet.",
            );
            return;
        }
        const connector = connectors.find((item) => item.id === "injected") || connectors[0];
        if (!connector) {
            setVerificationError("No browser wallet connector is available. Install or unlock a wallet extension, then try again.");
            return;
        }
        setVerificationError(null);
        try {
            await connectAsync({ connector });
        } catch (err: any) {
            const message = String(err?.shortMessage || err?.message || "");
            setVerificationError(friendlyError(
                /provider not found|no provider|not installed/i.test(message)
                    ? "No browser wallet was detected. Install or unlock MetaMask or Rabby, then try again."
                    : message || "The browser wallet could not be connected. Unlock it and try again."
            ));
        }
    };

    const handleSwitchChain = async () => {
        try {
            await switchChainAsync({ chainId: requiredChainId });
        } catch (err: any) {
            setVerificationError(friendlyError(`Failed to switch network: ${err.message || "User rejected the request"}`));
        }
    };

    type ReservationResult =
        | { kind: "reserved"; attemptId: string; receiptId: string }
        | { kind: "resume"; attemptId: string; txHash: `0x${string}`; receiptId: string | null }
        | { kind: "settled"; attemptId: string; receiptId: string | null };

    const reserveCheckoutAttempt = async (payer: string, attemptOverride?: string): Promise<ReservationResult> => {
        const attemptId = attemptOverride || clientIntentId;
        if (!linkData?.id || !attemptId) throw new Error("Checkout attempt is not ready.");
        const response = await fetch(`/api/payment-links/${linkData.id}/attempt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 409 && data.code === "ATTEMPT_RELEASED") {
            /* Terminal attempt UUID: rotate once and reserve a fresh attempt in the same click. */
            const fresh = rotateAttemptId();
            if (!attemptOverride) return reserveCheckoutAttempt(payer, fresh);
            throw new Error("This checkout attempt expired. Please try again.");
        }
        if (response.status === 409 && data.code === "ALREADY_SUBMITTED") {
            /* A transaction hash is durably bound server-side. The only safe path is to resume
               verification of THAT transaction — never broadcast another payment. */
            if (/^0x[0-9a-f]{64}$/i.test(data.txHash || "")) {
                return {
                    kind: "resume",
                    attemptId,
                    txHash: data.txHash as `0x${string}`,
                    receiptId: isReceiptId(data.receiptId) ? data.receiptId : null,
                };
            }
            throw new Error("This payment was already submitted. Continue verification below; do not pay again.");
        }
        if (!response.ok || !data.success || !isReceiptId(data.receiptId)) {
            throw new Error(data.error || "Unable to reserve this checkout attempt.");
        }
        if (data.settled === true) {
            return { kind: "settled", attemptId, receiptId: data.receiptId };
        }
        /* Past this point the server has RESERVED capacity. Any validation failure below must
           release it before throwing — otherwise the reserved (but never-broadcast) attempt keeps
           a single-use link consumed even though no transaction was sent. */
        if (String(data.amountUsdc) !== String(linkData.amount_usdc)
            || String(data.merchantAddress).toLowerCase() !== String(linkData.merchant_address).toLowerCase()
            || Number(data.settlementChainId) !== expectedChainId) {
            await releaseUnbroadcastAttempt(attemptId);
            throw new Error("Checkout terms changed while preparing payment. Refresh before continuing.");
        }
        if (!payer) {
            await releaseUnbroadcastAttempt(attemptId);
            throw new Error("The paying wallet is unavailable.");
        }
        setReceiptId(data.receiptId);
        return { kind: "reserved", attemptId, receiptId: data.receiptId };
    };

    const releaseUnbroadcastAttempt = async (attemptId: string) => {
        if (!linkData?.id || !attemptId || paymentBroadcastRef.current) return;
        try {
            const response = await fetch(`/api/payment-links/${linkData.id}/attempt?attempt=${encodeURIComponent(attemptId)}`, {
                method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            /* A confirmed release makes this UUID terminal server-side — rotate immediately so
               the next Pay click reserves a fresh attempt instead of replaying a dead one. */
            if (data?.released === true) rotateAttemptId();
        } catch {
            /* Keep the UUID; the server-side reaper reclaims the hold and the next reservation
               reports the terminal state, which also rotates. */
        }
    };

    const handlePay = async () => {
        if (isPaying || isEmbeddedPaying) return;
        if (!linkData || !address) return;
        if (paymentSubmissionGuardRef.current) return;
        paymentSubmissionGuardRef.current = true;
        if (!pendingVerificationHydrated) {
            paymentSubmissionGuardRef.current = false;
            setVerificationError("Restoring this checkout's payment state. Please wait a moment.");
            return;
        }
        setVerificationError(null);
        setVerificationStatus(null);
        setPayerEmailError(null);

        const liveSession = await refreshSession();
        const sessionMatchesWallet = Boolean(liveSession?.loggedIn && liveSession?.wallet && liveSession.wallet.toLowerCase() === address.toLowerCase());
        if (!sessionMatchesWallet) {
            paymentSubmissionGuardRef.current = false;
            setWalletAuthenticationError("Verify this connected wallet before paying.");
            return;
        }
        if (!liveSession?.email) {
            paymentSubmissionGuardRef.current = false;
            setPayerEmailError("A verified email and OTP confirmation are mandatory before payment.");
            return;
        }

        if (isRoleMismatch || liveSession?.role === "ENTERPRISE") {
            paymentSubmissionGuardRef.current = false;
            setVerificationError("Merchant accounts cannot pay checkout links. Sign in with a user account.");
            return;
        }
        if (merchantVerified === false && !unverifiedAccepted && !isUserRequest) {
            paymentSubmissionGuardRef.current = false;
            /* handlePay is the connected-wallet execution path, so record that mode before the
               modal opens. Without it "Accept & Continue" finds pendingPaymentMode null, closes
               the dialog, and leaves the payer back on the button they already pressed. */
            setPendingPaymentMode("wallet");
            setShowUnverifiedWarning(true);
            return;
        }

        if (cannotPayLink) {
            paymentSubmissionGuardRef.current = false;
            setVerificationError(unpayableReason);
            return;
        }

        /* Returning payer must verify an email before paying. */
        if (payerNeedsEmail) {
            paymentSubmissionGuardRef.current = false;
            setPayerEmailError("Verify an email address before completing this payment.");
            return;
        }

        if (!clientIntentId) {
            paymentSubmissionGuardRef.current = false;
            setVerificationError("Preparing a secure payment attempt. Please try again.");
            return;
        }

        /* Strict production burn safeguard */
        if (!isProd && chainId === 1) {
            paymentSubmissionGuardRef.current = false;
            setVerificationError("Switch to a supported test network before paying.");
            return;
        }

        /* Guard: prevent network mismatches based on the current mode (CCTP vs Direct) */
        if (isCctpMode ? !isCctpChain : chainId !== expectedChainId) {
            paymentSubmissionGuardRef.current = false;
            setVerificationError(`Wrong network detected. Please switch to ${requiredChainName} before paying.`);
            return;
        }

        setIsPaying(true);

        let reservation: ReservationResult;
        try {
            reservation = await reserveCheckoutAttempt(address || "");
        } catch (error) {
            paymentSubmissionGuardRef.current = false;
            setIsPaying(false);
            setVerificationError(friendlyError(error instanceof Error ? error.message : "Unable to reserve checkout."));
            return;
        }
        if (reservation.kind === "resume") {
            /* Server-authoritative recovery: a hash is already bound to this attempt. Resume the
               existing transaction; broadcasting another payment here would double-charge. */
            persistPendingVerification({
                txHash: reservation.txHash,
                receiptId: reservation.receiptId,
                payer: address,
                chainId: expectedChainId,
                attemptId: reservation.attemptId,
                submittedAt: new Date().toISOString(),
                source: "wallet",
                phase: "confirmed",
            });
            setSuccessTxHash(reservation.txHash);
            if (reservation.receiptId) setReceiptId(reservation.receiptId);
            setIsPaying(false);
            setVerificationStatus("Payment submitted; resuming verification…");
            setVerifiedHash(reservation.txHash);
            startVerification(reservation.txHash, reservation.receiptId, address, expectedChainId, reservation.attemptId);
            return;
        }
        if (reservation.kind === "settled") {
            setIsPaying(false);
            if (reservation.receiptId) setReceiptId(reservation.receiptId);
            markSettled();
            return;
        }
        const activeAttemptId = reservation.attemptId;
        const checkoutReceiptId = reservation.receiptId;

        if (isCctpChain && chainId) {
            /* CCTP Payment Flow */
            try {
                const cctpConfig = CCTP_CONFIG[chainId];
                setVerificationStatus("Initiating CCTP transaction on origin chain...");

                /* Step 1: Approve USDC spend by TokenMessenger */
                setPaymentStep("approving");
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
                        throw new Error("Your wallet denied the spending approval. Please try again.");
                    }
                } else {
                    throw new Error("A network client is required to confirm token approval.");
                }

                /* Step 2: Call depositForBurn */
                setPaymentStep("sending");
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
                setPaymentStep("confirming");
                setSuccessTxHash(cctpHash);
                setShareableReceiptUrl(receiptUrl(checkoutReceiptId, window.location.origin));
                setIsVerifying(true);
                setVerificationStatus("CCTP transaction submitted. Waiting for confirmation...");
                setIsPaying(false);

            } catch (err: any) {
                await releaseUnbroadcastAttempt(activeAttemptId);
                paymentSubmissionGuardRef.current = false;
                setVerificationError(friendlyError(err.message || "CCTP payment execution failed"));
                setIsPaying(false);
                setIsVerifying(false);
                setPaymentStep(null);
            }
        } else {
            /* Native Arc Network Payment Flow */
            try {
                const nextReceiptId = receiptId || checkoutReceiptId;
                setReceiptId(nextReceiptId);

                if (isUserRequest) {
                    setPaymentStep("sending");
                    setVerificationStatus("Sending USDC directly to the requester...");
                    const hash = await writeContractAsync({
                        address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
                        abi: USDC_ERC20_ABI,
                        functionName: "transfer",
                        args: [linkData.merchant_address as `0x${string}`, BigInt(linkData.amount_usdc)],
                    });

                    persistPendingVerification({
                        txHash: hash,
                        receiptId: nextReceiptId,
                        payer: address,
                        chainId: expectedChainId,
                        attemptId: activeAttemptId,
                        submittedAt: new Date().toISOString(),
                        source: "wallet",
                        phase: "broadcast",
                    });
                    setTxHash(hash);
                    setPaymentStep("confirming");
                    setSuccessTxHash(hash);
                    setShareableReceiptUrl(receiptUrl(nextReceiptId, window.location.origin));
                    setIsVerifying(true);
                    setVerificationStatus("Direct transfer submitted. Waiting for confirmation on the Arc Network...");
                    /* Durably bind the hash server-side the moment it exists. The server worker
                       owns confirmation polling from here; local receipt watching is only UI. */
                    startVerification(hash, nextReceiptId, address, expectedChainId, activeAttemptId);
                } else {
                    const currentAllowance = publicClient
                        ? await publicClient.readContract({
                            address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
                            abi: USDC_ERC20_ABI,
                            functionName: "allowance",
                            args: [address as `0x${string}`, SUBSCRIPT_ROUTER_ADDRESS],
                        })
                        : BigInt(0);

                    if (BigInt(currentAllowance) < BigInt(linkData.amount_usdc)) {
                        if (!publicClient) {
                            throw new Error("A network client is required to confirm token approval.");
                        }
                        setPaymentStep("approving");
                        setVerificationStatus("Approving merchant payment route...");
                        const approvalHash = await writeContractAsync({
                            address: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
                            abi: USDC_ERC20_ABI,
                            functionName: "approve",
                            args: [SUBSCRIPT_ROUTER_ADDRESS, BigInt(linkData.amount_usdc)],
                        });

                        const approvalReceipt = await publicClient.waitForTransactionReceipt({
                            hash: approvalHash,
                            timeout: 120_000,
                        });
                        if (approvalReceipt.status !== "success") {
                            throw new Error("Your wallet denied the spending approval. Please try again.");
                        }
                    }

                    setPaymentStep("sending");
                    setVerificationStatus("Routing payment to merchant...");
                    const hash = await writeContractAsync({
                        address: SUBSCRIPT_ROUTER_ADDRESS as `0x${string}`,
                        abi: ROUTER_DEPOSIT_ABI,
                        functionName: "depositForMerchant",
                        args: [linkData.merchant_address as `0x${string}`, BigInt(linkData.amount_usdc), nextReceiptId],
                    });

                    persistPendingVerification({
                        txHash: hash,
                        receiptId: nextReceiptId,
                        payer: address,
                        chainId: expectedChainId,
                        attemptId: activeAttemptId,
                        submittedAt: new Date().toISOString(),
                        source: "wallet",
                        phase: "broadcast",
                    });
                    setTxHash(hash);
                    setPaymentStep("confirming");
                    setSuccessTxHash(hash);
                    setShareableReceiptUrl(receiptUrl(nextReceiptId, window.location.origin));
                    setIsVerifying(true);
                    setVerificationStatus("Transaction submitted. Waiting for confirmation on the Arc Network...");
                    /* Durably bind the hash server-side the moment it exists. The server worker
                       owns confirmation polling from here; local receipt watching is only UI. */
                    startVerification(hash, nextReceiptId, address, expectedChainId, activeAttemptId);
                }

            } catch (err: any) {
                await releaseUnbroadcastAttempt(activeAttemptId);
                if (!paymentBroadcastRef.current) paymentSubmissionGuardRef.current = false;
                setVerificationError(friendlyError(err.message || "Payment transaction failed"));
                setIsPaying(false);
                setIsVerifying(false);
                setPaymentStep(null);
            }
        }
    };

    /* Submit the verification job and stream settlement status. Shared by the browser-wallet flow
       (driven by the wagmi receipt effect below) and the embedded-wallet flow (handleEmbeddedPay),
       so both settle through the identical /api/payment-links/verify pipeline. */
    const startVerification = useCallback((hash: string, rid: string | null, payer: string, chain: number, attemptId: string) => {
        if (verificationInFlightRef.current === hash) return;
        verificationInFlightRef.current = hash;
        paymentSubmissionGuardRef.current = true;
        setIsVerifying(true);
        setPaymentStep("verifying");
        const run = async () => {
            try {
                const verifyRes = await fetch("/api/payment-links/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        txHash: hash,
                        paymentLinkId: linkData?.id,
                        payerAddress: payer || "",
                        receiptId: rid,
                        chainId: chain,
                        checkoutAttemptId: attemptId,
                    })
                });

                const verifyData = await verifyRes.json().catch(() => ({}));
                const alreadyVerifying = verifyRes.status === 409 && verifyData.status === "VERIFYING";
                if (!verifyRes.ok && !alreadyVerifying) {
                    throw new Error(verifyData.error || "Failed to initiate verification");
                }

                const eventSource = new EventSource(`/api/payment-links/verify/status?txHash=${hash}`);
                /* Once we've reached a terminal state (settled, verification-failed, or a server-sent
                   error), suppress the transport onerror below so it can't overwrite the specific
                   message with the generic "stream disconnected". */
                let settled = false;

                eventSource.addEventListener("status", (event) => {
                    try {
                        const data = JSON.parse((event as MessageEvent).data);
                        if (data.status === "PENDING_CONFIRMATIONS") {
                            setVerificationStatus(`Confirming: Received ${data.confirmations} block confirmations...`);
                        } else if (data.status === "VERIFYING") {
                            setVerificationStatus("Transaction confirmed. Verifying parameters...");
                        } else if (data.status === "CONFIRMED") {
                            clearPendingVerification();
                            paymentSubmissionGuardRef.current = false;
                            verificationInFlightRef.current = null;
                            markSettled();
                            setIsVerifying(false);
                            setIsPaying(false);
                            setIsEmbeddedPaying(false);
                            setPaymentStep(null);
                            settled = true;
                            eventSource.close();
                        } else if (data.status === "FAILED") {
                            paymentSubmissionGuardRef.current = true;
                            verificationInFlightRef.current = null;
                            setVerificationStatus(null);
                            setVerificationError(friendlyError(data.errorMessage || "Payment verification needs attention"));
                            setIsVerifying(false);
                            setIsPaying(false);
                            setIsEmbeddedPaying(false);
                            setPaymentStep(null);
                            settled = true;
                            eventSource.close();
                        }
                    } catch (e) {
                        console.error("Error parsing event data:", e);
                    }
                });

                /* Named server-sent error events (event: error) carry a real message; without this
                   listener they'd only reach onerror and surface as the generic disconnect notice. */
                eventSource.addEventListener("error", (event) => {
                    const data = (event as MessageEvent).data;
                    if (!data) return; /* transport error, not a server message — let onerror handle it */
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed?.message) {
                            paymentSubmissionGuardRef.current = true;
                            verificationInFlightRef.current = null;
                            setVerificationStatus(null);
                            setVerificationError(friendlyError(parsed.message));
                            setIsVerifying(false);
                            setIsPaying(false);
                            setIsEmbeddedPaying(false);
                            setPaymentStep(null);
                            settled = true;
                            eventSource.close();
                        }
                    } catch {
                        /* not a JSON payload; leave it to onerror */
                    }
                });

                eventSource.onerror = (err) => {
                    if (settled) return;
                    console.error("EventSource connection error:", err);
                    eventSource.close();
                    paymentSubmissionGuardRef.current = true;
                    verificationInFlightRef.current = null;
                    setVerificationStatus(null);
                    setVerificationError(friendlyError("Real-time stream disconnected. Continue verification for the submitted transaction."));
                    setIsVerifying(false);
                    setIsPaying(false);
                    setIsEmbeddedPaying(false);
                    setPaymentStep(null);
                };
            } catch (err: any) {
                paymentSubmissionGuardRef.current = true;
                verificationInFlightRef.current = null;
                setVerificationStatus(null);
                setVerificationError(friendlyError(err.message || "Payment verification failed"));
                setIsVerifying(false);
                setIsPaying(false);
                setIsEmbeddedPaying(false);
                setPaymentStep(null);
            }
        };
        run();
    }, [clearPendingVerification, friendlyError, linkData, markSettled]);

    useEffect(() => {
        if (isConfirmed && txReceipt && txHash && linkData && verifiedHash !== txHash) {
            if (txReceipt.status !== "success") {
                clearPendingVerification();
                /* The reverted hash is bound to this attempt server-side; the durable worker
                   marks it FAILED_TERMINAL and returns capacity. Rotate now so the retry
                   reserves a fresh attempt instead of replaying a dead UUID. */
                rotateAttemptId();
                paymentSubmissionGuardRef.current = false;
                verificationInFlightRef.current = null;
                setTxHash(undefined);
                setSuccessTxHash(null);
                setVerificationStatus(null);
                setVerificationError(friendlyError("On-chain transaction reverted or failed."));
                setIsPaying(false);
                setIsVerifying(false);
                setPaymentStep(null);
                return;
            }
            const matchingPending = pendingVerification?.txHash === txHash ? pendingVerification : null;
            const payer = matchingPending?.payer || address || "";
            const activeAttemptId = matchingPending?.attemptId || clientIntentId;
            if (!payer || !activeAttemptId) return;
            const confirmedRecord: PendingCheckoutVerification = {
                txHash,
                receiptId: matchingPending?.receiptId ?? receiptId,
                payer,
                chainId: matchingPending?.chainId ?? chainId,
                attemptId: activeAttemptId,
                submittedAt: matchingPending?.submittedAt || new Date().toISOString(),
                source: matchingPending?.source || "wallet",
                phase: "confirmed",
            };
            persistPendingVerification(confirmedRecord);
            setVerifiedHash(txHash);
            startVerification(txHash, confirmedRecord.receiptId, payer, confirmedRecord.chainId, confirmedRecord.attemptId);
        }
    }, [address, chainId, clearPendingVerification, clientIntentId, friendlyError, isConfirmed, linkData, pendingVerification, persistPendingVerification, receiptId, rotateAttemptId, startVerification, txHash, txReceipt, verifiedHash]);

    useEffect(() => {
        if (!pendingVerification || pendingVerification.phase !== "confirmed" || isPaymentSettled) return;
        if (!linkData?.id) return;
        if (pendingVerification.attemptId !== clientIntentId || verifiedHash === pendingVerification.txHash) return;
        setVerifiedHash(pendingVerification.txHash);
        setVerificationStatus("Resuming settlement verification for your submitted payment...");
        startVerification(
            pendingVerification.txHash,
            pendingVerification.receiptId,
            pendingVerification.payer,
            pendingVerification.chainId,
            pendingVerification.attemptId,
        );
    }, [clientIntentId, isPaymentSettled, linkData?.id, pendingVerification, startVerification, verifiedHash]);

    const beginPaymentReview = (
        mode: "embedded" | "wallet",
        options?: { unverifiedAcknowledged?: boolean },
    ) => {
        setVerificationError(null);
        setWalletAuthenticationError(null);
        if (!pendingVerificationHydrated) {
            setVerificationError("Restoring this checkout's payment state. Please wait a moment.");
            return;
        }
        if (pendingVerification) {
            setVerificationError("This payment was already submitted. Continue verification of the existing transaction below.");
            paymentControlsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        if (cannotPayLink) {
            setVerificationError(unpayableReason);
            return;
        }
        if (isRoleMismatch || sessionInfo?.role === "ENTERPRISE") {
            setVerificationError("Merchant accounts cannot pay checkout links. Sign in with a user account.");
            return;
        }
        /* When re-entered from the warning modal's "Accept & Continue", the acknowledgment arrives
           as an argument: the setUnverifiedAccepted(true) that triggered it has not re-rendered
           yet, so reading the state here would bounce the user back into the same modal. */
        const merchantAcknowledged = unverifiedAccepted || options?.unverifiedAcknowledged === true;
        if (merchantVerified === false && !merchantAcknowledged && !isUserRequest) {
            setPendingPaymentMode(mode);
            setShowUnverifiedWarning(true);
            return;
        }
        if (mode === "wallet" && !hasMatchingWalletSession) {
            setWalletAuthenticationError("Verify this connected wallet before continuing.");
            paymentControlsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        if (!sessionInfo?.email) {
            setPayerEmailError("Verify an email address with the emailed OTP before continuing.");
            paymentControlsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        if (mode === "wallet" && isWrongChain) {
            setVerificationError(`Switch to ${requiredChainName} before continuing.`);
            return;
        }
        if (mode === "wallet" && (isInsufficientBalance || !hasSufficientArcBalance)) {
            setVerificationError("Your Arc USDC balance is insufficient for this payment.");
            return;
        }
        setReviewPaymentMode(mode);
    };

    const handlePayInBrowser = () => {
        if (pendingVerification) {
            retryPendingVerification();
            return;
        }
        paymentControlsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (embeddedPaySession) {
            beginPaymentReview("embedded");
        } else if (isConnected) {
            beginPaymentReview("wallet");
        } else {
            handleConnect();
        }
    };

    const handleManualPaymentCheck = async () => {
        if (!linkData?.id || isPaymentSettled || isManualChecking) return;
        setIsManualChecking(true);
        setManualCheckMessage(null);
        try {
            const res = await fetch(`/api/payment-links/${linkData.id}/status?attempt=${encodeURIComponent(clientIntentId)}`, { cache: "no-store" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Unable to check payment status");
            if (!isPollingExpired) setRemoteStatusError(null);
            setLastRemoteStatusCheck(new Date());
            const settlementVersion = typeof data?.settlementVersion === "string" ? data.settlementVersion : null;
            const useCount = Number(data?.useCount || 0);
            const hasNewSettlement = data?.attemptSettled === true && Boolean(settlementVersion);
            if (hasNewSettlement) {
                baselineSettlementVersionRef.current = settlementVersion;
                baselineUseCountRef.current = useCount;
                clearPendingVerification();
                paymentSubmissionGuardRef.current = false;
                setVerificationError(null);
                markSettled();
                setPaymentStep(null);
                setIsPaying(false);
                setIsEmbeddedPaying(false);
                setIsVerifying(false);
                setIsPollingExpired(false);
                setRemoteStatusError(null);
                setManualCheckMessage(null);
                if (data.receiptId) setReceiptId(data.receiptId);
            } else {
                setManualCheckMessage(isPollingExpired
                    ? "No confirmed payment found yet. Refresh this page to start a new checkout session."
                    : "No confirmed payment found yet. If you just sent it, wait a moment — we check automatically every 3 seconds.");
            }
        } catch {
            setManualCheckMessage(isPollingExpired
                ? "Could not check payment status. Refresh this page to start a new checkout session."
                : "Could not check payment status. Automatic checks continue in the background.");
        } finally {
            setIsManualChecking(false);
        }
    };

    const handleEmbeddedPay = async () => {
        if (isPaying || isEmbeddedPaying) return;
        if (!linkData) return;
        if (paymentSubmissionGuardRef.current) return;
        paymentSubmissionGuardRef.current = true;
        if (!pendingVerificationHydrated) {
            paymentSubmissionGuardRef.current = false;
            setVerificationError("Restoring this checkout's payment state. Please wait a moment.");
            return;
        }
        setVerificationError(null);
        setVerificationStatus(null);
        if (cannotPayLink) {
            setVerificationError(unpayableReason);
            paymentSubmissionGuardRef.current = false;
            return;
        }
        if (!clientIntentId) {
            setVerificationError("Preparing a secure payment attempt. Please try again.");
            paymentSubmissionGuardRef.current = false;
            return;
        }
        setIsEmbeddedPaying(true);
        setPaymentStep("sending");
        setVerificationStatus("Paying from your SubScript wallet...");
        try {
            const res = await fetch(`/api/user/payment-links/${linkData.id}/pay`, { 
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientIntentId })
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data.code === "ATTEMPT_RELEASED") {
                /* Terminal attempt UUID — rotate so the next click reserves a fresh attempt. */
                rotateAttemptId();
                throw new Error("This checkout attempt expired. Press Pay again to start a fresh attempt.");
            }
            if (!res.ok || !data.success || !data.txHash) {
                throw new Error(data.error || "Payment could not be completed.");
            }
            const hash = data.txHash as string;
            const checkoutReceiptId = linkData.receipt_token;
            const rid = data.receiptId || (isReceiptId(checkoutReceiptId) ? checkoutReceiptId : null);
            const payer = sessionInfo?.wallet || "";
            const submittedRecord: PendingCheckoutVerification = {
                txHash: hash as `0x${string}`,
                receiptId: rid,
                payer,
                chainId: expectedChainId,
                attemptId: clientIntentId,
                submittedAt: new Date().toISOString(),
                source: "embedded",
                phase: "confirmed",
            };
            persistPendingVerification(submittedRecord);
            setReceiptId(rid);
            setSuccessTxHash(hash);
            if (rid) setShareableReceiptUrl(receiptUrl(rid, window.location.origin));
            setIsVerifying(true);
            setPaymentStep("verifying");
            setVerificationStatus("Payment sent. Confirming settlement...");
            setVerifiedHash(hash);
            startVerification(hash, rid, payer, expectedChainId, submittedRecord.attemptId);
        } catch (err: any) {
            setVerificationStatus(null);
            setVerificationError(friendlyError(err.message || "Payment failed"));
            setIsEmbeddedPaying(false);
            setIsVerifying(false);
            setPaymentStep(null);
            if (!paymentBroadcastRef.current) paymentSubmissionGuardRef.current = false;
        }
    };

    const retryPendingVerification = () => {
        if (!pendingVerification || isVerifying || isPaymentSettled) return;
        setVerificationError(null);
        setVerificationStatus("Continuing confirmation for your submitted payment...");
        startVerification(
            pendingVerification.txHash,
            pendingVerification.receiptId,
            pendingVerification.payer,
            pendingVerification.chainId,
            pendingVerification.attemptId,
        );
    };

    const pendingVerificationPanel = pendingVerification && !isPaymentSettled ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center space-y-4" aria-live="polite">
            <div className="flex justify-center">
                {isVerifying || pendingVerification.phase === "broadcast"
                    ? <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
                    : <AlertTriangle className="h-8 w-8 text-amber-600" />}
            </div>
            <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Payment already submitted</p>
                <p className="text-xs leading-relaxed text-amber-900">
                    {verificationStatus || "Payment confirmation was interrupted. Continue with the same payment — do not pay again."}
                </p>
                {verificationError && (
                    <p className="text-[10px] font-mono leading-relaxed text-amber-900/80">{verificationError}</p>
                )}
            </div>
            <button
                type="button"
                onClick={retryPendingVerification}
                disabled={isVerifying}
                className="w-full rounded-xl border border-amber-300 bg-amber-100 px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-amber-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isVerifying ? "Verifying submitted payment…" : "Continue verification"}
            </button>
            <p className="text-[10px] leading-relaxed text-black/55">We will reuse this payment until confirmation completes.</p>
        </div>
    ) : null;

    /* The verifying/settled panel is identical for browser and embedded wallets (it keys off the
       settlement flag, not the wallet), so it's shared by both branches below. */
    const verificationPanel = (
        <div className={`${isPaymentSettled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"} border rounded-2xl p-5 text-center space-y-4 flex flex-col items-center`} aria-live="polite">
            {isPaymentSettled ? <CheckCircle className="w-8 h-8 text-emerald-600" /> : <Loader2 className="w-8 h-8 animate-spin text-amber-600" />}
            <p className={`text-xs font-semibold leading-relaxed ${isPaymentSettled ? "text-emerald-900" : "text-amber-900"}`}>{verificationStatus}</p>
            {shareableReceiptUrl && (
                <a href={shareableReceiptUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono font-bold text-[#1f62ab] hover:underline flex items-center gap-1">
                    Share receipt <ExternalLink className="w-3 h-3" />
                </a>
            )}
            {isPaymentSettled && (
                <div className="w-full pt-4 border-t border-black/10 space-y-3">
                    {/* Order matters. The merchant round trip comes first, but only when the merchant
                        actually sent this payer here — see autoReturnsToMerchant. Otherwise the payer
                        keeps their own destination as the primary action and the merchant link is
                        demoted to something they can choose, never an automatic navigation. */}
                    {autoReturnsToMerchant && merchantSuccessUrl ? (
                        <>
                            <p className="text-[10px] text-black/60 leading-relaxed text-center">
                                Taking you back to {merchantSuccessHost || "the merchant site"} in a few seconds…
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    const target = buildMerchantReturnUrl(merchantSuccessUrl);
                                    if (target) window.location.assign(target);
                                }}
                                className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                            >
                                Return to {merchantSuccessHost || "merchant site"} now <ArrowRight className="w-4 h-4" />
                            </button>
                        </>
                    ) : sessionInfo?.loggedIn ? (
                        /* Signed-in payer who arrived by QR, shared link, or from inside SubScript.
                           A peer request goes to the inbox (the request DM was marked approved at
                           settlement — creating a DM here would re-request payment); anything else
                           goes to transaction history, where this payment now appears. */
                        <>
                            <button
                                type="button"
                                onClick={() => window.location.assign(dashboardReturnUrl)}
                                className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                            >
                                {isUserRequest ? "Go to my inbox" : "Go to my dashboard"} <ArrowRight className="w-4 h-4" />
                            </button>
                            {merchantSuccessUrl && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const target = buildMerchantReturnUrl(merchantSuccessUrl);
                                        if (target) window.location.assign(target);
                                    }}
                                    className="mx-auto flex items-center justify-center gap-1.5 text-[10px] font-bold text-black/55 underline hover:text-black"
                                >
                                    Or continue to {merchantSuccessHost || "the merchant site"} <ExternalLink className="h-3 w-3" />
                                </button>
                            )}
                        </>
                    ) : merchantSuccessUrl ? (
                        /* Anonymous payer: no SubScript surface to send them to, so the merchant's
                           page is the only onward destination worth offering. Still their choice. */
                        <button
                            type="button"
                            onClick={() => {
                                const target = buildMerchantReturnUrl(merchantSuccessUrl);
                                if (target) window.location.assign(target);
                            }}
                            className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                            Continue to {merchantSuccessHost || "merchant site"} <ArrowRight className="w-4 h-4" />
                        </button>
                    ) : (
                        /* Anonymous payer, no return URL: the receipt link above is the record. */
                        <p className="text-[10px] text-black/55 leading-relaxed text-center">
                            You&apos;re all set — save the receipt link above for your records.
                            You can safely close this page.
                        </p>
                    )}
                </div>
            )}
        </div>
    );

    const embeddedEmailVerificationPanel = embeddedPaySession && payerNeedsEmail ? (
        <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 space-y-3 text-left">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#1f62ab]">Verify your email before payment</p>
            <p className="text-[10px] leading-relaxed text-black/60">We will email a one-time code. Payment stays locked until the code is confirmed.</p>
            {payerEmailStep === "email" ? <>
                <input type="email" value={payerEmailInput} onChange={(event) => { setPayerEmailInput(event.target.value); setPayerEmailError(null); }} placeholder="you@example.com" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-xs text-[#111827] placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none" />
                <button type="button" onClick={handleSendPayerEmailCode} disabled={isSendingPayerEmailCode || !canBindPayerEmail} className="w-full rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-[#FFFFF0] disabled:opacity-40">
                    {isSendingPayerEmailCode ? "Sending code…" : "Send verification code"}
                </button>
            </> : <>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={payerEmailCode} onChange={(event) => { setPayerEmailCode(event.target.value.replace(/\D/g, "")); setPayerEmailError(null); }} placeholder="6-digit code" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-center text-xs tracking-[0.3em] text-[#111827] placeholder:tracking-normal placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none" />
                <button type="button" onClick={handleVerifyPayerEmail} disabled={isVerifyingPayerEmail} className="w-full rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-[#FFFFF0] disabled:opacity-40">
                    {isVerifyingPayerEmail ? "Verifying…" : "Verify email"}
                </button>
            </>}
            {payerEmailError && <p className="text-[10px] font-mono text-red-700" role="alert">{payerEmailError}</p>}
        </div>
    ) : null;

    return (
        <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
            <div className="relative z-10 w-full max-w-md lg:max-w-4xl">

                <div className="text-center mb-8">
                    <h1 className="text-2xl font-extrabold text-[#111827] uppercase tracking-wider">
                        SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">checkout</span>
                    </h1>
                    <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">
                        {linkData?.billing_type === "RECURRING" || linkData?.recurring || linkData?.interval ? "Recurring" : "One-time"}
                    </p>
                </div>

                {isLoading ? (
                    /* Same component the route's loading.tsx renders, so the Suspense fallback and
                       this in-component fetch state are pixel-identical and the payer sees one
                       skeleton rather than two slightly different ones swapping. */
                    <CheckoutSkeleton />
                ) : error ? (
                    <div className="rounded-3xl border border-red-200 bg-red-50 p-6 sm:p-8 shadow-sm flex flex-col items-center justify-center text-center gap-6 py-12 lg:max-w-md lg:mx-auto" role="alert">
                        <div className="p-4 rounded-3xl bg-red-100 border border-red-200 text-red-700">
                            <AlertTriangle className="w-10 h-10" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-base font-bold text-red-900 uppercase tracking-wider">Checkout error</h2>
                            <p className="text-xs text-red-900/80 leading-relaxed max-w-xs">
                                {error}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="lg:flex lg:flex-row lg:items-stretch lg:gap-6">

                        {/* Desktop-only: a large, scannable QR beside the checkout block, same height.
                            Mobile keeps the inline "Pay on Mobile (Scan QR)" toggle further down — this
                            panel is hidden below lg so mobile is unchanged. */}
                        {checkoutUrl && (
                            <aside className="hidden lg:flex lg:w-[420px] lg:shrink-0 rounded-3xl border border-black/15 bg-white p-6 shadow-sm flex-col items-center justify-center text-center gap-5">
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-[#111827] uppercase tracking-wider">
                                        {cannotPayLink ? "Checkout status" : "Pay on mobile"}
                                    </p>
                                    <p className="text-[10px] text-black/60 leading-relaxed max-w-[280px]">
                                        {cannotPayLink
                                            ? "Payment controls are hidden because this link cannot submit a settlement."
                                            : "Scan with your phone's wallet browser to complete this payment on mobile."}
                                    </p>
                                </div>
                                {!cannotPayLink ? <div className="bg-white rounded-2xl p-4 w-full flex items-center justify-center overflow-hidden">
                                    <QRCode
                                        value={checkoutUrl}
                                        size={320}
                                        ecLevel="H"
                                        bgColor="#ffffff"
                                        fgColor="#000000"
                                        qrStyle="dots"
                                        eyeRadius={[
                                            [8, 8, 0, 8],
                                            [8, 8, 8, 0],
                                            [8, 0, 8, 8]
                                        ]}
                                        logoImage="/logo-colored.png"
                                        logoWidth={56}
                                        logoHeight={56}
                                        removeQrCodeBehindLogo={true}
                                        logoPadding={2}
                                    />
                                </div> : <div className="flex min-h-[352px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800">
                                    <AlertTriangle className="h-10 w-10" />
                                    <p className="text-xs font-bold uppercase tracking-wider">Checkout unavailable</p>
                                    <p className="text-[10px] text-black/60">{unpayableReason}</p>
                                </div>}
                                <div className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold ${remoteStatusError ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[#2775CA]/25 bg-[#2775CA]/[0.06] text-[#1f62ab]"}`} aria-live="polite">
                                    {cannotPayLink ? <AlertTriangle className="h-3.5 w-3.5" /> : remoteStatusError ? <AlertCircle className="h-3.5 w-3.5" /> : <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2775CA] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#2775CA]" /></span>}
                                    {cannotPayLink ? "Payment unavailable" : remoteStatusError || `Waiting for payment${lastRemoteStatusCheck ? ` · checked ${lastRemoteStatusCheck.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}`}
                                </div>
                                {!cannotPayLink && !isPaymentSettled && (
                                    <div className="w-full space-y-2">
                                        <button
                                            type="button"
                                            onClick={handleManualPaymentCheck}
                                            disabled={isManualChecking}
                                            className="w-full rounded-2xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-xs font-bold uppercase tracking-wider text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-50"
                                        >
                                            {isManualChecking ? (
                                                <><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Checking…</>
                                            ) : (
                                                <><CheckCircle className="mr-1.5 inline h-3.5 w-3.5" /> I've made my payment</>
                                            )}
                                        </button>
                                        {manualCheckMessage && (
                                            <p className="px-2 text-center text-[10px] leading-relaxed text-amber-900/80" aria-live="polite">{manualCheckMessage}</p>
                                        )}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={handlePayInBrowser}
                                    disabled={pendingVerification ? isVerifying : cannotPayLink}
                                    className="w-full rounded-2xl border border-[#2775CA]/30 bg-[#2775CA]/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#1f62ab] transition hover:bg-[#2775CA]/20 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {pendingVerification
                                        ? (isVerifying ? "Confirming payment…" : "Continue verification")
                                        : cannotPayLink ? "Payment unavailable" : "Pay in this browser"}
                                </button>
                            </aside>
                        )}

                        <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden lg:flex-1 lg:min-w-0">

                        {/* Progress. State was previously carried by colour alone — a blue label for
                            the current step against grey for the others — which WCAG 1.4.1 rules out
                            and which a screen reader could not report at all. Now a completed step
                            carries a check, the current one is marked aria-current, and the whole row
                            is a live region so moving between steps is announced. */}
                        <ol
                            role="status"
                            aria-live="polite"
                            aria-label="Checkout progress"
                            className="grid grid-cols-3 gap-2 rounded-2xl border border-black/10 bg-[#f8fafc] p-2 text-center text-[10px] font-bold uppercase tracking-wider"
                        >
                            {([
                                { label: "Account", done: isPaymentSettled || Boolean(reviewPaymentMode), current: !isPaymentSettled && !reviewPaymentMode },
                                { label: "Review", done: isPaymentSettled, current: Boolean(reviewPaymentMode) && !isPaymentSettled },
                                { label: "Confirmed", done: isPaymentSettled, current: false },
                            ] as const).map((step, index) => {
                                const settledStep = step.label === "Confirmed" && isPaymentSettled;
                                return (
                                    <li
                                        key={step.label}
                                        aria-current={step.current ? "step" : undefined}
                                        className={`flex items-center justify-center gap-1 ${
                                            settledStep
                                                ? "text-emerald-800"
                                                : step.current
                                                    ? "text-[#1f62ab]"
                                                    : step.done
                                                        ? "text-black/70"
                                                        : "text-black/60"
                                        }`}
                                    >
                                        {step.done ? (
                                            <CheckCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        ) : (
                                            <span aria-hidden="true">{index + 1} ·</span>
                                        )}
                                        <span>{step.label}</span>
                                        {step.done && <span className="sr-only">(done)</span>}
                                        {step.current && <span className="sr-only">(current step)</span>}
                                    </li>
                                );
                            })}
                        </ol>

                        {/* Role Mismatch Warning Banner */}
                        {isRoleMismatch && (
                            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                                <div className="flex items-start gap-3">
                                    <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-red-800 uppercase tracking-wide">Role Mismatch</p>
                                        <p className="text-[10px] text-black/60 leading-relaxed">
                                            This wallet is registered as a Merchant (Enterprise) account. Only standard User accounts can use this payment link to pay and start a DM. Please switch to a user wallet to proceed.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Unverified Merchant Warning Banner */}
                        {merchantVerified === false && !unverifiedAccepted && !isUserRequest && (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                                <div className="flex items-start gap-3">
                                    <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Unverified Merchant</p>
                                        <p className="text-[10px] text-black/60 leading-relaxed">
                                            This merchant has not been verified by SubScript. Proceed with caution and ensure you trust the payment recipient.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setUnverifiedAccepted(true)}
                                    className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
                                >
                                    I understand the risk, continue
                                </button>
                            </div>
                        )}

                        {/* Verified Merchant Badge */}
                        {merchantVerified === true && (
                            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                <Shield className="w-4 h-4 text-emerald-700" />
                                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">SubScript Verified Merchant</span>
                            </div>
                        )}

                        {cannotPayLink && (
                            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex flex-col items-center justify-center text-center gap-3">
                                <AlertTriangle className="w-8 h-8 text-red-700" />
                                <p className="text-xs font-bold text-red-800 uppercase tracking-wide">{unpayableTitle}</p>
                                <p className="text-[10px] text-black/60 leading-relaxed">{unpayableReason}</p>
                            </div>
                        )}
                        {isTestnetLink && !isSimulationOnly && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
                                <p className="text-xs font-bold uppercase tracking-wide text-amber-900">Arc Testnet Payment</p>
                                <p className="mt-2 text-[10px] leading-relaxed text-black/60">
                                    This payment moves test USDC on Arc Testnet. Test USDC has no monetary value.
                                </p>
                            </div>
                        )}

                        {linkData.expires_at && (
                            <div className="flex justify-end">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#f8fafc] border border-black/15 text-black/60">
                                    Expires: {new Date(linkData.expires_at).toLocaleDateString()}
                                </span>
                            </div>
                        )}


                        <div className="space-y-2">
                            <span className="text-[10px] font-bold text-black/60 uppercase tracking-widest">You are paying for</span>
                            <h2 className="text-2xl font-extrabold text-[#111827] tracking-tight">{linkData.title}</h2>
                            {linkData.description && (
                                <p className="text-xs text-black/60 leading-relaxed font-sans">{linkData.description}</p>
                            )}
                            {(linkData.invoice_number || linkData.due_date) && (
                                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                                    {linkData.invoice_number && (
                                        <span className="text-[10px] font-mono text-black/60 uppercase tracking-wider">
                                            Invoice {linkData.invoice_number}
                                        </span>
                                    )}
                                    {linkData.due_date && (
                                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#d4a853]">
                                            Due {new Date(linkData.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {giftBeneficiaryLabel && (
                            <div className="rounded-2xl border border-[#a8cc00]/40 bg-[#f4ffd6] p-4">
                                <div className="flex items-start gap-3">
                                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-[#a8cc00]/40 bg-white text-[#5c7a00]">
                                        <Gift className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#5c7a00]">Gift payment</p>
                                        <p className="mt-1 text-xs leading-relaxed text-black/70">
                                            This payment is a gift. Access will be granted to{" "}
                                            <span className="font-mono font-bold text-[#111827]">{giftBeneficiaryLabel}</span>.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl border border-black/10 bg-[#f8fafc] p-5 flex justify-between items-center">
                            <span className="text-[10px] text-black/60 uppercase font-bold tracking-wider">Amount Due</span>
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-[#2775CA] tracking-tight">
                                    {`${(Number(linkData.amount_usdc) / 1000000).toFixed(2)} USDC`}
                                </p>
                                <p className="text-[10px] text-black/60 uppercase font-bold tracking-widest font-mono">
                                    {displayCurrency && displayCurrency !== "USD" && displayAmount !== undefined
                                        ? `≈ ${fiatSymbol}${displayAmount.toFixed(2)} ${displayCurrency} · Arc Network`
                                        : "Arc Network"}
                                </p>
                            </div>
                        </div>


                        <div ref={paymentControlsRef}>
                        {/* A logged-in SubScript (email/Google) account must ALWAYS be offered its
                            embedded "pay from your SubScript wallet" path — even when a browser wallet
                            extension has auto-connected (isConnected). Previously this whole block was
                            gated on !isConnected, so an auto-connected extension flipped the checkout to
                            the browser-wallet branch and forced the user to verify a DIFFERENT wallet,
                            with no way to pay from their actual account. */}
                        {(!isConnected || embeddedPaySession) ? (
                            <div className="space-y-4">
                              {pendingVerificationPanel ? pendingVerificationPanel : (verificationStatus && !verificationError) ? verificationPanel : (
                                <>
                                {/* Embedded (Circle/email) wallet: pay on-page from the SubScript wallet
                                    balance — no browser wallet to connect, and no DM detour for one-time
                                    merchant payments. */}
                                {embeddedPaySession && !cannotPayLink && (
                                    <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 space-y-3">
                                        <p className="text-[11px] leading-relaxed text-black/70">
                                            Signed in{sessionInfo?.email ? ` as ${sessionInfo.email}` : ""}. Pay directly from your SubScript wallet — no browser wallet needed.
                                        </p>
                                        {embeddedEmailVerificationPanel}
                                         <button
                                             onClick={() => beginPaymentReview("embedded")}
                                             disabled={!pendingVerificationHydrated || Boolean(pendingVerification) || isEmbeddedPaying || !clientIntentId || cannotPayLink || payerNeedsEmail}
                                            className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-50 text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                                        >
                                            {isEmbeddedPaying ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> {
                                                    paymentStep === "sending" ? "Sending payment…" :
                                                    paymentStep === "verifying" ? "Verifying settlement…" :
                                                    "Processing…"
                                                }</>
                                            ) : (
                                                <>Pay {(Number(linkData.amount_usdc) / 1_000_000).toFixed(2)} USDC <ArrowRight className="w-4 h-4" /></>
                                            )}
                                        </button>
                                        {verificationError && <p className="text-[10px] font-mono text-red-700">{verificationError}</p>}
                                    </div>
                                )}

                                {/* Peer (user-to-user) requests are conversational, so a signed-in user may
                                    open them in DMs. One-time MERCHANT payments never route to DMs — they are
                                    paid on this page. */}
                                {isUserRequest && !cannotPayLink && sessionInfo?.loggedIn && sessionInfo.role !== "ENTERPRISE" && (
                                    <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 space-y-3">
                                        <p className="text-[11px] leading-relaxed text-black/70">
                                            You're already signed in to SubScript
                                            {sessionInfo.email ? ` as ${sessionInfo.email}` : sessionInfo.wallet ? ` (${sessionInfo.wallet.slice(0, 6)}...${sessionInfo.wallet.slice(-4)})` : ""}.
                                            Open this request in your DMs, or connect a wallet below to pay directly.
                                        </p>
                                        <button
                                            onClick={handleGoToDms}
                                            disabled={isCreatingDm}
                                            className="w-full py-3 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-40 text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                        >
                                            {isCreatingDm ? (
                                                <><Loader2 className="w-4 h-4 animate-spin text-black" /> Opening DMs...</>
                                            ) : (
                                                <>Go to my SubScript DMs <ArrowRight className="w-4 h-4" /></>
                                            )}
                                        </button>
                                        {dmError && <p className="text-[10px] font-mono text-red-700">{dmError}</p>}
                                        <div className="flex items-center gap-3 pt-1">
                                            <span className="h-px flex-1 bg-black/15" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-black/60">or pay with a wallet</span>
                                            <span className="h-px flex-1 bg-black/15" />
                                        </div>
                                    </div>
                                )}

                                {embeddedPaySession && !isConnected && !cannotPayLink && externalWalletEnabled && (
                                    <div className="flex items-center gap-3 pt-1">
                                        <span className="h-px flex-1 bg-black/15" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-black/60">or pay with a browser wallet</span>
                                        <span className="h-px flex-1 bg-black/15" />
                                    </div>
                                )}

                                {/* The browser-wallet connect prompt only makes sense when no wallet is
                                    connected yet. When an embedded user already has an extension connected,
                                    they pay via the embedded card above — no "Connect Wallet" nag.

                                    externalWalletEnabled additionally hides it while an operator has
                                    external wallets paused. Unlike sign-in, paying here is an on-chain
                                    transaction the server never signs, so this switch is the only thing
                                    that stops it — and the SubScript-account path below stays available,
                                    so a payer is never left without a way to pay. */}
                                {!isConnected && !cannotPayLink && externalWalletEnabled && (walletConnectors.length > 1 ? (
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-black/60 text-center">
                                            Multiple wallets found — choose one
                                        </p>
                                        {walletConnectors.map((connector) => (
                                            <button
                                                key={connector.uid}
                                                onClick={() => {
                                                    setVerificationError(null);
                                                    void connectAsync({ connector }).catch((error: any) => {
                                                        setVerificationError(friendlyError(error?.shortMessage || error?.message || "The browser wallet could not be connected."));
                                                    });
                                                }}
                                                disabled={isConnecting}
                                                className="w-full py-3.5 bg-white hover:bg-black/5 border border-black/15 text-[#111827] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50"
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
                                        <p className="text-[10px] text-black/60 text-center leading-relaxed font-sans">
                                            Connect your browser wallet (e.g. MetaMask, Rabby) on {expectedChainName} to complete the payment.
                                        </p>
                                        <button
                                            onClick={handleConnect}
                                            disabled={isConnecting}
                                            className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-50 text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                                        >
                                            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                                            {isConnecting ? "Connecting..." : "Connect Wallet"}
                                        </button>
                                    </>
                                ))}
                                {/* Signed-out visitors previously had NO error surface: connect failures
                                    set verificationError, but it only rendered inside the signed-in
                                    embedded block — so "Pay in this browser" looked dead on desktops
                                    without a wallet extension. */}
                                {!embeddedPaySession && verificationError && (
                                    <p className="text-[10px] font-mono text-red-700 text-center leading-relaxed" role="alert">{verificationError}</p>
                                )}
                                {!embeddedPaySession && !cannotPayLink && (
                                    <p className="text-[10px] text-black/60 text-center leading-relaxed font-sans">
                                        {externalWalletEnabled ? "Have a SubScript account? " : "Browser-wallet payments are paused right now. "}
                                        <a href="/login" target="_blank" rel="noopener noreferrer" className="text-[#1f62ab] hover:underline font-bold">
                                            Sign in
                                        </a>
                                        , then reload this page to pay from your email wallet — no extension needed.
                                    </p>
                                )}
                                </>
                              )}
                            </div>
                        ) : (
                            <div className="space-y-6">

                                <div className="flex flex-col gap-1.5 border-t border-b border-black/10 py-3 text-[10px] font-mono text-black/60">
                                    <div className="flex items-center justify-between">
                                        <span>Payer: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""}</span>
                                        <button type="button" onClick={() => disconnect()} className="hover:text-black transition-colors uppercase font-bold">Disconnect</button>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-black/60">
                                        <span>Network:</span>
                                        <span className={`font-bold ${isWrongChain ? "text-amber-700" : "text-[#1f62ab]"}`}>
                                            {isWrongChain ? `Switch to ${requiredChainName}` : `${requiredChainName} ✓`}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-black/60">
                                        <span>Arc Network USDC Balance:</span>
                                        <span className="font-bold text-[#1f62ab]">
                                            {parseFloat(formatUnits(arcUsdcBalance, 6)).toFixed(2)} USDC
                                        </span>
                                    </div>
                                    {isCctpMode && (
                                        <div className="flex items-center justify-between mt-1 text-black/60">
                                            <span>{cctpOriginChainName} USDC Balance:</span>
                                            <span className="font-bold text-blue-700">
                                                {balanceData ? `${parseFloat(balanceData.formatted).toFixed(2)} USDC` : "0.00 USDC"}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {isSessionLoading ? (
                                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-black/15 bg-[#f8fafc] p-4 text-[10px] text-black/60"><Loader2 className="h-4 w-4 animate-spin" /> Checking SubScript account…</div>
                                ) : hasMatchingWalletSession && sessionInfo?.email ? (
                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Ready to pay</p>
                                        <p className="mt-1 text-[11px] text-black/70">Signed in as <span className="font-bold text-[#111827]">{sessionInfo.email}</span></p>
                                        <p className="mt-1 text-[10px] text-black/60">Wallet ownership and email OTP are verified.</p>
                                    </div>
                                ) : !hasMatchingWalletSession ? (
                                    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Verify this wallet</p>
                                            <p className="mt-1 text-[10px] leading-relaxed text-black/60">A wallet signature confirms ownership. After that, a verified email OTP is mandatory before payment.</p>
                                            {sessionInfo?.loggedIn && sessionInfo.wallet && <p className="mt-2 text-[10px] text-black/60">This browser is currently signed in to another SubScript account.</p>}
                                        </div>
                                        <button type="button" onClick={handleAuthenticateConnectedWallet} disabled={isWalletAuthenticating} className="w-full rounded-xl bg-[#2775CA] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#FFFFF0] disabled:opacity-50">{isWalletAuthenticating ? "Waiting for signature…" : "Verify connected wallet"}</button>
                                        {walletAuthenticationError && <div className="space-y-2"><p className="text-[10px] leading-relaxed text-red-800" role="alert">{walletAuthenticationError}</p>{walletAuthenticationError.includes("does not have") && <a href={`/signup?next=${encodeURIComponent(`/pay/${id}`)}`} className="inline-block text-[10px] font-bold text-[#1f62ab] underline">Create a user account</a>}</div>}
                                    </div>
                                ) : null}

                                {pendingVerificationPanel ? pendingVerificationPanel : isWrongChain ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
                                        <div className="flex items-center gap-3">
                                            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0" />
                                            <div>
                                                <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Wrong Network</p>
                                                <p className="text-[10px] text-black/60 mt-0.5 leading-relaxed">
                                                    Your wallet is connected to a different chain. Switch to <span className="font-bold text-black/70">{requiredChainName}</span> to continue.
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleSwitchChain}
                                            className="w-full py-3 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                        >
                                            Switch to {requiredChainName}
                                        </button>
                                    </div>
                                ) : verificationStatus && !verificationError ? (
                                    verificationPanel
                                ) : (
                                    <div className="space-y-4">
                                        {verificationError && (
                                            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-left space-y-2">
                                                <span className="text-red-700 text-[10px] font-bold uppercase tracking-wide block">Payment Failed</span>
                                                <p className="text-red-900/80 text-[10px] font-mono mt-1 leading-normal break-words">{verificationError}</p>
                                                {merchantCancelUrl && (
                                                    <a
                                                        href={merchantCancelUrl}
                                                        className="text-[10px] font-mono text-black/60 hover:text-black/70 underline inline-flex items-center gap-1"
                                                    >
                                                        Back to {hostOf(merchantCancelUrl) || "merchant site"} <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                )}
                                            </div>
                                        )}

                                        {payerNeedsEmail && (
                                            <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 space-y-3 text-left">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-[#1f62ab]">Verify your email</p>
                                                <p className="text-[10px] leading-relaxed text-black/60">
                                                    External wallets must verify an email for receipts and security notices before paying.
                                                </p>
                                                {!hasMatchingWalletSession && (
                                                    <p className="text-[10px] leading-relaxed text-amber-900/80">Sign in with this same wallet first, then return here to verify your email.</p>
                                                )}
                                                {payerEmailStep === "email" ? <>
                                                    <input type="email" value={payerEmailInput} onChange={(event) => { setPayerEmailInput(event.target.value); setPayerEmailError(null); }} placeholder="you@example.com" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-xs text-[#111827] placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none" />
                                                    <button type="button" onClick={handleSendPayerEmailCode} disabled={isSendingPayerEmailCode || !hasMatchingWalletSession} className="w-full rounded-xl bg-[#2775CA] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-[#FFFFF0] disabled:opacity-40">
                                                        {isSendingPayerEmailCode ? "Sending code…" : "Send verification code"}
                                                    </button>
                                                </> : <>
                                                    <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={payerEmailCode} onChange={(event) => { setPayerEmailCode(event.target.value.replace(/\D/g, "")); setPayerEmailError(null); }} placeholder="6-digit code" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-center text-xs tracking-[0.3em] text-[#111827] placeholder:tracking-normal placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none" />
                                                    <button type="button" onClick={handleVerifyPayerEmail} disabled={isVerifyingPayerEmail} className="w-full rounded-xl bg-[#2775CA] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-[#FFFFF0] disabled:opacity-40">
                                                        {isVerifyingPayerEmail ? "Verifying…" : "Verify email"}
                                                    </button>
                                                </>}
                                                {payerEmailError && <p className="text-[10px] font-mono text-red-700">{payerEmailError}</p>}
                                            </div>
                                        )}

                                        {!hasSufficientArcBalance && (
                                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3 shadow-sm">
                                                <div className="flex items-start gap-3">
                                                    <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                                                    <div className="space-y-1">
                                                        <h3 className="text-xs font-bold text-[#111827] uppercase tracking-wide">Arc USDC Required</h3>
                                                        <p className="text-[10px] text-black/60 leading-relaxed font-sans">
                                                            Your Arc Network balance ({parseFloat(formatUnits(arcUsdcBalance, 6)).toFixed(2)} USDC) is insufficient for this ${(Number(linkData.amount_usdc) / 1000000).toFixed(2)} USDC payment.
                                                        </p>
                                                        <p className="text-[10px] text-black/60 leading-relaxed font-sans">
                                                            Cross-chain CCTP checkout is disabled until Arc-side memo settlement is live. Bridge or fund USDC on Arc, then complete this payment.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {!hasMatchingWalletSession ? (
                                            <button type="button" onClick={handleAuthenticateConnectedWallet} disabled={isWalletAuthenticating} className="w-full py-4 border border-amber-200 bg-amber-50 text-amber-900 font-bold rounded-2xl text-xs uppercase tracking-wider disabled:opacity-50">
                                                {isWalletAuthenticating ? "Verifying wallet…" : "Verify wallet to continue"}
                                            </button>
                                        ) : payerNeedsEmail ? (
                                            <button type="button" disabled className="w-full py-4 border border-amber-200 bg-amber-50 text-amber-900 font-bold rounded-2xl text-xs uppercase tracking-wider cursor-not-allowed">Verify email OTP to continue</button>
                                        ) : isRoleMismatch ? (
                                             <button
                                                 type="button"
                                                 disabled={true}
                                                 className="w-full py-4 border border-red-200 bg-red-50 text-red-700 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-not-allowed"
                                             >
                                                 Use a Personal Account
                                             </button>
                                        ) : cannotPayLink ? (
                                            <button
                                                type="button"
                                                disabled={true}
                                                className="w-full py-4 border border-red-200 bg-red-50 text-red-700 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-not-allowed"
                                            >
                                                {unpayableTitle}
                                            </button>
                                        ) : (merchantVerified === false && !unverifiedAccepted && !isUserRequest) ? (
                                            <button
                                                type="button"
                                                /* Same mode as the pay button this branch replaces, so
                                                   "Accept & Continue" carries straight into the wallet
                                                   review instead of dismissing to an unchanged screen. */
                                                onClick={() => {
                                                    setPendingPaymentMode("wallet");
                                                    setShowUnverifiedWarning(true);
                                                }}
                                                className="w-full py-4 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                            >
                                                <ShieldAlert className="w-4 h-4" /> Review Unverified Merchant Warning
                                            </button>
                                        ) : isInsufficientBalance || !hasSufficientArcBalance ? (
                                            <button
                                                type="button"
                                                disabled={true}
                                                className="w-full py-4 border border-red-200 bg-red-50 text-red-700 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-not-allowed"
                                            >
                                                Insufficient USDC Balance
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => beginPaymentReview("wallet")}
                                                disabled={!pendingVerificationHydrated || Boolean(pendingVerification) || isPaying || isConfirming || isEmbeddedPaying}
                                                className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-40 text-[#FFFFF0] font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                                            >
                                                {(isPaying || isConfirming || isEmbeddedPaying) ? (
                                                    <><Loader2 className="w-4 h-4 animate-spin" /> {
                                                        paymentStep === "approving" ? "Approving USDC…" :
                                                        paymentStep === "sending" ? "Sending payment…" :
                                                        paymentStep === "confirming" ? "Confirming on-chain…" :
                                                        paymentStep === "verifying" ? "Verifying settlement…" :
                                                        "Processing…"
                                                    }</>
                                                ) : isCctpChain ? (
                                                    /* Subscribe seamlessly via CCTP */
                                                    <>
                                                        Bridge via {cctpOriginChainName} <ArrowRight className="w-4 h-4" />
                                                    </>
                                                ) : (
                                                    <>
                                                        Pay {(Number(linkData.amount_usdc) / 1000000).toFixed(2)} USDC{displayCurrency && displayCurrency !== "USD" && displayAmount !== undefined ? ` (≈ ${fiatSymbol}${displayAmount.toFixed(2)})` : ""} <ArrowRight className="w-4 h-4" />
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        </div>

                        {/* Inline QR toggle for mobile/tablet. On desktop (lg+) the large QR shows in the
                            left panel beside the checkout, so this redundant toggle is hidden there. */}
                        {checkoutUrl && !cannotPayLink && (
                            <div className="border-t border-black/10 pt-4 space-y-3 lg:hidden">
                                <button
                                    type="button"
                                    onClick={() => setShowQrCode(!showQrCode)}
                                    className="w-full py-2.5 bg-white hover:bg-black/5 border border-black/15 text-[#111827] font-bold rounded-xl text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                                >
                                    <QrCode className="w-3.5 h-3.5 text-[#1f62ab]" />
                                    {showQrCode ? "Hide QR Code" : "Pay on Mobile (Scan QR)"}
                                </button>

                                {showQrCode && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="flex flex-col items-center justify-center space-y-3 bg-[#f8fafc] border border-black/10 rounded-2xl p-4 font-sans text-center overflow-hidden"
                                    >
                                        <p className="text-[10px] text-black/60 max-w-[200px] leading-relaxed">
                                            Scan this QR code with your mobile wallet's browser to complete the payment on your phone.
                                        </p>
                                        <div className="flex justify-center p-3 bg-white rounded-xl">
                                            <QRCode
                                                value={checkoutUrl}
                                                size={140}
                                                ecLevel="H"
                                                bgColor="#ffffff"
                                                fgColor="#000000"
                                                qrStyle="dots"
                                                eyeRadius={[
                                                    [8, 8, 0, 8],
                                                    [8, 8, 8, 0],
                                                    [8, 0, 8, 8]
                                                ]}
                                                logoImage="/logo-colored.png"
                                                logoWidth={28}
                                                logoHeight={28}
                                                removeQrCodeBehindLogo={true}
                                                logoPadding={2}
                                            />
                                        </div>
                                        {!cannotPayLink && !isPaymentSettled && (
                                            <button
                                                type="button"
                                                onClick={handleManualPaymentCheck}
                                                disabled={isManualChecking}
                                                className="w-full rounded-xl border border-emerald-300 bg-emerald-100 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-50"
                                            >
                                                {isManualChecking ? "Checking…" : "I've made my payment"}
                                            </button>
                                        )}
                                        {manualCheckMessage && (
                                            <p className="text-center text-[10px] leading-relaxed text-amber-900/80" aria-live="polite">{manualCheckMessage}</p>
                                        )}
                                    </motion.div>
                                )}
                            </div>
                        )}

                        {canShareCheckout && !isPaymentSettled && (
                            <div className="border-t border-black/10 pt-4">
                                <button
                                    type="button"
                                    onClick={() => { setShareOpen((open) => !open); setShareNotice(null); }}
                                    aria-expanded={shareOpen}
                                    className="w-full rounded-2xl border border-black/15 bg-white py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#111827] transition hover:bg-black/[0.03] flex items-center justify-center gap-2"
                                >
                                    <Users className="h-3.5 w-3.5 text-[#2775CA]" />
                                    {shareOpen ? "Close sharing" : "Share with a friend"}
                                </button>

                                {shareOpen && (
                                    <div className="mt-3 space-y-2 rounded-2xl border border-black/10 bg-[#f8fafc] p-3">
                                        <p className="text-[10px] leading-relaxed text-black/60">
                                            Send this checkout to someone who can pay it. They&apos;ll see the same
                                            amount and merchant you do.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleNativeShare}
                                            className="w-full rounded-xl bg-[#2775CA] px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#FFFFF0] transition hover:bg-[#1f62ab]"
                                        >
                                            Copy or share link
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => window.location.assign(`${getDashboardUrl("USER", "/dashboard/user")}?tab=inbox`)}
                                            className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#111827] transition hover:bg-black/[0.03]"
                                        >
                                            Send in SubScript DMs
                                        </button>
                                        {shareNotice && (
                                            <p className="text-[10px] leading-relaxed text-[#2775CA]" aria-live="polite">{shareNotice}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="pt-2 flex items-center justify-center gap-1.5 text-[10px] text-black/60 font-sans">
                            <Lock className="w-3 h-3" /> Protected by SubScript
                        </div>
                        {!isPaymentSettled && !(pendingVerification || txHash || successTxHash || verificationStatus || isPaying || isEmbeddedPaying || isVerifying) && (
                            merchantCancelUrl ? (
                                <a href={merchantCancelUrl} className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-black/60 underline hover:text-black">
                                    Cancel and return to {hostOf(merchantCancelUrl) || "merchant site"} <ExternalLink className="h-3 w-3" />
                                </a>
                            ) : (
                                <button type="button" onClick={() => window.history.length > 1 ? window.history.back() : router.push("/")} className="mx-auto block text-[10px] font-bold text-black/60 underline hover:text-black">
                                    Exit checkout
                                </button>
                            )
                        )}
                        {!isPaymentSettled && (pendingVerification || txHash || successTxHash || verificationStatus || isPaying || isEmbeddedPaying || isVerifying) && (
                            <p className="text-center text-[10px] font-medium leading-relaxed text-amber-900/80">Payment submitted — keep this page open while settlement is confirmed.</p>
                        )}
                        </div>
                    </div>
                )}
            </div>

            <AnimatePresence>
                {reviewPaymentMode && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} role="dialog" aria-modal="true" aria-labelledby="checkout-review-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-3xl border border-black/15 bg-white p-6 text-left shadow-xl">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1f62ab]">Final review</p>
                                <h3 id="checkout-review-title" className="mt-1 text-xl font-black text-[#111827]">Pay {displayMerchantName}?</h3>
                            </div>
                            <div className="space-y-3 rounded-2xl border border-black/15 bg-[#f8fafc] p-4 text-xs">
                                <div className="flex justify-between gap-4"><span className="text-black/60">Merchant</span><span className="text-right font-bold text-[#111827]">{displayMerchantName}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-black/60">You pay</span><span className="font-bold text-[#111827]">{(Number(linkData?.amount_usdc || 0) / 1_000_000).toFixed(2)} USDC</span></div>
                                {displayCurrency && displayCurrency !== "USD" && displayAmount !== undefined && <div className="flex justify-between gap-4"><span className="text-black/60">Estimated value</span><span className="font-bold text-[#111827]">≈ {fiatSymbol}{displayAmount.toFixed(2)} {displayCurrency}</span></div>}
                            </div>
                            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-900/80">Only continue if you recognize {displayMerchantName} and the amount is correct.</p>
                            <div className="grid grid-cols-2 gap-3">
                                <button type="button" onClick={() => setReviewPaymentMode(null)} className="rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-bold text-[#111827] hover:bg-black/5">Back</button>
                                <button type="button" disabled={isPaying || isEmbeddedPaying} onClick={() => { const mode = reviewPaymentMode; setReviewPaymentMode(null); if (mode === "embedded") void handleEmbeddedPay(); else void handlePay(); }} className="rounded-2xl bg-[#2775CA] px-4 py-3 text-xs font-bold text-[#FFFFF0] hover:bg-[#1f62ab] disabled:cursor-not-allowed disabled:opacity-50">Confirm payment</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showUnverifiedWarning && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="unverified-merchant-title"
                            className="w-full max-w-md rounded-3xl border border-amber-300 bg-white p-6 shadow-xl space-y-6 text-left relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-100/60 rounded-full blur-3xl -z-10" />
                            <div className="flex items-center gap-3 pb-2 border-b border-black/10">
                                <div className="p-2.5 rounded-2xl bg-amber-100 border border-amber-200 text-amber-700">
                                    <ShieldAlert className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 id="unverified-merchant-title" className="text-base font-bold text-[#111827] uppercase tracking-wider">Unverified Merchant</h3>
                                    <p className="text-[10px] text-black/60 uppercase tracking-widest font-mono">Security Advisory</p>
                                </div>
                            </div>

                            <div className="space-y-4 font-sans text-xs text-black/70 leading-relaxed">
                                <p>
                                    You are about to make a payment to an unverified merchant:
                                </p>
                                <div className="p-3 bg-[#f8fafc] border border-black/15 rounded-xl text-sm font-bold text-[#111827]">
                                    {displayMerchantName}
                                </div>
                                <p>
                                    This merchant has not completed SubScript verification. Confirm that you recognize the name before proceeding.
                                </p>
                                <p className="text-amber-800 font-medium">
                                    Payments to unverified merchants may be harder to recover.
                                </p>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPendingPaymentMode(null);
                                        setShowUnverifiedWarning(false);
                                    }}
                                    className="flex-1 py-3 bg-white hover:bg-black/5 border border-black/15 text-[#111827] font-bold rounded-2xl text-xs uppercase tracking-wider transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUnverifiedAccepted(true);
                                        setShowUnverifiedWarning(false);
                                        /* Chain straight into the final review rather than dropping the
                                           user back on the pay button to click it a second time. */
                                        if (pendingPaymentMode) {
                                            const mode = pendingPaymentMode;
                                            setPendingPaymentMode(null);
                                            beginPaymentReview(mode, { unverifiedAcknowledged: true });
                                        }
                                    }}
                                    className="flex-1 py-3 bg-amber-500 text-black font-bold rounded-2xl text-xs uppercase tracking-wider hover:brightness-110 transition-all shadow-sm"
                                >
                                    Accept & Continue
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
