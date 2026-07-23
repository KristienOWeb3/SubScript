"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, AlertTriangle, XCircle, Loader2 } from "@/components/icons";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const variantConfig = {
  danger: {
    icon: XCircle,
    borderColor: "border-red-500/30",
    bgAccent: "bg-red-500/10",
    iconColor: "text-red-400",
    confirmBg: "bg-red-500 hover:bg-red-600",
    confirmText: "text-white",
    glowColor: "bg-red-500/5",
  },
  warning: {
    icon: AlertTriangle,
    borderColor: "border-amber-500/30",
    bgAccent: "bg-amber-500/10",
    iconColor: "text-amber-400",
    confirmBg: "bg-amber-500 hover:bg-amber-600",
    confirmText: "text-black",
    glowColor: "bg-amber-500/5",
  },
  default: {
    icon: AlertCircle,
    borderColor: "border-[#00d2b4]/30",
    bgAccent: "bg-[#00d2b4]/10",
    iconColor: "text-[#00d2b4]",
    confirmBg: "bg-[#00d2b4] hover:brightness-110",
    confirmText: "text-black",
    glowColor: "bg-[#00d2b4]/5",
  },
};

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
  isLoading = false,
}: ConfirmModalProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-desc"
            className={`liquid-glass relative w-full max-w-sm space-y-5 overflow-hidden rounded-3xl border bg-[#09090b] p-6 text-left shadow-2xl ${config.borderColor}`}
          >
            <div className={`absolute right-0 top-0 -z-10 h-48 w-48 rounded-full blur-3xl ${config.glowColor}`} />
            <div className="flex items-center gap-3">
              <div className={`rounded-2xl border p-2.5 ${config.bgAccent} ${config.borderColor}`}>
                <Icon className={`h-5 w-5 ${config.iconColor}`} />
              </div>
              <h3 id="confirm-modal-title" className="text-sm font-bold uppercase tracking-wider text-white">
                {title}
              </h3>
            </div>
            <p id="confirm-modal-desc" className="text-xs leading-relaxed text-white/60">
              {description}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isLoading}
                className={`flex-1 rounded-2xl py-3 text-xs font-bold uppercase tracking-wider shadow-lg transition-all disabled:opacity-50 relative overflow-hidden flex items-center justify-center gap-2 ${config.confirmBg} ${config.confirmText} ${isLoading ? "quick-action-loading" : ""}`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
                  </>
                ) : (
                  confirmLabel
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
