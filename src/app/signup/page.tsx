"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import posthog from "posthog-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain, type Connector } from "wagmi";
import { activeArcChain } from "@/lib/wagmi";
import { WalletSelectionModal } from "@/components/WalletSelectionModal";
import { MultiWalletAuthRow } from "@/components/auth/MultiWalletAuthRow";
import { 
  Loader2, 
  Mail, 
  Wallet, 
  CheckCircle, 
  AlertCircle, 
  ArrowRight,
  ArrowLeft,
  User,
  Building2,
  Lock,
  MailCheck,
  LogOut,
  Sparkles,
  ExternalLink
} from "@/components/icons";
import { getDashboardUrl, getSafeRelativePath } from "@/utils/navigation";
import Script from "next/script";
import { CIRCLE_GOOGLE_ENABLED } from "@/lib/featureFlags";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";
import AuthSplitLayout from "@/components/auth/AuthSplitLayout";
import AuthLoadingState from "@/components/auth/AuthLoadingState";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import { MetaMaskIcon, MetaMaskColorSpinner } from "@/components/auth/QuickAuthButtons";

declare global {
  interface Window {
    turnstile: any;
  }
}

const PRESELECTED_ROLE_KEY = "subscript_preselected_role";
const X_HANDLE_URL = "https://x.com/SubScript_onarc";
const ROLE_ARM_TTL_MS = 10 * 60 * 1000;
type ArmedRole = { role: "USER" | "ENTERPRISE"; armedAt: number };

const clearPreselectedRole = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PRESELECTED_ROLE_KEY);
  }
};

const armPreselectedRole = (role: "USER" | "ENTERPRISE") => {
  if (typeof window === "undefined") return;
  const armed: ArmedRole = { role, armedAt: Date.now() };
  window.localStorage.setItem(PRESELECTED_ROLE_KEY, JSON.stringify(armed));
};

