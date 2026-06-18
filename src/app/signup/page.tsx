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
  ArrowRight
} from "lucide-react";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";

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

  /* Role selection states */
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"USER" | "ENTERPRISE" | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const handleLoginSuccess = useCallback((data: { success: boolean; wallet: string; role?: string | null }) => {
    setActiveMerchantAddress(data.wallet);
    if (data.role) {
      router.push(data.role === "USER" ? "/dashboard/user" : "/dashboard");
    } else {
      setShowRoleSelector(true);
    }
  }, [router]);

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
        handleLoginSuccess(verifyData);
      } else {
        setSiweError(verifyData.error || "Wallet signature verification failed.");
      }
    } catch (err: any) {
      setSiweError(err?.message || "Error signing SIWE verification message.");
    } finally {
      setSiweLoading(false);
    }
  }, [isConnected, address, signMessageAsync, handleLoginSuccess]);

  const handleRoleSelection = async () => {
    if (!selectedRole) return;
    setRoleLoading(true);
    setRoleError(null);
    try {
      const res = await fetch("/api/auth/register-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(selectedRole === "USER" ? "/dashboard/user" : "/dashboard");
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
    if (isConnected && address) {
      performSiwe();
    }
  }, [isConnected, address, performSiwe]);

  if (showRoleSelector) {
    return (
      <div className="flex min-h-screen bg-[#060608] text-white justify-center items-center p-6">
        <div className="w-full max-w-md bg-[#0c0c0e] border border-white/5 rounded-[32px] p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-black tracking-tight uppercase">Select Account Type</h1>
            <p className="text-xs text-white/50">Are you using SubScript as a user or an enterprise merchant?</p>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => setSelectedRole("USER")}
              className={`w-full p-5 border rounded-2xl text-left transition ${
                selectedRole === "USER"
                  ? "border-[#ccff00] bg-[#ccff00]/5"
                  : "border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]"
              }`}
            >
              <h3 className={`font-bold text-sm uppercase tracking-wider ${selectedRole === "USER" ? "text-[#ccff00]" : "text-white"}`}>
                Individual User
              </h3>
              <p className="text-xs text-white/50 mt-1">
                Subscribe to your favorite services, manage active memberships, and chat with merchants.
              </p>
            </button>

            <button
              onClick={() => setSelectedRole("ENTERPRISE")}
              className={`w-full p-5 border rounded-2xl text-left transition ${
                selectedRole === "ENTERPRISE"
                  ? "border-[#ccff00] bg-[#ccff00]/5"
                  : "border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]"
              }`}
            >
              <h3 className={`font-bold text-sm uppercase tracking-wider ${selectedRole === "ENTERPRISE" ? "text-[#ccff00]" : "text-white"}`}>
                Enterprise / Merchant
              </h3>
              <p className="text-xs text-white/50 mt-1">
                Generate payment links, set up recurring billing tiers, process payroll, and accept stablecoins.
              </p>
            </button>
          </div>

          {roleError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{roleError}</span>
            </div>
          )}

          <button
            onClick={handleRoleSelection}
            disabled={!selectedRole || roleLoading}
            className="w-full py-4 bg-[#ccff00] hover:bg-[#ccff00]/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl flex items-center justify-center gap-2 transition font-bold text-xs uppercase tracking-wider text-black"
          >
            {roleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
            {!roleLoading && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  }

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

            <div onClick={() => posthog.capture("signup_method_selected", { method: "circle_google" })}>
              <CircleGoogleWalletButton />
            </div>

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
