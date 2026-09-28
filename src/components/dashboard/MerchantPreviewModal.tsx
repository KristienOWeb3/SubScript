"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  ShieldCheck,
  CreditCard,
  Lock,
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  Calendar,
  Building2,
  Sparkles,
} from "@/components/icons";

interface MerchantPreviewModalProps {
  open: boolean;
  onClose: () => void;
  displayName: string;
  commitSlug?: string;
  merchantId?: string;
  verified?: boolean;
  profilePic?: string | null;
}

export default function MerchantPreviewModal({
  open,
  onClose,
  displayName,
  commitSlug,
  merchantId,
  verified = true,
  profilePic,
}: MerchantPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<"checkout" | "subscription">("checkout");

  const resolvedName = displayName.trim() || "Your Merchant Name";
  const initials = resolvedName.slice(0, 2).toUpperCase();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="merchant-preview-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="dashboard-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
            className="dashboard-modal-surface relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-black/10 bg-[#FFFFF0] text-left text-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3
                    id="preview-modal-title"
                    className="text-sm font-black uppercase tracking-wider text-[#111827]"
                  >
                    Customer Display Name Preview
                  </h3>
                  <span className="rounded-full bg-[#2775CA]/10 px-2 py-0.5 text-[10px] font-bold text-[#2775CA]">
                    Live Simulation
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-black/60">
                  Preview how <span className="font-bold text-[#082824]">&ldquo;{resolvedName}&rdquo;</span> is seen by your customers on checkouts and subscriptions.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-full border border-black/10 bg-white text-black/60 transition hover:bg-black/5 hover:text-black"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* View Mode Tabs */}
            <div className="flex border-b border-black/10 bg-black/[0.02] px-6 pt-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("checkout")}
                  className={`flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-bold transition ${
                    activeTab === "checkout"
                      ? "border-[#2775CA] text-[#2775CA]"
                      : "border-transparent text-black/60 hover:text-black"
                  }`}
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  Hosted Checkout Page (/pay/...)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("subscription")}
                  className={`flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-bold transition ${
                    activeTab === "subscription"
                      ? "border-[#2775CA] text-[#2775CA]"
                      : "border-transparent text-black/60 hover:text-black"
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Customer Subscriptions Portal
                </button>
              </div>
            </div>

            {/* Modal Body / Simulation Frame */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === "checkout" ? (
                /* CHECKOUT SIMULATION */
                <div className="mx-auto max-w-md space-y-4">
                  <div className="text-center">
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#2775CA]">
                      SubScript Checkout
                    </p>
                    <p className="mt-0.5 text-[11px] font-bold text-black/40 uppercase">Recurring Monthly</p>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-black/15 bg-white p-5 shadow-sm space-y-4">
                    {/* Merchant Header Card */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-3">
                        {profilePic ? (
                          <img
                            src={profilePic}
                            alt={resolvedName}
                            className="h-10 w-10 rounded-full object-cover border border-black/10"
                          />
                        ) : (
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-[#2775CA] font-black text-sm text-white shadow-xs">
                            {initials}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-sm font-black text-[#0f172a]">{resolvedName}</h4>
                            {verified && (
                              <span title="SubScript Verified Merchant">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 fill-emerald-100" />
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-slate-400">
                            {commitSlug ? `@${commitSlug}` : merchantId || "merchant.arc"}
                          </p>
                        </div>
                      </div>

                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700 uppercase tracking-wide">
                        Verified
                      </span>
                    </div>

                    {/* Plan Details */}
                    <div className="space-y-1">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                        Paying For
                      </span>
                      <p className="text-base font-black text-[#0f172a]">Pro Subscription</p>
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        Full access billed on recurring cycle settled natively on Arc USDC.
                      </p>
                    </div>

                    {/* Price Block */}
                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                      <span className="text-xs font-bold text-slate-500">Amount Due</span>
                      <div className="text-right">
                        <span className="text-lg font-black text-[#2775CA]">$25.00 USDC</span>
                        <span className="block text-[10px] text-slate-400">/ month</span>
                      </div>
                    </div>

                    {/* Simulated CTA Button */}
                    <button
                      type="button"
                      disabled
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2775CA] py-3 text-xs font-black uppercase tracking-wider text-white shadow-sm opacity-90 cursor-default"
                    >
                      <span>Pay with Arc USDC</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>

                    {/* Trust Footnote */}
                    <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
                      <Lock className="h-3 w-3 text-slate-400" />
                      <span>Encrypted on-chain authorization · Powered by SubScript</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* SUBSCRIPTION PORTAL SIMULATION */
                <div className="mx-auto max-w-md space-y-4">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-[11px] text-blue-900 leading-relaxed">
                    This is how your business appears to active subscribers inside their user billing dashboard (<code className="font-mono text-blue-950 font-bold">/dashboard/user</code>).
                  </div>

                  <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {profilePic ? (
                          <img
                            src={profilePic}
                            alt={resolvedName}
                            className="h-10 w-10 rounded-full object-cover border border-black/10"
                          />
                        ) : (
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-[#082824] font-black text-sm text-[#FFFFF0]">
                            {initials}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-sm font-black text-[#0f172a]">{resolvedName}</h4>
                            {verified && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 font-medium">Pro Subscription</p>
                        </div>
                      </div>

                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        Active
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 border-t border-b border-slate-100 py-3 text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Billing Rate
                        </span>
                        <p className="mt-0.5 font-black text-[#0f172a]">$25.00 USDC / mo</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Next Cycle
                        </span>
                        <p className="mt-0.5 font-bold text-slate-700">In 28 days</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="flex items-center gap-1 text-[10px]">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        Direct Arc Vault settlement
                      </span>
                      <span className="text-[10px] font-bold text-[#2775CA] hover:underline cursor-pointer">
                        Manage Plan
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-black/10 bg-[#fbfbf4] px-6 py-3.5">
              <p className="text-[11px] text-black/60">
                To update your customer-facing name, contact SubScript Support.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#082824] px-5 py-2 text-xs font-bold text-white transition hover:bg-black/80"
              >
                Close Preview
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
