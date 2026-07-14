"use client";

import { useEffect, useState } from "react";
import { resolveAliasForAddress } from "@/lib/alias/resolve";
import { accountDisplayName } from "@/lib/identityDisplay";

/*
 * Renders a human account name without exposing the underlying settlement address.
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

    const label = accountDisplayName(alias, fallbackToAddress ? "SubScript account" : "");
    return (
        <span className={className}>
            {label}
        </span>
    );
}
