"use client";

import { useEffect, useState } from "react";

/* Client view of the runtime kill switches, from the public /api/platform/flags endpoint.
 *
 * PRESENTATION ONLY. Hiding a button is not a security boundary — the server refuses each paused
 * action independently (auth/verify-signature 503s when external wallets are off, the Google
 * config route 503s when Google is off). This exists so we don't render a control that would fail
 * when clicked, and so an already-open tab stops offering it.
 *
 * Google remains available only after the flag request succeeds; external-wallet controls are
 * fail-closed so a paused bridge or connector is not rendered during a stale or failed flag read.
 * The server remains the authoritative boundary.
 */

export type PublicPlatformFlags = {
    googleSigninEnabled: boolean;
    externalWalletEnabled: boolean;
    merchantInviteOnlyEnabled: boolean;
};

const DEFAULTS: PublicPlatformFlags = {
    googleSigninEnabled: true,
    externalWalletEnabled: false,
    /* Presentation default only. Showing the invite-only copy before the flag lands would tell
       every visitor merchant signup is closed when it is open, so this starts off and the server
       stays the boundary either way. */
    merchantInviteOnlyEnabled: false,
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
                        externalWalletEnabled: json.externalWalletEnabled === true,
                        merchantInviteOnlyEnabled: json.merchantInviteOnlyEnabled === true,
                    });
                })
                .catch(() => {
                    /* Keep external-wallet controls hidden until the kill-switch state is known. */
                })
                .finally(() => {
                    if (active) setLoaded(true);
                });
        };

        loadFlags();

        const intervalId = setInterval(loadFlags, 15000);
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
