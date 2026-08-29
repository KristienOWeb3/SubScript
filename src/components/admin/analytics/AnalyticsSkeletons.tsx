"use client";

import React from "react";

export function AnalyticsCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`admin-skeleton-shimmer rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${className}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="h-3 w-28 rounded-md bg-[#f1f5f9]" />
        <div className="h-5 w-12 rounded-full bg-[#f1f5f9]" />
      </div>
      <div className="h-8 w-36 rounded-md bg-[#f1f5f9] mb-2" />
      <div className="h-3 w-48 rounded-md bg-[#f8fafc]" />
    </div>
  );
}

export function VolumeSkeleton() {
  return (
    <div className="admin-skeleton-shimmer space-y-6">
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
            <div className="h-3 w-24 rounded bg-[#f1f5f9] mb-3" />
            <div className="h-7 w-32 rounded bg-[#f1f5f9] mb-2" />
            <div className="h-3 w-20 rounded bg-[#f8fafc]" />
          </div>
        ))}
      </div>

      {/* Main Area Chart Skeleton */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-4 w-40 rounded bg-[#f1f5f9] mb-2" />
            <div className="h-3 w-56 rounded bg-[#f8fafc]" />
          </div>
          <div className="h-7 w-36 rounded-xl bg-[#f1f5f9]" />
        </div>
        <div className="h-56 w-full rounded-xl bg-[#f8fafc]" />
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-52 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
        <div className="h-52 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
      </div>
    </div>
  );
}

export function SubscriptionsSkeleton() {
  return (
    <div className="admin-skeleton-shimmer space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
            <div className="h-3 w-28 rounded bg-[#f1f5f9] mb-3" />
            <div className="h-7 w-20 rounded bg-[#f1f5f9] mb-2" />
            <div className="h-3 w-32 rounded bg-[#f8fafc]" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
        <div className="h-64 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
      </div>
    </div>
  );
}

export function GrowthSkeleton() {
  return (
    <div className="admin-skeleton-shimmer space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
            <div className="h-3 w-28 rounded bg-[#f1f5f9] mb-3" />
            <div className="h-7 w-24 rounded bg-[#f1f5f9] mb-2" />
            <div className="h-3 w-28 rounded bg-[#f8fafc]" />
          </div>
        ))}
      </div>

      <div className="h-60 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-48 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
        <div className="h-48 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
      </div>
    </div>
  );
}

export function KycSkeleton() {
  return (
    <div className="admin-skeleton-shimmer space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
            <div className="h-3 w-28 rounded bg-[#f1f5f9] mb-3" />
            <div className="h-7 w-24 rounded bg-[#f1f5f9]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
        <div className="h-64 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
      </div>
    </div>
  );
}

export function HealthSkeleton() {
  return (
    <div className="admin-skeleton-shimmer space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
            <div className="h-3 w-28 rounded bg-[#f1f5f9] mb-3" />
            <div className="h-7 w-20 rounded bg-[#f1f5f9]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-60 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
        <div className="h-60 rounded-2xl border border-[#e2e8f0] bg-white p-6" />
      </div>
    </div>
  );
}

export function AdminOverviewSkeleton() {
  return (
    <div className="admin-skeleton-shimmer space-y-6" role="status" aria-label="Loading Admin Overview...">
      {/* 5 KPI Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between mb-3">
              <div className="h-3 w-24 rounded bg-[#f1f5f9]" />
              <div className="h-6 w-6 rounded-lg bg-[#f1f5f9]" />
            </div>
            <div className="h-7 w-28 rounded bg-[#f1f5f9] mb-2" />
            <div className="h-3 w-32 rounded bg-[#f8fafc]" />
          </div>
        ))}
      </div>

      {/* Main Settlement Velocity Area Chart Skeleton */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <div className="h-4 w-48 rounded bg-[#f1f5f9] mb-2" />
            <div className="h-3 w-64 rounded bg-[#f8fafc]" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-20 rounded-full bg-[#f1f5f9]" />
            <div className="h-4 w-20 rounded-full bg-[#f1f5f9]" />
          </div>
        </div>
        <div className="h-60 w-full rounded-xl bg-[#f8fafc]" />
      </div>

      {/* Two Column Grid: Gas Reserves + Commerce Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Gas Reserves Card Skeleton */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#f1f5f9]">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-[#f1f5f9]" />
              <div>
                <div className="h-3.5 w-44 rounded bg-[#f1f5f9] mb-1.5" />
                <div className="h-2.5 w-56 rounded bg-[#f8fafc]" />
              </div>
            </div>
            <div className="h-7 w-7 rounded-lg bg-[#f1f5f9]" />
          </div>

          <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#f1f5f9] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-[#f1f5f9]" />
              <div className="space-y-1">
                <div className="h-2.5 w-24 rounded bg-[#f1f5f9]" />
                <div className="h-3.5 w-32 rounded bg-[#f1f5f9]" />
              </div>
            </div>
            <div className="h-4 w-16 rounded-full bg-[#f1f5f9]" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="p-3 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-3.5 w-14 rounded bg-[#f1f5f9]" />
                  <div className="h-3.5 w-10 rounded-full bg-[#f1f5f9]" />
                </div>
                <div className="h-4 w-16 rounded bg-[#f1f5f9] pt-1" />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Commerce Breakdown Donut Skeleton */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div>
            <div className="h-4 w-44 rounded bg-[#f1f5f9] mb-1.5" />
            <div className="h-3 w-56 rounded bg-[#f8fafc] mb-6" />
            <div className="flex items-center justify-center py-4">
              <div className="h-44 w-44 rounded-full border-8 border-[#f1f5f9] flex items-center justify-center">
                <div className="h-8 w-16 rounded bg-[#f1f5f9]" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[#f1f5f9]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="text-center space-y-1">
                <div className="h-3 w-12 mx-auto rounded bg-[#f1f5f9]" />
                <div className="h-2.5 w-16 mx-auto rounded bg-[#f8fafc]" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gas Sponsor Address Card Skeleton */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="h-3 w-36 rounded bg-[#f1f5f9] mb-1.5" />
          <div className="h-2.5 w-64 rounded bg-[#f8fafc]" />
        </div>
        <div className="h-8 w-60 rounded-xl bg-[#f1f5f9]" />
      </div>

      {/* Recent Merchants Table Skeleton */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="h-4 w-44 rounded bg-[#f1f5f9] mb-1.5" />
            <div className="h-3 w-56 rounded bg-[#f8fafc]" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-44 rounded-lg bg-[#f1f5f9]" />
            <div className="h-8 w-20 rounded-lg bg-[#f1f5f9]" />
          </div>
        </div>

        <div className="divide-y divide-[#f8fafc]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between py-3.5 px-2">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-[#f1f5f9]" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-[#f1f5f9]" />
                  <div className="h-2.5 w-16 rounded bg-[#f8fafc]" />
                </div>
              </div>
              <div className="h-3.5 w-32 rounded bg-[#f1f5f9] hidden sm:block" />
              <div className="h-4 w-14 rounded-full bg-[#f1f5f9]" />
              <div className="h-4 w-16 rounded-full bg-[#f1f5f9]" />
              <div className="h-6 w-16 rounded-lg bg-[#f1f5f9]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
