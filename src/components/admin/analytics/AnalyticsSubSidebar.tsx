"use client";

import React from "react";
import {
  TrendingUp,
  Layers,
  Users,
  ShieldCheck,
  Activity,
  AlertTriangle,
} from "@/components/icons";

export type AnalyticsSectionId =
  | "volume"
  | "subscriptions"
  | "growth"
  | "kyc"
  | "health";

export interface AnalyticsSidebarItem {
  id: AnalyticsSectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeTone?: "neutral" | "warning" | "danger" | "success" | "brand";
}

export const ANALYTICS_SECTIONS: AnalyticsSidebarItem[] = [
  {
    id: "volume",
    label: "Volume Transacted",
    description: "Settled GMV, checkout links, and ticket sizes",
    icon: TrendingUp,
  },
  {
    id: "subscriptions",
    label: "Subscriptions & MRR",
    description: "Customer plans, premium revenue, and churn",
    icon: Layers,
  },
  {
    id: "growth",
    label: "Platform Growth",
    description: "Accounts, merchant onboarding, and roles",
    icon: Users,
  },
  {
    id: "kyc",
    label: "KYC & Compliance",
    description: "Verification queues, pass rates, and status",
    icon: ShieldCheck,
  },
  {
    id: "health",
    label: "System & Gas Health",
    description: "Sponsor runway, stuck receipts, and flags",
    icon: Activity,
  },
];

export function AnalyticsSubSidebar({
  activeSection,
  onSelectSection,
  badges = {},
}: {
  activeSection: AnalyticsSectionId;
  onSelectSection: (id: AnalyticsSectionId) => void;
  badges?: {
    volume?: string | number;
    subscriptions?: string | number;
    growth?: string | number;
    kyc?: string | number;
    health?: string | number;
    hasHealthWarning?: boolean;
    kycPending?: number;
  };
}) {
  return (
    <div className="w-full lg:w-64 shrink-0 flex flex-col space-y-1.5 rounded-2xl border border-[#e2e8f0] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="px-3 py-2 border-b border-[#f1f5f9] mb-1">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[#64748b]">
          Analytics Views
        </span>
        <h4 className="text-xs font-bold text-[#0f172a] mt-0.5">Protocol Intelligence</h4>
      </div>

      <div className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
        {ANALYTICS_SECTIONS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          
          let badgeVal = badges[item.id];
          if (item.id === "kyc" && badges.kycPending) {
            badgeVal = badges.kycPending;
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className={`group flex shrink-0 items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition ${
                isActive
                  ? "bg-[#2775ca] text-white shadow-sm font-bold"
                  : "bg-transparent text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition shrink-0 ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-[#f1f5f9] text-[#64748b] group-hover:text-[#2775ca]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs truncate ${isActive ? "text-white font-bold" : "text-[#0f172a] font-semibold"}`}>
                    {item.label}
                  </p>
                  <p className={`text-[10px] truncate hidden xl:block ${isActive ? "text-white/80" : "text-[#94a3b8]"}`}>
                    {item.description}
                  </p>
                </div>
              </div>

              {badgeVal !== undefined && badgeVal !== null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-black shrink-0 ${
                    isActive
                      ? "bg-white/20 text-white"
                      : item.id === "health" && badges.hasHealthWarning
                      ? "bg-amber-500/15 text-amber-600 border border-amber-500/30"
                      : item.id === "kyc" && Number(badgeVal) > 0
                      ? "bg-[#2775ca]/15 text-[#2775ca] border border-[#2775ca]/30"
                      : "bg-[#f1f5f9] text-[#64748b]"
                  }`}
                >
                  {badgeVal}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
