"use client";

import React, { useEffect, useState } from "react";

interface PeerAvatarProps {
    src?: string | null;
    /** Used for the alt text and to derive the two-letter fallback. */
    name: string;
    /** Size and shape utilities, e.g. "h-10 w-10". Applied to both the image and the fallback. */
    className?: string;
    /** Colour utilities for the initials tile, so each caller keeps the look it already had. */
    fallbackClassName?: string;
}

/**
 * A peer's profile picture, with initials when there isn't one — or when the one we have won't load.
 *
 * Deliberately a plain `<img>` rather than `next/image`. Profile pictures here are arbitrary
 * user-supplied URLs, and `next/image` refuses any remote host that isn't declared in
 * `images.remotePatterns`; `next.config.mjs` declares none, so every remote avatar rendered through
 * it was blocked outright. That is why requesters showed a broken image in the DM requests list
 * while the same pictures rendered fine elsewhere in the dashboard, which has always used `<img>`.
 * An allow-list isn't the fix either: the set of hosts is whatever users paste.
 *
 * The `onError` fallback is the other half. Without it a dead or hotlink-protected URL leaves the
 * browser's broken-image glyph in a 40px circle, which looks like our bug rather than a missing
 * picture. `src` is tracked in state so a changed prop retries instead of staying failed.
 */
export function PeerAvatar({ src, name, className = "h-10 w-10", fallbackClassName = "bg-black/5 border-black/10 text-black/60" }: PeerAvatarProps) {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    const initials = (name || "").trim().slice(0, 2).toUpperCase() || "??";

    if (!src || failed) {
        return (
            <div className={`flex shrink-0 items-center justify-center rounded-full border text-xs font-black ${className} ${fallbackClassName}`}>
                {initials}
            </div>
        );
    }

    return (
        <div className={`relative shrink-0 overflow-hidden rounded-full border border-black/10 ${className}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt={name}
                className="h-full w-full object-cover"
                onError={() => setFailed(true)}
                loading="lazy"
            />
        </div>
    );
}

export default PeerAvatar;
