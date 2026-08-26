"use client";

const SUCCESS = new Set(["CONFIRMED", "SUCCESS", "SUCCEEDED", "PAID", "SETTLED", "COMPLETED", "APPROVED"]);
const FAILURE = new Set(["FAILED", "FAILED_PERMANENTLY", "REVERTED", "DECLINED", "EXPIRED", "DEAD_LETTER"]);
const CANCELED = new Set(["CANCELED", "CANCELLED", "REFUNDED", "VOIDED"]);
const ATTENTION = new Set(["PAST_DUE", "ACTION_REQUIRED", "NEEDS_RECONCILIATION", "PARTIALLY_COMPLETED"]);

export function financialStatusMeta(status?: string | null) {
  const normalized = (status || "PENDING").trim().toUpperCase();
  if (SUCCESS.has(normalized)) return { label: normalized === "PAID" ? "Paid" : "Confirmed", tone: "success" as const };
  if (FAILURE.has(normalized)) return { label: normalized[0] + normalized.slice(1).toLowerCase(), tone: "failure" as const };
  if (CANCELED.has(normalized)) return { label: normalized === "REFUNDED" ? "Refunded" : "Canceled", tone: "neutral" as const };
  if (ATTENTION.has(normalized)) return { label: normalized.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join(" "), tone: "failure" as const };
  if (["PENDING", "PROCESSING", "SUBMITTED"].includes(normalized)) return { label: normalized === "PROCESSING" ? "Processing" : "Pending", tone: "pending" as const };
  if (normalized === "ACTIVE") return { label: "Active", tone: "neutral" as const };
  return { label: normalized.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join(" "), tone: "neutral" as const };
}

export default function FinancialStatusBadge({ status }: { status?: string | null }) {
  const meta = financialStatusMeta(status);
  const styles = {
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 dark:border-emerald-400/25",
    failure: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 dark:border-red-400/25",
    pending: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200 dark:border-amber-400/25",
    neutral: "border-slate-300 bg-slate-100 text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-white/70",
  }[meta.tone];
  const dot = {
    success: "bg-emerald-600 dark:bg-emerald-300",
    failure: "bg-red-600 dark:bg-red-300",
    pending: "bg-amber-600 dark:bg-amber-200",
    neutral: "bg-slate-500 dark:bg-white/60",
  }[meta.tone];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${styles}`} aria-label={`Transaction status: ${meta.label}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${meta.tone === "pending" ? "animate-pulse" : ""}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
