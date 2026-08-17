"use client";

import React from "react";
import { SkeletonLine } from "@/components/ui/skeletons";

/* The checkout's loading shape, in one place.
 *
 * Used twice, and it has to be the same both times: once by src/app/pay/[id]/loading.tsx as the
 * route's Suspense fallback (before any JS runs), and once by PublicPayClient while it fetches the
 * link. Two hand-written copies would drift, and the payer would see the layout jump as one skeleton
 * swapped for a slightly different one.
 *
 * Shaped like the real checkout — title, description, amount row, pay button, and the desktop QR
 * panel — so nothing moves when the data lands.
 */
export default function CheckoutSkeleton() {
    return (
        <div
            className="lg:flex lg:flex-row lg:items-stretch lg:gap-6"
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <span className="sr-only">Loading payment details…</span>

            {/* Desktop QR panel. Reserved even before we know whether this link has a checkout URL:
                without it the two-column layout collapsed to one and back again on load. */}
            <aside className="hidden lg:flex lg:w-[420px] lg:shrink-0 flex-col items-center justify-center gap-5 rounded-3xl border border-black/15 bg-white p-6 shadow-sm">
                <SkeletonLine width="45%" height={12} />
                <div className="subscript-skeleton h-[320px] w-full rounded-2xl" />
                <SkeletonLine width="70%" height={34} className="!rounded-xl" />
            </aside>

            <div className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm space-y-6 lg:flex-1 lg:min-w-0">
                {/* Step indicator */}
                <div className="subscript-skeleton h-10 w-full rounded-2xl" />

                {/* "You are paying for" + title + description */}
                <div className="space-y-2">
                    <SkeletonLine width="35%" height={9} />
                    <SkeletonLine width="72%" height={22} />
                    <SkeletonLine width="90%" height={10} faint />
                    <SkeletonLine width="60%" height={10} faint />
                </div>

                {/* Amount due */}
                <div className="rounded-2xl border border-black/10 bg-[#f8fafc] p-5 flex items-center justify-between">
                    <SkeletonLine width={90} height={10} />
                    <div className="flex flex-col items-end gap-2">
                        <SkeletonLine width={130} height={20} />
                        <SkeletonLine width={90} height={9} faint />
                    </div>
                </div>

                {/* Pay button */}
                <div className="subscript-skeleton h-14 w-full rounded-2xl" />

                {/* "Protected by SubScript" */}
                <div className="flex justify-center">
                    <SkeletonLine width={140} height={9} faint />
                </div>
            </div>
        </div>
    );
}
