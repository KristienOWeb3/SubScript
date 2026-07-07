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
  MailCheck
} from "@/components/icons";
import { getDashboardUrl } from "@/utils/navigation";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { CIRCLE_GOOGLE_ENABLED } from "@/lib/featureFlags";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  /* Optional post-login destination (e.g. a /subscribe/[planId] link). Only safe
     same-origin relative paths are honored, to avoid open-redirects. */
  const rawNext = searchParams.get("next") || "";
  const safeNext = /^\/(?!\/)[^\s]*$/.test(rawNext) ? rawNext : "";

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();

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
          if (data.loggedIn) {
            if (data.role) {
              window.location.href = safeNext && data.role === "USER"
                ? safeNext
                : getDashboardUrl(data.role as any, "/dashboard");
            } else {
              window.location.href = safeNext
                ? `/signup?next=${encodeURIComponent(safeNext)}`
                : "/signup";
            }
          }
        }
      } catch (err) {
        console.error("Failed to check active session on signin mount:", err);
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
      // If signed in but somehow role is missing, go to onboarding (signup role selector)
      window.location.href = safeNext
        ? `/signup?next=${encodeURIComponent(safeNext)}`
        : getDashboardUrl("USER", "/signup");
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
      // Check if email has an account
      const checkRes = await fetch("/api/auth/check-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const checkData = await checkRes.json();
      if (!checkData.exists) {
        setOtpError("No completed account exists for this email yet. Use Sign Up below to create one.");
        return;
      }
      if (checkData.authMethod === "wallet") {
        setOtpError("This email is linked to a wallet-only account. Connect that wallet to sign in; email recovery is not available for linked notification emails.");
        return;
      }

      // Send OTP
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
      const message = `Sign this message to verify ownership of your SubScript Merchant Dashboard.\n\nNonce: ${fetchedNonce}`;
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
      setSiweError(err?.message || "Error signing SIWE verification message.");
    } finally {
      setSiweLoading(false);
      setWalletAuthRequested(false);
    }
  }, [isConnected, address, signMessageAsync, handleLoginSuccess, router, siweLoading]);

  useEffect(() => {
    if (walletAuthRequested && isConnected && address) {
      performSiwe();
    }
  }, [walletAuthRequested, isConnected, address, performSiwe]);

  return (
    <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-4 sm:p-6 relative font-sans">
      <AnimatedGradientBg />
      
      <div className="relative z-10 w-full max-w-md">
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
            SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">signin</span>
          </h1>
          <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
        </div>

        <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
          
          <div className="flex items-center justify-between px-2 pb-4 border-b border-white/5">
            <span className="text-[10px] uppercase font-extrabold tracking-widest text-[#00d2b4]">Authenticate</span>
            <span className="text-[10px] uppercase font-extrabold tracking-widest text-white/40">Secure Sign In</span>
          </div>

          {authMethod === "select" ? (
            <div className="space-y-4">
              <p className="text-center text-xs text-white/50 leading-relaxed px-2">
                Connect your registered payout wallet or email to access your SubScript dashboard.
              </p>

              <button
                onClick={() => {
                  posthog.capture("signin_method_selected", { method: "email" });
                  setAuthMethod("email");
                }}
                className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-white"
              >
                <Mail className="w-4 h-4 text-[#00d2b4]" />
                Continue with Email
              </button>

              {CIRCLE_GOOGLE_ENABLED && (
                <div onClick={() => posthog.capture("signin_method_selected", { method: "circle_google" })}>
                  <CircleGoogleWalletButton />
                </div>
              )}

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
                  posthog.capture("signin_method_selected", { method: "wallet" });
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

              {siweError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-400 flex items-start gap-3 mt-2">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{siweError}</span>
                </div>
              )}

              {walletMissingAccount && address && (
                <div className="bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-2xl p-4 text-xs text-white/70 space-y-4 mt-2">
                  <div className="flex items-start gap-3">
                    <Wallet className="w-5 h-5 shrink-0 mt-0.5 text-[#00d2b4]" />
                    <div className="space-y-1">
                      <p className="font-bold text-white uppercase tracking-wider">No account found</p>
                      <p className="leading-relaxed">
                        This wallet is connected, but it does not have a SubScript account yet. Choose your next step.
                      </p>
                      <p className="font-mono text-[10px] text-white/40 break-all">{address}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(safeNext ? `/signup?next=${encodeURIComponent(safeNext)}` : "/signup")}
                      className="py-3 bg-[#00d2b4] text-black rounded-xl font-bold text-[10px] uppercase tracking-wider"
                    >
                      Create Account
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWalletMissingAccount(false);
                        setAuthMethod("email");
                      }}
                      className="py-3 bg-white/5 border border-white/10 rounded-xl font-bold text-[10px] uppercase tracking-wider text-white"
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
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                      Registered Email
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
                      {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Sign In"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="text-center pt-4 border-t border-white/5">
            <p className="text-xs text-white/40">
              Don&apos;t have an account?{" "}
              <button 
                onClick={() => router.push("/signup")} 
                className="text-[#00d2b4] font-bold hover:underline"
              >
                Sign Up
              </button>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
