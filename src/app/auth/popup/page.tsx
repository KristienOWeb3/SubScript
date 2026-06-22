"use client";

import { useEffect, useState, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { getCookie, setCookie, deleteCookie } from "cookies-next/client";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
    ChallengeStatus,
    type ChallengeCompleteCallback,
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
    ]) {
        deleteCookie(name, { path: "/" });
    }
}

function getAuthIntent() {
    const storedIntent = window.localStorage.getItem("subscript_circle_auth_intent");
    return storedIntent === "signin" ? "signin" : "signup";
}

function PopupContent() {
    const [step, setStep] = useState<"loading" | "challenge" | "complete" | "error">("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        const completeCircleLogin = async (session: CircleSession) => {
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

                        if (loginError || !result) {
                            clearCircleSession();
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

                        const challengeRes = await fetch("/api/auth/circle/wallet", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                circleAuth: {
                                    userToken: session.userToken,
                                    oAuthInfo: session.oAuthInfo,
                                },
                                authIntent: getAuthIntent(),
                            }),
                        });
                        const challenge = await challengeRes.json();
                        if (!challengeRes.ok) {
                            throw new Error(challenge.error || "Could not initialize your Arc wallet.");
                        }

                        if (challenge.requiresChallenge === false) {
                            await completeCircleLogin(session);
                            return;
                        }

                        if (!challenge.challengeId) {
                            throw new Error("Circle did not return a wallet challenge.");
                        }

                        setStep("challenge");
                        sdk.setAuthentication({
                            userToken: session.userToken,
                            encryptionKey: session.encryptionKey,
                        });

                        const onChallengeComplete: ChallengeCompleteCallback = async (challengeError, challengeResult) => {
                            try {
                                if (cancelled) return;

                                if (challengeError || challengeResult?.status !== ChallengeStatus.COMPLETE) {
                                    clearCircleSession();
                                    setStep("error");
                                    setError(challengeError?.message || "Wallet setup was not completed.");
                                    return;
                                }

                                await completeCircleLogin(session);
                            } catch (err: any) {
                                setStep("error");
                                setError(err.message || "Could not complete wallet setup.");
                            }
                        };

                        sdk.execute(challenge.challengeId, onChallengeComplete);
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

                const sdk = new W3SSdk({
                    appSettings: { appId: config.appId },
                    loginConfigs,
                }, onLoginComplete);
            } catch (err: any) {
                setStep("error");
                setError(err.message || "Continue with Google failed.");
            }
        };

        runCircleGoogleCallback();

        return () => {
            cancelled = true;
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
