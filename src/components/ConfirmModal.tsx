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
    iconColor: "text-red-600",
    confirmBg: "bg-red-600 hover:bg-red-700",
    confirmText: "text-white",
  },
  warning: {
    icon: AlertTriangle,
    borderColor: "border-amber-500/30",
    bgAccent: "bg-amber-500/10",
    iconColor: "text-amber-600",
    confirmBg: "bg-amber-600 hover:bg-amber-700",
    confirmText: "text-white",
  },
  default: {
    icon: AlertCircle,
    borderColor: "border-[#2775CA]/30",
    bgAccent: "bg-[#2775CA]/10",
    iconColor: "text-[#2775CA]",
    confirmBg: "bg-[#2775CA] hover:bg-[#1f62ab]",
    confirmText: "text-white",
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-desc"
            className={`relative w-full max-w-sm space-y-4 overflow-hidden rounded-3xl border bg-[#FFFFF0] p-6 text-left shadow-2xl text-black ${config.borderColor}`}
          >
            <div className="flex items-center gap-3">
              <div className={`rounded-2xl border p-2.5 ${config.bgAccent} ${config.borderColor}`}>
                <Icon className={`h-5 w-5 ${config.iconColor}`} />
              </div>
              <h3 id="confirm-modal-title" className="text-sm font-black uppercase tracking-wider text-[#111827]">
                {title}
              </h3>
            </div>
            <p id="confirm-modal-desc" className="text-xs leading-relaxed text-black/70 font-sans">
              {description}
            </p>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="flex-1 rounded-2xl border border-black/15 bg-white py-2.5 text-xs font-bold uppercase tracking-wider text-black transition-all hover:bg-black/5 disabled:opacity-50 shadow-sm"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isLoading}
                className={`flex-1 rounded-2xl py-2.5 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm ${config.confirmBg} ${config.confirmText}`}
              >
                {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
