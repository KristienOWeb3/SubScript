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
    fallback,
    placeholderClassName = "bg-white/15",
}: {
    address: string | null | undefined;
    /** Alias already loaded by the caller (skips the fetch). */
    knownAlias?: string | null;
    className?: string;
    /** When no alias, show the shortened address (true) or nothing (false). */
    fallbackToAddress?: boolean;
    /**
     * Label to show when the address has no registered name. Overrides the generic
     * "SubScript account". A receipt is a document someone may forward or file, so it says
     * `0x1234…5678` rather than naming an account that was never named.
     */
    fallback?: string;
    /**
     * Tint for the loading bar. Defaults to a white wash, which is what the dark dashboards
     * need and what a light surface cannot show at all.
     */
    placeholderClassName?: string;
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
            <span className={`inline-block h-3.5 w-24 rounded ${placeholderClassName} animate-pulse align-middle ${className || ""}`} />
        );
    }

    const defaultFallback = fallbackToAddress ? "SubScript account" : "";
    const label = accountDisplayName(alias, fallback ?? defaultFallback);
    return (
        <span className={className}>
            {label}
        </span>
    );
}
