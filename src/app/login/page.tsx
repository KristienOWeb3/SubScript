"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Loader2, 
  ArrowRight,
  Lock,
  UserPlus,
  LogOut
} from "@/components/icons";
import { getDashboardUrl, getSafeRelativePath } from "@/utils/navigation";
import AuthSkeleton from "@/components/AuthSkeleton";

function LoginChoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeNext = getSafeRelativePath(searchParams?.get("next") || null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeSession, setActiveSession] = useState<{ wallet: string; email?: string; role: string } | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

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
              return;
          }
        }
      } catch (err) {
        console.error("Failed to check active session on login mount:", err);
      } finally {
        setCheckingSession(false);
      }
    };
    checkSession();
  }, [safeNext]);

  const handleChoice = (path: "/signin" | "/signup") => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    router.push(path + (params.toString() ? "?" + params.toString() : ""));
  };

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
    return <AuthSkeleton title="portal" subtitle="Welcome to SubScript" />;
  }

  if (activeSession) {
    return (
      <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
              SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">portal</span>
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
            SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">portal</span>
          </h1>
          <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">Welcome to SubScript</p>
        </div>

        <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
          
          <div className="flex items-center justify-between px-1 pb-4 border-b border-black/10">
            <span className="text-[10px] uppercase font-black tracking-widest text-[#1f62ab]">Get Started</span>
            <span className="text-[10px] uppercase font-bold text-black/50 tracking-wider">Choose an option</span>
          </div>

          <div className="space-y-4">
            {/* Sign In Option */}
            <button
              onClick={() => handleChoice("/signin")}
              className="w-full text-left p-5 rounded-2xl border border-black/10 bg-white hover:border-[#2775CA]/40 hover:bg-black/[0.02] hover:shadow-md transition-all group flex items-start gap-4 shadow-sm"
            >
              <div className="p-3 bg-[#2775CA]/10 border border-[#2775CA]/20 text-[#2775CA] rounded-xl group-hover:scale-105 transition-all">
                <Lock className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wider">Sign In</h3>
                  <ArrowRight className="w-4 h-4 text-black/30 group-hover:text-[#2775CA] group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-xs text-black/60 leading-relaxed font-sans font-normal">
                  Access your dashboard, manage active subscriptions, check developer API keys, or view payouts.
                </p>
              </div>
            </button>

            {/* Sign Up Option */}
            <button
              onClick={() => handleChoice("/signup")}
              className="w-full text-left p-5 rounded-2xl border border-black/10 bg-white hover:border-[#2775CA]/40 hover:bg-black/[0.02] hover:shadow-md transition-all group flex items-start gap-4 shadow-sm"
            >
              <div className="p-3 bg-[#2775CA]/10 border border-[#2775CA]/20 text-[#2775CA] rounded-xl group-hover:scale-105 transition-all">
                <UserPlus className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wider">Create Account</h3>
                  <ArrowRight className="w-4 h-4 text-black/30 group-hover:text-[#2775CA] group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-xs text-black/60 leading-relaxed font-sans font-normal">
                  New to SubScript? Set up a personal account or register a merchant node to start accepting payments.
                </p>
              </div>
            </button>
          </div>

          <div className="text-center pt-2">
            <p className="text-[10px] text-black/40 uppercase tracking-widest font-mono">
              Fast, secure settlement on Arc
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function LoginChoicePage() {
  return (
    <Suspense fallback={<AuthSkeleton title="portal" subtitle="Welcome to SubScript" />}>
      <LoginChoiceContent />
    </Suspense>
  );
}
