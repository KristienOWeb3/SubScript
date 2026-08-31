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
  scrollContainerSelector = ".user-dashboard-content, .user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);
  const lastScrollY = useRef(0);
  const isRetractedRef = useRef(isRetracted);
  isRetractedRef.current = isRetracted;
  const touchStartY = useRef(0);

  // Always expand whenever user changes tabs
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  const handleScrollDelta = useCallback((currentY: number) => {
    const delta = currentY - lastScrollY.current;

    // Expand when at or near the top
    if (currentY <= 25) {
      if (isRetractedRef.current) setIsRetracted(false);
      lastScrollY.current = currentY;
      return;
    }

    // Scroll down past top area -> Smoothly retract to edges
    if (delta > 6 && !isRetractedRef.current && currentY > 30) {
      setIsRetracted(true);
    }
    // Scroll up -> Expand back smoothly
    else if (delta < -6 && isRetractedRef.current) {
      setIsRetracted(false);
    }

    lastScrollY.current = currentY;
  }, []);

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
        const touchDelta = touchStartY.current - touchCurrentY; // > 0 means dragging up = scrolling DOWN
        const currentY = getActiveScrollY();

        if (currentY <= 20) {
          if (isRetractedRef.current) setIsRetracted(false);
        } else if (touchDelta > 6 && !isRetractedRef.current && currentY > 25) {
          setIsRetracted(true);
        } else if (touchDelta < -6 && isRetractedRef.current) {
          setIsRetracted(false);
        }
      }
    };

    // Desktop mouse wheel listener
    const onWheel = (e: WheelEvent) => {
      const currentY = getActiveScrollY();
      if (currentY <= 20) {
        if (isRetractedRef.current) setIsRetracted(false);
      } else if (e.deltaY > 6 && !isRetractedRef.current && currentY > 25) {
        setIsRetracted(true);
      } else if (e.deltaY < -6 && isRetractedRef.current) {
        setIsRetracted(false);
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
  }, [handleScrollDelta, scrollContainerSelector]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabItem?.icon;
  const isInboxActive = activeTab === ("inbox" as unknown as T);

  // Smooth, non-bouncy transition easing
  const smoothTransition = {
    type: "tween" as const,
    ease: [0.25, 1, 0.5, 1], // Smooth cubic-bezier without bouncy overshoot
    duration: 0.28,
  };

  return (
    <motion.aside
      layout
      transition={smoothTransition}
      aria-label="Mobile navigation bar"
      className={`fixed bottom-5 inset-x-0 mx-auto w-full max-w-sm px-4 z-50 flex items-center pointer-events-none select-none box-border ${
        isRetracted ? "justify-between" : "justify-center gap-2"
      }`}
    >
      {/* Left Navigation Capsule / Retracted Pill */}
      <motion.nav
        aria-label="Primary navigation"
        layout
        initial={false}
        animate={{
          width: isRetracted ? 48 : isInboxActive ? "calc(100% - 100px)" : "calc(100% - 56px)",
          maxWidth: isRetracted ? 48 : isInboxActive ? 220 : 272,
        }}
        transition={smoothTransition}
        onClick={() => {
          if (isRetracted) {
            setIsRetracted(false);
          }
        }}
        className={`liquid-glass pointer-events-auto relative flex h-12 items-center rounded-full backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] overflow-hidden border border-black/15 transition-colors duration-200 ${
          isRetracted ? "cursor-pointer justify-center p-0 flex-none" : "px-1.5 justify-between flex-1 min-w-0"
        }`}
        style={{
          backgroundColor: "rgb(39 117 202 / 20%)",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
        }}
      >
        <LiquidGlassEffect />

        <AnimatePresence mode="wait" initial={false}>
          {isRetracted ? (
            /* Retracted State: Clean circular active icon bubble on the left edge */
            <motion.button
              key="retracted-icon"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.15 }}
              type="button"
              aria-label={`Current: ${activeTabItem.label}. Tap to expand navigation`}
              onClick={(e) => {
                e.stopPropagation();
                setIsRetracted(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#353935] text-[#FFFFF0] shadow-sm active:scale-95 transition-transform"
            >
              {ActiveIcon && <ActiveIcon className="h-5 w-5 text-[#FFFFF0]" />}
            </motion.button>
          ) : (
            /* Expanded State: Horizontal tabs with active tab text on RIGHT of icon */
            <motion.div
              key="expanded-tabs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex w-full items-center justify-between gap-1"
            >
              {tabs.map((tab) => {
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
                    className={`relative h-9 flex items-center justify-center rounded-full transition-all duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2775CA] ${
                      isActive
                        ? "bg-[#353935] text-[#FFFFF0] shadow-sm px-2.5 gap-1.5 flex-1 min-w-[70px] max-w-[88px]"
                        : "bg-transparent text-black/65 hover:bg-black/5 hover:text-black w-9 shrink-0"
                    }`}
                  >
                    <IconComponent
                      className={`h-4.5 w-4.5 shrink-0 transition-colors duration-200 ${
                        isActive ? "text-[#FFFFF0]" : "text-black/65"
                      }`}
                    />
                    {/* Label strictly on the RIGHT SIDE of the icon */}
                    {isActive && (
                      <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-wider text-[#FFFFF0] truncate">
                        {tab.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* Right Edge: Detached DMs Action Button */}
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
          className={`relative h-12 flex items-center justify-center rounded-full border border-black/15 transition-all duration-200 shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] active:scale-95 overflow-hidden ${
            isInboxActive && !isRetracted
              ? "bg-[#353935] text-[#FFFFF0] w-[88px] px-2.5 gap-1.5"
              : isInboxActive
              ? "bg-[#353935] text-[#FFFFF0] w-12"
              : "bg-[#2775CA]/20 text-black/70 hover:text-black w-12"
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



