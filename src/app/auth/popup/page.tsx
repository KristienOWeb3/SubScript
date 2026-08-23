"use client";

import { useEffect, useState, Suspense } from "react";
import { Loader2 } from "@/components/icons";
import { getCookie, setCookie, deleteCookie } from "cookies-next/client";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
    type LoginCompleteCallback,
    type LoginConfigs,
    type SocialLoginResult,
} from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { getDashboardUrl } from "@/utils/navigation";

type CircleGoogleConfig = {
    appId: string;
    googleClientId: string;
    redirectUri: string;
};

type CircleSession = {
    userToken: string;
    encryptionKey: string;
    refreshToken?: string;
    oAuthInfo?: SocialLoginResult["oAuthInfo"];
};

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const CIRCLE_VERIFY_TIMEOUT_MS = 25_000;
const COOKIE_OPTIONS = {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
};

function cookieString(name: string) {
    const value = getCookie(name);
    return typeof value === "string" ? value : "";
}

function persistCircleSession(session: CircleSession) {
    setCookie("circle_user_token", session.userToken, COOKIE_OPTIONS);
    setCookie("circle_encryption_key", session.encryptionKey, COOKIE_OPTIONS);

    if (session.refreshToken) {
        setCookie("circle_refresh_token", session.refreshToken, COOKIE_OPTIONS);
    }

    if (session.oAuthInfo) {
        setCookie("circle_oauth_info", JSON.stringify(session.oAuthInfo), COOKIE_OPTIONS);
    }
}

function clearCircleSession() {
    for (const name of [
        "circle_user_token",
        "circle_encryption_key",
        "circle_refresh_token",
        "circle_oauth_info",
        "circle_device_token",
        "circle_device_encryption_key",
    ]) {
        deleteCookie(name, { path: "/" });
    }
}

function getAuthIntent() {
    const storedIntent = window.localStorage.getItem("subscript_circle_auth_intent");
    return storedIntent === "signin" ? "signin" : "signup";
}

function clearCircleLoginState() {
    clearCircleSession();
    window.localStorage.removeItem("socialLoginProvider");
    window.localStorage.removeItem("state");
    window.localStorage.removeItem("nonce");
}

function GoogleLogo({ className = "w-5 h-5" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
        </svg>
    );
}

