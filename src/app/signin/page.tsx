"use client";

import { useState, useEffect, useCallback, Suspense, useRef } from "react";
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
  AlertCircle, 
  ArrowRight, 
  Lock, 
  MailCheck, 
  LogOut,
  RefreshCw
} from "@/components/icons";
import { getDashboardUrl, getSafeRelativePath } from "@/utils/navigation";
import { CIRCLE_GOOGLE_ENABLED } from "@/lib/featureFlags";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";
import Script from "next/script";
import AuthSplitLayout from "@/components/auth/AuthSplitLayout";
import AuthLoadingState from "@/components/auth/AuthLoadingState";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import { MetaMaskIcon, MetaMaskColorSpinner } from "@/components/auth/QuickAuthButtons";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams?.get("email") || "";
  const safeNext = getSafeRelativePath(searchParams?.get("next") || null);

  useEffect(() => {
    router.prefetch("/signup");
  }, [router]);

  const { address, isConnected, connector: activeConnector, chainId } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { externalWalletEnabled, googleSigninEnabled, loaded: platformFlagsLoaded } = usePlatformFlags();
  const googleAvailable = CIRCLE_GOOGLE_ENABLED && (!platformFlagsLoaded || googleSigninEnabled !== false);

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(initialEmail);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  
  const [siweLoading, setSiweLoading] = useState(false);
  const [siweError, setSiweError] = useState<string | null>(null);
  const [walletAuthRequested, setWalletAuthRequested] = useState(false);
  const [walletMissingAccount, setWalletMissingAccount] = useState(false);

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

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [activeSession, setActiveSession] = useState<{ wallet: string; email?: string; role: string } | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const isTurnstileConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  const [resendCooldown, setResendCooldown] = useState(0);

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
    const container = document.getElementById("turnstile-email-signin");
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
      console.warn("Turnstile render note:", e);
    }
  }, [turnstileLoaded, otpSent]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (data.loggedIn && data.role) {
            setActiveSession({
              wallet: data.wallet,
              email: data.email || undefined,
              role: data.role,
            });
          }
        }
      } catch (err) {
        console.error("Failed to check active session on signin mount:", err);
      }
    };
    checkSession();
  }, [safeNext]);

  const handleLoginSuccess = useCallback((data: { success: boolean; wallet: string; role?: string | null }) => {
    if (safeNext && data.role === "USER") {
      window.location.href = safeNext;
      return;
    }
    if (data.role) {
      window.location.href = getDashboardUrl(data.role as any, "/dashboard");
    } else {
      const params = new URLSearchParams();
      params.set("completeRole", "1");
      if (safeNext) params.set("next", safeNext);
      window.location.href = `/signup?${params.toString()}`;
    }
  }, [safeNext]);

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
          authFlow: activeTab,
          isSignup: activeTab === "signup",
          captchaToken,
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
    setShowWalletModal(false);
    setConnectingConnectorId(connector.id);
    setWalletAuthRequested(true);
    setWalletMissingAccount(false);
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
    posthog.capture(activeTab === "signup" ? "signup_method_selected" : "signin_method_selected", { method: "wallet" });
    setWalletMissingAccount(false);
    setSiweError(null);
    setShowWalletModal(true);
  };

  const performSiwe = useCallback(async () => {
    if (!isConnected || !address || siweLoading) return;
    setSiweLoading(true);
    setSiweError(null);
    setWalletMissingAccount(false);

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
      if (activeTab === "signin" && !checkData.exists) {
        setWalletMissingAccount(true);
        return;
      }
      if (activeTab === "signup" && checkData.exists) {
        setSiweError("This wallet already has an account. Use Sign In to access it.");
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
        body: JSON.stringify({ address, signature, nonce: fetchedNonce }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        posthog.capture(activeTab === "signup" ? "signup_success" : "signin_success", { method: "siwe" });
        handleLoginSuccess(verifyData);
      } else {
        setSiweError(verifyData.error || "Wallet signature verification failed.");
      }
    } catch (err: any) {
      setSiweError(err?.message || "Error signing verification message.");
    } finally {
      setSiweLoading(false);
      setWalletAuthRequested(false);
      setConnectingConnectorId(null);
    }
  }, [isConnected, address, signMessageAsync, handleLoginSuccess, siweLoading, activeTab]);

  useEffect(() => {
    if (walletAuthRequested && isConnected && address) {
      performSiwe();
    }
  }, [walletAuthRequested, isConnected, address, performSiwe]);

  const handleGoogleClick = async () => {
    posthog.capture(activeTab === "signup" ? "signup_method_selected" : "signin_method_selected", { method: "circle_google" });
    setGoogleLoading(true);
    setGoogleError(null);
    try {
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

  const handleTabChange = useCallback((tab: "signin" | "signup") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setOtpError(null);
    setSiweError(null);
    setGoogleError(null);
    setOtpSent(false);
    setOtpCode("");
    const targetPath = tab === "signin" ? "/signin" : "/signup";
    const params = new URLSearchParams();
    if (safeNext) params.set("next", safeNext);
    if (email) params.set("email", email);
    const searchStr = params.toString() ? `?${params.toString()}` : "";
    if (typeof window !== "undefined" && window.location.pathname !== targetPath) {
      window.location.assign(`${targetPath}${searchStr}`);
    }
  }, [activeTab, safeNext, email]);

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setActiveSession(null);
    } catch (err) {
      console.error("Signout error:", err);
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleGoToDashboard = () => {
    if (!activeSession) return;
    window.location.href = safeNext && activeSession.role === "USER"
      ? safeNext
      : getDashboardUrl(activeSession.role as any, "/dashboard");
  };

  if (isSigningOut) {
    return (
      <AuthSplitLayout activeTab="signin">
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#2775CA]" />
          <p className="text-xs font-semibold text-black/60 uppercase tracking-wider font-mono">
            Signing out...
          </p>
        </div>
      </AuthSplitLayout>
    );
  }

  if (activeSession) {
    return (
      <AuthSplitLayout activeTab="signin" onTabChange={handleTabChange}>
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h3 className="text-base font-bold uppercase tracking-wider text-[#111827]">
              You&apos;re Already Signed In
            </h3>
            <p className="text-xs text-black/60 leading-relaxed">
              You are currently signed in with:
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

  return (
    <AuthSplitLayout activeTab={activeTab} onTabChange={handleTabChange}>
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
          disabled={otpLoading}
        />

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

              {isTurnstileConfigured && (
                <div className="pt-1 flex justify-center scale-90 origin-top">
                  <div id="turnstile-email-signin"></div>
                </div>
              )}
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

        {/* Missing Wallet Account Prompt */}
        {walletMissingAccount && address && (
          <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 text-xs text-black/80 space-y-3 mt-2">
            <div className="flex items-start gap-3">
              <Wallet className="w-5 h-5 shrink-0 mt-0.5 text-[#1f62ab]" />
              <div className="space-y-1">
                <p className="font-bold text-[#111827] uppercase tracking-wider">No account found yet</p>
                <p className="leading-relaxed text-black/70">
                  This wallet isn&apos;t registered on SubScript yet. Would you like to create an account?
                </p>
                <p className="font-mono text-[10px] text-black/50 break-all">{address}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleTabChange("signup")}
                className="py-2.5 bg-[#2775CA] hover:bg-[#1f62ab] text-white rounded-xl font-bold text-[10px] uppercase tracking-wider shadow-sm transition"
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => setWalletMissingAccount(false)}
                className="py-2.5 bg-[#FFFFF0] hover:bg-black/5 border border-black/15 rounded-xl font-bold text-[10px] uppercase tracking-wider text-[#111827] shadow-sm transition"
              >
                Use Email
              </button>
            </div>
          </div>
        )}
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

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthLoadingState activeTab="signin" />}>
      <SignInContent />
    </Suspense>
  );
}
