"use client";

import React from "react";

/**
 * Cycling ellipsis for busy labels: "Working." → "Working.." → "Working..." → "Working".
 *
 * The three dots are always in the layout and only their opacity animates, so a button never
 * changes width mid-load — a literal "..." in the label jitters the row on every tick. Purely
 * CSS-driven (see `.subscript-loading-dot` in globals.css) so a spinning label costs no renders.
 *
 * Pass the verb without trailing dots: <>Working<LoadingDots /></>
 */
export default function LoadingDots({ className = "" }: { className?: string }) {
    return (
        <span className={`subscript-loading-dots ${className}`} aria-hidden="true">
            <span className="subscript-loading-dot">.</span>
            <span className="subscript-loading-dot">.</span>
            <span className="subscript-loading-dot">.</span>
        </span>
    );
}
