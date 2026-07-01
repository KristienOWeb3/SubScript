"use client";

import { useRef } from "react";

type SwipeOptions = {
    /* Turn the gesture off (e.g. desktop, or while a modal owns the screen). */
    enabled?: boolean;
    /* Minimum horizontal travel (px) before a swipe counts. */
    threshold?: number;
    /* Maximum vertical travel (px) allowed — keeps a mostly-vertical scroll from switching tabs. */
    restraint?: number;
};

/* Decide whether to ignore a gesture based on where it started. We bail when the touch begins:
   - inside a horizontally scrollable element (a table, carousel) — the user means to scroll THAT;
   - on a form field or slider — a horizontal drag there is text selection / value adjustment, not
     a tab switch. */
function shouldIgnoreSwipeStart(target: EventTarget | null): boolean {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
        const tag = el.tagName;
        if (
            tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
            el.isContentEditable || el.getAttribute("role") === "slider"
        ) {
            return true;
        }
        const overflowX = window.getComputedStyle(el).overflowX;
        if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
            return true;
        }
        el = el.parentElement;
    }
    return false;
}

/* Low-level horizontal-swipe detector. Returns touch handlers to spread onto a container.
   Touch-only by nature, so it never fires for mouse users on desktop. */
export function useHorizontalSwipe(
    onSwipe: (direction: "left" | "right") => void,
    options: SwipeOptions = {},
) {
    const { enabled = true, threshold = 60, restraint = 50 } = options;
    const origin = useRef<{ x: number; y: number; guard: boolean } | null>(null);

    return {
        onTouchStart: (event: React.TouchEvent) => {
            if (!enabled || event.touches.length !== 1) {
                origin.current = null;
                return;
            }
            const touch = event.touches[0];
            origin.current = {
                x: touch.clientX,
                y: touch.clientY,
                guard: shouldIgnoreSwipeStart(event.target),
            };
        },
        onTouchEnd: (event: React.TouchEvent) => {
            const start = origin.current;
            origin.current = null;
            if (!enabled || !start || start.guard) return;
            const touch = event.changedTouches[0];
            if (!touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            /* Horizontal-dominant, far enough, and not a diagonal scroll. */
            if (Math.abs(dx) >= threshold && Math.abs(dy) <= restraint && Math.abs(dx) > Math.abs(dy)) {
                onSwipe(dx < 0 ? "left" : "right");
            }
        },
    };
}

/* Swipe between an ordered set of sub-tabs. Swiping left advances to the next tab, right goes
   back; clamped at the ends (no wrap). Spread the returned handlers onto the sub-section
   container. Tap targets keep working — this is purely additive. */
export function useSwipeTabs<T extends string>(
    tabs: readonly T[],
    current: T,
    onChange: (next: T) => void,
    options: SwipeOptions = {},
) {
    return useHorizontalSwipe((direction) => {
        const index = tabs.indexOf(current);
        if (index < 0) return;
        const nextIndex = direction === "left" ? index + 1 : index - 1;
        if (nextIndex < 0 || nextIndex >= tabs.length) return;
        onChange(tabs[nextIndex]);
    }, options);
}
