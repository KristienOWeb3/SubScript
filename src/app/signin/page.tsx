"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import posthog from "posthog-js";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { 
  Loader2, 
  Mail, 
  Wallet, 
  AlertCircle, 
  ArrowRight, 
  Lock, 
  MailCheck, 
  LogOut 
} from "@/components/icons";
import { getDashboardUrl, getSafeRelativePath } from "@/utils/navigation";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import AuthSkeleton from "@/components/AuthSkeleton";
import { CIRCLE_GOOGLE_ENABLED } from "@/lib/featureFlags";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";
import Script from "next/script";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams?.get("email") || "";
  /* Optional post-login destination (e.g. a /subscribe/[planId] link). Only safe
     same-origin relative paths are honored, to avoid open-redirects. */
  const safeNext = getSafeRelativePath(searchParams?.get("next") || null);

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  /* Hides the web3 button when an operator pauses external wallets. Cosmetic only —
     /api/auth/verify-signature refuses the flow regardless. */
  const { externalWalletEnabled, googleSigninEnabled, loaded: platformFlagsLoaded } = usePlatformFlags();
  const googleAvailable = CIRCLE_GOOGLE_ENABLED && platformFlagsLoaded && googleSigninEnabled;

  const [authMethod, setAuthMethod] = useState<"select" | "email">("select");
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

  const [activeSession, setActiveSession] = useState<{ wallet: string; email?: string; role: string } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const isTurnstileConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  useEffect(() => {
    if (!turnstileLoaded || authMethod !== "email" || otpSent || !window.turnstile) return;
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const container = document.getElementById("turnstile-email-signin");
    if (!siteKey || !container || container.innerHTML !== "") return;

    window.turnstile.render(container, {
      sitekey: siteKey,
      theme: "light",
      callback: (token: string) => setCaptchaToken(token),
      "expired-callback": () => setCaptchaToken(""),
      "error-callback": () => setCaptchaToken(""),
    });
  }, [turnstileLoaded, authMethod, otpSent]);

  useEffect(() => {
    if (initialEmail) {
      setAuthMethod("email");
    }
  }, [initialEmail]);

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
                  role: data.role
              });
          }
        }
      } catch (err) {
        console.error("Failed to check active session on signin mount:", err);
      } finally {
        setCheckingSession(false);
      }
    };
    checkSession();
  }, [safeNext]);

  const handleLoginSuccess = useCallback((data: { success: boolean; wallet: string; role?: string | null }) => {
    // Honor a post-login destination for standard user accounts (e.g. a shared
    // /subscribe link). Merchants always land on their dashboard.
    if (safeNext && data.role === "USER") {
      window.location.href = safeNext;
      return;
    }
    if (data.role) {
      window.location.href = getDashboardUrl(data.role as any, "/dashboard");
    } else {
      // Authenticated but no role — go directly to role selection step
      const params = new URLSearchParams();
      params.set("completeRole", "1");
      if (safeNext) params.set("next", safeNext);
      window.location.href = `/signup?${params.toString()}`;
    }
  }, [safeNext]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
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
        body: JSON.stringify({ email, authFlow: "signin", captchaToken }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
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

  const handleConnectWallet = () => {
    setWalletAuthRequested(true);
    setWalletMissingAccount(false);
    setSiweError(null);
    const injectedConnector = connectors.find((c) => c.id === "injected");
    if (isConnected && address) {
      return;
    } else if (injectedConnector) {
      connect({ connector: injectedConnector });
    } else if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    } else {
      setWalletAuthRequested(false);
      setSiweError("No injected Web3 wallet found. Please install Metamask or Rabby.");
    }
  };

  const performSiwe = useCallback(async () => {
    if (!isConnected || !address || siweLoading) return;
    setSiweLoading(true);
    setSiweError(null);
    setWalletMissingAccount(false);

    try {
      // Check if wallet address already has an account
      const checkRes = await fetch("/api/auth/check-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const checkData = await checkRes.json();
      if (!checkData.exists) {
        setWalletMissingAccount(true);
        return;
      }

      // Verify wallet ownership via SIWE
      const nonceRes = await fetch("/api/auth/nonce");
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok || !nonceData.nonce) {
        throw new Error(nonceData.error || "Failed to fetch SIWE nonce");
      }
      const fetchedNonce = nonceData.nonce;
      const message = buildWalletAuthMessage({ address, nonce: fetchedNonce, domain: window.location.host, uri: window.location.origin });
      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch("/api/auth/verify-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, nonce: fetchedNonce }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        handleLoginSuccess(verifyData);
      } else {
        setSiweError(verifyData.error || "Wallet signature verification failed.");
      }
    } catch (err: any) {
      setSiweError(err?.message || "Error signing verification message.");
    } finally {
      setSiweLoading(false);
      setWalletAuthRequested(false);
    }
  }, [isConnected, address, signMessageAsync, handleLoginSuccess, siweLoading]);

  useEffect(() => {
    if (walletAuthRequested && isConnected && address) {
      performSiwe();
    }
  }, [walletAuthRequested, isConnected, address, performSiwe]);

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

  if (checkingSession || isSigningOut) {
    return <AuthSkeleton title="signin" subtitle="Sign in to your account" />;
  }

  if (activeSession) {
    return (
      <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
              SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">signin</span>
            </h1>
            <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">Welcome back</p>
          </div>

          <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
            <div className="text-center space-y-2">
              <h2 className="text-base font-bold uppercase tracking-wider text-[#111827]">You&apos;re Already Signed In</h2>
              <p className="text-xs text-black/60 leading-relaxed">
                You are currently signed in as:
              </p>
              <div className="bg-black/[0.03] border border-black/10 p-3.5 rounded-2xl font-mono text-xs break-all text-[#111827]">
                {activeSession.email || activeSession.wallet}
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleGoToDashboard}
                className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={handleLogout}
                className="w-full py-3.5 bg-white hover:bg-black/5 border border-black/15 text-[#111827] rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                Sign Out / Switch Account
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
      <div className="relative z-10 w-full max-w-md">
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
            SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">signin</span>
          </h1>
          <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">Sign in to your account</p>
        </div>

        <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
          
          <div className="flex items-center justify-between px-1 pb-4 border-b border-black/10">
            <span className="text-[10px] uppercase font-black tracking-widest text-[#1f62ab]">Sign In</span>
            <span className="text-[10px] uppercase font-bold text-black/50 tracking-wider">Choose method</span>
          </div>

          {authMethod === "select" ? (
            <div className="space-y-4">
              <p className="text-center text-xs text-black/60 leading-relaxed px-2">
                Sign in with your email or connected wallet to access your SubScript dashboard.
              </p>

              <button
                onClick={() => {
                  posthog.capture("signin_method_selected", { method: "email" });
                  setAuthMethod("email");
                }}
                className="w-full py-4 bg-white hover:bg-black/[0.03] border border-black/15 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-[#111827] shadow-sm"
              >
                <Mail className="w-4 h-4 text-[#2775CA]" />
                Continue with Email
              </button>

              {googleAvailable && (
                <div onClick={() => posthog.capture("signin_method_selected", { method: "circle_google" })}>
                  <CircleGoogleWalletButton onSuccess={handleLoginSuccess} />
                </div>
              )}

              {externalWalletEnabled && (
                <>
                  <div className="relative py-2 flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-black/10"></div>
                    </div>
                    <span className="relative px-3 bg-white text-[9px] font-bold text-black/40 uppercase tracking-widest">
                      or use web3
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      posthog.capture("signin_method_selected", { method: "wallet" });
                      handleConnectWallet();
                    }}
                    disabled={isConnecting || siweLoading}
                    className="w-full py-4 bg-[#2775CA] hover:bg-[#1f62ab] rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-[#FFFFF0] shadow-sm"
                  >
                    {isConnecting || siweLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wallet className="w-4 h-4" />
                    )}
                    Connect Web3 Wallet
                  </button>
                </>
              )}

              {siweError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-start gap-3 mt-2" role="alert">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
                  <span className="leading-relaxed">{siweError}</span>
                </div>
              )}

              {walletMissingAccount && address && (
                <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 text-xs text-black/80 space-y-4 mt-2">
                  <div className="flex items-start gap-3">
                    <Wallet className="w-5 h-5 shrink-0 mt-0.5 text-[#1f62ab]" />
                    <div className="space-y-1">
                      <p className="font-bold text-[#111827] uppercase tracking-wider">No account found yet</p>
                      <p className="leading-relaxed text-black/70">
                        This wallet is connected, but it doesn&apos;t have a SubScript account yet. Would you like to create one?
                      </p>
                      <p className="font-mono text-[10px] text-black/50 break-all">{address}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(safeNext ? `/signup?next=${encodeURIComponent(safeNext)}` : "/signup")}
                      className="py-3 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] rounded-xl font-bold text-[10px] uppercase tracking-wider shadow-sm transition"
                    >
                      Create Account
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWalletMissingAccount(false);
                        setAuthMethod("email");
                      }}
                      className="py-3 bg-white hover:bg-black/5 border border-black/15 rounded-xl font-bold text-[10px] uppercase tracking-wider text-[#111827] shadow-sm transition"
                    >
                      Use Email
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                      Registered Email
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-3 text-xs text-[#111827] placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none pr-10 shadow-sm"
                      />
                      <Mail className="absolute right-3.5 top-3.5 w-4 h-4 text-black/35" />
                    </div>
                    {isTurnstileConfigured && (
                      <div className="space-y-2 pt-2 flex flex-col items-center">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60 self-start">
                          Security Verification
                        </label>
                        <div id="turnstile-email-signin" className="my-2"></div>
                      </div>
                    )}
                    {otpError && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-start gap-3 mt-2" role="alert">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
                        <span className="leading-relaxed">{otpError}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setAuthMethod("select")}
                      className="flex-1 py-3.5 bg-white hover:bg-black/5 border border-black/15 rounded-xl font-bold text-xs uppercase tracking-wider text-[#111827] transition shadow-sm"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={otpLoading || (isTurnstileConfigured && !captchaToken)}
                      className="flex-1 py-3.5 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-sm"
                    >
                      {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Code"}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                      Verification Code
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Enter 6-digit code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        required
                        className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-3 text-center font-mono text-sm tracking-widest text-[#111827] placeholder:text-black/40 focus:border-[#2775CA]/60 focus:outline-none shadow-sm"
                      />
                      <Lock className="absolute right-3.5 top-3.5 w-4 h-4 text-black/35" />
                    </div>
                    {otpError && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-start gap-3 mt-2" role="alert">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
                        <span className="leading-relaxed">{otpError}</span>
                      </div>
                    )}
                  </div>

                  {sandboxOtp && (
                    <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 text-xs text-[#1f62ab] flex items-center gap-3 shadow-sm">
                      <MailCheck className="w-5 h-5 shrink-0" />
                      <span className="font-mono">Development Code: {sandboxOtp}</span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setOtpSent(false)}
                      className="flex-1 py-3.5 bg-white hover:bg-black/5 border border-black/15 rounded-xl font-bold text-xs uppercase tracking-wider text-[#111827] transition shadow-sm"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={otpLoading}
                      className="flex-1 py-3.5 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-sm"
                    >
                      {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Sign In"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="text-center pt-4 border-t border-black/10">
            <p className="text-xs text-black/60">
              Don&apos;t have an account?{" "}
              <button 
                onClick={() => router.push(safeNext ? `/signup?next=${encodeURIComponent(safeNext)}` : "/signup")} 
                className="text-[#2775CA] font-bold hover:underline"
              >
                Sign Up
              </button>
            </p>
          </div>

        </div>
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileLoaded(true)}
        />
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthSkeleton title="signin" subtitle="Sign in to your account" />}>
      <SignInContent />
    </Suspense>
  );
}

