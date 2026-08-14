"use client";

import React from "react";

export function AnalyticsCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${className}`}
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
    <div className="space-y-6 animate-pulse">
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
    <div className="space-y-6 animate-pulse">
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
    <div className="space-y-6 animate-pulse">
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
    <div className="space-y-6 animate-pulse">
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
    <div className="space-y-6 animate-pulse">
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
