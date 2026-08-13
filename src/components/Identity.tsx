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
    const [isLoading, setIsLoading] = useState<boolean>(!knownAlias && Boolean(address));

    useEffect(() => {
        if (knownAlias) {
            setAlias(knownAlias);
            setIsLoading(false);
            return;
        }
        if (!address) {
            setIsLoading(false);
            return;
        }
        let active = true;
        setIsLoading(true);
        resolveAliasForAddress(address)
            .then((resolved) => {
                if (active) {
                    setAlias(resolved);
                    setIsLoading(false);
                }
            })
            .catch(() => {
                if (active) setIsLoading(false);
            });
        return () => { active = false; };
    }, [address, knownAlias]);

    if (isLoading) {
        return (
            <span className={`inline-block h-3.5 w-24 rounded bg-white/15 animate-pulse align-middle ${className || ""}`} />
        );
    }

    const label = accountDisplayName(alias, fallbackToAddress ? "SubScript account" : "");
    return (
        <span className={className}>
            {label}
        </span>
    );
}
