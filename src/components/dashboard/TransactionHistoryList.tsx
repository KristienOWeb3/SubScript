"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

type HistoryIdentity = { id: string; txHash?: string | null };

export default function TransactionHistoryList({ transactions, revealId, paused, reducedMotion, onRevealComplete, children }: {
  transactions: HistoryIdentity[];
  revealId: string | null;
  paused: boolean;
  reducedMotion: boolean;
  onRevealComplete: (id: string) => void;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const revealed = useRef(new Set<string>());
  const animations = useRef(new Map<HTMLElement, Animation>());

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || paused) return;
    const initial = seen.current === null;
    seen.current ??= new Set();
    const newIds = new Set<string>();
    for (const tx of transactions) {
      const hash = tx.txHash?.toLowerCase();
      const isNew = !initial && !seen.current.has(tx.id) && (!hash || !seen.current.has(hash));
      const isReveal = tx.id === revealId && !revealed.current.has(tx.id);
      if (isNew || isReveal) newIds.add(tx.id);
      seen.current.add(tx.id);
      if (hash) seen.current.add(hash);
    }

    for (const [row, animation] of animations.current) {
      if (!list.contains(row) || reducedMotion) {
        animation.cancel();
        animations.current.delete(row);
      }
    }

    for (const row of Array.from(list.children) as HTMLElement[]) {
      const id = row.dataset.transactionId;
      if (!id || !newIds.has(id) || animations.current.has(row)) continue;
      if (reducedMotion || typeof row.animate !== "function") {
        revealed.current.add(id);
        if (id === revealId) onRevealComplete(id);
        continue;
      }
      const height = row.offsetHeight;
      const animation = row.animate([
        { height: "0px", opacity: 0, filter: "blur(8px)" },
        { height: `${height}px`, opacity: 1, filter: "blur(0px)" },
      ], {
        duration: 780,
        delay: 200,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "backwards",
      });
      animations.current.set(row, animation);
      animation.onfinish = () => {
        animation.cancel();
        animations.current.delete(row);
        revealed.current.add(id);
        if (id === revealId) onRevealComplete(id);
      };
    }
  });

  useEffect(() => {
    const running = animations.current;
    return () => {
      running.forEach(animation => animation.cancel());
      running.clear();
    };
  }, []);

  return <div ref={listRef} className="mt-4 divide-y divide-white/[0.06]">{children}</div>;
}
