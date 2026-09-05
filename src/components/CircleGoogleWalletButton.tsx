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
    variant?: "full" | "icon";
    disabled?: boolean;
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
    const config: CircleGoogleConfig & { error?: string } = await configRes
        .json()
        .catch(() => ({ error: "Circle Google login is not configured or temporarily unavailable." } as any));
    if (!configRes.ok) {
        throw new Error(config.error || "Circle Google login is not configured.");
    }

    let deviceToken = "";
    let deviceEncryptionKey = "";

    try {
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
        if (dtRes.ok && dt.deviceToken && dt.deviceEncryptionKey) {
            deviceToken = dt.deviceToken;
            deviceEncryptionKey = dt.deviceEncryptionKey;
            persistCircleDevice(deviceToken, deviceEncryptionKey);
        }
    } catch (e) {
        console.warn("[CircleGoogleWalletButton] Device token init notice:", e);
    }

    return {
        config,
        deviceToken,
        deviceEncryptionKey,
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

export default function CircleGoogleWalletButton({ onSuccess, variant = "full", disabled = false }: CircleGoogleWalletButtonProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [devEmailInput, setDevEmailInput] = useState("");
    const isDev = process.env.NODE_ENV !== "production" || (typeof window !== "undefined" && window.location.hostname === "localhost");
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearWatchdog = () => {
        if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    };

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

        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === "GOOGLE_AUTH_SUCCESS" && event.data?.data) {
                stopLoading();
                if (onSuccess) {
                    onSuccess(event.data.data);
                } else {
                    const destination = event.data.data.role
                        ? getDashboardUrl(event.data.data.role as any, "/dashboard")
                        : `/signup?email=${encodeURIComponent(event.data.data.email || "")}`;
                    window.location.href = destination;
                }
            } else if (event.data?.type === "GOOGLE_AUTH_ERROR") {
                failWith(event.data.error || "Continue with Google failed.");
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            isMounted = false;
            clearWatchdog();
            window.removeEventListener("message", handleMessage);
        };
    }, [onSuccess]);

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
        const completed = await completeRes.json().catch(() => ({ error: "Could not save your wallet." }));
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

    const openGooglePopup = (authUrl: string) => {
        const width = 500;
        const height = 620;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
            authUrl,
            "google_oauth_popup",
            `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`
        );

        if (!popup || popup.closed || typeof popup.closed === "undefined") {
            window.location.href = authUrl;
        }
    };

    const handleDevQuickLogin = async (overrideEmail?: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const email = (overrideEmail || devEmailInput || "developer@subscript.io").trim();
            const res = await fetch("/api/auth/circle/wallet/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    googleIdToken: `dev_google_${encodeURIComponent(email)}`,
                }),
            });
            const data = await res.json().catch(() => ({ error: "Dev login failed." }));
            if (!res.ok) {
                throw new Error(data.error || "Dev login failed.");
            }
            stopLoading();
            if (onSuccess) {
                onSuccess(data);
                return;
            }
            const destination = data.role
                ? getDashboardUrl(data.role as any, "/dashboard")
                : `/signup?email=${encodeURIComponent(data.email || "")}`;
            window.location.href = destination;
        } catch (err: any) {
            failWith(err.message || "Dev login failed.");
        }
    };

    const handleContinue = async () => {
        if (disabled) return;
        setIsLoading(true);
        setError(null);
        armWatchdog();

        try {
            window.localStorage.setItem("subscript_circle_auth_intent", getAuthIntent());

            const bootstrap = preloadIsFresh()
                ? preloadedDataRef.current!
                : await loadCircleBootstrap();
            preloadedDataRef.current = bootstrap;

            const nonce = crypto.randomUUID();
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
                client_id: bootstrap.config.googleClientId,
                redirect_uri: bootstrap.config.redirectUri,
                response_type: "id_token",
                scope: "openid email profile",
                nonce: nonce,
                prompt: "select_account",
            }).toString();

            // If Circle SDK device token is present and valid, try it first
            if (bootstrap.deviceToken && !bootstrap.deviceToken.startsWith("dev-dt-")) {
                try {
                    const onLoginComplete: LoginCompleteCallback = async (loginError, result) => {
                        try {
                            if (loginError || !result) {
                                openGooglePopup(authUrl);
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
                        } catch {
                            openGooglePopup(authUrl);
                        }
                    };

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
                    return;
                } catch (sdkErr) {
                    console.warn("[CircleGoogleWalletButton] SDK performLogin warning, using direct Google OAuth:", sdkErr);
                }
            }

            // Direct Google OAuth Popup
            openGooglePopup(authUrl);
        } catch (err: any) {
            failWith(err.message || "Continue with Google failed.");
        }
    };

    if (variant === "icon") {
        return (
            <div className="relative">
                <button
                    type="button"
                    onClick={handleContinue}
                    disabled={disabled || isLoading}
                    title="Continue with Google"
                    className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed group relative"
                >
                    {isLoading ? (
                        <GoogleColorSpinner className="h-4 w-4" />
                    ) : (
                        <GoogleLogo className="h-5 w-5 transition-transform group-hover:scale-105" />
                    )}
                </button>

                {error ? (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 z-50 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-900 text-center shadow-lg">
                        <p>{error}</p>
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={handleContinue}
                disabled={disabled || isLoading}
                className="w-full rounded-2xl border border-black/15 bg-white text-[#111827] px-4 py-4 text-xs font-bold uppercase tracking-wider transition hover:bg-black/[0.03] hover:border-black/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-3"
            >
                {isLoading ? (
                    <GoogleColorSpinner className="h-4 w-4" />
                ) : (
                    <GoogleLogo className="h-4 w-4" />
                )}
                <span>{isLoading ? "Signing in with Google..." : "Continue with Google"}</span>
            </button>

            {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 text-center leading-relaxed font-sans space-y-2">
                    <p>{error}</p>
                    {isDev && (
                        <div className="pt-2 border-t border-red-200/60 flex flex-col gap-2">
                            <p className="text-[11px] font-bold text-red-800 uppercase tracking-wider">
                                Localhost Quick Login
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={devEmailInput}
                                    onChange={(e) => setDevEmailInput(e.target.value)}
                                    placeholder="your-email@gmail.com"
                                    className="flex-1 px-3 py-1.5 rounded-xl border border-red-300 text-black text-xs bg-white focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleDevQuickLogin()}
                                    disabled={disabled}
                                    className="px-3 py-1.5 bg-[#2775CA] text-white rounded-xl font-bold text-xs hover:bg-[#1f62ab] transition shrink-0"
                                >
                                    Sign In
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}
