"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getCookie, setCookie, deleteCookie } from "cookies-next/client";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
    SocialLoginProvider,
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

type CircleGoogleWalletButtonProps = {
    onSuccess?: (data: {
        success: boolean;
        wallet: string;
        email?: string | null;
        provider?: string;
        role?: string | null;
    }) => void;
};

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
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

function getOrCreateCookie(name: string) {
    const existing = cookieString(name);
    if (existing) return existing;

    const value = crypto.randomUUID();
    setCookie(name, value, COOKIE_OPTIONS);
    return value;
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
    ]) {
        deleteCookie(name, { path: "/" });
    }
}

function getAuthIntent() {
    return window.location.pathname.includes("/signin") || window.location.pathname.includes("/login")
        ? "signin"
        : "signup";
}

const LOGIN_WATCHDOG_MS = 90_000;

export default function CircleGoogleWalletButton({ onSuccess }: CircleGoogleWalletButtonProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearWatchdog = () => {
        if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    };

    /* The Circle SDK can silently stall if the Google popup is dismissed or blocked,
       leaving the button spinning forever. The watchdog surfaces that as a clear error. */
    const armWatchdog = () => {
        clearWatchdog();
        watchdogRef.current = setTimeout(() => {
            clearCircleSession();
            setIsLoading(false);
            setError("Google sign-in didn't finish. Close the Google window if it's still open and try again.");
        }, LOGIN_WATCHDOG_MS);
    };

    const stopLoading = () => {
        clearWatchdog();
        setIsLoading(false);
    };

    useEffect(() => clearWatchdog, []);

    const completeCircleLogin = async (session: CircleSession) => {
        clearWatchdog();
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

        if (onSuccess) {
            onSuccess(completed);
            return;
        }

        const destination = completed.role
            ? getDashboardUrl(completed.role as any, "/dashboard")
            : `/signup?email=${encodeURIComponent(completed.email || "")}`;

        window.location.href = destination;
    };

    const handleContinue = async () => {
        setIsLoading(true);
        setError(null);
        armWatchdog();

        try {
            const configRes = await fetch("/api/auth/circle/google/config", { cache: "no-store" });
            const config: CircleGoogleConfig & { error?: string } = await configRes.json();
            if (!configRes.ok) {
                throw new Error(config.error || "Circle Google login is not configured.");
            }

            const deviceToken = getOrCreateCookie("circle_device_token");
            const deviceEncryptionKey = getOrCreateCookie("circle_device_encryption_key");
            window.localStorage.setItem("subscript_circle_auth_intent", getAuthIntent());

            const onLoginComplete: LoginCompleteCallback = async (loginError, result) => {
                try {
                    if (loginError || !result) {
                        clearCircleSession();
                        stopLoading();
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
                       (the same model as email/OTP, keyed by email — one account per email). We
                       deliberately skip Circle's PIN wallet challenge: sdk.execute() was the step that
                       failed with "Error encrypting data" and also created a separate account. */
                    await completeCircleLogin(session);
                } catch (err: any) {
                    stopLoading();
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

            const sdk = new W3SSdk({
                appSettings: { appId: config.appId },
                loginConfigs,
            }, onLoginComplete);

            await sdk.getDeviceId();
            await sdk.performLogin(SocialLoginProvider.GOOGLE);
        } catch (err: any) {
            setError(err.message || "Continue with Google failed.");
            stopLoading();
        }
    };

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={handleContinue}
                disabled={isLoading}
                className="w-full rounded-xl border border-white/10 bg-white text-black px-4 py-3 text-sm font-bold transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
            >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue with Google
            </button>
            {error ? (
                <p className="text-xs text-red-300 text-center leading-relaxed">{error}</p>
            ) : null}
        </div>
    );
}
