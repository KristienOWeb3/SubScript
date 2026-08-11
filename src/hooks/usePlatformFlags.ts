"use client";

import { useEffect, useState } from "react";

/* Client view of the runtime kill switches, from the public /api/platform/flags endpoint.
 *
 * PRESENTATION ONLY. Hiding a button is not a security boundary — the server refuses each paused
 * action independently (auth/verify-signature 503s when external wallets are off, the Google
 * config route 503s when Google is off). This exists so we don't render a control that would fail
 * when clicked, and so an already-open tab stops offering it.
 *
 * Defaults to everything ENABLED and stays there if the fetch fails. Same fail-open posture as
 * getPlatformFlags on the server: a flags endpoint having a bad day must not remove the user's
 * ability to sign in. The consequence is a brief window on first paint where a paused button is
 * visible; `loaded` is exposed for callers that would rather wait than flash it.
 */

export type PublicPlatformFlags = {
    googleSigninEnabled: boolean;
    externalWalletEnabled: boolean;
};

const DEFAULTS: PublicPlatformFlags = {
    googleSigninEnabled: true,
    externalWalletEnabled: true,
};

export function usePlatformFlags(): PublicPlatformFlags & { loaded: boolean } {
    const [flags, setFlags] = useState<PublicPlatformFlags>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let active = true;

        const loadFlags = () => {
            fetch("/api/platform/flags")
                .then((res) => (res.ok ? res.json() : null))
                .then((json) => {
                    if (!active || !json) return;
                    setFlags({
                        googleSigninEnabled: json.googleSigninEnabled !== false,
                        externalWalletEnabled: json.externalWalletEnabled !== false,
                    });
                })
                .catch(() => {
                    /* Keep the permissive defaults. */
                })
                .finally(() => {
                    if (active) setLoaded(true);
                });
        };

        loadFlags();

        const intervalId = setInterval(loadFlags, 60000);
        const handleVisibility = () => {
            if (document.visibilityState === "visible") loadFlags();
        };

        window.addEventListener("visibilitychange", handleVisibility);

        return () => {
            active = false;
            clearInterval(intervalId);
            window.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []);

    return { ...flags, loaded };
}
