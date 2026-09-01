"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Fluid 120fps ProMotion Curves & Hysteresis Tuning
 * Subtle, magnificent motion that remains silky-smooth even on rapid scrolls.
 * ───────────────────────────────────────────────────────────────────────────── */
const SCROLL_DOWN_DELTA_THRESHOLD = 14; // Requires 14px of intentional down-scroll to retract
const SCROLL_UP_DELTA_THRESHOLD = 8;   // Requires 8px of intentional up-scroll to expand
const TOP_DEADZONE_PX = 16;            // Keep locked expanded at the very top of page

// Sleek compact dimensions (+5% height increase from 48px to 50px)
const CAPSULE_HEIGHT = 50;
const CAPSULE_RETRACTED_SIZE = 50;

export default function MobileFloatingNav<T extends string = string>({
  tabs,
  activeTab,
  onSelectTab,
  pendingDmCount = 0,
  scrollContainerSelector = ".user-dashboard-content, .user-dashboard-redesign",
}: MobileFloatingNavProps<T>) {
  const [isRetracted, setIsRetracted] = useState(false);

  // Mutable tracking refs — isolated from React render cycle for zero-jitter 120fps performance
  const trackingRef = useRef({
    lastScrollY: 0,
    accumulatedDelta: 0,
    touchStartY: 0,
    isTouchActive: false,
    rafScheduled: false,
    lastToggleTime: 0,
    scrollContainerEl: null as HTMLElement | null,
  });

  // Always expand gracefully whenever user switches active tab
  useEffect(() => {
    setIsRetracted(false);
  }, [activeTab]);

  const updateRetractionState = useCallback((shouldRetract: boolean) => {
    const now = Date.now();
    // 80ms minimum commitment prevents strobe effects during frantic opposite-direction flicks
    if (now - trackingRef.current.lastToggleTime < 80) return;

    setIsRetracted((prev) => {
      if (prev !== shouldRetract) {
        trackingRef.current.lastToggleTime = now;
        return shouldRetract;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const t = trackingRef.current;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let pollCount = 0;

    const findContainer = (): HTMLElement | null => {
      const selectors = scrollContainerSelector.split(",").map((s) => s.trim());
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) return el;
      }
      return null;
    };

    // ── High-performance Scroll Handler with Inertia Filtering ──
    const handleScrollEvent = (targetEl?: HTMLElement | Window) => {
      if (t.rafScheduled) return;
      t.rafScheduled = true;

      requestAnimationFrame(() => {
        t.rafScheduled = false;
        const currentY =
          targetEl && "scrollTop" in targetEl
            ? targetEl.scrollTop
            : window.scrollY || document.documentElement.scrollTop || 0;

        const delta = currentY - t.lastScrollY;
        t.lastScrollY = currentY;

        // Force expanded at the top deadzone
        if (currentY <= TOP_DEADZONE_PX) {
          t.accumulatedDelta = 0;
          updateRetractionState(false);
          return;
        }

        // Directional delta accumulation with smooth hysteresis
        if ((delta > 0 && t.accumulatedDelta >= 0) || (delta < 0 && t.accumulatedDelta <= 0)) {
          t.accumulatedDelta += delta;
        } else {
          t.accumulatedDelta = delta; // Re-anchor on direction reversal
        }

        // Downward intentional scroll -> retract
        if (t.accumulatedDelta > SCROLL_DOWN_DELTA_THRESHOLD) {
          updateRetractionState(true);
          t.accumulatedDelta = 0;
        }
        // Upward intentional scroll -> expand
        else if (t.accumulatedDelta < -SCROLL_UP_DELTA_THRESHOLD) {
          updateRetractionState(false);
          t.accumulatedDelta = 0;
        }
      });
    };

    // ── Direct Touch Gesture Tracking for Instant Response on Mobile ──
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0) {
        t.touchStartY = e.touches[0].clientY;
        t.isTouchActive = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!t.isTouchActive || !e.touches || e.touches.length === 0) return;
      const currentTouchY = e.touches[0].clientY;
      const deltaTouchY = currentTouchY - t.touchStartY;

      // Swiping UP on screen (scrolling content DOWN) -> smooth retraction
      if (deltaTouchY < -14) {
        updateRetractionState(true);
        t.touchStartY = currentTouchY;
      }
      // Swiping DOWN on screen (scrolling content UP) -> smooth expansion
      else if (deltaTouchY > 10) {
        updateRetractionState(false);
        t.touchStartY = currentTouchY;
      }
    };

    const handleTouchEnd = () => {
      t.isTouchActive = false;
    };

    // ── Trackpad Wheel Gesture Support ──
    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 5) return;
      if (e.deltaY > 10) {
        updateRetractionState(true);
      } else if (e.deltaY < -8) {
        updateRetractionState(false);
      }
    };

    const attachListeners = (container: HTMLElement | null) => {
      if (container) {
        t.scrollContainerEl = container;
        t.lastScrollY = container.scrollTop;
        container.addEventListener("scroll", () => handleScrollEvent(container), { passive: true });
      }

      window.addEventListener("scroll", () => handleScrollEvent(window), { passive: true });
      window.addEventListener("touchstart", handleTouchStart, { passive: true });
      window.addEventListener("touchmove", handleTouchMove, { passive: true });
      window.addEventListener("touchend", handleTouchEnd, { passive: true });
      window.addEventListener("wheel", handleWheel, { passive: true });
    };

    const container = findContainer();
    if (container) {
      attachListeners(container);
    } else {
      attachListeners(null);
      pollInterval = setInterval(() => {
        pollCount++;
        const found = findContainer();
        if (found) {
          t.scrollContainerEl = found;
          t.lastScrollY = found.scrollTop;
          found.addEventListener("scroll", () => handleScrollEvent(found), { passive: true });
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        } else if (pollCount >= 15 && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }, 250);
    }

    return () => {
      if (t.scrollContainerEl) {
        t.scrollContainerEl.removeEventListener("scroll", () => handleScrollEvent(t.scrollContainerEl!));
      }
      window.removeEventListener("scroll", () => handleScrollEvent(window));
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("wheel", handleWheel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [scrollContainerSelector, updateRetractionState]);

  const activeTabItem = tabs.find((t) => t.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabItem?.icon;
  const isInboxActive = activeTab === ("inbox" as unknown as T);
  const targetExpandedWidth = isInboxActive ? 216 : 272;

  /* ─────────────────────────────────────────────────────────────────────────
   * 120fps ProMotion Deceleration Curve:
   * Cubic bezier (0.22, 1, 0.36, 1) over 500ms creates a regal, buttery glide
   * ───────────────────────────────────────────────────────────────────────── */
  const motionBezier = "cubic-bezier(0.22, 1, 0.36, 1)";
  const capsuleTransition = `width 500ms ${motionBezier}, height 500ms ${motionBezier}, max-width 500ms ${motionBezier}, min-height 500ms ${motionBezier}, transform 500ms ${motionBezier}, border-radius 500ms ${motionBezier}, background 350ms ease, box-shadow 500ms ${motionBezier}`;

  // When retracted, identify which pill is the active selection
  const isLeftSelected = !isInboxActive;
  const isRightSelected = isInboxActive;

  return (
    <aside
      aria-label="Mobile navigation bar"
      className={`fixed bottom-4 inset-x-0 mx-auto w-full max-w-sm px-4 z-50 flex items-center box-border pointer-events-none ${
        isRetracted ? "justify-between" : "justify-center gap-2"
      }`}
      style={{
        transform: "translate3d(0, 0, 0)",
        WebkitBackfaceVisibility: "hidden",
        transition: `padding 500ms ${motionBezier}`,
      }}
    >
      {/* ── Left Navigation Capsule (Shrinks to active tab icon circle on scroll down) ── */}
      <nav
        aria-label="Primary navigation"
        data-retracted-selected={isRetracted && isLeftSelected ? "true" : undefined}
        data-retracted={isRetracted ? "true" : "false"}
        onClick={() => {
          if (isRetracted) updateRetractionState(false);
        }}
        className={`pointer-events-auto relative flex items-center justify-center rounded-full backdrop-blur-2xl shadow-[0_12px_40px_0_rgba(0,0,0,0.24)] overflow-hidden border select-none ${
          isRetracted
            ? isLeftSelected
              ? "bg-[#353935] dark:bg-[#2775CA] text-[#FFFFF0] dark:text-white border-black/20 dark:border-white/20 shadow-[0_12px_36px_rgba(0,0,0,0.35)] cursor-pointer active:scale-95"
              : "bg-white/90 dark:bg-white/10 text-black dark:text-white/80 border-black/15 dark:border-white/15 cursor-pointer active:scale-95"
            : "border-black/15 dark:border-white/15 text-black/90 dark:text-white"
        }`}
        style={{
          transition: capsuleTransition,
          willChange: "width, height, max-width, min-height, transform",
          transform: "translate3d(0, 0, 0)",
          WebkitBackfaceVisibility: "hidden",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          width: isRetracted ? CAPSULE_RETRACTED_SIZE : targetExpandedWidth,
          height: CAPSULE_HEIGHT,
          minHeight: CAPSULE_HEIGHT,
          maxHeight: CAPSULE_HEIGHT,
          maxWidth: isRetracted ? CAPSULE_RETRACTED_SIZE : targetExpandedWidth,
          boxSizing: "border-box",
        }}
      >
        {!isRetracted && <LiquidGlassEffect />}

        {/* ── Retracted Mode: Centered Active Tab Icon ── */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-350 ease-out ${
            isRetracted
              ? "opacity-100 scale-100 pointer-events-auto"
              : "opacity-0 scale-75 pointer-events-none"
          }`}
          style={{
            transitionTimingFunction: motionBezier,
            transitionDuration: "450ms",
          }}
        >
          <button
            type="button"
            aria-label={`Current: ${activeTabItem.label}. Tap to expand navigation`}
            aria-current={isLeftSelected ? "page" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              updateRetractionState(false);
            }}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90 ${
              isLeftSelected ? "text-[#FFFFF0] dark:text-white" : "text-black dark:text-white/80"
            }`}
          >
            {ActiveIcon && (
              <ActiveIcon
                className={`h-4.5 w-4.5 ${
                  isLeftSelected
                    ? "!text-[#FFFFF0] !bg-[#FFFFF0] dark:!text-white dark:!bg-white"
                    : "!text-black !bg-black dark:!text-white/80 dark:!bg-white/80"
                }`}
              />
            )}
          </button>
        </div>

        {/* ── Expanded Mode: Stable Fixed-Width Canvas (Prevents Text Squashing / Layout Stutter) ── */}
        <div
          className={`relative h-full flex items-center justify-between px-1 transition-all ease-out ${
            isRetracted
              ? "opacity-0 scale-95 pointer-events-none"
              : "opacity-100 scale-100 pointer-events-auto"
          }`}
          style={{
            width: targetExpandedWidth,
            minWidth: targetExpandedWidth,
            transitionTimingFunction: motionBezier,
            transitionDuration: "380ms",
            transform: "translate3d(0, 0, 0)",
            WebkitBackfaceVisibility: "hidden",
          }}
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
                className={`relative h-8.5 flex items-center justify-center rounded-full transition-all duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#353935] dark:focus-visible:ring-[#2775CA] ${
                  isActive
                    ? "shadow-sm px-2.5 gap-1.5 flex-1 min-w-[72px] max-w-[90px]"
                    : "bg-transparent text-black dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white w-9 shrink-0"
                }`}
              >
                <IconComponent
                  className={`h-4.5 w-4.5 shrink-0 transition-colors duration-250 ${
                    isActive
                      ? "!text-[#FFFFF0] !bg-[#FFFFF0] dark:!text-white dark:!bg-white"
                      : "!text-black !bg-black dark:!text-white/70 dark:!bg-white/70"
                  }`}
                />
                {isActive && (
                  <span className="whitespace-nowrap text-[8.5px] font-black uppercase tracking-wider text-[#FFFFF0] dark:text-white truncate">
                    {tab.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Right Edge: Action Button (DMs) ── */}
      <div
        className="pointer-events-auto relative shrink-0 flex items-center"
        style={{
          transform: "translate3d(0, 0, 0)",
          WebkitBackfaceVisibility: "hidden",
          height: CAPSULE_HEIGHT,
        }}
      >
        <button
          type="button"
          data-testid="mobile-dm-btn"
          data-retracted-selected={isRetracted && isRightSelected ? "true" : undefined}
          aria-current={isInboxActive ? "page" : undefined}
          onClick={() => {
            updateRetractionState(false);
            onSelectTab("inbox" as unknown as T);
          }}
          className={`relative flex items-center justify-center rounded-full border shadow-[0_12px_40px_0_rgba(0,0,0,0.24)] active:scale-90 overflow-hidden transition-all duration-350 box-border ${
            isInboxActive
              ? "bg-[#353935] dark:bg-[#2775CA] text-[#FFFFF0] dark:text-white border-black/20 dark:border-white/20 shadow-[0_12px_36px_rgba(0,0,0,0.35)]"
              : "bg-white/90 dark:bg-white/10 text-black dark:text-white/80 border-black/15 dark:border-white/15 hover:text-black dark:hover:text-white"
          } ${isInboxActive && !isRetracted ? "px-2.5 gap-1.5" : ""}`}
          style={{
            transition: capsuleTransition,
            willChange: "width, height, border-radius, transform",
            transform: "translate3d(0, 0, 0)",
            WebkitBackfaceVisibility: "hidden",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            width: isRetracted ? CAPSULE_RETRACTED_SIZE : isInboxActive ? 82 : CAPSULE_RETRACTED_SIZE,
            height: CAPSULE_HEIGHT,
            minHeight: CAPSULE_HEIGHT,
            maxHeight: CAPSULE_HEIGHT,
            boxSizing: "border-box",
          }}
          aria-label="Open Direct Messages"
        >
          {!isInboxActive && <LiquidGlassEffect />}
          <MessageSquare
            className={`h-4.5 w-4.5 shrink-0 relative z-10 ${
              isInboxActive
                ? "!text-[#FFFFF0] !bg-[#FFFFF0] dark:!text-white dark:!bg-white"
                : "!text-black !bg-black dark:!text-white/80 dark:!bg-white/80"
            }`}
          />
          {isInboxActive && !isRetracted && (
            <span className="whitespace-nowrap text-[8.5px] font-black uppercase tracking-wider text-[#FFFFF0] dark:text-white truncate relative z-10">
              DMs
            </span>
          )}
        </button>
        {pendingDmCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 z-20 flex h-4.5 min-w-[1.15rem] items-center justify-center rounded-full border-2 border-[#060608] bg-red-500 px-1 text-[9px] font-black leading-none text-white shadow-md">
            {pendingDmCount > 9 ? "9+" : pendingDmCount}
          </span>
        )}
      </div>
    </aside>
  );
}