const readPreselectedRole = (): "USER" | "ENTERPRISE" | null => {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(PRESELECTED_ROLE_KEY);
  if (!stored) return null;

  try {
    const armed = JSON.parse(stored) as Partial<ArmedRole> | null;
    const role = armed?.role;
    const armedAt = armed?.armedAt;
    if ((role !== "USER" && role !== "ENTERPRISE") || typeof armedAt !== "number") {
      clearPreselectedRole();
      return null;
    }
    const age = Date.now() - armedAt;
    if (age < 0 || age > ROLE_ARM_TTL_MS) {
      clearPreselectedRole();
      return null;
    }
    return role;
  } catch {
    clearPreselectedRole();
    return null;
  }
};

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const getSafeNext = useCallback(() => {
    if (typeof window === "undefined") return "";
    return getSafeRelativePath(searchParams?.get("next") || null);
  }, [searchParams]);

  const { address, isConnected, connector: activeConnector, chainId } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { externalWalletEnabled, googleSigninEnabled, merchantInviteOnlyEnabled, loaded: platformFlagsLoaded } = usePlatformFlags();
  const googleAvailable = CIRCLE_GOOGLE_ENABLED && (!platformFlagsLoaded || googleSigninEnabled !== false);

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState(searchParams?.get("email") || "");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    const handlePopState = () => {
      if (typeof window !== "undefined") {
        const isSignupRoute = window.location.pathname.startsWith("/signup");
        setActiveTab(isSignupRoute ? "signup" : "signin");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const [siweLoading, setSiweLoading] = useState(false);
  const [siweError, setSiweError] = useState<string | null>(null);
  const [walletAuthRequested, setWalletAuthRequested] = useState(false);
  const [walletSignupPrompt, setWalletSignupPrompt] = useState(false);

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [merchantInvite, setMerchantInvite] = useState("");
  const [merchantInviteBlocked, setMerchantInviteBlocked] = useState(false);
  const inviteOnlyNotice = merchantInviteOnlyEnabled && !merchantInvite;

  const isCompleteRoleParam =
    searchParams?.get("completeRole") === "1" || searchParams?.get("selectRole") === "1";
  const [showRoleSelector, setShowRoleSelector] = useState(isCompleteRoleParam);
  const [selectedRole, setSelectedRole] = useState<"USER" | "ENTERPRISE">(() => {
    const roleHint = (searchParams?.get("role") || searchParams?.get("type") || "").toLowerCase();
    return ["merchant", "enterprise", "business"].includes(roleHint) ? "ENTERPRISE" : "USER";
  });
  const [signupStep, setSignupStep] = useState<"select-role" | "auth">(
    isCompleteRoleParam ? "select-role" : "auth"
  );
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [requiresEmailLinking, setRequiresEmailLinking] = useState(false);
  const [isExternalWalletSignup, setIsExternalWalletSignup] = useState(false);

  const [activeSession, setActiveSession] = useState<{ wallet: string; email?: string; role: string } | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const isTurnstileConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const captchaRequired = isTurnstileConfigured && !captchaToken;

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).turnstile) {
      setTurnstileLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!turnstileLoaded || otpSent || !window.turnstile) return;
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const container = document.getElementById("turnstile-email-signup");
    if (!siteKey || !container || container.innerHTML !== "") return;

    try {
      window.turnstile.render(container, {
        sitekey: siteKey,
        theme: "light",
        callback: (token: string) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(""),
        "error-callback": () => setCaptchaToken(""),
      });
    } catch (e) {
      console.warn("Turnstile render error on signup:", e);
    }
  }, [turnstileLoaded, otpSent]);

  useEffect(() => {
    router.prefetch("/signin");
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (data.loggedIn) {
            setIsExternalWalletSignup(data.provider === "external_wallet" || (!data.provider && !data.email));
            if (data.email) {
              setEmail(data.email);
              setRequiresEmailLinking(false);
            } else {
              setRequiresEmailLinking(true);
            }
            if (data.role) {
              setActiveSession({
                wallet: data.wallet,
                email: data.email || undefined,
                role: data.role,
              });
            } else {
              setShowRoleSelector(true);
            }
          }
        }
      } catch (err) {
        console.error("Failed to check active session on signup mount:", err);
      }
    };
    checkSession();

    const initialInvite = searchParams?.get("merchantCode") || searchParams?.get("invite") || "";
    setMerchantInvite(initialInvite);

    const roleHint = (searchParams?.get("role") || searchParams?.get("type") || "").toLowerCase();
    if (["merchant", "enterprise", "business"].includes(roleHint)) {
      setSelectedRole("ENTERPRISE");
    } else if (["user", "personal", "subscriber"].includes(roleHint)) {
      setSelectedRole("USER");
    }

    if (searchParams?.get("auth") === "1" || searchParams?.get("step") === "auth") {
      setSignupStep("auth");
    }

    if (searchParams?.get("completeRole") === "1") {
      setShowRoleSelector(true);
      setSignupStep("select-role");
    }

    const refParam = searchParams?.get("ref") || searchParams?.get("referral");
    if (refParam) {
      localStorage.setItem("subscript_referrer", refParam.trim());
    }
  }, [searchParams]);

  const triggerReferralLogging = useCallback(async () => {
    if (typeof window === "undefined") return;
    const referrer = localStorage.getItem("subscript_referrer");
    if (!referrer) return;
    try {
      const res = await fetch("/api/user/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrer }),
      });
      if (res.ok) {
        localStorage.removeItem("subscript_referrer");
      }
    } catch (err) {
      console.error("Failed to log referral:", err);
    }
  }, []);

  const handleLoginSuccess = useCallback(
    (data: { success: boolean; wallet: string; email?: string | null; role?: string | null }) => {
      const userEmail = data.email || email;
      if (data.email) {
        setEmail(data.email);
        setRequiresEmailLinking(false);
      }

      const intendedRole = selectedRole ?? readPreselectedRole();

      // Case 1: Returning user with an existing role
      if (data.role) {
        clearPreselectedRole();
        triggerReferralLogging().finally(() => {
          const next = getSafeNext();
          window.location.href = next && data.role === "USER"
            ? next
            : getDashboardUrl(data.role as any, "/dashboard");
        });
        return;
      }

      // Case 2: New account created (via OTP, Google, or Wallet) -> Prompt user to select account type (Merchant vs User)
      clearPreselectedRole();
      if (!data.email && !email) {
        setRequiresEmailLinking(true);
        setIsExternalWalletSignup(true);
      }
      setShowRoleSelector(true);
      setSignupStep("select-role");
    },
    [email, triggerReferralLogging, getSafeNext]
  );

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email || !email.includes("@")) {
      setOtpError("Please enter a valid email address.");
      return;
    }
    setOtpLoading(true);
    setOtpError(null);
    setSandboxOtp(null);

    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          captchaCode: "",
          captchaToken,
          isSignup: activeTab === "signup",
          authFlow: activeTab,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        setResendCooldown(30);
        if (data.devOtpCode) {
          setSandboxOtp(data.devOtpCode);
        }
      } else {
        setOtpError(data.error || "Failed to send verification code.");
      }
    } catch (err) {
      setOtpError("Network error sending verification code.");
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
        body: JSON.stringify({ email, code: otpCode, rememberMe: true }),
      });
      const data = await res.json();
      if (data.success) {
        posthog.capture(activeTab === "signup" ? "signup_success" : "signin_success", { method: "email_otp" });
        handleLoginSuccess(data);
      } else {
        setOtpError(data.error || "Invalid verification code.");
      }
    } catch (err) {
      setOtpError("Network error verifying code.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSelectConnector = async (connector: Connector) => {
    if (captchaRequired) return;
    setShowWalletModal(false);
    setConnectingConnectorId(connector.id);
    setWalletAuthRequested(true);
    setWalletSignupPrompt(false);
    setSiweError(null);
    try {
      if (isConnected) {
        disconnect();
      }
      const connRes = await connectAsync({ connector, chainId: activeArcChain.id });
      if (switchChainAsync && connRes?.chainId !== activeArcChain.id) {
        try {
          await switchChainAsync({ chainId: activeArcChain.id });
        } catch {
          // Handled during SIWE if rejected
        }
      }
    } catch (err: any) {
      setConnectingConnectorId(null);
      setWalletAuthRequested(false);
      setSiweError(err?.message || "Failed to connect wallet.");
    }
  };

  const handleConnectWallet = () => {
    if (captchaRequired) return;
    posthog.capture(activeTab === "signup" ? "signup_method_selected" : "signin_method_selected", { method: "wallet" });
    setSiweError(null);
    setShowWalletModal(true);
  };

  const performSiwe = useCallback(async () => {
    if (!isConnected || !address || siweLoading) return;
    setSiweLoading(true);
    setSiweError(null);

    // Enforce Arc network before signature
    if (chainId && chainId !== activeArcChain.id && switchChainAsync) {
      try {
        await switchChainAsync({ chainId: activeArcChain.id });
      } catch {
        setSiweError("Please switch your wallet to Arc Network to continue.");
        setSiweLoading(false);
        setConnectingConnectorId(null);
        return;
      }
    }

    try {
      const checkRes = await fetch("/api/auth/check-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const checkData = await checkRes.json();
      if (activeTab === "signup" && checkData.exists) {
        setSiweError("This wallet already has an account. Use Sign In to access it.");
        return;
      }
      if (activeTab === "signin" && !checkData.exists) {
        setSiweError("No account found for this wallet. Use Create Account to register.");
        return;
      }

      const nonceRes = await fetch("/api/auth/nonce");
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok || !nonceData.nonce) {
        throw new Error(nonceData.error || "Failed to fetch SIWE nonce");
      }
      const fetchedNonce = nonceData.nonce;
      const message = buildWalletAuthMessage({
        address,
        nonce: fetchedNonce,
        domain: window.location.host,
        uri: window.location.origin,
      });
      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch("/api/auth/verify-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          signature,
          nonce: fetchedNonce,
          captchaCode: "",
          captchaToken,
        }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        setIsExternalWalletSignup(true);
        posthog.capture(activeTab === "signup" ? "signup_success" : "signin_success", { method: "siwe" });
        handleLoginSuccess(verifyData);
      } else {
        setSiweError(verifyData.error || "Wallet signature verification failed.");
      }
    } catch (err: any) {
      setSiweError(err?.message || "Error signing SIWE verification message.");
    } finally {
      setSiweLoading(false);
      setWalletAuthRequested(false);
      setConnectingConnectorId(null);
    }
  }, [isConnected, address, signMessageAsync, handleLoginSuccess, siweLoading, captchaToken, activeTab]);

  useEffect(() => {
    if (walletAuthRequested && isConnected && address) {
      performSiwe();
    }
  }, [walletAuthRequested, isConnected, address, performSiwe]);

  const handleGoogleClick = async () => {
    if (captchaRequired) return;
    posthog.capture(activeTab === "signup" ? "signup_method_selected" : "signin_method_selected", { method: "circle_google" });
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      if (selectedRole && activeTab === "signup") {
        armPreselectedRole(selectedRole);
      }
      const configRes = await fetch("/api/auth/circle/google/config", { cache: "no-store" });
      const config = await configRes.json().catch(() => ({}));
      if (!configRes.ok || !config.googleClientId) {
        throw new Error(config.error || "Circle Google login is not configured.");
      }

      const nonce = crypto.randomUUID();
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: config.redirectUri,
        response_type: "id_token",
        scope: "openid email profile",
        nonce: nonce,
        prompt: "select_account",
      }).toString();

      window.localStorage.setItem("subscript_circle_auth_intent", activeTab);
      window.location.href = authUrl;
    } catch (err: any) {
      setGoogleError(err.message || "Continue with Google failed.");
      setGoogleLoading(false);
    }
  };

  const handleRoleSelection = async () => {
    if (!selectedRole) return;
    if (requiresEmailLinking && email.trim()) {
      if (!email.includes("@")) {
        setRoleError("Please enter a valid email address to link with your account, or leave blank.");
        return;
      }
    }
    setRoleLoading(true);
    setRoleError(null);
    setMerchantInviteBlocked(false);
    try {
      const res = await fetch("/api/auth/register-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: selectedRole,
          email: requiresEmailLinking && email.trim() ? email.trim() : undefined,
          merchantInviteToken: selectedRole === "ENTERPRISE" ? merchantInvite : undefined,
          merchantSignupCode: selectedRole === "ENTERPRISE" ? merchantInvite : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearPreselectedRole();
        triggerReferralLogging().finally(() => {
          const next = getSafeNext();
          window.location.href = next && selectedRole === "USER"
            ? next
            : getDashboardUrl(selectedRole as any, "/dashboard");
        });
      } else {
        setRoleError(data.error || "Failed to register account type.");
        setMerchantInviteBlocked(typeof data.code === "string" && data.code.startsWith("MERCHANT_"));
      }
    } catch (err) {
      setRoleError("Network error registering account type.");
    } finally {
      setRoleLoading(false);
    }
  };

  const handleProceed = async () => {
    setRoleError(null);
    if (!selectedRole) return;

    if (selectedRole === "ENTERPRISE" && inviteOnlyNotice && !merchantInvite.trim()) {
      setRoleError("A merchant invite code is required to register a business account.");
      setMerchantInviteBlocked(true);
      return;
    }

    if (requiresEmailLinking && email.trim()) {
      if (!email.includes("@")) {
        setRoleError("Please enter a valid email address to link with your account, or leave blank.");
        return;
      }
    }

    if (activeSession || isExternalWalletSignup || showRoleSelector) {
      await handleRoleSelection();
      return;
    }

    armPreselectedRole(selectedRole);
    setSignupStep("auth");
  };

  const leftHeadline =
    selectedRole === "USER" ? (
      <h1 className="text-2xl xl:text-3xl font-black tracking-tight text-white leading-tight">
        Send and receive USDC <br />
        <span className="text-white/95">anywhere in the world</span>
      </h1>
    ) : (
      <h1 className="text-2xl xl:text-3xl font-black tracking-tight text-white leading-tight">
        Cross-border payments and checkout <br />
        <span className="text-white/95">for your business</span>
      </h1>
    );

  const leftSubtitle =
    selectedRole === "USER"
      ? "Pay friends, subscribe to services, and send money across borders."
      : "Accept USDC from customers worldwide. Every payment settles right away.";

  const handleTabChange = useCallback((tab: "signin" | "signup") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setOtpError(null);
    setSiweError(null);
    setGoogleError(null);
    setRoleError(null);
    setOtpSent(false);
    setOtpCode("");
    const targetPath = tab === "signin" ? "/signin" : "/signup";
    const params = new URLSearchParams();
    const safeNext = getSafeNext();
    if (safeNext) params.set("next", safeNext);
    if (email) params.set("email", email);
    const searchStr = params.toString() ? `?${params.toString()}` : "";
    if (typeof window !== "undefined" && window.location.pathname !== targetPath) {
      window.location.assign(`${targetPath}${searchStr}`);
    }
  }, [activeTab, getSafeNext, email]);

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setActiveSession(null);
      setShowRoleSelector(false);
    } catch (err) {
      console.error("Signout error:", err);
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleGoToDashboard = () => {
    if (!activeSession) return;
    const safeNext = getSafeNext();
    window.location.href = safeNext && activeSession.role === "USER"
      ? safeNext
      : getDashboardUrl(activeSession.role as any, "/dashboard");
  };

  if (isSigningOut) {
    return (
      <AuthSplitLayout activeTab="signup">
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#2775CA]" />
          <p className="text-xs font-semibold text-black/60 uppercase tracking-wider font-mono">
            Signing out...
          </p>
        </div>
      </AuthSplitLayout>
    );
  }

  // State A: Already Logged In
  if (activeSession) {
    return (
      <AuthSplitLayout activeTab="signup" onTabChange={handleTabChange}>
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h3 className="text-base font-bold uppercase tracking-wider text-[#111827]">
              You&apos;re Already Signed In
            </h3>
            <p className="text-xs text-black/60 leading-relaxed">
              You are currently logged in with:
            </p>
            <div className="bg-black/[0.03] border border-black/10 p-3.5 rounded-2xl font-mono text-xs break-all text-[#111827]">
              {activeSession.email || activeSession.wallet}
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleGoToDashboard}
              className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] text-white rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={handleLogout}
              className="w-full py-3.5 bg-[#FFFFF0] hover:bg-black/5 border border-black/15 text-[#111827] rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <LogOut className="w-4 h-4" />
              Sign Out / Switch Account
            </button>
          </div>
        </div>
      </AuthSplitLayout>
    );
  }

  // State B: Account Type Selector (User / Merchant)
  if (signupStep === "select-role" || showRoleSelector) {
    return (
      <AuthSplitLayout
        tabs={[
          { id: "USER", label: "User" },
          { id: "ENTERPRISE", label: "Merchant" },
        ]}
        activeTabId={selectedRole}
        onSelectTab={(id) => {
          setSelectedRole(id as "USER" | "ENTERPRISE");
          setRoleError(null);
        }}
        leftHeadline={leftHeadline}
        leftSubtitle={leftSubtitle}
        title={selectedRole === "ENTERPRISE" ? "Merchant Account" : "Personal Account"}
        subtitle={
          selectedRole === "ENTERPRISE"
            ? "For businesses, platforms, and global commerce"
            : "For individuals paying, sending, and subscribing"
        }
      >
        <div className="space-y-3.5">
          {/* Account Type Card: User vs Merchant */}
          {selectedRole === "USER" ? (
            <div className="space-y-3">
              {/* Personal Perks */}
              <div className="p-3.5 rounded-2xl border border-black/10 bg-black/[0.02]">
                <ul className="space-y-2 text-xs text-[#111827]">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#2775CA] shrink-0 mt-0.5" />
                    <span>Send and receive USDC across borders in seconds</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#2775CA] shrink-0 mt-0.5" />
                    <span>One-click checkout and automated subscription management</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#2775CA] shrink-0 mt-0.5" />
                    <span>Sponsored gas fees with zero network friction on Arc</span>
                  </li>
                </ul>
              </div>

              {/* What You Need */}
              <div className="p-3 rounded-xl border border-black/10 bg-black/[0.01] space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black/50">
                  Things you need
                </span>
                <ul className="space-y-1 text-[11px] text-black/70">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2775CA] shrink-0" />
                    <span>Personal email address or Web3 wallet (Google, MetaMask)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2775CA] shrink-0" />
                    <span>No minimum deposit or verification paperwork required</span>
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Merchant Perks */}
              <div className="p-3.5 rounded-2xl border border-black/10 bg-black/[0.02]">
                <ul className="space-y-2 text-xs text-[#111827]">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#2775CA] shrink-0 mt-0.5" />
                    <span>Cross-border USDC checkout links and recurring billing engine</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#2775CA] shrink-0 mt-0.5" />
                    <span>Developer APIs, webhooks, and metered subscription vaults</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#2775CA] shrink-0 mt-0.5" />
                    <span>Instant settlement on Arc with direct treasury withdrawals</span>
                  </li>
                </ul>
              </div>

              {/* What You Need */}
              <div className="p-3 rounded-xl border border-black/10 bg-black/[0.01] space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-black/50">
                  Things you need
                </span>
                <ul className="space-y-1 text-[11px] text-black/70">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2775CA] shrink-0" />
                    <span>Business email address or corporate treasury wallet</span>
                  </li>
                  {inviteOnlyNotice && (
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2775CA] shrink-0" />
                      <span>Merchant invite code (invite-only access active)</span>
                    </li>
                  )}
                </ul>
              </div>

              {/* Merchant Invite Input if selecting Business while invite-only is on */}
              {inviteOnlyNotice && (
                <div className="space-y-1 pt-0.5">
                  <label className="block text-[11px] font-semibold text-[#111827]">
                    Merchant Invite Code / Token
                  </label>
                  <input
                    type="text"
                    placeholder="Paste your merchant invite token"
                    value={merchantInvite}
                    onChange={(e) => setMerchantInvite(e.target.value)}
                    className="w-full rounded-xl border border-black/15 bg-[#FFFFF0] px-3.5 py-2 text-xs text-[#111827] placeholder:text-black/35 focus:border-[#2775CA] focus:outline-none shadow-sm font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* Email Linking Prompt for External Wallets */}
          {requiresEmailLinking && (
            <div className="space-y-1 pt-1">
              <label className="block text-[11px] font-semibold text-[#111827]">
                Link an Email for Receipts & Alerts <span className="text-black/40 font-normal">(Optional)</span>
              </label>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-[#FFFFF0] px-3.5 py-2 text-xs text-[#111827] placeholder:text-black/35 focus:border-[#2775CA] focus:outline-none shadow-sm"
              />
            </div>
          )}

          {roleError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 space-y-1.5" role="alert">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-relaxed">{roleError}</span>
              </div>
              {merchantInviteBlocked && (
                <div className="pt-1.5 border-t border-red-200/60 flex items-center justify-between">
                  <span className="text-[10px] text-red-700">Need an account?</span>
                  <a
                    href={X_HANDLE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-[#2775CA] hover:underline flex items-center gap-1"
                  >
                    <span>Request on X</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Primary Action Button: Proceed */}
          <button
            type="button"
            onClick={handleProceed}
            disabled={roleLoading}
            className="w-full py-3 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-50 text-white font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99]"
          >
            {roleLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>Proceed</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>

          <p className="text-center text-xs text-black/60 pt-0.5">
            Already have an account?{" "}
            <a href="/signin" className="text-[#2775CA] font-bold hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </AuthSplitLayout>
    );
  }

  // State C: Create Account / Auth Methods Form
  return (
    <AuthSplitLayout
      activeTab="signup"
      onTabChange={handleTabChange}
      leftHeadline={
        <h1 className="text-2xl xl:text-3xl font-black tracking-tight text-white leading-tight">
          Cross-border payments and checkout <br />
          <span className="text-white/95">for your business</span>
        </h1>
      }
      leftSubtitle="Accept USDC from customers worldwide. Every payment settles right away."
      title="Create your account"
      subtitle="Continue with your wallet or email to get started"
    >
      <div className="space-y-3.5">

        {/* Quick Social & Web3 Auth Row */}
        <MultiWalletAuthRow
          googleAvailable={googleAvailable}
          externalWalletEnabled={externalWalletEnabled}
          onGoogleSuccess={handleLoginSuccess}
          connectors={connectors}
          onSelectConnector={handleSelectConnector}
          onNoWalletDetected={(msg) => setSiweError(msg)}
          onOpenModal={() => setShowWalletModal(true)}
          isConnecting={isConnecting}
          siweLoading={siweLoading}
          connectingConnectorId={connectingConnectorId}
          disabled={otpLoading || captchaRequired}
        />

        {isTurnstileConfigured && (
          <div className="flex justify-center scale-90 origin-top">
            <div id="turnstile-email-signup"></div>
          </div>
        )}

        {/* Divider */}
        <div className="relative py-1 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-black/10"></div>
          </div>
          <span className="relative px-2.5 bg-[#FFFFF0] text-[9px] font-bold text-black/40 uppercase tracking-widest font-mono">
            or continue with email
          </span>
        </div>

        {/* Email OTP Flow */}
        {!otpSent ? (
          <form onSubmit={handleSendOtp} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-[#111827]">
                Email address
              </label>
              <div className="relative">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={otpLoading}
                  className="w-full rounded-xl border border-black/15 bg-[#FFFFF0] px-3.5 py-2.5 text-xs text-[#111827] placeholder:text-black/35 focus:border-[#2775CA] focus:outline-none shadow-sm transition-colors"
                />
              </div>

            </div>

            {/* Explicit Send OTP Button beneath email */}
            <button
              type="submit"
              disabled={otpLoading || !email || (isTurnstileConfigured && !captchaToken)}
              className="w-full py-2.5 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-50 text-white font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99]"
            >
              {otpLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending code...</span>
                </>
              ) : (
                <span>Send OTP</span>
              )}
            </button>

            {/* Any error on that page is visible under the Send OTP button */}
            {(otpError || siweError || googleError) && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-start gap-2 mt-1.5" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-relaxed">{otpError || siweError || googleError}</span>
              </div>
            )}

            {activeTab === "signup" && (
              <p className="text-center text-[10px] text-black/50 leading-tight pt-1">
                By clicking &ldquo;Continue&rdquo; you are agreeing to SubScript&apos;s{" "}
                <Link href="/terms" className="text-[#2775CA] hover:underline font-medium">
                  Terms of Use
                </Link>{" "}
                &amp;{" "}
                <Link href="/privacy" className="text-[#2775CA] hover:underline font-medium">
                  Privacy Policy
                </Link>
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-semibold text-[#111827]">
                  Verification Code
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                    setOtpError(null);
                  }}
                  className="text-[10px] text-[#2775CA] hover:underline font-medium"
                >
                  Change email
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  autoFocus
                  maxLength={6}
                  className="w-full rounded-xl border border-black/15 bg-[#FFFFF0] px-3.5 py-2.5 text-center font-mono text-sm tracking-widest text-[#111827] placeholder:text-black/35 focus:border-[#2775CA] focus:outline-none shadow-sm transition-colors"
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-black/50 px-0.5">
                <span>Sent to {email}</span>
                <button
                  type="button"
                  onClick={() => handleSendOtp()}
                  disabled={resendCooldown > 0 || otpLoading}
                  className="text-[#2775CA] font-semibold hover:underline disabled:text-black/30"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                </button>
              </div>
            </div>

            {sandboxOtp && (
              <div className="rounded-xl border border-[#2775CA]/20 bg-[#2775CA]/5 p-2 text-[11px] text-[#1f62ab] flex items-center gap-1.5 font-mono">
                <MailCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Sandbox Code: <strong>{sandboxOtp}</strong></span>
              </div>
            )}

            <button
              type="submit"
              disabled={otpLoading || otpCode.length < 6}
              className="w-full py-2.5 bg-[#2775CA] hover:bg-[#1f62ab] disabled:opacity-50 text-white font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.99]"
            >
              {otpLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Continue</span>
              )}
            </button>

            {/* Error visible under action button */}
            {otpError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-start gap-2 mt-1.5" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-relaxed">{otpError}</span>
              </div>
            )}

            {activeTab === "signup" && (
              <p className="text-center text-[10px] text-black/50 leading-tight pt-1">
                By clicking &ldquo;Continue&rdquo; you are agreeing to SubScript&apos;s{" "}
                <Link href="/terms" className="text-[#2775CA] hover:underline font-medium">
                  Terms of Use
                </Link>{" "}
                &amp;{" "}
                <Link href="/privacy" className="text-[#2775CA] hover:underline font-medium">
                  Privacy Policy
                </Link>
              </p>
            )}
          </form>
        )}

        <p className="text-center text-xs text-black/60 pt-0.5">
          Already have an account?{" "}
          <a href="/signin" className="text-[#2775CA] font-bold hover:underline">
            Sign in
          </a>
        </p>
      </div>

      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setTurnstileLoaded(true)}
      />

      <WalletSelectionModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        connectors={connectors}
        onSelectConnector={handleSelectConnector}
        connectingConnectorId={connectingConnectorId}
        activeConnectorId={activeConnector?.id}
        isConnected={isConnected}
      />
    </AuthSplitLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthLoadingState activeTab="signup" />}>
      <SignupContent />
    </Suspense>
  );
}
