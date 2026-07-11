"use client";

import { useState, useEffect, useCallback } from "react";
import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { 
  Loader2, 
  Mail, 
  Wallet, 
  CheckCircle, 
  AlertCircle, 
  ArrowRight,
  User,
  Building2,
  Lock,
  MailCheck,
  RefreshCw,
  LogOut
} from "@/components/icons";
import { getDashboardUrl } from "@/utils/navigation";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import Script from "next/script";
import { CIRCLE_GOOGLE_ENABLED } from "@/lib/featureFlags";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";

// Global type declaration for Cloudflare Turnstile
declare global {
  interface Window {
    turnstile: any;
  }
}

export default function SignupPage() {
  const router = useRouter();
  /* Optional post-onboarding destination (e.g. a /subscribe/[planId] link a new
     user followed). Only safe same-origin relative paths are honored. */
  const getSafeNext = () => {
    if (typeof window === "undefined") return "";
    const raw = new URLSearchParams(window.location.search).get("next") || "";
    return /^\/(?!\/)[^\s]*$/.test(raw) ? raw : "";
  };
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [authMethod, setAuthMethod] = useState<"select" | "email">("select");
  const [activeMerchantAddress, setActiveMerchantAddress] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [siweLoading, setSiweLoading] = useState(false);
  const [siweError, setSiweError] = useState<string | null>(null);
  const [walletAuthRequested, setWalletAuthRequested] = useState(false);
  const [walletSignupPrompt, setWalletSignupPrompt] = useState(false);
  const [merchantSignupIntent, setMerchantSignupIntent] = useState(false);
  const [merchantSignupCode, setMerchantSignupCode] = useState("");

  /* Role selection states */
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"USER" | "ENTERPRISE" | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [requiresEmailLinking, setRequiresEmailLinking] = useState(false);
  /* True only for external/self-custody wallet signups, which have no email. The "add your email
     for push notifications" prompt is shown only for these — email/Google accounts already carry
     an email, so they must never see it. */
  const [isExternalWalletSignup, setIsExternalWalletSignup] = useState(false);
  const [isCompleteRoleFlow, setIsCompleteRoleFlow] = useState(false);
  
  const [activeSession, setActiveSession] = useState<{ wallet: string; email?: string; role: string } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  /* CAPTCHA (Cloudflare Turnstile) states */
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);
  const isTurnstileConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (typeof window !== "undefined" && window.turnstile) {
      setTurnstileLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!turnstileLoaded || typeof window === "undefined" || !window.turnstile) return;

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) {
      // Fail closed: without a configured site key we do not render a widget, so no token is
      // produced and captcha-gated actions cannot proceed.
      console.error("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not configured — captcha will not render.");
      return;
    }

    const renderTurnstile = (elementId: string) => {
      const container = document.getElementById(elementId);
      if (container && container.innerHTML === "") {
        try {
          window.turnstile.render(container, {
            sitekey: siteKey,
            theme: "dark",
            callback: (token: string) => setCaptchaToken(token),
            "expired-callback": () => setCaptchaToken(""),
            "error-callback": () => setCaptchaToken(""),
          });
        } catch (e) {
          console.warn("Turnstile render error for " + elementId + ":", e);
        }
      }
    };

    // Attempt to render in both possible containers depending on active screen
    setTimeout(() => {
      renderTurnstile("turnstile-email-signup");
      renderTurnstile("turnstile-wallet-signup");
    }, 100);
  }, [turnstileLoaded, authMethod, walletSignupPrompt]);

  const [showEmailInput, setShowEmailInput] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (data.loggedIn) {
            setActiveMerchantAddress(data.wallet);
            /* An external wallet has no user_embedded_wallets row until register-role runs, so a
               logged-in session with no provider AND no email is a not-yet-completed external-wallet
               signup — keep it flagged so the email-for-push prompt stays visible on reload. OTP and
               Google always carry a provider + email, so they never hit this fallback. */
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
                role: data.role
              });
            } else {
              setShowRoleSelector(true);
            }
          } else {
            /* Fresh, not-logged-in signup → ask what kind of account they want FIRST, before the
               auth method (so merchants get the email/Google-only screen). Skip when the entry point
               already declares the type: the merchant funnel, an email-resume link, or completeRole=1. */
            const sp = new URLSearchParams(window.location.search);
            const hint = (sp.get("role") || sp.get("type") || sp.get("account") || "").toLowerCase();
            const merchantIntent = ["merchant", "enterprise", "business"].includes(hint);
            if (!merchantIntent && !sp.get("email") && sp.get("completeRole") !== "1") {
              setShowRoleSelector(true);
            }
          }
        }
      } catch (err) {
        console.error("Failed to check active session on mount:", err);
      } finally {
        setCheckingSession(false);
      }
    };
    checkSession();

    const params = new URLSearchParams(window.location.search);
    const initialEmail = params.get("email");
    const roleHint = (params.get("role") || params.get("type") || params.get("account") || "").toLowerCase();
    const merchantIntent = ["merchant", "enterprise", "business"].includes(roleHint);
    setMerchantSignupIntent(merchantIntent);
    /* Arrived via the merchant funnel (/signup?role=merchant) → pre-select the merchant card so
       the intended account type is chosen for them and the role picker reads correctly. */
    if (merchantIntent) setSelectedRole("ENTERPRISE");
    setMerchantSignupCode(params.get("merchantCode") || params.get("invite") || "");

    const refParam = params.get("ref") || params.get("referral");
    if (refParam) {
      localStorage.setItem("subscript_referrer", refParam.trim());
    }

    /* If redirected here from sign-in with completeRole=1, the user already
       authenticated but is missing a role. Jump straight to the role picker
       instead of showing the full signup form. */
    if (params.get("completeRole") === "1") {
      setShowRoleSelector(true);
      setIsCompleteRoleFlow(true);
    }

    if (initialEmail) {
      setEmail(initialEmail);
      setAuthMethod("email");
    } else {
      setShowEmailInput(true);
    }
  }, []);

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

  const handleLoginSuccess = useCallback((data: { success: boolean; wallet: string; email?: string | null; role?: string | null }) => {
    setActiveMerchantAddress(data.wallet);
    if (data.email) {
      setEmail(data.email);
      setRequiresEmailLinking(false);
    }
    if (data.role) {
      triggerReferralLogging().finally(() => {
        const next = getSafeNext();
        window.location.href = (next && data.role === "USER")
          ? next
          : getDashboardUrl(data.role as any, "/dashboard");
      });
    } else {
      if (!data.email && !email) {
        /* No email on the login response is the SIWE / external-wallet path (OTP and Google always
           return an email), so prompt for a push-notification email and flag it so the field stays
           gated to this case — including on the very first SIWE success, before any reload. */
        setRequiresEmailLinking(true);
        setIsExternalWalletSignup(true);
      }
      setShowRoleSelector(true);
    }
  }, [email, triggerReferralLogging]);

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
      // 1. Check if email already has an account
      const checkRes = await fetch("/api/auth/check-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const checkData = await checkRes.json();
      if (checkData.exists) {
        if (checkData.authMethod === "wallet") {
          setOtpError("This email is linked to a wallet-only account. Connect that wallet to sign in; this email cannot create another account.");
          return;
        }
        if (checkData.onboardingComplete === false) {
          setOtpError("This email already started signup but has not chosen an account type yet. Sending a verification code so you can finish setup.");
        } else {
          setOtpError("An account with this email already exists. Use Sign In below to access it.");
          return;
        }
      }

      // 2. Send OTP
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captchaCode: "", captchaToken, isSignup: true }),
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        if (data.sandboxCode) {
          setSandboxOtp(data.sandboxCode);
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
    setWalletSignupPrompt(false);
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

  const performSiwe = useCallback(async (confirmedCreate = false) => {
    if (!isConnected || !address || siweLoading) return;
    setSiweLoading(true);
    setSiweError(null);

    try {
      // 1. Check if wallet already has an account
      const checkRes = await fetch("/api/auth/check-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const checkData = await checkRes.json();
      if (checkData.exists) {
        setSiweError("This wallet already has an account. Use Sign In below to access it.");
        return;
      }

      // 2. Let the user choose instead of spawning a browser confirm loop.
      if (!confirmedCreate) {
        setWalletSignupPrompt(true);
        setSiweLoading(false);
        return;
      }

      // 3. Continue SIWE if they want to create an account
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
        body: JSON.stringify({ 
          address, 
          signature, 
          nonce: fetchedNonce,
          captchaCode: "",
          captchaToken
        }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        /* External-wallet signup: no email on file, so this is the one flow that prompts for one. */
        setIsExternalWalletSignup(true);
        handleLoginSuccess(verifyData);
      } else {
        setSiweError(verifyData.error || "Wallet signature verification failed.");
      }
    } catch (err: any) {
      setSiweError(err?.message || "Error signing SIWE verification message.");
    } finally {
      setSiweLoading(false);
      setWalletAuthRequested(false);
    }
  }, [isConnected, address, signMessageAsync, handleLoginSuccess, router, siweLoading, captchaToken]);

  const handleRoleSelection = async () => {
    if (!selectedRole) return;
    if (requiresEmailLinking) {
      if (!email || !email.includes("@")) {
        setRoleError("Please enter a valid email address.");
        return;
      }
    }
    setRoleLoading(true);
    setRoleError(null);
    try {
      const res = await fetch("/api/auth/register-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: selectedRole,
          email: requiresEmailLinking ? email : undefined,
          merchantSignupCode: selectedRole === "ENTERPRISE" ? merchantSignupCode : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerReferralLogging().finally(() => {
          const next = getSafeNext();
          window.location.href = (next && selectedRole === "USER")
            ? next
            : getDashboardUrl(selectedRole as any, "/dashboard");
        });
      } else {
        setRoleError(data.error || "Failed to register account type.");
      }
    } catch (err) {
      setRoleError("Network error registering account type.");
    } finally {
      setRoleLoading(false);
    }
  };

  /* Pre-auth account-type step: the user picks User vs Merchant BEFORE choosing an auth method, so
     the auth screen can adapt (merchants are email/Google only). This only records the choice and
     advances to the auth method screen; the role is registered after authentication. */
  const handleContinueToAuth = () => {
    if (!selectedRole) return;
    setRoleError(null);
    setMerchantSignupIntent(selectedRole === "ENTERPRISE");
    setShowRoleSelector(false);
  };

  useEffect(() => {
    if (walletAuthRequested && isConnected && address) {
      performSiwe();
    }
  }, [walletAuthRequested, isConnected, address, performSiwe]);

  if (showRoleSelector) {
    return (
      <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-6 relative font-sans">
        <AnimatedGradientBg />
        
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
              {isCompleteRoleFlow
                ? <>SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">almost there</span></>
                : <>SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">onboarding</span></>
              }
            </h1>
            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">
              {isCompleteRoleFlow ? "One last step to complete your account" : "Decentralized Payment Protocol"}
            </p>
          </div>

          <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
            <div className="text-center space-y-1.5">
              <h2 className="text-base font-bold uppercase tracking-wider text-white">Select Account Type</h2>
              <p className="text-xs text-white/50 leading-relaxed">
                Choose how you intend to interact with the SubScript protocol.
              </p>
            </div>

            <div className="space-y-4">
              {/* Individual User Option */}
              <button
                onClick={() => setSelectedRole("USER")}
                className={`w-full p-5 border text-left rounded-2xl transition-all duration-300 relative overflow-hidden group ${
                  selectedRole === "USER"
                    ? "border-[#00d2b4] bg-[#00d2b4]/5 shadow-[0_0_20px_rgba(0,210,180,0.15)]"
                    : "border-white/5 bg-white/[0.01] hover:border-[#00d2b4]/40 hover:bg-white/[0.02] hover:shadow-[0_0_15px_rgba(0,210,180,0.08)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border transition-colors ${
                    selectedRole === "USER"
                      ? "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-[#00d2b4]"
                      : "bg-white/5 border-white/5 text-white/40 group-hover:text-[#00d2b4]"
                  }`}>
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm uppercase tracking-wider transition-colors ${
                      selectedRole === "USER" ? "text-[#00d2b4]" : "text-white"
                    }`}>
                      Individual User
                    </h3>
                    <span className="text-[9px] text-[#00d2b4] uppercase font-bold tracking-wider">Routes to User Hub</span>
                  </div>
                </div>
                <p className="text-[11px] text-white/50 mt-3 leading-relaxed">
                  Subscribe to web3 APIs, manage recurring allowance streams, view payment history, and connect with merchants.
                </p>
              </button>

              {/* Enterprise Merchant Option */}
              <button
                onClick={() => setSelectedRole("ENTERPRISE")}
                className={`w-full p-5 border text-left rounded-2xl transition-all duration-300 relative overflow-hidden group ${
                  selectedRole === "ENTERPRISE"
                    ? "border-[#00d2b4] bg-[#00d2b4]/5 shadow-[0_0_20px_rgba(0,210,180,0.15)]"
                    : "border-white/5 bg-white/[0.01] hover:border-[#00d2b4]/40 hover:bg-white/[0.02] hover:shadow-[0_0_15px_rgba(0,210,180,0.08)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border transition-colors ${
                    selectedRole === "ENTERPRISE"
                      ? "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-[#00d2b4]"
                      : "bg-white/5 border-white/5 text-white/40 group-hover:text-[#00d2b4]"
                  }`}>
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm uppercase tracking-wider transition-colors ${
                      selectedRole === "ENTERPRISE" ? "text-[#00d2b4]" : "text-white"
                    }`}>
                      Enterprise Merchant
                    </h3>
                    <span className="text-[9px] text-[#00d2b4] uppercase font-bold tracking-wider">Routes to Control Center</span>
                  </div>
                </div>
                <p className="text-[11px] text-white/50 mt-3 leading-relaxed">
                  Configure subscription tiers, generate hosted payment links, run automated payroll runs, and manage cashflow.
                </p>
              </button>
            </div>

            {requiresEmailLinking && isExternalWalletSignup && (
              <div className="space-y-2 pt-2 text-left">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Email Address (for push notifications)
                </label>
                <div className="relative">
                  <input
                    type="email"
                    placeholder="name@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="subscript-input pr-10"
                  />
                  <Mail className="absolute right-3.5 top-3.5 w-4 h-4 text-white/30" />
                </div>
                <p className="text-[9px] text-white/40 leading-relaxed">
                  Enter your email address so you don&apos;t miss critical payment and billing push notifications.
                </p>
              </div>
            )}

            {roleError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{roleError}</span>
              </div>
            )}

            <button
              onClick={activeMerchantAddress ? handleRoleSelection : handleContinueToAuth}
              disabled={!selectedRole || roleLoading}
              className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 transition-all font-bold text-xs uppercase tracking-wider text-black ${
                !selectedRole
                  ? "bg-white/10 text-white/40 cursor-not-allowed border border-white/5"
                  : "bg-[#00d2b4] hover:bg-[#00d2b4]/85 shadow-[0_0_20px_rgba(0,210,180,0.2)]"
              }`}
            >
              {/* Pre-auth (no session yet) records the choice and moves to the auth method screen;
                  post-auth it finalizes the account by registering the chosen role. */}
              {roleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (activeMerchantAddress ? "Complete Signup" : "Continue")}
              {!roleLoading && <ArrowRight className="w-4 h-4" />}
            </button>

            <p className="text-center text-xs text-white/40 pt-1">
              Already have an account?{" "}
              <button
                onClick={() => router.push("/signin")}
                className="text-[#00d2b4] hover:text-[#00d2b4]/80 font-semibold transition-colors"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

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
    const next = getSafeNext();
    window.location.href = (next && activeSession.role === "USER")
      ? next
      : getDashboardUrl(activeSession.role as any, "/dashboard");
  };

  if (checkingSession || isSigningOut) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
      </div>
    );
  }

  if (activeSession) {
    return (
      <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-4 sm:p-6 relative font-sans">
        <AnimatedGradientBg />
        
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
              SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">signup</span>
            </h1>
            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
          </div>

          <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
            <div className="text-center space-y-2">
              <h2 className="text-base font-bold uppercase tracking-wider text-white">Active Session Found</h2>
              <p className="text-xs text-white/50 leading-relaxed">
                You are currently signed in as:
              </p>
              <div className="bg-white/5 border border-white/10 p-3 rounded-xl font-mono text-[11px] break-all text-[#00d2b4]">
                {activeSession.email || activeSession.wallet}
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleGoToDashboard}
                className="w-full py-3.5 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
              >
                Go to Dashboard
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={handleLogout}
                className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
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
    <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-4 sm:p-6 relative font-sans">
      <AnimatedGradientBg />
      
      <div className="relative z-10 w-full max-w-md">
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
            SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">signup</span>
          </h1>
          <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
        </div>

        <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
          
          {/* Onboarding Progress Indicator */}
          <div className="flex items-center justify-between px-2 pb-4 border-b border-white/5">
            {[{ step: 1, label: "Method" }, { step: 2, label: "Verify" }, { step: 3, label: "Access" }].map((s) => {
              const currentStep = authMethod === "select" ? 1 : (!otpSent && authMethod === "email" ? 2 : 3);
              const isCompleted = s.step < currentStep;
              const isActive = s.step === currentStep;
              return (
                <div key={s.step} className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                    isCompleted 
                      ? "bg-[#00d2b4] text-black" 
                      : isActive 
                        ? "bg-[#00d2b4]/25 text-[#00d2b4] border border-[#00d2b4]/40 shadow-[0_0_10px_rgba(0,210,180,0.2)]" 
                        : "bg-white/5 text-white/30 border border-white/10"
                  }`}>
                    {isCompleted ? "✓" : s.step}
                  </div>
                  <span className={`text-[9px] uppercase font-bold tracking-wider hidden sm:inline ${
                    isActive ? "text-[#00d2b4]" : isCompleted ? "text-white/80" : "text-white/30"
                  }`}>
                    {s.label}
                  </span>
                  {s.step < 3 && <div className="w-6 h-[1px] bg-white/10 hidden sm:block" />}
                </div>
              );
            })}
          </div>

          {authMethod === "select" ? (
            <div className="space-y-4">
              <p className="text-center text-xs text-white/50 leading-relaxed px-2">
                Configure your payout wallet and secure your connection to the subscription system.
              </p>

              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-[10px] leading-relaxed text-emerald-300 flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Recommended:</strong> Register with Email{CIRCLE_GOOGLE_ENABLED ? " or Google" : ""} to create a secure <strong>Server-Signed Wallet</strong>. This will be fully compatible with our upcoming mobile app. Web3 connected wallets are web-only.
                </span>
              </div>

              <button
                onClick={() => {
                  posthog.capture("signup_method_selected", { method: "email" });
                  setAuthMethod("email");
                }}
                className="w-full py-4 bg-white/5 hover:bg-white/10 border border-emerald-400/30 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-white shadow-[0_0_15px_rgba(52,211,153,0.05)]"
              >
                <Mail className="w-4 h-4 text-[#ccff00]" />
                Continue with Email Wallet (Recommended)
              </button>
              <p className="-mt-2 px-3 text-center text-[10px] leading-relaxed text-white/40">
                {merchantSignupIntent
                  ? `Merchant accounts use email${CIRCLE_GOOGLE_ENABLED ? " or Google" : ""} sign-in for security, recovery, and professional invoicing.`
                  : "Email wallets use SubScript-managed recovery. Connect an external wallet for self-custody."}
              </p>

              {CIRCLE_GOOGLE_ENABLED && (
                <div onClick={() => posthog.capture("signup_method_selected", { method: "circle_google" })}>
                  <CircleGoogleWalletButton onSuccess={handleLoginSuccess} />
                </div>
              )}

              {/* External/self-custody wallets are for USERS only — merchant accounts must be
                  email/embedded (server-recoverable) for a more professional, recoverable account. */}
              {!merchantSignupIntent && (
                <>
              <div className="relative py-2 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/5"></div>
                </div>
                <span className="relative px-3 bg-[#0a0a0c] text-[9px] font-bold text-white/30 uppercase tracking-widest">
                  or use web3
                </span>
              </div>

              <button
                onClick={() => {
                  posthog.capture("signup_method_selected", { method: "wallet" });
                  handleConnectWallet();
                }}
                disabled={isConnecting || siweLoading}
                className="w-full py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/90 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-black shadow-[0_0_20px_rgba(0,210,180,0.15)]"
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
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3 mt-2">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{siweError}</span>
                </div>
              )}

              {walletSignupPrompt && address && (
                <div className="bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-2xl p-4 text-xs text-white/70 space-y-4 mt-2">
                  <div className="flex items-start gap-3">
                    <Wallet className="w-5 h-5 shrink-0 mt-0.5 text-[#00d2b4]" />
                    <div className="space-y-1">
                      <p className="font-bold text-white uppercase tracking-wider">Wallet detected</p>
                      <p className="leading-relaxed">
                        No SubScript account exists for this wallet yet. Choose what you want to do next.
                      </p>
                      <p className="font-mono text-[10px] text-white/40 break-all">{address}</p>
                    </div>
                  </div>

                  {/* Cloudflare Turnstile for Wallet Signup */}
                  {isTurnstileConfigured && (
                    <div className="space-y-2 border-t border-white/5 pt-3 flex flex-col items-center">
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-white/50 self-start">
                        Security Verification
                      </label>
                      <div id="turnstile-wallet-signup" className="my-2"></div>
                    </div>
                  )}

                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => performSiwe(true)}
                      disabled={siweLoading || (isTurnstileConfigured && !captchaToken)}
                      className="w-full py-3 bg-[#00d2b4] text-black rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2"
                    >
                      {siweLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Account With This Wallet"}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setWalletSignupPrompt(false);
                          setAuthMethod("email");
                        }}
                        className="py-3 bg-white/5 border border-white/10 rounded-xl font-bold text-[10px] uppercase tracking-wider text-white"
                      >
                        Use Email
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push("/signin")}
                        className="py-3 bg-white/5 border border-white/10 rounded-xl font-bold text-[10px] uppercase tracking-wider text-white"
                      >
                        Sign In
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                      Email Address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        placeholder="name@domain.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="subscript-input pr-10"
                      />
                      <Mail className="absolute right-3.5 top-3.5 w-4 h-4 text-white/30" />
                    </div>

                    {/* Cloudflare Turnstile */}
                    {isTurnstileConfigured && (
                      <div className="space-y-2 pt-2 flex flex-col items-center">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60 self-start">
                          Security Verification
                        </label>
                        <div id="turnstile-email-signup" className="my-2"></div>
                      </div>
                    )}
                    {otpError && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3 mt-2">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{otpError}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setAuthMethod("select")}
                      className="flex-1 py-3.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl font-bold text-xs uppercase tracking-wider text-white transition"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={otpLoading}
                      className="flex-1 py-3.5 bg-[#00d2b4] text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition hover:bg-[#00d2b4]/95"
                    >
                      {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Code"}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                      Verification Code
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Enter 6-digit OTP code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        required
                        className="subscript-input tracking-widest text-center text-sm font-mono"
                      />
                      <Lock className="absolute right-3.5 top-3.5 w-4 h-4 text-white/30" />
                    </div>
                    {otpError && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3 mt-2">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{otpError}</span>
                      </div>
                    )}
                  </div>

                  {sandboxOtp && (
                    <div className="bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-2xl p-4 text-xs text-[#00d2b4] flex items-center gap-3 shadow-[0_0_15px_rgba(0,210,180,0.1)]">
                      <MailCheck className="w-5 h-5 shrink-0" />
                      <span className="font-mono">Sandbox Test OTP: {sandboxOtp}</span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setOtpSent(false)}
                      className="flex-1 py-3.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl font-bold text-xs uppercase tracking-wider text-white transition"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={otpLoading}
                      className="flex-1 py-3.5 bg-[#00d2b4] text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition hover:bg-[#00d2b4]/95"
                    >
                      {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Continue"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="text-center pt-2 space-y-4">
            <p className="text-[10px] text-white/30 leading-relaxed">
              By proceeding, you secure your connection to the stablecoin subscription system.
            </p>
            <div className="pt-2 border-t border-white/5">
              <p className="text-xs text-white/40">
                Already have an account?{" "}
                <button 
                  onClick={() => router.push("/signin")} 
                  className="text-[#00d2b4] font-bold hover:underline"
                >
                  Sign In
                </button>
              </p>
            </div>
          </div>

        </div>
      </div>

      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setTurnstileLoaded(true)}
      />
    </div>
  );
}
