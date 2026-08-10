"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Menu, X } from "@/components/icons";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import LiquidGlassEffect from "@/components/LiquidGlassEffect";
import { getDashboardUrl } from "@/utils/navigation";
import { docsSections, sectionHref } from "./sections";

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const staggerContainerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
  exit: {},
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

/* Chrome shared by every docs route. The active item now comes from the URL rather than an
   IntersectionObserver over one long page, so nav state is correct on first paint (and on a
   cold load of a deep link) instead of settling after scroll. */
export default function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeHref = pathname.replace(/\/+$/, "") || "/docs";

  /* Close the overlay on navigation: the route change is what dismisses it, so a tapped link
     never leaves the menu covering the page it just opened. */
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <div className="relative min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white md:h-screen md:overflow-hidden">
      <AnimatedGradientBg />

      <div className="relative z-10 md:h-full">
        {/* Floating Header Bar */}
        <div className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
          <nav className="w-full max-w-7xl liquid-glass rounded-full px-6 py-3.5 flex items-center justify-between pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] bg-black/40 backdrop-blur-lg border border-white/10">
            <LiquidGlassEffect />

            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2.5 group">
                <Image
                  src="/logo.png"
                  alt="SubScript Logo"
                  width={32}
                  height={32}
                  className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)] group-hover:scale-105 transition-transform"
                  priority
                />
                <span className="text-base font-bold text-white tracking-tight group-hover:text-[#00d2b4] transition-colors">
                  SubScript <span className="font-serif font-normal italic lowercase text-[#00d2b4]">docs</span>
                </span>
              </Link>
              <span className="hidden h-4 w-px bg-white/10 md:block" />
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40 md:block">
                Integration Guide
              </span>
            </div>

            <div className="hidden md:flex items-center gap-4">
              <Link
                href={getDashboardUrl("ENTERPRISE", "/merchant")}
                className="liquid-glass rounded-full px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-all duration-200 flex items-center gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
              <Link
                href="/signup"
                className="bg-[#00d2b4] text-[#111111] text-xs font-semibold px-4 py-2 rounded-full hover:brightness-110 shadow-[0_0_8px_rgba(0,210,180,0.25)] transition-all duration-200"
              >
                Sign up
              </Link>
            </div>

            <div className="md:hidden flex items-center gap-3">
              <Link
                href="/signup"
                className="bg-[#00d2b4] text-[#111111] text-xs font-semibold px-3.5 py-1.5 rounded-full hover:brightness-110 shadow-[0_0_8px_rgba(0,210,180,0.25)] transition-all duration-200"
              >
                Sign up
              </Link>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="p-1.5 text-white/70 hover:text-white transition-colors"
                aria-label="Open Navigation Menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </nav>
        </div>

        {/* Mobile Fullscreen Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              className="fixed inset-0 z-50 md:hidden flex flex-col bg-black/95 backdrop-blur-xl"
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
                <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileMenuOpen(false)}>
                  <Image
                    src="/logo.png"
                    alt="SubScript Logo"
                    width={32}
                    height={32}
                    className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)]"
                  />
                  <span className="text-xl font-bold text-white tracking-tight">
                    SubScript <span className="font-serif font-normal italic lowercase text-[#00d2b4]">docs</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-[#9ca3af] hover:text-white transition-colors"
                  aria-label="Close Menu"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <motion.div
                className="flex-1 flex flex-col min-h-0 max-h-[calc(100vh-4rem)]"
                variants={staggerContainerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div className="flex-1 px-6 py-6 flex flex-col gap-2 overflow-y-auto overscroll-contain">
                  {docsSections.map((section, index) => {
                    const Icon = section.icon;
                    const isNewGroup = index === 0 || docsSections[index - 1].group !== section.group;
                    const href = sectionHref(section);
                    const active = activeHref === href;
                    return (
                      <motion.div key={section.slug || "overview"} variants={itemVariants}>
                        {isNewGroup && (
                          <p className={`mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#00d2b4] ${index === 0 ? "mt-0" : "mt-4"}`}>
                            {section.group}
                          </p>
                        )}
                        <Link
                          href={href}
                          className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-all duration-200 ${
                            active
                              ? "bg-[#00d2b4]/15 border border-[#00d2b4]/30 text-[#00d2b4] font-semibold"
                              : "bg-white/[0.03] border border-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className={`h-4 w-4 ${active ? "text-[#00d2b4]" : "text-white/40"}`} />
                            <span className="text-sm tracking-wide">{section.title}</span>
                          </div>
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-[#00d2b4] shadow-[0_0_6px_#00d2b4]" />}
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 pb-20 pt-24 md:h-full md:grid-cols-4 md:grid-rows-[minmax(0,1fr)] md:pb-0 md:pt-20">
          <aside className="col-span-1 hidden min-h-0 self-stretch overflow-y-auto overscroll-contain pb-8 pr-2 md:block">
            <div className="liquid-glass rounded-2xl border border-white/5 bg-black/40 p-5 backdrop-blur-md">
              <p className="mb-3 border-b border-white/5 pb-3 text-[9px] font-semibold uppercase tracking-widest text-white/30">
                Documentation map
              </p>
              <nav className="flex flex-col gap-1">
                {docsSections.map((section, index) => {
                  const Icon = section.icon;
                  const href = sectionHref(section);
                  const active = activeHref === href;
                  return (
                    <div key={section.slug || "overview"}>
                      {(index === 0 || docsSections[index - 1].group !== section.group) && (
                        <p className={`mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25 ${index === 0 ? "mt-0" : "mt-4"}`}>
                          {section.group}
                        </p>
                      )}
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider transition ${
                          active ? "border border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4]" : "text-white/50 hover:bg-white/[0.03] hover:text-white"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {section.title}
                      </Link>
                    </div>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main className="col-span-1 min-h-0 md:col-span-3 md:overflow-y-auto md:overscroll-contain md:pb-20 md:pr-3">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