function GoogleColorSpinner({ className = "w-10 h-10" }: { className?: string }) {
    return (
        <svg
            className={`${className} animate-spin`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="9" stroke="#E2E8F0" strokeWidth="2.5" />
            <path
                d="M12 3a9 9 0 0 1 6.36 2.64"
                stroke="#4285F4"
                strokeWidth="2.5"
                strokeLinecap="round"
            />
            <path
                d="M18.36 5.64A9 9 0 0 1 21 12"
                stroke="#EA4335"
                strokeWidth="2.5"
                strokeLinecap="round"
            />
            <path
                d="M21 12a9 9 0 0 1-2.64 6.36"
                stroke="#FBBC05"
                strokeWidth="2.5"
                strokeLinecap="round"
            />
            <path
                d="M18.36 18.36A9 9 0 0 1 12 21"
                stroke="#34A853"
                strokeWidth="2.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

function PopupContent() {
    const [step, setStep] = useState<"loading" | "challenge" | "complete" | "error">("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        let verifyWatchdog: ReturnType<typeof setTimeout> | null = null;

        const clearVerifyWatchdog = () => {
            if (verifyWatchdog) {
                clearTimeout(verifyWatchdog);
                verifyWatchdog = null;
            }
        };

        const completeCircleLogin = async (session: CircleSession, googleIdToken: string | null) => {
            clearVerifyWatchdog();
            const completeRes = await fetch("/api/auth/circle/wallet/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    circleAuth: {
                        userToken: session.userToken,
                        oAuthInfo: session.oAuthInfo,
                    },
                    googleIdToken,
                }),
            });
            const completed = await completeRes.json();
            if (!completeRes.ok) {
                throw new Error(completed.error || "Could not save your wallet.");
            }

            window.localStorage.removeItem("subscript_circle_auth_intent");
            setStep("complete");

            const destination = completed.role
                ? getDashboardUrl(completed.role as any, "/dashboard")
                : `/signup?email=${encodeURIComponent(completed.email || "")}`;

            window.location.href = destination;
        };

        const runCircleGoogleCallback = async () => {
            try {
                if (!window.location.hash) {
                    throw new Error("Google did not return an OAuth response. Please start again from the sign in page.");
                }

                const hashParams = new URLSearchParams(window.location.hash.slice(1));
                const googleIdToken = hashParams.get("id_token");

                const configRes = await fetch("/api/auth/circle/google/config", { cache: "no-store" });
                const config: CircleGoogleConfig & { error?: string } = await configRes.json();
                if (!configRes.ok) {
                    throw new Error(config.error || "Circle Google login is not configured.");
                }

                const deviceToken = cookieString("circle_device_token");
                const deviceEncryptionKey = cookieString("circle_device_encryption_key");
                if (!deviceToken || !deviceEncryptionKey) {
                    throw new Error("Your Google login session expired. Please try Continue with Google again.");
                }

                const onLoginComplete: LoginCompleteCallback = async (loginError, result) => {
                    try {
                        if (cancelled) return;
                        clearVerifyWatchdog();

                        if (loginError || !result) {
                            clearCircleLoginState();
                            setStep("error");
                            setError(loginError?.message || "Google login did not complete.");
                            return;
                        }

                        const socialResult = result as SocialLoginResult;
                        const session: CircleSession = {
                            userToken: socialResult.userToken,
                            encryptionKey: socialResult.encryptionKey,
                            refreshToken: socialResult.refreshToken,
                            oAuthInfo: socialResult.oAuthInfo,
                        };
                        persistCircleSession(session);

                        /* Google verifies the email; the account is a server-managed embedded wallet
                           (same model as email/OTP, one account per email). Skip Circle's PIN wallet
                           challenge — sdk.execute() was the step that threw "Error encrypting data"
                           and created a separate account. */
                        await completeCircleLogin(session, googleIdToken);
                    } catch (err: any) {
                        setStep("error");
                        setError(err.message || "Continue with Google failed.");
                    }
                };

                const loginConfigs: LoginConfigs = {
                    deviceToken,
                    deviceEncryptionKey,
                    google: {
                        clientId: config.googleClientId,
                        redirectUri: config.redirectUri,
                        selectAccountPrompt: true,
                    },
                };

                verifyWatchdog = setTimeout(() => {
                    if (cancelled) return;
                    clearCircleLoginState();
                    setStep("error");
                    setError("Circle took too long to verify your Google account. Please try again.");
                }, CIRCLE_VERIFY_TIMEOUT_MS);

                const sdk = new W3SSdk({
                    appSettings: { appId: config.appId },
                    loginConfigs,
                }, onLoginComplete);
            } catch (err: any) {
                clearVerifyWatchdog();
                setStep("error");
                setError(err.message || "Continue with Google failed.");
            }
        };

        runCircleGoogleCallback();

        return () => {
            cancelled = true;
            clearVerifyWatchdog();
        };
    }, []);



    const title = step === "challenge"
        ? "Security Verification"
        : step === "complete"
            ? "Welcome to SubScript"
            : step === "error"
                ? "Sign In Notice"
                : "Signing in with Google";

    const message = step === "challenge"
        ? "Please complete the verification step to finish setting up your account."
        : step === "complete"
            ? "Google account verified. Redirecting you to your dashboard..."
            : "Connecting your Google account and verifying your details...";

    return (
        <div className="subscript-checkout flex min-h-screen items-center justify-center bg-[#FFFFF0] p-4 sm:p-6 text-[#111827] font-sans">
            <div className="w-full max-w-sm rounded-3xl border border-black/15 bg-white p-6 sm:p-8 text-center shadow-sm space-y-5">
                <div className="flex items-center justify-center gap-2 mb-1">
                    <div className="p-2.5 rounded-2xl bg-black/[0.04] border border-black/10">
                        <GoogleLogo className="h-6 w-6" />
                    </div>
                </div>
                {step === "error" ? null : (
                    <div className="flex justify-center py-2">
                        <GoogleColorSpinner className="h-10 w-10" />
                    </div>
                )}
                <div className="space-y-1.5">
                    <h1 className="text-xl font-bold text-[#111827] tracking-tight">{title}</h1>
                    <p className="text-xs leading-relaxed text-black/60">
                        {step === "error" ? error : message}
                    </p>
                </div>
                {step === "error" ? (
                    <a
                        href="/signin"
                        className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-[#FFFFF0] transition shadow-sm"
                    >
                        Back to sign in
                    </a>
                ) : null}
            </div>
        </div>
    );
}

export default function AuthPopupPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFFFF0] text-[#111827] p-6 font-sans space-y-3">
                <GoogleColorSpinner className="w-10 h-10" />
                <p className="text-xs text-black/60">Connecting to Google...</p>
            </div>
        }>
            <PopupContent />
        </Suspense>
    );
}
