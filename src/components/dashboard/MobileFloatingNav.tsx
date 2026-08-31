"use client";

import { useEffect, useState, useRef } from "react";
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

/* ────────────────────────────────────────────────────
 * Tuning constants — subtle, 120fps-friendly triggers.
 * ──────────────────────────────────────────────────── */
const RETRACT_THRESHOLD = 120;  // requires 120px of deliberate down-scroll before retracting
const EXPAND_THRESHOLD  = 25;   // light 25px up-scroll immediately expands
const COOLDOWN_MS       = 450;  // ignore opposite direction after committing
const RETRACT_DELAY_MS  = 120;  // slight debounce to verify scroll intent
const TOP_DEADZONE_PX   = 80;   // top 80px of page is deadzone: NEVER retracts near top

export default function MobileFloatingNav<T extends string = string>({
  tabs,
  activeTab,
  onSelectTab,
  pendingDmCount = 0,
  scrollContainerSelector = ".user-dashboard-content, .user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);

  // Mutable tracking — only touched inside scroll handler, never during render
  const scrollState = useRef({
    lastY: 0,
    accum: 0,
    lastCommit: 0,
    retractTimer: null as ReturnType<typeof setTimeout> | null,
  });

  // Always expand whenever user changes tabs
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const s = scrollState.current;
    let scrollEl: HTMLElement | null = null;
    let rafId = 0;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollCount = 0;

    const findContainer = (): HTMLElement | null => {
      const sels = scrollContainerSelector.split(",").map((v) => v.trim());
      for (const sel of sels) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) return el;
      }
      return null;
    };

    const cancelRetract = () => {
      if (s.retractTimer) {
        clearTimeout(s.retractTimer);
        s.retractTimer = null;
      }
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!scrollEl) return;

        const y = scrollEl.scrollTop;
        const delta = y - s.lastY;
        s.lastY = y;

        // Top deadzone — always keep expanded and clear timers
        if (y <= TOP_DEADZONE_PX) {
          cancelRetract();
          setIsRetracted(false);
          s.accum = 0;
          return;
        }

        // Ignore micro-scrolls (< 3px)
        if (Math.abs(delta) < 3) return;

        // Accumulate directional scroll delta
        if ((delta > 0 && s.accum >= 0) || (delta < 0 && s.accum <= 0)) {
          s.accum += delta;
        } else {
          s.accum = delta;
          cancelRetract();
        }

        const now = Date.now();
        if (now - s.lastCommit < COOLDOWN_MS) return;

        // Scrolling DOWN past threshold (120px) → queue retraction
        if (s.accum > RETRACT_THRESHOLD && !s.retractTimer) {
          s.retractTimer = setTimeout(() => {
            s.retractTimer = null;
            setIsRetracted(true);
            s.lastCommit = Date.now();
            s.accum = 0;
          }, RETRACT_DELAY_MS);
        }
        // Scrolling UP past threshold (25px) → expand immediately
        else if (s.accum < -EXPAND_THRESHOLD) {
          cancelRetract();
          setIsRetracted(false);
          s.lastCommit = now;
          s.accum = 0;
        }
      });
    };

    const attach = (el: HTMLElement) => {
      scrollEl = el;
      s.lastY = el.scrollTop;
      s.accum = 0;
      el.addEventListener("scroll", onScroll, { passive: true });
    };

    const found = findContainer();
    if (found) {
      attach(found);
    } else {
      pollTimer = setInterval(() => {
        pollCount++;
        const el = findContainer();
        if (el) {
          attach(el);
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        } else if (pollCount >= 20 && pollTimer) {
          clearInterval(pollTimer); pollTimer = null;
        }
      }, 300);
    }

    return () => {
      if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
      if (pollTimer) clearInterval(pollTimer);
      cancelRetract();
    };
  }, [scrollContainerSelector]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabItem?.icon;
  const isInboxActive = activeTab === ("inbox" as unknown as T);

  /* High-refresh 120fps ProMotion bezier curve */
  const motionBezier = "cubic-bezier(0.16, 1, 0.3, 1)";
  const transitionStyle: React.CSSProperties = {
    transition: `width 360ms ${motionBezier}, max-width 360ms ${motionBezier}, height 360ms ${motionBezier}, transform 360ms ${motionBezier}, opacity 240ms ease`,
    willChange: "width, max-width, height, transform, opacity",
    transform: "translateZ(0)",
    WebkitTransform: "translateZ(0)",
  };

  return (
    <aside
      aria-label="Mobile navigation bar"
      className={`fixed bottom-5 inset-x-0 mx-auto w-full max-w-sm px-4 z-50 flex items-center pointer-events-none select-none box-border ${
        isRetracted ? "justify-between" : "justify-center gap-2"
      }`}
      style={{
        transition: `gap 360ms ${motionBezier}, justify-content 360ms ${motionBezier}`,
        transform: "translateZ(0)",
      }}
    >
      {/* ── Left Navigation Capsule ── */}
      <nav
        aria-label="Primary navigation"
        onClick={() => { if (isRetracted) setIsRetracted(false); }}
        className={`liquid-glass pointer-events-auto relative flex items-center rounded-full backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] overflow-hidden border border-black/15 ${
          isRetracted
            ? "h-12 w-12 cursor-pointer justify-center p-0 flex-none"
            : "px-3 py-[1.1rem] min-h-[79px] justify-between flex-1 min-w-0"
        }`}
        style={{
          ...transitionStyle,
          backgroundColor: "rgb(39 117 202 / 20%)",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          maxWidth: isRetracted ? 48 : isInboxActive ? 220 : 272,
        }}
      >
        <LiquidGlassEffect />

        {isRetracted ? (
          /* Retracted: single icon bubble */
          <button
            type="button"
            aria-label={`Current: ${activeTabItem.label}. Tap to expand navigation`}
            onClick={(e) => { e.stopPropagation(); setIsRetracted(false); }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#353935] text-[#FFFFF0] shadow-sm active:scale-95 transition-transform"
            style={{ transform: "translateZ(0)" }}
          >
            {ActiveIcon && <ActiveIcon className="h-5 w-5 text-[#FFFFF0]" />}
          </button>
        ) : (
          /* Expanded: tab buttons */
          <div className="flex w-full items-center justify-between gap-1" style={{ transform: "translateZ(0)" }}>
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
          </div>
        )}
      </nav>

      {/* ── Right Edge: Detached DMs Button ── */}
      <div className="pointer-events-auto relative shrink-0" style={{ transform: "translateZ(0)" }}>
        <button
          type="button"
          onClick={() => { setIsRetracted(false); onSelectTab("inbox" as unknown as T); }}
          className={`relative flex items-center justify-center rounded-full border border-black/15 shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] active:scale-95 overflow-hidden ${
            isRetracted
              ? "h-12 w-12"
              : isInboxActive
              ? "h-[79px] w-[88px] bg-[#353935] text-[#FFFFF0] px-2.5 gap-1.5"
              : "h-[52px] w-[52px] bg-[#2775CA]/20 text-black/70 hover:text-black"
          }`}
          style={{
            ...transitionStyle,
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
        {pendingDmCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 z-20 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-[#060608] bg-red-500 px-1 text-[10px] font-black leading-none text-white shadow-md">
            {pendingDmCount > 9 ? "9+" : pendingDmCount}
          </span>
        )}
      </div>
    </aside>
  );
}
