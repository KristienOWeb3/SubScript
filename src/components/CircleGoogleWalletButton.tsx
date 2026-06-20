"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { SocialLoginProvider, type LoginCompleteCallback, type LoginConfigs } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { getDashboardUrl } from "@/utils/navigation";

type CircleGoogleConfig = {
    appId: string;
    googleClientId: string;
    redirectUri: string;
};

export default function CircleGoogleWalletButton() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showMockInput, setShowMockInput] = useState(false);
    const [mockEmail, setMockEmail] = useState("");

    const handleContinue = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const configRes = await fetch("/api/auth/circle/google/config");
            const config: CircleGoogleConfig & { isMock?: boolean; error?: string } = await configRes.json();
            if (!configRes.ok) {
                throw new Error(config.error || "Circle Google login is not configured.");
            }

            if (config.isMock) {
                setShowMockInput(true);
                setIsLoading(false);
                return;
            }

            let sdk: W3SSdk;
            const onLoginComplete: LoginCompleteCallback = async (loginError, result) => {
                try {
                    if (loginError || !result) {
                        setIsLoading(false);
                        setError(loginError?.message || "Google login did not complete.");
                        return;
                    }
                    const socialResult = result as any;

                    const challengeRes = await fetch("/api/auth/circle/wallet", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            // Device and encryption credentials remain inside the browser SDK session.
                            circleAuth: {
                                userToken: socialResult.userToken,
                                oAuthInfo: socialResult.oAuthInfo,
                            },
                            authIntent: window.location.pathname.includes("/signin") ? "signin" : "signup",
                        }),
                    });
                    const challenge = await challengeRes.json();
                    if (!challengeRes.ok) {
                        if (challenge.redirectTo) {
                            router.push(challenge.redirectTo);
                            return;
                        }
                        throw new Error(challenge.error || "Could not create your Arc wallet.");
                    }

                    sdk.setAuthentication({
                        userToken: socialResult.userToken,
                        encryptionKey: socialResult.encryptionKey,
                    });

                    sdk.execute(challenge.challengeId, async (challengeError, challengeResult) => {
                        try {
                            if (challengeError || challengeResult?.status !== "COMPLETE") {
                                setIsLoading(false);
                                setError(challengeError?.message || "Wallet setup was not completed.");
                                return;
                            }

                            const completeRes = await fetch("/api/auth/circle/wallet/complete", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    circleAuth: {
                                        userToken: socialResult.userToken,
                                        oAuthInfo: socialResult.oAuthInfo,
                                    },
                                }),
                            });
                            const completed = await completeRes.json();
                            if (!completeRes.ok) {
                                throw new Error(completed.error || "Could not save your wallet.");
                            }

                            const params = new URLSearchParams(window.location.search);
                            const next = params.get("next") || "/dashboard/user";
                            router.push(next);
                            router.refresh();
                        } catch (err: any) {
                            setIsLoading(false);
                            setError(err.message || "Could not complete wallet setup.");
                        }
                    });
                } catch (err: any) {
                    setIsLoading(false);
                    setError(err.message || "Continue with Google failed.");
                }
            };

            sdk = new W3SSdk({
                appSettings: { appId: config.appId },
                // Circle device credentials are per-device session material, never deployment secrets.
                loginConfigs: {
                    google: {
                        clientId: config.googleClientId,
                        redirectUri: config.redirectUri,
                        selectAccountPrompt: true,
                    },
                } as unknown as LoginConfigs,
            }, onLoginComplete);

            await sdk.performLogin(SocialLoginProvider.GOOGLE);
        } catch (err: any) {
            setError(err.message || "Continue with Google failed.");
            setIsLoading(false);
        }
    };

    const handleMockSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!mockEmail || !mockEmail.includes("@")) {
            setError("Please enter a valid email address.");
            return;
        }
        setIsLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/auth/social", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: mockEmail,
                    provider: "google",
                    rememberMe: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Mock social login failed.");
            }

            if (data.role) {
                window.location.href = getDashboardUrl(data.role as any, "/dashboard");
            } else {
                window.location.href = `/signup?email=${encodeURIComponent(mockEmail)}`;
            }
        } catch (err: any) {
            setError(err.message || "Mock social login failed.");
            setIsLoading(false);
        }
    };

    if (showMockInput) {
        return (
            <form onSubmit={handleMockSubmit} className="space-y-3">
                <div className="space-y-1.5 text-left">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                        Sandbox Google Email
                    </label>
                    <input
                        type="email"
                        placeholder="mock-user@gmail.com"
                        value={mockEmail}
                        onChange={(e) => setMockEmail(e.target.value)}
                        required
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition focus:border-[#ccff00]/40 outline-none"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setShowMockInput(false)}
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-xs font-bold transition hover:bg-white/10"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="flex-1 rounded-xl bg-[#ccff00] text-black px-4 py-3 text-xs font-bold transition hover:bg-[#ccff00]/90 disabled:opacity-60 flex items-center justify-center gap-1.5"
                    >
                        {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                        Mock Login
                    </button>
                </div>
                {error ? (
                    <p className="text-xs text-red-300 text-center leading-relaxed">{error}</p>
                ) : null}
            </form>
        );
    }

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

