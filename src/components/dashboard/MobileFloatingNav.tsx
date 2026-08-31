"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
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
  scrollContainerSelector = ".user-dashboard-content, .user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);
  const lastScrollY = useRef(0);
  const touchStartY = useRef(0);
  const lastStateChangeTime = useRef(0);

  // Always expand whenever user changes tabs
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  const setRetractedWithDebounce = useCallback((retract: boolean) => {
    const now = Date.now();
    // Prevent rapid flickering during aggressive scroll reversals (100ms lock)
    if (now - lastStateChangeTime.current < 100) return;
    lastStateChangeTime.current = now;
    setIsRetracted(retract);
  }, []);

  const handleScrollDelta = useCallback((currentY: number) => {
    const delta = currentY - lastScrollY.current;

    // Always expand at or near the top of the page
    if (currentY <= 30) {
      setRetractedWithDebounce(false);
      lastScrollY.current = currentY;
      return;
    }

    // Scroll down by substantial delta -> retract to edges
    if (delta > 14 && currentY > 50) {
      setRetractedWithDebounce(true);
    }
    // Scroll up by substantial delta -> expand back
    else if (delta < -10) {
      setRetractedWithDebounce(false);
    }

    lastScrollY.current = currentY;
  }, [setRetractedWithDebounce]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let ticking = false;
    const getActiveScrollY = () => {
      const selectors = scrollContainerSelector.split(",").map((s) => s.trim());
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.scrollTop > 0) {
          return el.scrollTop;
        }
      }
      return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };

    const handleAnyScroll = (e?: Event) => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          let y = 0;
          if (e && e.target && "scrollTop" in (e.target as HTMLElement)) {
            const targetEl = e.target as HTMLElement;
            if (targetEl.scrollTop > 0) {
              y = targetEl.scrollTop;
            } else {
              y = getActiveScrollY();
            }
          } else {
            y = getActiveScrollY();
          }
          handleScrollDelta(y);
          ticking = false;
        });
        ticking = true;
      }
    };

    // Instant touch gesture detection for mobile devices
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        touchStartY.current = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touchCurrentY = e.touches[0].clientY;
        const touchDelta = touchStartY.current - touchCurrentY; // > 0 means finger dragged UP, page scrolled DOWN
        const currentY = getActiveScrollY();

        if (currentY <= 25) {
          setRetractedWithDebounce(false);
        } else if (touchDelta > 14 && currentY > 45) {
          setRetractedWithDebounce(true);
        } else if (touchDelta < -10) {
          setRetractedWithDebounce(false);
        }
      }
    };

    // Desktop mouse wheel listener
    const onWheel = (e: WheelEvent) => {
      const currentY = getActiveScrollY();
      if (currentY <= 25) {
        setRetractedWithDebounce(false);
      } else if (e.deltaY > 10 && currentY > 40) {
        setRetractedWithDebounce(true);
      } else if (e.deltaY < -10) {
        setRetractedWithDebounce(false);
      }
    };

    // Capture phase listener ensures ALL scroll events from any nested container are caught!
    window.addEventListener("scroll", handleAnyScroll, { capture: true, passive: true });
    document.addEventListener("scroll", handleAnyScroll, { capture: true, passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleAnyScroll, { capture: true });
      document.removeEventListener("scroll", handleAnyScroll, { capture: true });
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("wheel", onWheel);
    };
  }, [handleScrollDelta, scrollContainerSelector, setRetractedWithDebounce]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const isInboxActive = activeTab === ("inbox" as unknown as T);

  // Smooth, non-bouncy transition easing
  const smoothTransition = {
    type: "tween" as const,
    ease: [0.25, 1, 0.5, 1], // Smooth cubic-bezier
    duration: 0.26,
  };

  return (
    <motion.aside
      layout
      transition={smoothTransition}
      aria-label="Mobile navigation bar"
      className={`fixed bottom-5 inset-x-0 mx-auto w-full max-w-[360px] px-4 z-50 flex items-center pointer-events-none select-none box-border ${
        isRetracted ? "justify-between" : "justify-center gap-2.5"
      }`}
    >
      {/* Left Navigation Capsule / Retracted Pill */}
      <motion.nav
        aria-label="Primary navigation"
        layout
        initial={false}
        animate={{
          width: isRetracted ? 54 : isInboxActive ? 210 : 268,
        }}
        transition={smoothTransition}
        onClick={() => {
          if (isRetracted) {
            setIsRetracted(false);
          }
        }}
        className={`liquid-glass pointer-events-auto relative flex h-[54px] items-center rounded-full backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] overflow-hidden border border-black/15 transition-all duration-200 ${
          isRetracted
            ? "cursor-pointer justify-center p-0 flex-none"
            : "px-1.5 justify-between flex-1 min-w-0"
        }`}
        style={{
          backgroundColor: "rgb(39 117 202 / 20%)",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
        }}
      >
        <LiquidGlassEffect />

        {/* Stable Tabs List without DOM unmounting */}
        <div className="flex w-full items-center justify-between gap-1 overflow-hidden">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const IconComponent = tab.icon;

            // When retracted, hide all inactive tabs smoothly
            if (isRetracted && !isActive) {
              return null;
            }

            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={isActive}
                aria-current={isActive ? "page" : undefined}
                aria-label={tab.label}
                onClick={(e) => {
                  if (isRetracted) {
                    e.stopPropagation();
                    setIsRetracted(false);
                  } else {
                    onSelectTab(tab.id);
                  }
                }}
                className={`relative h-10 flex items-center justify-center rounded-full transition-all duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2775CA] ${
                  isActive
                    ? isRetracted
                      ? "h-11 w-11 bg-[#353935] text-[#FFFFF0] shadow-sm mx-auto"
                      : "bg-[#353935] text-[#FFFFF0] shadow-sm px-2.5 gap-1.5 flex-1 min-w-[70px] max-w-[88px]"
                    : "bg-transparent text-black/65 hover:bg-black/5 hover:text-black w-9 shrink-0"
                }`}
              >
                <IconComponent
                  className={`h-5 w-5 shrink-0 transition-colors duration-200 ${
                    isActive ? "text-[#FFFFF0]" : "text-black/65"
                  }`}
                />
                {/* Label strictly on the RIGHT SIDE of the icon in expanded state */}
                {isActive && !isRetracted && (
                  <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-wider text-[#FFFFF0] truncate">
                    {tab.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </motion.nav>

      {/* Right Edge: Detached Round DMs Action Button */}
      <motion.div
        layout
        transition={smoothTransition}
        className="pointer-events-auto relative shrink-0"
      >
        <button
          type="button"
          onClick={() => {
            setIsRetracted(false);
            onSelectTab("inbox" as unknown as T);
          }}
          className={`relative h-[54px] flex items-center justify-center rounded-full border border-black/15 transition-all duration-200 shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] active:scale-95 overflow-hidden ${
            isInboxActive && !isRetracted
              ? "bg-[#353935] text-[#FFFFF0] w-[90px] px-3 gap-1.5"
              : isInboxActive
              ? "bg-[#353935] text-[#FFFFF0] w-[54px]"
              : "bg-[#2775CA]/20 text-black/70 hover:text-black w-[54px]"
          }`}
          style={{
            backgroundColor: isInboxActive ? undefined : "rgb(39 117 202 / 20%)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
          }}
          aria-label="Open DMs"
        >
          <LiquidGlassEffect />
          <MessageSquare className="h-5 w-5 shrink-0 relative z-10" />
          {isInboxActive && !isRetracted && (
            <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-wider text-[#FFFFF0] truncate relative z-10">
              DMs
            </span>
          )}
        </button>
        {/* Unread Message Badge */}
        {pendingDmCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 z-20 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-[#060608] bg-red-500 px-1 text-[10px] font-black leading-none text-white shadow-md">
            {pendingDmCount > 9 ? "9+" : pendingDmCount}
          </span>
        )}
      </motion.div>
    </motion.aside>
  );
}




