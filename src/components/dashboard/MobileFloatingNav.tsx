"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import LiquidGlassEffect from "@/components/LiquidGlassEffect";

export interface MobileNavTab<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly icon: LucideIcon;
}

interface MobileFloatingNavProps<T extends string = string> {
  readonly tabs: readonly MobileNavTab<T>[];
  readonly activeTab: T;
  readonly onSelectTab: (tabId: T) => void;
  readonly pendingDmCount?: number;
  readonly scrollContainerSelector?: string;
}

export default function MobileFloatingNav<T extends string = string>({
  tabs,
  activeTab,
  onSelectTab,
  pendingDmCount = 0,
  scrollContainerSelector = ".user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);
  const lastScrollY = useRef(0);
  const isRetractedRef = useRef(isRetracted);
  isRetractedRef.current = isRetracted;

  // Always expand whenever user changes tabs
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  const handleScrollDelta = useCallback((currentY: number) => {
    const delta = currentY - lastScrollY.current;

    // Expand when near the top
    if (currentY <= 35) {
      if (isRetractedRef.current) setIsRetracted(false);
      lastScrollY.current = currentY;
      return;
    }

    // Scroll down -> Retract to edges
    if (delta > 15 && !isRetractedRef.current && currentY > 60) {
      setIsRetracted(true);
    }
    // Scroll up -> Expand back
    else if (delta < -12 && isRetractedRef.current) {
      setIsRetracted(false);
    }

    lastScrollY.current = currentY;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollContainer = document.querySelector(scrollContainerSelector) as HTMLElement | null;
          const containerY = scrollContainer ? scrollContainer.scrollTop : 0;
          const windowY = window.scrollY || window.pageYOffset || 0;
          const effectiveY = Math.max(containerY, windowY);
          handleScrollDelta(effectiveY);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    const scrollContainer = document.querySelector(scrollContainerSelector) as HTMLElement | null;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", onScroll);
      }
    };
  }, [handleScrollDelta, scrollContainerSelector]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabItem?.icon;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm z-50 flex items-center justify-between pointer-events-none">
      {/* Left Navigation Capsule / Retracted Pill */}
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        className={`pointer-events-auto transition-[flex,width] duration-300 ${
          isRetracted ? "flex-none" : "flex-1 mr-3 min-w-0"
        }`}
      >
        <nav
          aria-label="Primary navigation"
          className={`liquid-glass relative flex items-center rounded-full backdrop-blur-lg shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-[padding,background-color] duration-300 ${
            isRetracted
              ? "p-1.5 cursor-pointer justify-center"
              : "px-3 py-[1.1rem] justify-around w-full"
          }`}
          style={{
            backgroundColor: "rgb(39 117 202 / 20%)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
          }}
          onClick={() => {
            if (isRetracted) {
              setIsRetracted(false);
            }
          }}
        >
          <LiquidGlassEffect />

          {isRetracted ? (
            /* Retracted State: Circular bubble with active tab icon */
            <button
              key="retracted-active-btn"
              type="button"
              aria-label={`Current: ${activeTabItem.label} (Tap to expand)`}
              onClick={(e) => {
                e.stopPropagation();
                setIsRetracted(false);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-black/20 bg-[#353935] text-[#FFFFF0] shadow-sm active:scale-90 transition-transform"
            >
              {ActiveIcon && <ActiveIcon className="h-5 w-5 text-[#FFFFF0]" />}
            </button>
          ) : (
            /* Expanded State: Horizontal tabs with text to the RIGHT of icon */
            tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const IconComponent = tab.icon;

              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={isActive}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={tab.label}
                  onClick={() => onSelectTab(tab.id)}
                  className={`relative h-11 shrink-0 overflow-hidden rounded-full border transition-[width,background-color,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2775CA] ${
                    isActive
                      ? "w-20 min-[360px]:w-[92px] border-black/20 bg-[#353935] text-[#FFFFF0] shadow-sm"
                      : "w-10 min-[360px]:w-11 border-transparent bg-transparent text-black/65 hover:bg-black/5 hover:text-black"
                  }`}
                >
                  <span
                    className={`absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      isActive ? "scale-105" : "scale-100"
                    }`}
                  >
                    <IconComponent
                      className={`h-5 w-5 transition-colors duration-300 ${
                        isActive ? "text-[#FFFFF0]" : "text-black/65"
                      }`}
                    />
                  </span>
                  {/* Label strictly on the RIGHT SIDE of the icon */}
                  <span
                    className={`absolute left-10 top-1/2 -translate-y-1/2 whitespace-nowrap text-[9px] font-bold uppercase tracking-wide transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      isActive ? "translate-x-1 opacity-100" : "-translate-x-4 opacity-0"
                    }`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })
          )}
        </nav>
      </motion.div>

      {/* Right Edge: Detached DMs Action Button */}
      <div className="pointer-events-auto relative shrink-0">
        <button
          type="button"
          onClick={() => {
            setIsRetracted(false);
            onSelectTab("inbox" as unknown as T);
          }}
          className={`relative h-[3.3rem] flex items-center justify-center rounded-full border transition-all duration-300 gap-2 px-3 overflow-hidden shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${
            activeTab === ("inbox" as unknown as T) && !isRetracted
              ? "bg-[#353935] border-[#353935] text-[#FFFFF0] scale-105 w-[108px]"
              : activeTab === ("inbox" as unknown as T)
              ? "bg-[#353935] border-[#353935] text-[#FFFFF0] w-[3.3rem]"
              : "bg-[#2775CA]/20 border-black/15 text-black/60 hover:text-black w-[3.3rem]"
          }`}
          style={{
            backgroundColor: activeTab === ("inbox" as unknown as T) ? undefined : "rgb(39 117 202 / 20%)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
          }}
          aria-label="Open DMs"
        >
          <MessageSquare className="h-5 w-5 shrink-0" />
          {activeTab === ("inbox" as unknown as T) && !isRetracted && (
            <span className="text-[7px] font-bold uppercase tracking-wider shrink-0">DMs</span>
          )}
        </button>
        {/* Unread Badge */}
        {pendingDmCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-[#060608] bg-red-500 px-1 text-[10px] font-black leading-none text-white">
            {pendingDmCount > 9 ? "9+" : pendingDmCount}
          </span>
        )}
      </div>
    </div>
  );
}

