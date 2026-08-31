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

// Minimum scroll distance (px) before we commit to a direction change.
// Prevents flicker when the user jiggles their thumb at the turn-around point.
const DIRECTION_THRESHOLD = 18;
// After committing to a direction, ignore the opposite direction for this many ms.
const DIRECTION_COOLDOWN_MS = 180;

export default function MobileFloatingNav<T extends string = string>({
  tabs,
  activeTab,
  onSelectTab,
  pendingDmCount = 0,
  scrollContainerSelector = ".user-dashboard-content, .user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);

  // Direction tracking refs — never accessed during render
  const anchorY = useRef(0);           // Y position when we last committed a direction
  const lastDirection = useRef<"up" | "down" | null>(null);
  const cooldownUntil = useRef(0);     // Timestamp: ignore opposite direction until this time

  // Always expand whenever user changes tabs
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  const processScroll = useCallback((currentY: number) => {
    const now = Date.now();

    // Near the top of the page — always expand, reset tracking
    if (currentY <= 20) {
      setIsRetracted(false);
      anchorY.current = currentY;
      lastDirection.current = null;
      return;
    }

    const delta = currentY - anchorY.current;

    // Determine candidate direction
    let candidateDir: "up" | "down" | null = null;
    if (delta > DIRECTION_THRESHOLD) {
      candidateDir = "down";
    } else if (delta < -DIRECTION_THRESHOLD) {
      candidateDir = "up";
    }

    if (!candidateDir) return; // Haven't moved enough yet — do nothing

    // If this is the same direction we're already committed to, just slide the anchor
    if (candidateDir === lastDirection.current) {
      anchorY.current = currentY;
      return;
    }

    // Opposite direction — only commit if the cooldown has expired
    if (now < cooldownUntil.current) {
      return; // Still cooling down — ignore this reversal
    }

    // Commit to the new direction
    lastDirection.current = candidateDir;
    anchorY.current = currentY;
    cooldownUntil.current = now + DIRECTION_COOLDOWN_MS;

    if (candidateDir === "down" && currentY > 30) {
      setIsRetracted(true);
    } else if (candidateDir === "up") {
      setIsRetracted(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let ticking = false;

    const getActiveScrollY = () => {
      const selectors = scrollContainerSelector.split(",").map((s) => s.trim());
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.scrollTop > 0) return el.scrollTop;
      }
      return (
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
      );
    };

    const handleScroll = (e?: Event) => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        let y = 0;
        if (e?.target && "scrollTop" in (e.target as HTMLElement)) {
          const t = e.target as HTMLElement;
          y = t.scrollTop > 0 ? t.scrollTop : getActiveScrollY();
        } else {
          y = getActiveScrollY();
        }
        processScroll(y);
        ticking = false;
      });
    };

    // Capture phase catches scroll from any nested overflow container
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
      document.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [processScroll, scrollContainerSelector]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabItem?.icon;
  const isInboxActive = activeTab === ("inbox" as unknown as T);

  // Smooth, non-bouncy transition
  const smoothTransition = {
    type: "tween" as const,
    ease: [0.25, 1, 0.5, 1],
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
      {/* ── Left Navigation Capsule / Retracted Pill ── */}
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
          if (isRetracted) setIsRetracted(false);
        }}
        className={`liquid-glass pointer-events-auto relative flex items-center rounded-full backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] overflow-hidden border border-black/15 transition-all duration-200 ${
          isRetracted
            ? "h-12 w-12 cursor-pointer justify-center p-0 flex-none"
            : "px-3 py-[1.1rem] min-h-[79px] justify-between flex-1 min-w-0"
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
                    className={`relative h-11 flex items-center justify-center rounded-full transition-all duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2775CA] ${
                      isActive
                        ? "bg-[#353935] text-[#FFFFF0] shadow-sm px-3 gap-1.5 flex-1 min-w-[76px] max-w-[94px]"
                        : "bg-transparent text-black/65 hover:bg-black/5 hover:text-black w-10 shrink-0"
                    }`}
                  >
                    <IconComponent
                      className={`h-5 w-5 shrink-0 transition-colors duration-200 ${
                        isActive ? "text-[#FFFFF0]" : "text-black/65"
                      }`}
                    />
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

      {/* ── Right Edge: Detached DMs Button ── */}
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
          className={`relative flex items-center justify-center rounded-full border border-black/15 transition-all duration-200 shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] active:scale-95 overflow-hidden ${
            isRetracted
              ? "h-12 w-12"
              : isInboxActive
              ? "h-[79px] w-[88px] bg-[#353935] text-[#FFFFF0] px-2.5 gap-1.5"
              : "h-[52px] w-[52px] bg-[#2775CA]/20 text-black/70 hover:text-black"
          }`}
          style={{
            backgroundColor: isInboxActive && !isRetracted ? undefined : "rgb(39 117 202 / 20%)",
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
