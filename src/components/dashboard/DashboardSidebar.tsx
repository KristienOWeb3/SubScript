"use client";

import { useState } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { X } from "@/components/icons";

/* The desktop sidebar, shared by the user and merchant dashboards.
 *
 * WHY THIS EXISTS. The two dashboards had separately authored navigation that had drifted into
 * different design languages — the user side used pill rows whose active state bleeds into the
 * content panel, the merchant side used uppercase bordered tiles — so the same product read as two
 * products depending on which account you signed in with. One component means a change to the
 * navigation's shape lands on both surfaces instead of being ported by hand and forgotten on one.
 *
 * STATUS: the merchant dashboard renders this. The user dashboard still renders its own
 * UserDesktopSidebar, which this was lifted from class-for-class and which remains the visual
 * reference; porting it over is the remaining half of the consolidation. Until that happens, treat
 * UserDesktopSidebar as the source of truth for geometry and mirror changes into both.
 *
 * ACCENT IS A CSS VARIABLE, NOT A PROP INTERPOLATED INTO A CLASS. Tailwind generates utilities by
 * scanning source text for complete class names, so `text-[${accent}]` produces nothing at all at
 * build time — the class never exists. Passing the colour as a custom property and reading it back
 * through `text-[color:var(--sb-accent)]` keeps the class literal (so it IS generated) while the
 * value stays per-dashboard: lime for users, teal for merchants, gold for a single Premium row.
 *
 * The active row deliberately bleeds right, past the sidebar's own padding and under the content
 * panel's rounded left edge (`lg:-mr-5 lg:pr-7`), which is what joins the tab to the page rather
 * than leaving it floating beside it. That only reads correctly when `panelColor` matches the
 * content panel the sidebar sits against, so it is required rather than defaulted.
 */

export type DashboardSidebarItem = {
    id: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    /* Set when the row navigates OUT of the dashboard rather than switching an in-page tab, so it
       renders as a Link. Such a row has no active state: leaving the route unmounts this nav. */
    href?: string;
    /* Opens `href` in a new tab. The help centre is deliberately not a same-tab navigation: it is
       reference material read ALONGSIDE the dashboard, and replacing the dashboard with it loses
       whatever the reader was in the middle of. */
    newTab?: boolean;
    /* Unread count. Rendered only when > 0; 9+ above nine, so the pill cannot widen the rail. */
    badgeCount?: number;
    /* Small trailing label, e.g. the merchant "PRO" marker on Premium. */
    tag?: string;
    /* Overrides the sidebar accent for this row alone. Premium is gold on a teal sidebar. */
    accent?: string;
};

export type DashboardSidebarPromo = {
    badge: string;
    title: string;
    body: string;
    ctaLabel: string;
    onCta: () => void;
};

/* Widened from CSSProperties because custom properties are not part of the CSSProperties index
   signature; without this, setting `--sb-accent` in a style object is a type error. */
type AccentStyle = CSSProperties & Record<"--sb-accent" | "--sb-panel", string>;

