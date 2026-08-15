"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SpendAnalysisRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/user?tab=dns&subview=spend-analysis#spend-analysis");
  }, [router]);

  return (
    <div
      aria-label="Opening Spend Analysis"
      className="min-h-screen bg-[#FFFFF0] px-4 pb-24 pt-20 text-black"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="h-8 w-52 rounded-lg subscript-skeleton" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 rounded-2xl border border-black/10 bg-white p-4">
              <div className="h-3 w-24 rounded-full subscript-skeleton" />
              <div className="mt-5 h-7 w-32 rounded-lg subscript-skeleton" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-5">
          <div className="h-4 w-40 rounded-full subscript-skeleton" />
          <div className="mt-5 h-56 w-full rounded-xl subscript-skeleton subscript-skeleton--faint" />
        </div>
      </div>
    </div>
  );
}
