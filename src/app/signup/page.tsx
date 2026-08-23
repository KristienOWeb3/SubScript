"use client";

import { useState, useEffect, useCallback } from "react";
import posthog from "posthog-js";
import Link from "next/link";
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
import { getDashboardUrl, getSafeRelativePath } from "@/utils/navigation";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import AuthSkeleton from "@/components/AuthSkeleton";
import Script from "next/script";
import { CIRCLE_GOOGLE_ENABLED } from "@/lib/featureFlags";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";

// Global type declaration for Cloudflare Turnstile
declare global {
  interface Window {
    turnstile: any;
  }
}

/* Survives the Google OAuth redirect, which remounts this page and clears React state. */
const PRESELECTED_ROLE_KEY = "subscript_preselected_role";

/* Where a business that isn't approved yet can reach us instead of bouncing off the merchant card. */
const X_HANDLE_URL = "https://x.com/SubScript_onarc";

/* The role here selects an account type that cannot be changed afterwards, so the value is only
   allowed to live as long as one authentication hand-off plausibly takes. Anything older is a
   leftover from an abandoned attempt and must not auto-register whoever authenticates next in
   this browser — they fall back to the picker instead, which costs one tap. */
const ROLE_ARM_TTL_MS = 10 * 60 * 1000;

type ArmedRole = { role: "USER" | "ENTERPRISE"; armedAt: number };

const clearPreselectedRole = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PRESELECTED_ROLE_KEY);
  }
};

/* Written only when an authentication that navigates away is actually starting — never on a mere
   card click. Selecting a card lives in React state; if the user abandons signup there, nothing
   was persisted and there is nothing to go stale. */
const armPreselectedRole = (role: "USER" | "ENTERPRISE") => {
  if (typeof window === "undefined") return;
  const armed: ArmedRole = { role, armedAt: Date.now() };
  window.localStorage.setItem(PRESELECTED_ROLE_KEY, JSON.stringify(armed));
};

/* Read synchronously rather than relying on the restore effect — handleLoginSuccess can fire
   from the mount-time session check before that effect has committed the state update.
   Every rejection path also erases the value, so a malformed or expired record cannot linger and
   be re-evaluated on the next visit. Records written by the previous plain-string format have no
   timestamp to age, so they parse as invalid and are dropped — failing to the picker. */
const readPreselectedRole = (): "USER" | "ENTERPRISE" | null => {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(PRESELECTED_ROLE_KEY);
  if (!stored) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    clearPreselectedRole();
    return null;
  }

  const armed = parsed as Partial<ArmedRole> | null;
  const role = armed?.role;
  const armedAt = armed?.armedAt;
  if ((role !== "USER" && role !== "ENTERPRISE") || typeof armedAt !== "number") {
    clearPreselectedRole();
    return null;
  }
  /* A clock rolled backwards (timezone change, NTP correction) makes armedAt look like the future.
     Treat that as untrustworthy rather than as an indefinitely valid record. */
  const age = Date.now() - armedAt;
  if (age < 0 || age > ROLE_ARM_TTL_MS) {
    clearPreselectedRole();
    return null;
  }
  return role;
};

