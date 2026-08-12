"use client";

/**
 * The merchant verification tick — one component, one rule.
 *
 * Why this exists: the check beside a counterparty's name in the inbox was gated on
 * `isActiveDmMerchant`, a heuristic meaning "this address behaves like a business" (role
 * ENTERPRISE, or a .hq/.biz alias, or simply someone the user had a subscription with). So an
 * unverified merchant rendered the same green check as a verified one, and the badge asserted
 * something nobody had checked. Meanwhile checkout, the commit page, and the payment-link page
 * each open-coded their own correct version, which is why the inbox could drift without anyone
 * noticing.
 *
 * The rule, stated once: the tick renders if and only if `merchants.verified` is true for that
 * address, as reported by the server. There is no client-side inference, no fallback, and no
 * optimistic default — an absent or unknown value renders nothing.
 *
 * Rules:
 * - `verified` is a server-sourced boolean. Never pass a role, an alias suffix, or the presence
 *   of a subscription. If you find yourself computing this prop, you are reintroducing the bug.
 * - `undefined` means "not loaded yet" and renders nothing, never a placeholder tick.
 */

import { CheckCircle2, Shield, AlertTriangle } from "@/components/icons";

type BadgeSize = "xs" | "sm" | "md";

const ICON_SIZE: Record<BadgeSize, string> = {
    xs: "h-3 w-3",
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
};

const CHIP_SIZE: Record<BadgeSize, string> = {
    xs: "gap-1 px-1.5 py-0.5 text-[8px]",
    sm: "gap-1 px-2 py-1 text-[8px]",
    md: "gap-1.5 px-2.5 py-1 text-[10px]",
};

/**
 * Bare tick, for use immediately after a name where the surrounding context already says
 * "merchant" — inbox thread headers, thread lists, subscription rows.
 *
 * Renders nothing at all when the merchant is unverified. That asymmetry is deliberate: a name
 * with no tick is the correct, quiet representation of "not verified" in a dense list. The
 * explicit amber warning belongs on the surfaces where money is about to move, which is what
 * MerchantVerificationChip below is for.
 */
export function MerchantVerifiedTick({
    verified,
    size = "xs",
    className = "",
}: {
    verified: boolean | null | undefined;
    size?: BadgeSize;
    className?: string;
}) {
    if (verified !== true) return null;

    return (
        <CheckCircle2
            className={`${ICON_SIZE[size]} shrink-0 text-emerald-400 ${className}`}
            aria-label="Verified by SubScript"
            role="img"
        />
    );
}

/**
 * Labelled chip stating verification either way, for surfaces where the customer is deciding
 * whether to authorize a payment: checkout, the commit page, the hosted payment link.
 *
 * Here silence is the wrong default — a customer about to escrow funds should be told plainly
 * that the recipient is unverified, not left to infer it from a missing icon.
 *
 * `verified === null | undefined` still renders nothing: mid-load is not a verdict, and
 * flashing "Unverified" at a legitimate merchant while the fetch settles is its own harm.
 */
export function MerchantVerificationChip({
    verified,
    size = "sm",
    className = "",
}: {
    verified: boolean | null | undefined;
    size?: BadgeSize;
    className?: string;
}) {
    if (verified === null || verified === undefined) return null;

    if (verified) {
        return (
            <span
                className={`inline-flex items-center rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] font-bold uppercase tracking-wider text-emerald-400 ${CHIP_SIZE[size]} ${className}`}
            >
                <Shield className={ICON_SIZE[size]} aria-hidden="true" />
                Verified
            </span>
        );
    }

    return (
        <span
            className={`inline-flex items-center rounded-lg border border-amber-500/20 bg-amber-500/[0.06] font-bold uppercase tracking-wider text-amber-400 ${CHIP_SIZE[size]} ${className}`}
        >
            <AlertTriangle className={ICON_SIZE[size]} aria-hidden="true" />
            Unverified
        </span>
    );
}
