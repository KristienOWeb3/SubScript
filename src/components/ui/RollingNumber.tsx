"use client";

import { useEffect, useRef, useState } from "react";

interface RollingNumberProps {
  value: string;
  className?: string;
  id?: string;
  paused?: boolean;
}

const ease = "cubic-bezier(.16,1,.3,1)";

function makeSlot(character: string) {
  const slot = document.createElement("span");
  slot.className = "d roll-slot";
  slot.setAttribute("aria-hidden", "true");
  slot.dataset.c = character;
  const inner = document.createElement("span");
  inner.textContent = character;
  slot.append(inner);
  return slot;
}

/** Keep unchanged digits still; roll changed digits with authentic motion blur and stagger from prototype */
export default function RollingNumber({ value, className = "", id, paused = false }: RollingNumberProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const animations = useRef<Animation[]>([]);
  const [initialValue] = useState(value);
  const [displayedValue, setDisplayedValue] = useState(value);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || paused || previous.current === value) return;
    setDisplayedValue(value);

    // Polls can arrive before the stagger finishes. Settle the previous value
    // and detach its callbacks before giving the same slots another animation.
    animations.current.forEach(animation => {
      animation.onfinish = null;
      animation.cancel();
    });
    animations.current = [];
    el.replaceChildren(...Array.from(previous.current, makeSlot));
    const to = String(value);
    previous.current = to;

    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.replaceChildren(...Array.from(to, makeSlot));
      return;
    }

    const old = Array.from(el.children) as HTMLElement[];
    for (let k = 0; k < Math.max(old.length, to.length); k++) {
      const os = old[old.length - 1 - k];
      const nc = to[to.length - 1 - k];

      if (os && nc === undefined) {
        const w = os.offsetWidth;
        if (typeof os.animate === "function") {
          const anim = os.animate([
            { width: `${w}px`, opacity: 1, filter: "blur(0px)" },
            { width: "0px", opacity: 0, filter: "blur(4px)" },
          ], { duration: 440, easing: ease, fill: "forwards" });
          anim.onfinish = () => os.remove();
          animations.current.push(anim);
        } else {
          os.remove();
        }
        continue;
      }

      if (!os) {
        el.prepend(makeSlot(nc));
        continue;
      }

      if (os.dataset.c === nc) continue;

      const i = os.firstElementChild as HTMLElement | null;
      if (!i) continue;

      const n = document.createElement("span");
      n.textContent = nc;
      os.dataset.c = nc;
      os.append(n);
      i.classList.add("x", "roll-leaving");

      const h = (os.offsetHeight || 20) * 0.85;
      const dl = (to.length - 1 - k) * 45;

      if (typeof i.animate === "function") {
        const exit = i.animate([
          { transform: "none", opacity: 1, filter: "blur(0px)" },
          { transform: `translateY(${h}px)`, opacity: 0, filter: "blur(4px)" },
        ], { duration: 540, delay: dl, easing: ease, fill: "forwards" });
        exit.onfinish = () => i.remove();

        const entry = n.animate([
          { transform: `translateY(${-h}px)`, opacity: 0, filter: "blur(4px)" },
          { transform: "none", opacity: 1, filter: "blur(0px)" },
        ], { duration: 540, delay: dl, easing: ease, fill: "backwards" });

        animations.current.push(exit, entry);
      } else {
        i.remove();
      }
    }
  }, [value, paused]);

  useEffect(() => () => {
    animations.current.forEach((a) => {
      a.onfinish = null;
      a.cancel();
    });
  }, []);

  return (
    <span
      id={id}
      ref={containerRef}
      aria-label={displayedValue}
      role="img"
      className={`rs inline-block tabular-nums whitespace-pre leading-none select-all ${className}`}
    >
      {Array.from(initialValue, (c, i) => (
        <span className="d roll-slot" data-c={c} key={i} aria-hidden="true">
          <span>{c}</span>
        </span>
      ))}
    </span>
  );
}
