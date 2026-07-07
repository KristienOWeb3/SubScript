"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Loader2, 
  ArrowRight,
  Lock,
  UserPlus
} from "@/components/icons";
import { getDashboardUrl } from "@/utils/navigation";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

function LoginChoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "";
  const safeNext = /^\/(?!\/)[^\s]*$/.test(rawNext) ? rawNext : "";
  const [checkingSession, setCheckingSession] = useState(true);

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
              return;
            } else {
              const params = new URLSearchParams();
              params.set("completeRole", "1");
              if (safeNext) params.set("next", safeNext);
              window.location.href = `/signup?${params.toString()}`;
              return;
            }
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
    const params = new URLSearchParams(searchParams.toString());
    router.push(path + (params.toString() ? "?" + params.toString() : ""));
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white flex items-center justify-center p-4 sm:p-6 relative font-sans">
      <AnimatedGradientBg />
      
      <div className="relative z-10 w-full max-w-md">
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white uppercase tracking-wider">
            SubScript <span className="font-serif italic lowercase font-normal text-[#00d2b4]">gateway</span>
          </h1>
          <p className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Decentralized Payment Protocol</p>
        </div>

        <div className="liquid-glass border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden bg-black/40 backdrop-blur-md">
          
          <div className="flex items-center justify-between px-2 pb-4 border-b border-white/5">
            <span className="text-[10px] uppercase font-extrabold tracking-widest text-[#00d2b4]">Authentication</span>
            <span className="text-[9px] uppercase font-bold text-white/45 tracking-wider">Choose path</span>
          </div>

          <div className="space-y-4">
            {/* Sign In Choice */}
            <button
              onClick={() => handleChoice("/signin")}
              className="w-full text-left p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#00d2b4]/30 hover:shadow-[0_0_15px_rgba(0,210,180,0.1)] transition-all group flex items-start gap-4"
            >
              <div className="p-3 bg-[#00d2b4]/10 border border-[#00d2b4]/20 text-[#00d2b4] rounded-xl group-hover:scale-105 transition-all">
                <Lock className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Sign In</h3>
                  <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#00d2b4] group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-xs text-white/50 leading-relaxed font-sans font-normal">
                  Access your dashboard, manage active subscriptions, check developer API keys, or configure settlement.
                </p>
              </div>
            </button>

            {/* Sign Up Choice */}
            <button
              onClick={() => handleChoice("/signup")}
              className="w-full text-left p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#00d2b4]/30 hover:shadow-[0_0_15px_rgba(0,210,180,0.1)] transition-all group flex items-start gap-4"
            >
              <div className="p-3 bg-[#00d2b4]/10 border border-[#00d2b4]/20 text-[#00d2b4] rounded-xl group-hover:scale-105 transition-all">
                <UserPlus className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Create Account</h3>
                  <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#00d2b4] group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-xs text-white/50 leading-relaxed font-sans font-normal">
                  New to SubScript? Set up a client wallet or register a merchant node to start accepting USDC.
                </p>
              </div>
            </button>
          </div>

          <div className="text-center pt-2">
            <p className="text-[10px] text-white/30 uppercase tracking-widest font-mono">
              Secured by Arc Protocol
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function LoginChoicePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00d2b4]" />
      </div>
    }>
      <LoginChoiceContent />
    </Suspense>
  );
}
