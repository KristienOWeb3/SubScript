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
  RefreshCw
} from "lucide-react";
import { getDashboardUrl } from "@/utils/navigation";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import Script from "next/script";

// Add global type declaration for reCAPTCHA
declare global {
  interface Window {
    grecaptcha: any;
    onRecaptchaLoad: () => void;
    onRecaptchaSuccess: (token: string) => void;
    onRecaptchaExpired: () => void;
  }
}

export default function SignupPage() {
  const router = useRouter();
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

  /* Role selection states */
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"USER" | "ENTERPRISE" | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [requiresEmailLinking, setRequiresEmailLinking] = useState(false);

  /* CAPTCHA states */
  const [captchaToken, setCaptchaToken] = useState("");
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.onRecaptchaSuccess = (token: string) => {
        setCaptchaToken(token);
      };
      window.onRecaptchaExpired = () => {
        setCaptchaToken("");
      };
      
      if (window.grecaptcha) {
        setRecaptchaLoaded(true);
      }
    }
    return () => {
      if (typeof window !== "undefined") {
        window.onRecaptchaSuccess = () => {};
        window.onRecaptchaExpired = () => {};
      }
    };
  }, []);

  useEffect(() => {
    if (recaptchaLoaded && typeof window !== "undefined" && window.grecaptcha) {
      const renderRecaptcha = (elementId: string) => {
        const container = document.getElementById(elementId);
        if (container && container.innerHTML === "") {
          try {
            window.grecaptcha.render(elementId, {
              sitekey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
              theme: "dark",
              callback: "onRecaptchaSuccess",
              "expired-callback": "onRecaptchaExpired",
            });
          } catch (e) {
            console.warn("reCAPTCHA render error for " + elementId + ":", e);
          }
        }
      };

      // Attempt to render in both possible containers depending on active screen
      setTimeout(() => {
        renderRecaptcha("recaptcha-email-signup");
        renderRecaptcha("recaptcha-wallet-signup");
      }, 100);
    }
  }, [recaptchaLoaded, authMethod, walletSignupPrompt]);

  const [showEmailInput, setShowEmailInput] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (data.loggedIn) {
            setActiveMerchantAddress(data.wallet);
            if (data.email) {
              setEmail(data.email);
              setRequiresEmailLinking(false);
            } else {
              setRequiresEmailLinking(true);
            }
            if (data.role) {
              window.location.href = getDashboardUrl(data.role as any, "/dashboard");
            } else {
              setShowRoleSelector(true);
            }
          }
        }
      } catch (err) {
        console.error("Failed to check active session on mount:", err);
      }
    };
    checkSession();

    const initialEmail = new URLSearchParams(window.location.search).get("email");
    if (initialEmail) {
      setEmail(initialEmail);
      setAuthMethod("email");
    } else {
      setShowEmailInput(true);
    }
  }, []);

  const handleLoginSuccess = useCallback((data: { success: boolean; wallet: string; email?: string | null; role?: string | null }) => {
    setActiveMerchantAddress(data.wallet);
    if (data.email) {
      setEmail(data.email);
      setRequiresEmailLinking(false);
    }
    if (data.role) {
      window.location.href = getDashboardUrl(data.role as any, "/dashboard");
    } else {
      if (!data.email && !email) {
        setRequiresEmailLinking(true);
      }
      setShowRoleSelector(true);
    }
  }, [email]);

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
        setOtpError("An account with this email already exists. Redirecting to Sign In...");
        setTimeout(() => {
          router.push(`/signin?email=${encodeURIComponent(email)}`);
        }, 2000);
        return;
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
        setSiweError("This wallet already has an account. Redirecting to Sign In...");
        setTimeout(() => {
          router.push("/signin");
        }, 2000);
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
      const message = `Sign this message to verify ownership of your SubScript Merchant Dashboard.\n\nNonce: ${fetchedNonce}`;
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
        body: JSON.stringify({ role: selectedRole, email: requiresEmailLinking ? email : undefined }),
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = getDashboardUrl(selectedRole as any, "/dashboard");
      } else {
        setRoleError(data.error || "Failed to register account type.");
      }
    } catch (err) {
      setRoleError("Network error registering account type.");
    } finally {
      setRoleLoading(false);
    }
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
              SubScript <span className="font-serif italic lowercase font-normal text-[#ccff00]">onboarding</span>
            </h1>
            <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
          </div>

          <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
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
                    ? "border-[#ccff00] bg-[#ccff00]/5 shadow-[0_0_20px_rgba(204,255,0,0.15)]"
                    : "border-white/5 bg-white/[0.01] hover:border-[#ccff00]/40 hover:bg-white/[0.02] hover:shadow-[0_0_15px_rgba(204,255,0,0.08)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border transition-colors ${
                    selectedRole === "USER"
                      ? "bg-[#ccff00]/10 border-[#ccff00]/30 text-[#ccff00]"
                      : "bg-white/5 border-white/5 text-white/40 group-hover:text-[#ccff00]"
                  }`}>
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm uppercase tracking-wider transition-colors ${
                      selectedRole === "USER" ? "text-[#ccff00]" : "text-white"
                    }`}>
                      Individual User
                    </h3>
                    <span className="text-[9px] text-[#ccff00] uppercase font-bold tracking-wider">Routes to User Hub</span>
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

            {requiresEmailLinking && (
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
                  Enter your email address so you don't miss critical payment and billing push notifications.
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
              onClick={handleRoleSelection}
              disabled={!selectedRole || roleLoading}
              className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 transition-all font-bold text-xs uppercase tracking-wider text-black ${
                !selectedRole 
                  ? "bg-white/10 text-white/40 cursor-not-allowed border border-white/5" 
                  : selectedRole === "USER"
                    ? "bg-[#ccff00] hover:bg-[#ccff00]/85 shadow-[0_0_20px_rgba(204,255,0,0.2)]"
                    : "bg-[#00d2b4] hover:bg-[#00d2b4]/85 shadow-[0_0_20px_rgba(0,210,180,0.2)]"
              }`}
            >
              {roleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Complete Signup"}
              {!roleLoading && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-6 relative font-sans">
      <AnimatedGradientBg />
      
      <div className="relative z-10 w-full max-w-md">
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
            SubScript <span className="font-serif italic lowercase font-normal text-[#ccff00]">signup</span>
          </h1>
          <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
        </div>

        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
          
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
                      ? "bg-[#ccff00] text-black" 
                      : isActive 
                        ? "bg-[#ccff00]/25 text-[#ccff00] border border-[#ccff00]/40 shadow-[0_0_10px_rgba(204,255,0,0.2)]" 
                        : "bg-white/5 text-white/30 border border-white/10"
                  }`}>
                    {isCompleted ? "✓" : s.step}
                  </div>
                  <span className={`text-[9px] uppercase font-bold tracking-wider ${
                    isActive ? "text-[#ccff00]" : isCompleted ? "text-white/80" : "text-white/30"
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

              <button
                onClick={() => {
                  posthog.capture("signup_method_selected", { method: "email" });
                  setAuthMethod("email");
                }}
                className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-white"
              >
                <Mail className="w-4 h-4 text-[#ccff00]" />
                Continue with Email Wallet
              </button>
              <p className="-mt-2 px-3 text-center text-[10px] leading-relaxed text-white/40">
                Email wallets use SubScript-managed recovery. Connect an external wallet for self-custody.
              </p>

              <div onClick={() => posthog.capture("signup_method_selected", { method: "circle_google" })}>
                <CircleGoogleWalletButton onSuccess={handleLoginSuccess} />
              </div>

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
                className="w-full py-4 bg-[#ccff00] hover:bg-[#ccff00]/90 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-black shadow-[0_0_20px_rgba(204,255,0,0.15)]"
              >
                {isConnecting || siweLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wallet className="w-4 h-4" />
                )}
                Connect Web3 Wallet
              </button>

              {siweError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3 mt-2">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{siweError}</span>
                </div>
              )}

              {walletSignupPrompt && address && (
                <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 rounded-2xl p-4 text-xs text-white/70 space-y-4 mt-2">
                  <div className="flex items-start gap-3">
                    <Wallet className="w-5 h-5 shrink-0 mt-0.5 text-[#ccff00]" />
                    <div className="space-y-1">
                      <p className="font-bold text-white uppercase tracking-wider">Wallet detected</p>
                      <p className="leading-relaxed">
                        No SubScript account exists for this wallet yet. Choose what you want to do next.
                      </p>
                      <p className="font-mono text-[10px] text-white/40 break-all">{address}</p>
                    </div>
                  </div>

                  {/* Google reCAPTCHA for Wallet Signup */}
                  <div className="space-y-2 border-t border-white/5 pt-3 flex flex-col items-center">
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-white/50 self-start">
                      Security Verification
                    </label>
                    <div id="recaptcha-wallet-signup" className="my-2"></div>
                  </div>

                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => performSiwe(true)}
                      disabled={siweLoading || !captchaToken}
                      className="w-full py-3 bg-[#ccff00] text-black rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2"
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

                    {/* Google reCAPTCHA */}
                    <div className="space-y-2 pt-2 flex flex-col items-center">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60 self-start">
                        Security Verification
                      </label>
                      <div id="recaptcha-email-signup" className="my-2"></div>
                    </div>
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
                      className="flex-1 py-3.5 bg-[#ccff00] text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition hover:bg-[#ccff00]/95"
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
                    <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 rounded-2xl p-4 text-xs text-[#ccff00] flex items-center gap-3 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
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
                      className="flex-1 py-3.5 bg-[#ccff00] text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition hover:bg-[#ccff00]/95"
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
                  className="text-[#ccff00] font-bold hover:underline"
                >
                  Sign In
                </button>
              </p>
            </div>
          </div>

        </div>
      </div>

      <Script 
        src="https://www.google.com/recaptcha/api.js?render=explicit" 
        strategy="afterInteractive"
        onLoad={() => setRecaptchaLoaded(true)}
      />
    </div>
  );
}
