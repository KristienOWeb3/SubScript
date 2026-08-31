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
  scrollContainerSelector = ".user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);
  const lastScrollY = useRef(0);
  const isRetractedRef = useRef(isRetracted);
  isRetractedRef.current = isRetracted;

  // Expand whenever the active tab changes
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  const handleScrollDelta = useCallback((currentY: number) => {
    const delta = currentY - lastScrollY.current;
    
    // If user is near the top (<= 40px), always expand
    if (currentY <= 40) {
      if (isRetractedRef.current) setIsRetracted(false);
      lastScrollY.current = currentY;
      return;
    }

    // Scroll down > 20px -> Retract to edges
    if (delta > 20 && !isRetractedRef.current) {
      setIsRetracted(true);
    } 
    // Scroll up < -15px -> Expand back to full pill
    else if (delta < -15 && isRetractedRef.current) {
      setIsRetracted(false);
    }

    lastScrollY.current = currentY;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const scrollContainer = document.querySelector(scrollContainerSelector) as HTMLElement | null;

    const onWindowScroll = () => {
      handleScrollDelta(window.scrollY);
    };

    const onContainerScroll = () => {
      if (scrollContainer) {
        handleScrollDelta(scrollContainer.scrollTop);
      }
    };

    window.addEventListener("scroll", onWindowScroll, { passive: true });
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", onContainerScroll, { passive: true });
    }

    return () => {
      window.removeEventListener("scroll", onWindowScroll);
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", onContainerScroll);
      }
    };
  }, [handleScrollDelta, scrollContainerSelector]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabItem?.icon;

  return (
    <div
      className={`fixed bottom-6 z-50 transition-all duration-300 pointer-events-none ${
        isRetracted
          ? "left-4 right-4 flex items-center justify-between"
          : "left-1/2 -translate-x-1/2 w-[92%] max-w-sm flex items-center justify-between gap-3"
      }`}
    >
      {/* Left Navigation Capsule / Retracted Circle */}
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        className="pointer-events-auto shrink-0"
        style={{ width: isRetracted ? "auto" : "calc(100% - 62px)" }}
      >
        <nav
          aria-label="Primary navigation"
          className={`liquid-glass relative flex items-center rounded-full backdrop-blur-lg shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-[padding,background-color] duration-300 ${
            isRetracted
              ? "p-2.5 cursor-pointer justify-center"
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
            /* Retracted State: Compact circular bubble showing only active tab's icon */
            <motion.button
              key="retracted-active"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              type="button"
              aria-label={activeTabItem.label}
              onClick={(e) => {
                e.stopPropagation();
                setIsRetracted(false);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-black/20 bg-[#353935] text-[#FFFFF0] shadow-sm active:scale-95 transition-transform"
            >
              {ActiveIcon && <ActiveIcon className="h-5 w-5 text-[#FFFFF0]" />}
            </motion.button>
          ) : (
            /* Expanded State: Full horizontal bar with text to the RIGHT of the icon for active tab */
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
                  {/* Text on the RIGHT SIDE of the icon */}
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
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        className="pointer-events-auto relative shrink-0"
      >
        <button
          type="button"
          onClick={() => {
            setIsRetracted(false);
            onSelectTab("inbox" as unknown as T);
          }}
          className={`relative h-[3.3rem] flex items-center justify-center rounded-full border transition-all duration-300 gap-2 px-3 overflow-hidden shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${
            activeTab === ("inbox" as unknown as T)
              ? "bg-[#353935] border-[#353935] text-[#FFFFF0] scale-105 w-[108px]"
              : "bg-[#2775CA]/20 border-black/15 text-black/60 hover:text-black w-[3.3rem]"
          }`}
          style={{
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
      </motion.div>
    </div>
  );
}
