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

        const completeCircleLogin = async (session: CircleSession) => {
            clearVerifyWatchdog();
            const completeRes = await fetch("/api/auth/circle/wallet/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    circleAuth: {
                        userToken: session.userToken,
                        oAuthInfo: session.oAuthInfo,
                    },
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
                        await completeCircleLogin(session);
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

    const message = step === "challenge"
        ? "Complete the Circle wallet security step to finish setup."
        : step === "complete"
            ? "Google verified. Redirecting you now..."
            : "Verifying your Google account with Circle...";

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#121212] p-6 text-white font-sans">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-8 text-center shadow-2xl">
                {step === "error" ? null : (
                    <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-[#00d2b4]" />
                )}
                <h1 className="mb-2 text-xl font-bold">Continue with Google</h1>
                <p className="text-sm leading-relaxed text-white/60">
                    {step === "error" ? error : message}
                </p>
                {step === "error" ? (
                    <a
                        href="/signin"
                        className="mt-6 inline-flex rounded-xl bg-[#ccff00] px-4 py-3 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-[#ccff00]/90"
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
            <div className="flex flex-col items-center justify-center min-h-screen bg-[#121212] text-white p-6 font-sans">
                <Loader2 className="w-10 h-10 text-[#00d2b4] animate-spin mb-4" />
                <p className="text-sm text-white/60">Loading oauth portal...</p>
            </div>
        }>
            <PopupContent />
        </Suspense>
    );
}
