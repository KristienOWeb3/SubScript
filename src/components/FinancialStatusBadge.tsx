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
    success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    failure: "border-red-400/25 bg-red-400/10 text-red-300",
    pending: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    neutral: "border-white/15 bg-white/5 text-white/60",
  }[meta.tone];
  const dot = {
    success: "bg-emerald-300",
    failure: "bg-red-300",
    pending: "bg-amber-200",
    neutral: "bg-white/50",
  }[meta.tone];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${styles}`} aria-label={`Transaction status: ${meta.label}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${meta.tone === "pending" ? "animate-pulse" : ""}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
