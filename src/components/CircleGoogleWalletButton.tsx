"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "@/components/icons";
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

function persistCircleDevice(deviceToken: string, deviceEncryptionKey: string) {
    setCookie("circle_device_token", deviceToken, COOKIE_OPTIONS);
    setCookie("circle_device_encryption_key", deviceEncryptionKey, COOKIE_OPTIONS);
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
    return window.location.pathname.includes("/signin") || window.location.pathname.includes("/login")
        ? "signin"
        : "signup";
}

const LOGIN_WATCHDOG_MS = 90_000;

/* Appended to every failure message. A stale bootstrap is the usual cause of an intermittent
   failure here, and reloading is the one action that reliably clears it. */
const RETRY_HINT = "Refresh and try again.";

function withRetryHint(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return RETRY_HINT;
    if (trimmed.includes(RETRY_HINT)) return trimmed;
    const punctuated = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    return `${punctuated} ${RETRY_HINT}`;
}

type CircleBootstrap = {
    config: CircleGoogleConfig;
    deviceToken: string;
    deviceEncryptionKey: string;
    fetchedAt: number;
};

/* A Circle device token is short-lived. This used to be fetched once on mount and then reused on
   click no matter how old it was, so anyone who sat on the sign-in page for a while clicked with an
   expired token and the login failed — and reloading appeared to "fix" it because the reload
   fetched a fresh one. Bootstrapping is shared between the preload and the click path so the two
   can never drift, and the click path re-runs it whenever the cached copy is past its window. */
const PRELOAD_TTL_MS = 5 * 60_000;

async function loadCircleBootstrap(): Promise<CircleBootstrap> {
    const configRes = await fetch("/api/auth/circle/google/config", { cache: "no-store" });
    const config: CircleGoogleConfig & { error?: string } = await configRes.json();
    if (!configRes.ok) {
        throw new Error(config.error || "Circle Google login is not configured.");
    }

    const googleConfig = {
        clientId: config.googleClientId,
        redirectUri: config.redirectUri,
        selectAccountPrompt: true,
    };
    const tempSdk = new W3SSdk({
        appSettings: { appId: config.appId },
        loginConfigs: { deviceToken: "", deviceEncryptionKey: "", google: googleConfig },
    }, () => {});

    const deviceId = await tempSdk.getDeviceId();
    const dtRes = await fetch("/api/auth/circle/google/device-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
    });
    const dt = await dtRes.json().catch(() => ({}));
    if (!dtRes.ok || !dt.deviceToken || !dt.deviceEncryptionKey) {
        throw new Error(dt.error || "Could not initialize Google login.");
    }
    persistCircleDevice(dt.deviceToken, dt.deviceEncryptionKey);

    return {
        config,
        deviceToken: dt.deviceToken,
        deviceEncryptionKey: dt.deviceEncryptionKey,
        fetchedAt: Date.now(),
    };
}

function GoogleLogo({ className = "w-4 h-4" }: { className?: string }) {
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

function GoogleColorSpinner({ className = "w-4 h-4" }: { className?: string }) {
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
            preloadedDataRef.current = null;
            clearCircleSession();
            setIsLoading(false);
            setError(withRetryHint("Google sign-in didn't finish. Close the Google window if it's still open."));
        }, LOGIN_WATCHDOG_MS);
    };

    const stopLoading = () => {
        clearWatchdog();
        setIsLoading(false);
    };

    const preloadedDataRef = useRef<CircleBootstrap | null>(null);

    const preloadIsFresh = () => {
        const preloaded = preloadedDataRef.current;
        return Boolean(preloaded) && Date.now() - preloaded!.fetchedAt < PRELOAD_TTL_MS;
    };

    /* Any failure invalidates the cached bootstrap, so pressing the button again re-initialises
        from scratch. Without this an in-page retry reused the same bad token and failed the same
        way, which is why a full page refresh looked like the only cure. */
    const failWith = (message: string) => {
        preloadedDataRef.current = null;
        clearCircleSession();
        stopLoading();
        setError(withRetryHint(message));
    };

    useEffect(() => {
        let isMounted = true;
        loadCircleBootstrap()
            .then((bootstrap) => {
                if (isMounted) preloadedDataRef.current = bootstrap;
            })
            .catch((e) => {
                console.warn("[CircleGoogleWalletButton] Preload error:", e);
            });
        return () => {
            isMounted = false;
            clearWatchdog();
        };
    }, []);

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
            window.localStorage.setItem("subscript_circle_auth_intent", getAuthIntent());

            const onLoginComplete: LoginCompleteCallback = async (loginError, result) => {
                try {
                    if (loginError || !result) {
                        failWith(loginError?.message || "Google login did not complete.");
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

                    await completeCircleLogin(session);
                } catch (err: any) {
                    failWith(err.message || "Continue with Google failed.");
                }
            };

            /* Re-bootstrap when the preloaded copy is past its window rather than clicking with a
               token that has already expired. */
            const bootstrap = preloadIsFresh()
                ? preloadedDataRef.current!
                : await loadCircleBootstrap();
            preloadedDataRef.current = bootstrap;

            const sdk = new W3SSdk({
                appSettings: { appId: bootstrap.config.appId },
                loginConfigs: {
                    deviceToken: bootstrap.deviceToken,
                    deviceEncryptionKey: bootstrap.deviceEncryptionKey,
                    google: {
                        clientId: bootstrap.config.googleClientId,
                        redirectUri: bootstrap.config.redirectUri,
                        selectAccountPrompt: true,
                    },
                },
            }, onLoginComplete);

            await sdk.performLogin(SocialLoginProvider.GOOGLE);
        } catch (err: any) {
            failWith(err.message || "Continue with Google failed.");
        }
    };

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={handleContinue}
                disabled={isLoading}
                className="w-full rounded-2xl border border-black/15 bg-white text-[#111827] px-4 py-4 text-xs font-bold uppercase tracking-wider transition hover:bg-black/[0.03] hover:border-black/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-3 shadow-sm"
            >
                {isLoading ? (
                    <GoogleColorSpinner className="h-4 w-4" />
                ) : (
                    <GoogleLogo className="h-4 w-4" />
                )}
                <span>{isLoading ? "Signing in with Google..." : "Continue with Google"}</span>
            </button>
            {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 text-center leading-relaxed font-sans">
                    {error}
                </div>
            ) : null}
        </div>
    );
}
