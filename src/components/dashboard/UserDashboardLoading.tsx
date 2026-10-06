"use client";

import DashboardSidebar, {
  type DashboardSidebarItem,
} from "./DashboardSidebar";
import { Settings, HelpCircle } from "@/components/icons";

// CSS owns the responsive loading layout, including the server's first paint.
export default function UserDashboardLoading({
  items,
  activeTab,
}: {
  items: ReadonlyArray<DashboardSidebarItem>;
  activeTab: string;
}) {
  return (
    <div
      role="status"
      className="user-dashboard-loading relative overflow-x-hidden bg-[#FFFFF0] dark:bg-[#060608] text-black dark:text-white font-sans h-[100dvh] overflow-y-auto overscroll-y-contain md:h-[100dvh] md:overflow-hidden"
    >
      <span className="sr-only">Loading dashboard…</span>
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none z-0 bg-[#353935] hidden md:block"
      />
      <div className="relative z-10 md:flex md:h-[100dvh] md:min-h-0">
        <DashboardSidebar
          className="hidden md:flex"
          isLoading={true}
          items={items}
          footerItems={[
            { id: "dns", label: "Settings", icon: Settings },
            { id: "support", label: "Help center", icon: HelpCircle },
          ]}
          activeId={activeTab}
          onSelect={() => {}}
          identity={{
            label: "",
            fallback: "",
            onClick: () => {},
          }}
          accent="#FFFFF0"
          panelColor="#353935"
          ariaLabel="User dashboard loading"
        />

        {/* Content Pane Skeleton — mirrors the mobile & desktop Home layout */}
        <div className="user-dashboard-content relative z-10 min-w-0 flex-1 flex flex-col bg-[#FFFFF0] dark:bg-[#060608] md:mt-[14px] md:rounded-tl-[20px] md:border md:border-black/10 dark:md:border-white/10 overflow-hidden h-[100dvh] md:h-[calc(100dvh-14px)]">
          <div className="md:hidden fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
            <div className="flex w-full max-w-md items-center justify-between px-1 py-2 pointer-events-auto">
              <div
                aria-label="Loading profile"
                className="h-12 w-12 subscript-skeleton max-w-full rounded-full shrink-0 shadow-sm"
              />
              <div
                className="flex items-center gap-2"
                aria-label="Loading account controls"
              >
                <div className="h-9 w-9 subscript-skeleton max-w-full rounded-full shrink-0" />
                <div className="h-9 w-9 subscript-skeleton max-w-full rounded-full shrink-0" />
              </div>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto min-h-0 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-28 md:pt-6 lg:pt-8 md:pb-12">
            {/* Title Header on Desktop/Tablet */}
            <div className="hidden md:flex items-center justify-between gap-6 mb-8 pb-6 border-b border-black/10 dark:border-white/10">
              <div className="h-8 w-64 subscript-skeleton max-w-full rounded-lg" />
            </div>

            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[46fr_54fr]">
                {/* LEFT: Balance card + Actions */}
                <div className="flex flex-col gap-4 min-w-0">
                  <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-3 py-3 text-center md:flex-wrap md:flex-row md:justify-between md:rounded-[20px] md:border md:border-black/35 dark:md:border-white/15 md:bg-[#2775CA]/20 dark:md:bg-[#2775CA]/10 md:px-6 md:py-[22px] md:text-left">
                    <div className="flex flex-col items-center gap-2 md:items-start">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-24 subscript-skeleton max-w-full rounded-full" />
                        <div className="h-3.5 w-3.5 subscript-skeleton max-w-full rounded-full" />
                        <div className="h-3.5 w-3.5 subscript-skeleton max-w-full rounded-full" />
                      </div>
                      <div className="h-10 w-48 subscript-skeleton max-w-full rounded-2xl" />
                      <div className="h-3 w-24 subscript-skeleton max-w-full subscript-skeleton--faint rounded-full" />
                    </div>
                    <div className="wallet-actions flex w-full shrink-0 flex-row justify-center gap-2 md:w-auto md:flex-col md:gap-2.5">
                      <div className="h-11 min-w-0 flex-1 md:w-[130px] md:min-w-[130px] md:flex-none subscript-skeleton max-w-full rounded-full" />
                      <div className="flex items-center gap-2 flex-1 md:flex-none md:w-[130px]">
                        <div className="h-11 min-w-0 flex-1 md:w-[130px] md:min-w-[130px] subscript-skeleton max-w-full rounded-full" />
                        <div className="flex md:hidden h-11 w-11 shrink-0 subscript-skeleton max-w-full rounded-full" />
                      </div>
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] sm:gap-3.5">
                    <div className="dashboard-blue-panel flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 dark:border-white/15 p-3 sm:p-[18px]">
                      <div className="space-y-2.5">
                        <div className="h-2.5 w-24 subscript-skeleton max-w-full rounded-full" />
                        <div className="h-3 w-8 subscript-skeleton max-w-full subscript-skeleton--faint rounded-full" />
                        <div className="h-6 w-24 subscript-skeleton max-w-full rounded-lg" />
                      </div>
                      <div className="h-2.5 w-24 subscript-skeleton max-w-full rounded-full" />
                    </div>
                    <div className="dashboard-blue-panel flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 dark:border-white/15 p-3 sm:p-[18px]">
                      <div className="space-y-2.5">
                        <div className="h-2.5 w-20 subscript-skeleton max-w-full rounded-full" />
                        <div className="flex gap-3">
                          <div className="h-6 w-16 subscript-skeleton max-w-full rounded-lg" />
                          <div className="h-6 w-16 subscript-skeleton max-w-full rounded-lg" />
                        </div>
                      </div>
                      <div className="h-2.5 w-24 subscript-skeleton max-w-full rounded-full" />
                    </div>
                  </div>
                </div>

                {/* RIGHT: Active Subscriptions */}
                <div className="hidden lg:flex min-h-[260px] h-full flex-col rounded-3xl border border-black/15 dark:border-white/15 bg-white/80 dark:bg-white/5 p-5 shadow-sm">
                  <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                    <div className="h-3 w-36 subscript-skeleton max-w-full rounded-full" />
                    <div className="h-5 w-16 subscript-skeleton max-w-full rounded-full" />
                  </div>
                  <div className="flex-1 space-y-3 overflow-hidden">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-2 border-b border-black/5 dark:border-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 subscript-skeleton max-w-full rounded-full" />
                          <div className="space-y-1.5">
                            <div className="h-3 w-28 subscript-skeleton max-w-full rounded-full" />
                            <div className="h-2 w-16 subscript-skeleton max-w-full subscript-skeleton--faint rounded-full" />
                          </div>
                        </div>
                        <div className="h-4 w-20 subscript-skeleton max-w-full rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="dashboard-blue-panel min-h-[390px] rounded-[20px] border border-black/35 dark:border-white/15 p-5 text-black dark:text-white">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-36 subscript-skeleton max-w-full rounded-full" />
                  <div className="h-4 w-16 subscript-skeleton max-w-full rounded-full" />
                </div>
                <div className="dashboard-filter-scroll mt-4 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[
                    { label: "All", width: "w-14" },
                    { label: "Subscriptions", width: "w-28" },
                    { label: "One Time", width: "w-20" },
                    { label: "Transfers", width: "w-20" },
                    { label: "Withdrawals", width: "w-24" },
                    { label: "Deposits", width: "w-20" },
                  ].map((tab) => (
                    <div
                      key={tab.label}
                      className={`h-7 ${tab.width} shrink-0 subscript-skeleton max-w-full rounded-full`}
                    />
                  ))}
                </div>
                <div className="mt-4 divide-y divide-black/5 dark:divide-white/5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-3">
                      <div className="h-10 w-10 subscript-skeleton max-w-full rounded-full shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="h-3 w-32 subscript-skeleton max-w-full rounded-full" />
                        <div className="h-2 w-20 subscript-skeleton max-w-full subscript-skeleton--faint rounded-full" />
                      </div>
                      <div className="shrink-0 space-y-1.5 text-right">
                        <div className="h-3.5 w-16 subscript-skeleton max-w-full rounded-full ml-auto" />
                        <div className="h-2 w-12 subscript-skeleton max-w-full subscript-skeleton--faint rounded-full ml-auto" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Mobile Bottom Bar Skeleton */}
      <div className="md:hidden fixed bottom-4 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-2">
        <div className="flex h-[60.6375px] flex-1 items-center justify-around rounded-full border border-black/15 dark:border-white/15 bg-[#2775CA]/20 dark:bg-[#2775CA]/10 px-3 backdrop-blur-2xl">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-6 w-6 subscript-skeleton max-w-full rounded-full"
            />
          ))}
        </div>
        <div className="h-[60.6375px] w-[60.6375px] shrink-0 rounded-full subscript-skeleton" />
      </div>
    </div>
  );
}