export default function SignupPage() {
  const router = useRouter();
  /* Optional post-onboarding destination (e.g. a /subscribe/[planId] link a new
     user followed). Only safe same-origin relative paths are honored. */
  const getSafeNext = () => {
    if (typeof window === "undefined") return "";
    return getSafeRelativePath(new URLSearchParams(window.location.search).get("next"));
  };
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { externalWalletEnabled, googleSigninEnabled, merchantInviteOnlyEnabled, loaded: platformFlagsLoaded } = usePlatformFlags();
  const googleAvailable = CIRCLE_GOOGLE_ENABLED && platformFlagsLoaded && googleSigninEnabled;

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
  /* Whatever came in on ?invite= / ?merchantCode=. Under invite-only enforcement the server treats
     it as a token bound to one granted email; before then it is the legacy shared code. Either way
     it is a hint, never the thing that decides — the server checks the verified email. */
  const [merchantInvite, setMerchantInvite] = useState("");
  /* Set when the server refuses a merchant signup for want of an invite, so the picker can offer
     the request-access route instead of a bare error. */
  const [merchantInviteBlocked, setMerchantInviteBlocked] = useState(false);
  /* An invite link in the URL means an admin already approved this business, so the invite-only
     nudge would just be noise on the way in. */
  const inviteOnlyNotice = merchantInviteOnlyEnabled && !merchantInvite;

  /* Role selection states */
  const [showRoleSelector, setShowRoleSelector] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"USER" | "ENTERPRISE" | null>(null);
  /* Picking a card is only an intent, so it stays in React state. Persisting here instead would
     outlive the page: abandon signup, hit Sign In, sign out, or hand the laptop over, and the next
     person to authenticate in this browser gets silently registered into a role they never chose —
     and the account type cannot be changed afterwards. The value is armed at the auth hand-off
     (see armPreselectedRole) where it is bound to an attempt actually in flight. */
  const persistRoleChoice = (role: "USER" | "ENTERPRISE") => {
    setSelectedRole(role);
  };
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
            theme: "light",
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
       the intended account type is chosen for them and the role picker reads correctly. Kept in
       React state only: the URL declared an intent, not a started authentication. */
    if (merchantIntent) {
      setSelectedRole("ENTERPRISE");
    } else {
      /* Returning from the Google OAuth redirect: React state was destroyed by the navigation,
         so restore the role armed at the hand-off. readPreselectedRole drops anything expired or
         malformed, so a stale choice from an abandoned attempt lands on the picker instead. */
      const storedRole = readPreselectedRole();
      if (storedRole) {
        setSelectedRole(storedRole);
      }
    }
    setMerchantInvite(params.get("merchantCode") || params.get("invite") || "");

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
    const userEmail = data.email || email;
    if (data.email) {
      setEmail(data.email);
      setRequiresEmailLinking(false);
    }

    /* The OAuth redirect wipes React state, so fall back to the persisted choice from before
       the hand-off. Either way the role has now been consumed — drop it so a later visit to
       /signup for a different account type isn't silently auto-registered into the old role. */
    const intendedRole = selectedRole ?? readPreselectedRole();

    if (data.role) {
      clearPreselectedRole();
      triggerReferralLogging().finally(() => {
        const next = getSafeNext();
        window.location.href = (next && data.role === "USER")
          ? next
          : getDashboardUrl(data.role as any, "/dashboard");
      });
    } else if (intendedRole) {
      // Role was chosen before authenticating -> register automatically without prompting again
      fetch("/api/auth/register-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: intendedRole,
          email: userEmail || undefined,
          /* Both keys: the server reads merchantInviteToken under invite-only enforcement and
             merchantSignupCode before it. One state, so a link keeps working either way. */
          merchantInviteToken: intendedRole === "ENTERPRISE" ? merchantInvite : undefined,
          merchantSignupCode: intendedRole === "ENTERPRISE" ? merchantInvite : undefined,
        }),
      })
        .then((res) => res.json())
        .then((regData) => {
          if (regData.success) {
            clearPreselectedRole();
            triggerReferralLogging().finally(() => {
              const next = getSafeNext();
              window.location.href = (next && intendedRole === "USER")
                ? next
                : getDashboardUrl(intendedRole as any, "/dashboard");
            });
          } else {
            /* Reopening the picker without the reason reads as "your choice didn't take" — the
               user re-picks the same card and hits the same rejection. A missing merchant invite,
               for instance, is only fixable once it's named. */
            clearPreselectedRole();
            setRoleError(regData.error || "Failed to register account type.");
            setMerchantInviteBlocked(typeof regData.code === "string" && regData.code.startsWith("MERCHANT_"));
            /* Nothing was written, so USER is still available on the picker. An ungranted business
               is not locked out of SubScript — only out of a merchant account. */
            setSelectedRole(null);
            setShowRoleSelector(true);
          }
        })
        .catch(() => {
          clearPreselectedRole();
          setRoleError("Network error registering account type. Please select your account type again.");
          setShowRoleSelector(true);
        });
    } else {
      /* Authenticated with no role to apply: whatever may still be armed is now moot, and the
         picker below is about to ask explicitly. */
      clearPreselectedRole();
      if (!data.email && !email) {
        setRequiresEmailLinking(true);
        setIsExternalWalletSignup(true);
      }
      setShowRoleSelector(true);
    }
  }, [email, selectedRole, merchantInvite, triggerReferralLogging]);

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
        body: JSON.stringify({ email, captchaCode: "", captchaToken, isSignup: true, authFlow: "signup" }),
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
    setMerchantInviteBlocked(false);
    try {
      const res = await fetch("/api/auth/register-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: selectedRole,
          email: requiresEmailLinking ? email : undefined,
          merchantInviteToken: selectedRole === "ENTERPRISE" ? merchantInvite : undefined,
          merchantSignupCode: selectedRole === "ENTERPRISE" ? merchantInvite : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearPreselectedRole();
        triggerReferralLogging().finally(() => {
          const next = getSafeNext();
          window.location.href = (next && selectedRole === "USER")
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

  /* Pre-auth account-type step: the user picks User vs Merchant BEFORE choosing an auth method, so
     the auth screen can adapt (merchants are email/Google only). This only records the choice and
     advances to the auth method screen; the role is registered after authentication. */
  const handleContinueToAuth = () => {
    if (!selectedRole) return;
    setRoleError(null);
    setMerchantSignupIntent(selectedRole === "ENTERPRISE");
    setShowRoleSelector(false);
  };

  /* Leaving for Sign In abandons this signup — an existing account already has a role, so nothing
     armed here should survive to be applied to it. Declared above the early returns below, which
     render Sign In links and would otherwise reference it before initialization. */
  const goToSignIn = () => {
    clearPreselectedRole();
    router.push("/signin");
  };

  useEffect(() => {
    if (walletAuthRequested && isConnected && address) {
      performSiwe();
    }
  }, [walletAuthRequested, isConnected, address, performSiwe]);

  if (showRoleSelector) {
    return (
      <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
              {isCompleteRoleFlow
                ? <>SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">finish setup</span></>
                : <>SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">signup</span></>
              }
            </h1>
            <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">
              {isCompleteRoleFlow ? "One last step to complete your account" : "Create your account"}
            </p>
          </div>

          <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
            <div className="text-center space-y-1.5">
              <h2 className="text-base font-bold uppercase tracking-wider text-[#111827]">Choose Account Type</h2>
              <p className="text-xs text-black/60 leading-relaxed">
                Select how you would like to use SubScript.
              </p>
            </div>

            <div className="space-y-4">
              {/* User Account Option */}
              <button
                onClick={() => persistRoleChoice("USER")}
                className={`w-full p-5 border text-left rounded-2xl transition-all duration-200 relative overflow-hidden group shadow-sm ${
                  selectedRole === "USER"
                    ? "border-[#2775CA] bg-[#2775CA]/[0.06] shadow-sm"
                    : "border-black/10 bg-white hover:border-[#2775CA]/40 hover:bg-black/[0.02]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border transition-colors ${
                    selectedRole === "USER"
                      ? "bg-[#2775CA]/10 border-[#2775CA]/30 text-[#2775CA]"
                      : "bg-black/5 border-black/5 text-black/40 group-hover:text-[#2775CA]"
                  }`}>
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm uppercase tracking-wider transition-colors ${
                      selectedRole === "USER" ? "text-[#2775CA]" : "text-[#111827]"
                    }`}>
                      Personal Account
                    </h3>
                  </div>
                </div>
                <p className="text-xs text-black/60 mt-3 leading-relaxed">
                  Subscribe to apps, manage recurring payment plans, send payments, and track personal spending.
                </p>
              </button>

              {/* Enterprise Merchant Option */}
              <button
                onClick={() => persistRoleChoice("ENTERPRISE")}
                className={`w-full p-5 border text-left rounded-2xl transition-all duration-200 relative overflow-hidden group shadow-sm ${
                  selectedRole === "ENTERPRISE"
                    ? "border-[#2775CA] bg-[#2775CA]/[0.06] shadow-sm"
                    : "border-black/10 bg-white hover:border-[#2775CA]/40 hover:bg-black/[0.02]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border transition-colors ${
                    selectedRole === "ENTERPRISE"
                      ? "bg-[#2775CA]/10 border-[#2775CA]/30 text-[#2775CA]"
                      : "bg-black/5 border-black/5 text-black/40 group-hover:text-[#2775CA]"
                  }`}>
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm uppercase tracking-wider transition-colors ${
                      selectedRole === "ENTERPRISE" ? "text-[#2775CA]" : "text-[#111827]"
                    }`}>
                      Merchant Account
                    </h3>
                    <span className="text-[10px] text-[#1f62ab] uppercase font-bold tracking-wider">
                      {inviteOnlyNotice ? "Invite only" : "Business & Developer"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-black/60 mt-3 leading-relaxed">
                  Accept recurring subscriptions, create checkout links, automate payroll, and manage business revenue.
                </p>
                {inviteOnlyNotice && (
                  <p className="text-xs text-[#1f62ab] mt-2.5 leading-relaxed font-medium">
                    We review and approve merchants individually. Already approved? Sign up with your registered email.
                  </p>
                )}
              </button>
            </div>

            {inviteOnlyNotice && (
              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 space-y-2.5 text-left">
                <p className="text-xs text-black/70 leading-relaxed">
                  Need a merchant account? Tell us about your business to receive an invite.
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Link
                    href="/merchant-access"
                    className="text-xs font-bold uppercase tracking-wider text-[#2775CA] hover:underline transition-colors"
                  >
                    Request merchant access
                  </Link>
                  <span className="text-black/20">·</span>
                  <a
                    href={X_HANDLE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold uppercase tracking-wider text-black/50 hover:text-black transition-colors"
                  >
                    Or reach out on X
                  </a>
                </div>
              </div>
            )}

            {requiresEmailLinking && isExternalWalletSignup && (
              <div className="space-y-2 pt-2 text-left">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                  Email Address (for notifications)
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
                <p className="text-[10px] text-black/50 leading-relaxed">
                  Enter your email address to receive transaction confirmations and billing updates.
                </p>
              </div>
            )}

            {roleError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-start gap-3" role="alert">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
                <div className="space-y-2">
                  <span className="leading-relaxed block">{roleError}</span>
                  {merchantInviteBlocked && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href="/merchant-access"
                        className="text-xs font-bold uppercase tracking-wider text-[#2775CA] hover:underline transition-colors"
                      >
                        Request merchant access
                      </Link>
                      <span className="text-black/20">·</span>
                      <a
                        href={X_HANDLE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold uppercase tracking-wider text-black/50 hover:text-black transition-colors"
                      >
                        Reach out on X
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={activeMerchantAddress ? handleRoleSelection : handleContinueToAuth}
              disabled={!selectedRole || roleLoading}
              className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 transition-all font-bold text-xs uppercase tracking-wider shadow-sm ${
                !selectedRole || roleLoading
                  ? "bg-black/5 text-black/40 cursor-not-allowed border border-black/10"
                  : "bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0]"
              }`}
            >
              {roleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (activeMerchantAddress ? "Complete Signup" : "Continue")}
              {!roleLoading && <ArrowRight className="w-4 h-4" />}
            </button>

            <p className="text-center text-xs text-black/60 pt-1">
              Already have an account?{" "}
              <button
                onClick={goToSignIn}
                className="text-[#2775CA] hover:underline font-semibold transition-colors"
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
    /* Signing out ends any signup attempt this browser had in flight. Leaving the armed role behind
       would let it apply to whoever authenticates next on this device. */
    clearPreselectedRole();
    setSelectedRole(null);
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
    return <AuthSkeleton title="signup" subtitle="Create your account" />;
  }

  if (activeSession) {
    return (
      <div className="subscript-checkout min-h-screen bg-[#FFFFF0] text-black selection:bg-[#2775CA]/20 selection:text-black flex items-center justify-center p-4 sm:p-6 relative font-sans">
        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
              SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">signup</span>
            </h1>
            <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">Create your account</p>
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
            SubScript <span className="font-serif italic lowercase font-normal text-[#2775CA]">signup</span>
          </h1>
          <p className="text-xs text-[#1f62ab] font-bold uppercase tracking-widest mt-1">Create your account</p>
        </div>

        <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
          
          {/* Onboarding Progress Indicator */}
          <div className="flex items-center justify-between px-1 pb-4 border-b border-black/10">
            {[{ step: 1, label: "Method" }, { step: 2, label: "Verify" }, { step: 3, label: "Access" }].map((s) => {
              const currentStep = authMethod === "select" ? 1 : (!otpSent && authMethod === "email" ? 2 : 3);
              const isCompleted = s.step < currentStep;
              const isActive = s.step === currentStep;
              return (
                <div key={s.step} className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                    isCompleted 
                      ? "bg-[#2775CA] text-[#FFFFF0]" 
                      : isActive 
                        ? "bg-[#2775CA]/15 text-[#2775CA] border border-[#2775CA]/40 shadow-sm" 
                        : "bg-black/5 text-black/40 border border-black/10"
                  }`}>
                    {isCompleted ? "✓" : s.step}
                  </div>
                  <span className={`text-[9px] uppercase font-bold tracking-wider hidden sm:inline ${
                    isActive ? "text-[#2775CA]" : isCompleted ? "text-[#111827]" : "text-black/40"
                  }`}>
                    {s.label}
                  </span>
                  {s.step < 3 && <div className="w-6 h-[1px] bg-black/10 hidden sm:block" />}
                </div>
              );
            })}
          </div>

          {authMethod === "select" ? (
            <div className="space-y-4">
              <p className="text-center text-xs text-black/60 leading-relaxed px-2">
                Choose how you would like to create and secure your SubScript account.
              </p>

              {/* Merchant Invite Notice */}
              {inviteOnlyNotice && merchantSignupIntent && (
                <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 space-y-2 text-left">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#1f62ab]">
                    Merchant accounts are invite only
                  </p>
                  <p className="text-xs text-black/70 leading-relaxed">
                    We review and approve merchant accounts individually. If we have already approved you, continue below with your registered email.
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Link
                      href="/merchant-access"
                      className="text-xs font-bold uppercase tracking-wider text-[#2775CA] hover:underline transition-colors"
                    >
                      Request merchant access
                    </Link>
                    <span className="text-black/20">·</span>
                    <a
                      href={X_HANDLE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold uppercase tracking-wider text-black/50 hover:text-black transition-colors"
                    >
                      Or reach out on X
                    </a>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  posthog.capture("signup_method_selected", { method: "email" });
                  setAuthMethod("email");
                }}
                className="w-full py-4 bg-white hover:bg-black/[0.03] border border-black/15 rounded-2xl flex items-center justify-center gap-3 transition font-bold text-xs uppercase tracking-wider text-[#111827] shadow-sm"
              >
                <Mail className="w-4 h-4 text-[#2775CA]" />
                Continue with Email
              </button>
              <p className="-mt-2 px-3 text-center text-[10px] leading-relaxed text-black/50">
                {merchantSignupIntent
                  ? `Merchant accounts use email${googleAvailable ? " or Google" : ""} sign-in for security, recovery, and invoicing.`
                  : "Email wallets feature simple recovery. Connect an external wallet for self-custody."}
              </p>

              {googleAvailable && (
                <div
                  onClick={() => {
                    posthog.capture("signup_method_selected", { method: "circle_google" });
                    if (selectedRole) armPreselectedRole(selectedRole);
                  }}
                >
                  <CircleGoogleWalletButton onSuccess={handleLoginSuccess} />
                </div>
              )}

              {!merchantSignupIntent && externalWalletEnabled && (
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
                      posthog.capture("signup_method_selected", { method: "wallet" });
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

              {walletSignupPrompt && address && (
                <div className="rounded-2xl border border-[#2775CA]/25 bg-[#2775CA]/[0.06] p-4 text-xs text-black/80 space-y-4 mt-2">
                  <div className="flex items-start gap-3">
                    <Wallet className="w-5 h-5 shrink-0 mt-0.5 text-[#1f62ab]" />
                    <div className="space-y-1">
                      <p className="font-bold text-[#111827] uppercase tracking-wider">Wallet connected</p>
                      <p className="leading-relaxed text-black/70">
                        No SubScript account exists for this wallet yet. Choose how you would like to proceed.
                      </p>
                      <p className="font-mono text-[10px] text-black/50 break-all">{address}</p>
                    </div>
                  </div>

                  {isTurnstileConfigured && (
                    <div className="space-y-2 border-t border-black/10 pt-3 flex flex-col items-center">
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-black/60 self-start">
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
                      className="w-full py-3.5 bg-[#2775CA] hover:bg-[#1f62ab] text-[#FFFFF0] rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
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
                        className="py-3 bg-white hover:bg-black/5 border border-black/15 rounded-xl font-bold text-xs uppercase tracking-wider text-[#111827] shadow-sm transition"
                      >
                        Use Email
                      </button>
                      <button
                        type="button"
                        onClick={goToSignIn}
                        className="py-3 bg-white hover:bg-black/5 border border-black/15 rounded-xl font-bold text-xs uppercase tracking-wider text-[#111827] shadow-sm transition"
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
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60">
                      Email Address
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
                        <div id="turnstile-email-signup" className="my-2"></div>
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
                      disabled={otpLoading}
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
                      {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Continue"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="text-center pt-2 space-y-4">
            <p className="text-[11px] text-black/50 leading-relaxed">
              By continuing, you agree to SubScript&apos;s terms of service and privacy policy.
            </p>
            <div className="pt-2 border-t border-black/10">
              <p className="text-xs text-black/60">
                Already have an account?{" "}
                <button 
                  onClick={goToSignIn} 
                  className="text-[#2775CA] font-bold hover:underline"
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