export default function DashboardSidebar({
    items,
    footerItems = [],
    activeId,
    onSelect,
    identity,
    promo,
    accent,
    panelColor,
    ariaLabel,
}: {
    items: ReadonlyArray<DashboardSidebarItem>;
    /* Rendered pinned to the bottom, above the promo. Same shape as `items` — settings and help
       are navigation, and giving them a second prop type only invited them to drift apart. */
    footerItems?: ReadonlyArray<DashboardSidebarItem>;
    activeId: string;
    onSelect: (id: string) => void;
    identity: {
        /* Domain, alias, or shortened address — whatever the account is best known by. */
        label: string;
        avatarUrl?: string | null;
        /* Shown when there is no avatar; first letter of the label is the usual choice. */
        fallback: string;
        onClick: () => void;
        title?: string;
    };
    promo?: DashboardSidebarPromo;
    accent: string;
    panelColor: string;
    ariaLabel: string;
}) {
    const [promoVisible, setPromoVisible] = useState(true);

    const rowBase =
        "group flex w-full items-center justify-center lg:justify-start gap-3 rounded-full lg:rounded-l-full lg:rounded-r-none text-left font-semibold transition-all relative";
    const activeRow =
        "bg-[color:var(--sb-panel)] text-[color:var(--sb-accent)] font-bold lg:-mr-5 lg:pr-7";
    const idleRow = "text-white/70 hover:bg-white/[0.06] hover:text-white";

    const renderRow = (item: DashboardSidebarItem, compact: boolean) => {
        const Icon = item.icon;
        /* A row that leaves the route is never "active" — see the href note on the type. */
        const isActive = !item.href && activeId === item.id;
        const sizing = compact ? "py-2.5 px-3.5 lg:px-4 text-xs" : "py-3 px-3.5 lg:px-4 text-xs";
        const className = `${rowBase} ${sizing} ${isActive ? activeRow : idleRow}`;
        /* Per-row accent override. Scoped to this element, so it cannot leak to siblings. */
        const style = item.accent ? ({ "--sb-accent": item.accent } as CSSProperties) : undefined;

        const body: ReactNode = (
            <>
                <Icon
                    className={`h-4.5 w-4.5 shrink-0 ${
                        isActive ? "text-[color:var(--sb-accent)]" : "text-white/60 group-hover:text-white"
                    }`}
                />
                <span className="hidden lg:inline truncate">{item.label}</span>
                {item.tag && (
                    <span className="hidden lg:inline-flex ml-auto shrink-0 rounded-full border border-[color:var(--sb-accent)]/25 bg-[color:var(--sb-accent)]/10 px-1.5 py-0.5 text-[8px] font-bold text-[color:var(--sb-accent)]">
                        {item.tag}
                    </span>
                )}
                {typeof item.badgeCount === "number" && item.badgeCount > 0 && (
                    <span
                        className={`ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-bold ${
                            isActive ? "bg-[color:var(--sb-accent)] text-black" : "bg-red-500 text-white"
                        }`}
                    >
                        {item.badgeCount > 9 ? "9+" : item.badgeCount}
                    </span>
                )}
            </>
        );

        if (item.href) {
            return (
                <Link
                    key={item.id}
                    href={item.href}
                    title={item.label}
                    className={className}
                    style={style}
                    {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                    {body}
                </Link>
            );
        }

        return (
            <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                title={item.label}
                aria-current={isActive ? "page" : undefined}
                className={className}
                style={style}
            >
                {body}
            </button>
        );
    };

    return (
        <aside
            style={{ "--sb-accent": accent, "--sb-panel": panelColor } as AccentStyle}
            /* Scrollbar is hidden rather than styled: the rail is 80px wide below lg, where a
               gutter would eat a tenth of it. */
            className="hidden md:flex h-full max-h-screen w-20 lg:w-64 shrink-0 flex-col justify-between overflow-y-auto overscroll-contain bg-[#08080a] p-4 lg:p-5 text-white/90 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
            <div className="space-y-6">
                {/* Identity sits above the nav, matching the wireframe's top-left account block. */}
                <button
                    type="button"
                    onClick={identity.onClick}
                    className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-left shadow-sm transition hover:border-[color:var(--sb-accent)]/30 hover:bg-white/10"
                    title={identity.title || identity.label}
                >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color:var(--sb-accent)] text-[11px] font-bold text-black">
                        {identity.avatarUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                            identity.fallback
                        )}
                    </div>
                    <span className="hidden truncate font-mono text-[11px] font-bold text-white lg:inline">
                        {identity.label}
                    </span>
                </button>

                <nav className="space-y-1.5" aria-label={ariaLabel}>
                    {items.map((item) => renderRow(item, false))}
                </nav>
            </div>

            <div className="mt-6 space-y-4">
                {promo && promoVisible && (
                    <div className="relative hidden rounded-2xl border border-[color:var(--sb-accent)]/20 bg-[color:var(--sb-accent)]/[0.06] p-3.5 text-white shadow-sm lg:block">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="rounded bg-[color:var(--sb-accent)] px-2 py-0.5 text-[10px] font-bold text-black">
                                {promo.badge}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPromoVisible(false)}
                                aria-label={`Dismiss ${promo.title}`}
                                className="text-white/50 transition-colors hover:text-white"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <p className="text-xs font-extrabold leading-tight text-white">{promo.title}</p>
                        <p className="mt-1 text-[10px] leading-snug text-white/50">{promo.body}</p>
                        <button
                            type="button"
                            onClick={promo.onCta}
                            className="mt-2.5 rounded-md bg-[color:var(--sb-accent)] px-3 py-1 text-[10px] font-bold text-black transition hover:opacity-80"
                        >
                            {promo.ctaLabel}
                        </button>
                    </div>
                )}

                {footerItems.length > 0 && (
                    <div className="space-y-1">{footerItems.map((item) => renderRow(item, true))}</div>
                )}
            </div>
        </aside>
    );
}
