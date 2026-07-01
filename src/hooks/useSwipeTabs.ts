"use client";

import { useRef } from "react";

type SwipeOptions = {
    /* Turn the gesture off (e.g. while a modal owns the screen). */
    enabled?: boolean;
    /* Minimum horizontal travel (px) before a swipe fires. */
    threshold?: number;
};

/* Decide whether to ignore a gesture based on where it started. We bail when the pointer begins:
   - inside a horizontally scrollable element (a table, carousel) — the user means to scroll THAT;
   - on a form field or slider — a horizontal drag there is text selection / value adjustment. */
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

/* Low-level horizontal-swipe detector built on Pointer Events, so it works for touch, mouse and
   pen alike (a finger swipe on mobile, a click-drag on desktop). We fire as soon as the pointer
   crosses the horizontal threshold — rather than waiting for pointerup — because a fast touch drag
   can end in `pointercancel` (the browser claiming the gesture for scroll), which the old
   touchend-delta approach missed entirely. `touch-action: pan-y` lets the page still scroll
   vertically while reserving horizontal drags for us. */
export function useHorizontalSwipe(
    onSwipe: (direction: "left" | "right") => void,
    options: SwipeOptions = {},
) {
    const { enabled = true, threshold = 55 } = options;
    const origin = useRef<
        { x: number; y: number; guard: boolean; fired: boolean; pointerId: number } | null
    >(null);

    const reset = () => {
        origin.current = null;
    };

    return {
        style: { touchAction: "pan-y" as const },
        onPointerDown: (event: React.PointerEvent) => {
            if (!enabled) {
                origin.current = null;
                return;
            }
            origin.current = {
                x: event.clientX,
                y: event.clientY,
                guard: shouldIgnoreSwipeStart(event.target),
                fired: false,
                pointerId: event.pointerId,
            };
            /* Keep receiving move events even if a fast swipe leaves the element's bounds. */
            try {
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            } catch {
                /* Some elements/pointers can't be captured — non-fatal, we still get in-bounds moves. */
            }
        },
        onPointerMove: (event: React.PointerEvent) => {
            const start = origin.current;
            if (!start || start.fired || start.guard || event.pointerId !== start.pointerId) return;
            /* Pointer left the surface / button released without us seeing pointerup. */
            if (event.buttons === 0 && event.pointerType !== "touch") {
                reset();
                return;
            }
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            /* Horizontal-dominant and far enough — a mostly-vertical drag is a scroll, leave it be. */
            if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy)) {
                start.fired = true;
                onSwipe(dx < 0 ? "left" : "right");
            }
        },
        onPointerUp: reset,
        onPointerCancel: reset,
    };
}

/* Swipe between an ordered set of sub-tabs. Swiping left advances to the next tab, right goes
   back; clamped at the ends (no wrap). Spread the returned props onto the sub-section container.
   Tap targets keep working — this is purely additive. */
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
