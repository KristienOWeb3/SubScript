"use client";

import { useEffect, useState } from "react";
import { resolveAliasForAddress, shortAddress } from "@/lib/alias/resolve";

/*
 * Renders a wallet's human ".sub" DNS name, resolving it from the address when not already known.
 * Falls back to a shortened address only when no (public) alias exists. Use this instead of showing
 * raw wallet addresses anywhere an identity is displayed.
 */
export function Identity({
    address,
    knownAlias,
    className,
    fallbackToAddress = true,
}: {
    address: string | null | undefined;
    /** Alias already loaded by the caller (skips the fetch). */
    knownAlias?: string | null;
    className?: string;
    /** When no alias, show the shortened address (true) or nothing (false). */
    fallbackToAddress?: boolean;
}) {
    const [alias, setAlias] = useState<string | null>(knownAlias ?? null);

    useEffect(() => {
        if (knownAlias || !address) return;
        let active = true;
        resolveAliasForAddress(address).then((resolved) => {
            if (active) setAlias(resolved);
        });
        return () => { active = false; };
    }, [address, knownAlias]);

    const label = alias || (fallbackToAddress ? shortAddress(address) : "");
    return (
        <span className={className} title={address || undefined}>
            {label}
        </span>
    );
}
