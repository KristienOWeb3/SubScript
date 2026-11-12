"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Wallet } from "@/components/icons";

interface PayoutDestinationNoticeModalProps {
  open: boolean;
  /** The address payouts go to today: the saved destination, or the merchant wallet by default. */
  destination: string;
  onChangeNow: () => void;
  onChangeLater: () => void;
}

const ACK_KEY_PREFIX = "subscript:payout-destination-notice:";

/** Whether this merchant wallet has already answered the payout notice on this device. */
export function hasSeenPayoutDestinationNotice(wallet: string | null | undefined) {
  if (!wallet) return true;
  try {
    return window.localStorage.getItem(ACK_KEY_PREFIX + wallet.toLowerCase()) === "1";
  } catch {
    return false;
  }
}

export function markPayoutDestinationNoticeSeen(wallet: string | null | undefined) {
  if (!wallet) return;
  try {
    window.localStorage.setItem(ACK_KEY_PREFIX + wallet.toLowerCase(), "1");
  } catch {
    /* Private mode or blocked storage: the notice may show again next visit, which is harmless. */
  }
}

export function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

/* Tells a merchant where their payouts go (their own wallet unless they saved another address)
 * and offers a shortcut to Settings → Profile & Branding, where the destination is edited.
 * Shown once per wallet: on first sign-in, or the first time they add a webhook endpoint. */
export default function PayoutDestinationNoticeModal({
  open,
  destination,
  onChangeNow,
  onChangeLater,
}: PayoutDestinationNoticeModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="payout-notice-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="dashboard-modal-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="payout-notice-title"
            aria-describedby="payout-notice-body"
            className="dashboard-modal-surface relative transform-gpu w-full max-w-sm space-y-4 overflow-hidden rounded-3xl border border-[#00d2b4]/30 bg-[#FFFFF0] p-6 text-left text-black shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#00d2b4]/15 text-[#082824]">
                <Wallet className="h-5 w-5" />
              </div>
              <h3 id="payout-notice-title" className="text-sm font-black text-[#111827]">
                Your payout destination
              </h3>
            </div>

            <p id="payout-notice-body" className="text-xs leading-relaxed text-black/70">
              <span className="font-mono font-bold text-[#082824]" title={destination}>
                {shortAddress(destination)}
              </span>{" "}
              is your payout destination. You can change it anytime in Settings.
            </p>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={onChangeLater}
                className="flex-1 rounded-2xl border border-black/15 bg-white py-2.5 text-xs font-bold tracking-wide text-black shadow-sm transition-all hover:bg-black/5"
              >
                Change later
              </button>
              <button
                type="button"
                onClick={onChangeNow}
                autoFocus
                className="flex-1 rounded-2xl bg-[#00d2b4] py-2.5 text-xs font-black tracking-wide text-[#062b26] shadow-sm transition-all hover:brightness-110"
              >
                Change now
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
