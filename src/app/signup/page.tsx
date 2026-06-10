"use client";

import { useState, useEffect, useCallback } from "react";
import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { 
  Loader2, 
  Mail, 
  Chrome, 
  Wallet, 
  CheckCircle, 
  AlertCircle, 
  ArrowRight, 
  Lock 
} from "lucide-react";

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
        setActiveMerchantAddress(data.wallet);
        router.push("/dashboard");
      } else {
        setOtpError(data.error || "Invalid verification code.");
      }
    } catch (err) {
      setOtpError("Network error verifying code.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSocialLogin = () => {
    const width = 500;
    const height = 650;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      "/auth/popup?provider=google",
      "SubScript - Continue with Google",
      `width=${width},height=${height},left=${left},top=${top}`
    );

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "social-login-success") {
        const socialEmail = event.data.email;
        setOtpLoading(true);
        setOtpError(null);
        try {
          const res = await fetch("/api/auth/social", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: socialEmail, provider: "google", rememberMe: true }),
          });
          const data = await res.json();
          if (data.success) {
            setActiveMerchantAddress(data.wallet);
            router.push("/dashboard");
          } else {
            setOtpError(data.error || "Google login failed.");
          }
        } catch (err) {
          setOtpError("Network error verifying social session.");
        } finally {
          setOtpLoading(false);
        }
        window.removeEventListener("message", handleMessage);
      }
    };

    window.addEventListener("message", handleMessage);
  };

  const handleConnectWallet = () => {
    const injectedConnector = connectors.find((c) => c.id === "injected");
    if (injectedConnector) {
      connect({ connector: injectedConnector });
    } else if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    } else {
      setSiweError("No injected Web3 wallet found. Please install Metamask or Rabby.");
    }
  };

  const performSiwe = useCallback(async () => {
    if (!isConnected || !address || siweLoading) return;
    setSiweLoading(true);
    setSiweError(null);

    try {
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
        setActiveMerchantAddress(address);
        router.push("/dashboard");
      } else {
        setSiweError(verifyData.error || "Wallet signature verification failed.");
      }
    } catch (err: any) {
      setSiweError(err?.message || "Error signing SIWE verification message.");
    } finally {
      setSiweLoading(false);
    }
  }, [isConnected, address, signMessageAsync, router]);

  useEffect(() => {
    if (isConnected && address) {
      performSiwe();
    }
  }, [isConnected, address, performSiwe]);

  return (
    <div className="flex min-h-screen bg-[#060608] text-white justify-center items-center p-6">
      <div className="w-full max-w-md bg-[#0c0c0e] border border-white/5 rounded-[32px] p-8 space-y-6">
        
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black tracking-tight uppercase">Get Started</h1>
          <p className="text-xs text-white/50">Configure your payout channel and connect to the SubScript protocol.</p>
        </div>

        {/* Onboarding Progress Indicator */}
        <div className="flex items-center justify-between px-2 py-4 border-b border-white/5">
          {[{ step: 1, label: "Method" }, { step: 2, label: "Verify" }, { step: 3, label: "Access" }].map((s) => {
            const currentStep = authMethod === "select" ? 1 : (!otpSent && authMethod === "email" ? 2 : 3);
            const isCompleted = s.step < currentStep;
            const isActive = s.step === currentStep;
            return (
              <div key={s.step} className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  isCompleted 
                    ? "bg-[#ccff00] text-black" 
                    : isActive 
                      ? "bg-[#ccff00]/20 text-[#ccff00] border border-[#ccff00]/40" 
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
          <div className="space-y-3">
            <button
              onClick={() => {
                posthog.capture("signup_method_selected", { method: "email" });
                setAuthMethod("email");
              }}
              className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-white"
            >
              <Mail className="w-4 h-4 text-[#ccff00]" />
              Continue with Email
            </button>

            <button
              onClick={() => {
                posthog.capture("signup_method_selected", { method: "google" });
                handleSocialLogin();
              }}
              disabled={otpLoading}
              className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-white"
            >
              {otpLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Chrome className="w-4 h-4 text-[#ccff00]" />
              )}
              Continue with Google
            </button>

            <div className="relative py-2 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/5"></div>
              </div>
              <span className="relative px-3 bg-[#0c0c0e] text-[9px] font-bold text-white/30 uppercase tracking-widest">
                or use web3
              </span>
            </div>

            <button
              onClick={() => {
                posthog.capture("signup_method_selected", { method: "wallet" });
                handleConnectWallet();
              }}
              disabled={isConnecting || siweLoading}
              className="w-full py-4 bg-[#ccff00] hover:bg-[#ccff00]/90 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-black"
            >
              {isConnecting || siweLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wallet className="w-4 h-4" />
              )}
              Connect Web3 Wallet
            </button>

            {siweError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2 mt-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{siweError}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="name@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full text-xs p-3.5 bg-white/[0.02] border border-white/5 rounded-xl text-white focus:outline-none focus:border-[#ccff00]/40 transition font-sans"
                  />
                  {otpError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2 mt-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{otpError}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthMethod("select")}
                    className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-xl font-bold text-xs uppercase tracking-wider text-white"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={otpLoading}
                    className="flex-1 py-3.5 bg-[#ccff00] text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                  >
                    {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Code"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    placeholder="Enter 6-digit OTP code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required
                    className="w-full text-xs p-3.5 bg-white/[0.02] border border-white/5 rounded-xl text-white focus:outline-none focus:border-[#ccff00]/40 transition font-mono tracking-widest text-center"
                  />
                  {otpError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2 mt-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{otpError}</span>
                    </div>
                  )}
                </div>

                {sandboxOtp && (
                  <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 rounded-xl p-3 text-xs text-[#ccff00] flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Sandbox Test OTP: {sandboxOtp}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-xl font-bold text-xs uppercase tracking-wider text-white"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={otpLoading}
                    className="flex-1 py-3.5 bg-[#ccff00] text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                  >
                    {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Continue"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="text-center pt-2">
          <p className="text-[10px] text-white/30">
            By proceeding, you secure your connection to the stablecoin subscription system.
          </p>
        </div>

      </div>
    </div>
  );
}
