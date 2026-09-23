"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "@/components/icons";

interface MerchantDisplayNameModalProps {
  open: boolean;
  defaultName: string;
  onSaved: (name: string) => void;
  onClose: () => void;
}

/* One-time onboarding for a self-serve merchant's display name.
 *
 * Pre-filled with the default derived from the merchant's email (claude@gmail.com -> "Claude"). The
 * merchant keeps or edits it once, then it locks — only SubScript Support can change it afterwards.
 * Rendered only while the merchant's display name is still unlocked (display_name_locked = false). */
export default function MerchantDisplayNameModal({
  open,
  defaultName,
  onSaved,
  onClose,
}: MerchantDisplayNameModalProps) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
    }
  }, [open, defaultName]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name to continue.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't save your name. Try again.");
      onSaved(json.displayName || trimmed);
    } catch (err: any) {
      setError(err.message || "Couldn't save your name. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="merchant-name-title"
            className="relative w-full max-w-sm space-y-4 overflow-hidden rounded-3xl border border-[#00d2b4]/30 bg-[#FFFFF0] p-6 text-left text-black shadow-2xl"
          >
            <h3
              id="merchant-name-title"
              className="text-sm font-black uppercase tracking-wider text-[#111827]"
            >
              Your merchant name
            </h3>
            <p className="text-xs leading-relaxed text-black/70">
              This is the name customers see on your checkout pages and receipts. Keep the suggestion
              below or change it now. You can set it only once. After that, only SubScript Support can
              change it for you.
            </p>

            <div className="space-y-1.5">
              <label
                htmlFor="merchant-name-input"
                className="block text-[10px] font-black uppercase tracking-wider text-black/60"
              >
                Display name
              </label>
              <input
                id="merchant-name-input"
                type="text"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-sm font-bold text-[#111827] shadow-sm focus:border-[#00d2b4] focus:outline-none"
              />
            </div>

            {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 rounded-2xl border border-black/15 bg-white py-2.5 text-xs font-bold uppercase tracking-wider text-black shadow-sm transition-all hover:bg-black/5 disabled:opacity-50"
              >
                Decide later
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !name.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#00d2b4] py-2.5 text-xs font-black uppercase tracking-wider text-[#062b26] shadow-sm transition-all hover:brightness-110 disabled:opacity-40"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save name
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
