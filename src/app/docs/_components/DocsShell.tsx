"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import { getDashboardUrl } from "@/utils/navigation";
import { docsSections, sectionHref } from "./sections";

/* Chrome shared by every docs route. The persistent left sidebar was removed in favour of a
   horizontal top tab bar (a scrollable pill row of every section) — the active pill is derived
   from the URL, so nav state is correct on first paint and on a cold deep-link load. The /docs
   overview page carries the full grouped index for browsing; this bar is for quick switching. */
export default function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeHref = pathname.replace(/\/+$/, "") || "/docs";

  /* Keep the active pill in view when the route changes — important on mobile, where the bar
     scrolls horizontally and the current page could otherwise sit off-screen. `block: "nearest"`
     avoids nudging the vertical scroll position of the page. */
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-docs-tab-active]");
    el?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeHref]);

  return (
    <div className="min-h-screen w-full bg-[#FFFFF0] text-[#111827] font-sans selection:bg-[#2775CA]/20 selection:text-black">
      <header className="sticky top-0 z-40 w-full border-b border-black/10 bg-[#FFFFF0]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2775CA] p-1.5 shadow-sm">
              <img
                src="/logo-transparent.png"
                alt="SubScript Logo"
                className="h-full w-full object-contain brightness-0 invert"
              />
            </div>
            <span className="text-lg font-black tracking-tight text-[#111827]">
              SubScript <span className="font-bold text-black/40">docs</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href={getDashboardUrl("ENTERPRISE", "/merchant")}
              className="hidden items-center gap-1.5 text-xs font-semibold text-black/70 transition-colors hover:text-black sm:inline-flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-[#2775CA] px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-[#1f62ab]"
            >
              Sign up
            </Link>
          </div>
        </div>

        {/* Top tab bar — replaces the old sidebar. Horizontally scrollable pill row. */}
        <nav aria-label="Documentation sections" className="border-t border-black/[0.06]">
          <div className="mx-auto max-w-6xl overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-center gap-1 py-2">
              {docsSections.map((section) => {
                const Icon = section.icon;
                const href = sectionHref(section);
                const active = activeHref === href;
                return (
                  <Link
                    key={section.slug || "overview"}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    {...(active ? { "data-docs-tab-active": "" } : {})}
                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-[#2775CA] text-white shadow-sm"
                        : "text-black/60 hover:bg-black/[0.04] hover:text-[#111827]"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? "text-white" : "text-black/40"}`} />
                    {section.title}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </header>

      {/* Content — full width, centered, no sidebar. */}
      <main className="mx-auto max-w-4xl px-6 py-10 sm:px-8">{children}</main>
    </div>
  );
}
