"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { SocialLoginProvider, type LoginCompleteCallback } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

type CircleGoogleConfig = {
    appId: string;
    googleClientId: string;
    redirectUri: string;
    deviceToken: string;
    deviceEncryptionKey: string;
};

export default function CircleGoogleWalletButton() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleContinue = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const configRes = await fetch("/api/auth/circle/google/config");
            const config: CircleGoogleConfig & { error?: string } = await configRes.json();
            if (!configRes.ok) {
                throw new Error(config.error || "Circle Google login is not configured.");
            }

            let sdk: W3SSdk;
            const onLoginComplete: LoginCompleteCallback = async (loginError, result) => {
                try {
                    if (loginError || !result) {
                        setIsLoading(false);
                        setError(loginError?.message || "Google login did not complete.");
                        return;
                    }

                    const challengeRes = await fetch("/api/auth/circle/wallet", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ circleAuth: result }),
                    });
                    const challenge = await challengeRes.json();
                    if (!challengeRes.ok) {
                        throw new Error(challenge.error || "Could not create your Arc wallet.");
                    }

                    sdk.setAuthentication({
                        userToken: result.userToken,
                        encryptionKey: result.encryptionKey,
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
                                    email: challenge.email,
                                    circleAuth: result,
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
                loginConfigs: {
                    google: {
                        clientId: config.googleClientId,
                        redirectUri: config.redirectUri,
                        selectAccountPrompt: true,
                    },
                    deviceToken: config.deviceToken,
                    deviceEncryptionKey: config.deviceEncryptionKey,
                },
            }, onLoginComplete);

            await sdk.performLogin(SocialLoginProvider.GOOGLE);
        } catch (err: any) {
            setError(err.message || "Continue with Google failed.");
            setIsLoading(false);
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
