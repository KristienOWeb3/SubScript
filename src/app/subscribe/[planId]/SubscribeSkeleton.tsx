"use client";

import React from "react";
import { SkeletonLine } from "@/components/ui/skeletons";

/* The subscription checkout's loading shape.
 *
 * Mirrors src/app/pay/[id]/CheckoutSkeleton.tsx, for the same reason: a spinner tells the
 * subscriber nothing and then the layout jumps when the plan lands. This is shaped like the real
 * card — merchant row, plan name, the recurring amount inset, and the CTA — so the only thing that
 * changes on load is the content.
 */
export default function SubscribeSkeleton() {
    return (
        <div
            className="rounded-3xl border border-black/15 bg-white p-6 shadow-sm space-y-6 sm:p-8"
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <span className="sr-only">Loading plan details…</span>

            {/* Merchant identity row */}
            <div className="flex items-center gap-3">
                <div className="subscript-skeleton h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                    <SkeletonLine width="40%" height={10} />
                    <SkeletonLine width="60%" height={14} />
                </div>
            </div>

            {/* Plan label + name */}
            <div className="space-y-2">
                <SkeletonLine width="22%" height={10} />
                <SkeletonLine width="70%" height={26} />
            </div>

            {/* Description */}
            <div className="space-y-2">
                <SkeletonLine width="100%" height={12} />
                <SkeletonLine width="85%" height={12} />
            </div>

            {/* Recurring amount inset */}
            <div className="rounded-2xl border border-black/10 bg-[#f8fafc] p-5">
                <div className="flex items-center justify-between gap-4">
                    <SkeletonLine width="30%" height={12} />
                    <div className="flex-1 space-y-2">
                        <SkeletonLine width="55%" height={28} className="ml-auto" />
                        <SkeletonLine width="75%" height={10} className="ml-auto" />
                    </div>
                </div>
            </div>

            {/* Terms copy */}
            <div className="space-y-2">
                <SkeletonLine width="100%" height={12} />
                <SkeletonLine width="92%" height={12} />
            </div>

            {/* CTA */}
            <SkeletonLine width="100%" height={52} className="!rounded-2xl" />

            {/* Trust footer */}
            <div className="flex justify-center pt-1">
                <SkeletonLine width="62%" height={10} />
            </div>
        </div>
    );
}
