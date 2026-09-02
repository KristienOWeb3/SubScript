"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardSidebar, {
  type DashboardSidebarItem,
} from "@/components/dashboard/DashboardSidebar";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Pencil,
  ReceiptText,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Home,
  BarChart3,
  Sliders,
  MessageSquare,
  DollarSign,
  TrendingUp,
  RefreshCcw,
  UserCheck,
  Eye,
  Trophy,
} from "@/components/icons";
import {
  SkeletonCard,
  SkeletonRows,
  SkeletonStatGrid,
  SkeletonToggleRows,
} from "@/components/ui/skeletons";
import { AdminOverviewDashboard } from "@/components/admin/overview/AdminOverviewDashboard";
import { AdminSupportTicketsView } from "@/components/admin/AdminSupportTicketsView";
import { AdminAccountSettingsView } from "@/components/admin/AdminAccountSettingsView";
import { AdminAuditLogView } from "@/components/admin/AdminAuditLogView";
import {
  AnalyticsSubSidebar,
  type AnalyticsSectionId,
} from "@/components/admin/analytics/AnalyticsSubSidebar";
import { VolumeView } from "@/components/admin/analytics/views/VolumeView";
import { SubscriptionsView } from "@/components/admin/analytics/views/SubscriptionsView";
import { GrowthView } from "@/components/admin/analytics/views/GrowthView";
import { KycView } from "@/components/admin/analytics/views/KycView";
import { HealthView } from "@/components/admin/analytics/views/HealthView";
import {
  VolumeSkeleton,
  SubscriptionsSkeleton,
  GrowthSkeleton,
  KycSkeleton,
  HealthSkeleton,
  AdminOverviewSkeleton,
} from "@/components/admin/analytics/AnalyticsSkeletons";
import { AdminFinancialsView } from "@/components/admin/AdminFinancialsView";
import { AdminReconciliationView } from "@/components/admin/AdminReconciliationView";
import { AdminAccountsView } from "@/components/admin/AdminAccountsView";
import { AdminTransactionInspectorModal } from "@/components/admin/AdminTransactionInspectorModal";
import { AdminMerchantCatalogModal } from "@/components/admin/AdminMerchantCatalogModal";
import { AdminSystemHealthCard } from "@/components/admin/AdminSystemHealthCard";
import { AdminRelayerBalancesCard } from "@/components/admin/AdminRelayerBalancesCard";
import { AdminRevenueView } from "@/components/admin/AdminRevenueView";
import { AdminRiskSignalsCard } from "@/components/admin/AdminRiskSignalsCard";
import { AdminReferralsView } from "@/components/admin/AdminReferralsView";

type Merchant = {
  walletAddress: string;
  merchantName: string;
  tier: string;
  verified: boolean;
  profilePic?: string | null;
  createdAt: string;
};

type BannedAccount = {
  address: string;
  reason?: string | null;
  bannedBy?: string;
  createdAt: string;
};
type BannedIp = {
  ip: string;
  reason?: string | null;
  bannedBy?: string;
  createdAt: string;
};

type SponsorStatus = {
  configured: boolean;
  address: string | null;
  balanceUsdc: string | null;
  topupUsdc: string;
  estimatedTopupsRemaining: number | null;
  underfunded: boolean;
  emergencyStop: boolean;
  error: string | null;
};

type AdminEntry = {
  wallet: string;
  tier: "root" | "delegated";
  label?: string | null;
  adminHandle?: string;
  alias?: string | null;
  grantedBy?: string;
  createdAt?: string;
  /* Delegated only. Root holds every scope implicitly, so the API omits these for that tier. */
  scopes?: string[];
  grantReason?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  /* Backfilled wide when scoping landed — badged so it gets narrowed on purpose. */
  legacyFullScope?: boolean;
};

type Analytics = {
  generatedAt: string;
  volume: {
    totalUsdc: string;
    paymentCount: number;
    averageUsdc: string;
    last30DaysUsdc: string;
    last30DaysCount: number;
    checkoutVolumeUsdc: string;
    checkoutCount: number;
  };
  subscriptions: {
    activeCustomer: number;
    activePremium: number;
    activeTotal: number;
    cancellingAtPeriodEnd: number;
    byStatus: Record<string, number>;
  };
  growth: {
    usersTotal: number;
    usersRoleUser: number;
    usersRoleEnterprise: number;
    usersNew30d: number;
    merchantsTotal: number;
    merchantsVerified: number;
    merchantsNew30d: number;
    customersTotal: number;
    customersNew30d: number;
  };
  kyc: { byStatus: Record<string, number>; pending: number; approved: number };
  health: {
    revocationPending: number;
    downgradeFailures: number;
    stuckReceipts: number;
  };
  recentBroadcasts: Array<{
    id: string;
    title: string;
    audience: string;
    status: string;
    sentCount: number;
    failedCount: number;
    totalRecipients: number;
    createdAt: string;
  }>;
};

type PlatformFlags = {
  googleSigninEnabled: boolean;
  maintenanceEnabled: boolean;
  maintenanceMessage: string | null;
  externalWalletEnabled: boolean;
  merchantInviteOnlyEnabled: boolean;
  localBankTransferEnabled: boolean;
  googleEnvConfigured?: boolean;
};

type MerchantAccessRequest = {
  id: string;
  email: string;
  companyName: string | null;
  website: string | null;
  contactName: string | null;
  useCase: string | null;
  monthlyVolume: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

type MerchantAccessGrant = {
  email: string;
  grantedBy: string;
  inviteUrl: string;
  inviteSentAt: string | null;
  claimedAt: string | null;
  claimedWallet: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  note: string | null;
  createdAt: string;
};

type MerchantAccessEnforcement = {
  enabled: boolean;
  source: "env" | "flag" | "off";
  isMainnet: boolean;
};

type KycRecord = {
  id: string;
  walletAddress: string;
  accountRole: string;
  kind: string;
  countryCode: string;
  provider: string;
  providerCaseId: string | null;
  requestedLevel: string;
  status: string;
  reasonCode: string | null;
  revision: number;
  submittedAt: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  adminAsserted: boolean;
  lastAdminActor: string | null;
  lastAdminActionAt: string | null;
  /* Joined from address_aliases for display. Null when the wallet has no DNS name. KYC itself
     is keyed on walletAddress, so renaming the alias never affects the record. */
  alias?: string | null;
};

/* Mirrors REASONS_BY_TARGET in src/lib/kyc — the server rejects anything else, and a
   status whose set is empty must be sent with no reason at all. */
const KYC_REASONS: Record<string, string[]> = {
  NEEDS_INPUT: [
    "ADDITIONAL_INFORMATION_REQUIRED",
    "DOCUMENT_EXPIRED",
    "DOCUMENT_UNREADABLE",
    "IDENTITY_MISMATCH",
    "BUSINESS_DETAILS_MISMATCH",
  ],
  REJECTED: [
    "IDENTITY_MISMATCH",
    "BUSINESS_DETAILS_MISMATCH",
    "UNSUPPORTED_JURISDICTION",
    "PROVIDER_REJECTED",
    "COMPLIANCE_REVIEW_FAILED",
  ],
  EXPIRED: ["APPROVAL_EXPIRED"],
  REVOKED: ["APPROVAL_REVOKED", "COMPLIANCE_REVIEW_FAILED"],
};

/* Mirrors ADMIN_TRANSITIONS. Terminal states offer nothing here — lifting one is what the
   root-only force-approve panel is for. */
const KYC_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["IN_REVIEW", "NEEDS_INPUT", "APPROVED", "REJECTED"],
  IN_REVIEW: ["NEEDS_INPUT", "APPROVED", "REJECTED"],
  NEEDS_INPUT: [],
  APPROVED: ["EXPIRED", "REVOKED"],
  REJECTED: [],
  EXPIRED: [],
  REVOKED: [],
};

const KYC_FORCE_CONFIRMATION = "FORCE APPROVE";

type TabId =
  | "overview"
  | "analytics"
  | "revenue"
  | "financials"
  | "referrals"
  | "reconciliation"
  | "accounts"
  | "tickets"
  | "merchants"
  | "merchant-access"
  | "kyc"
  | "moderation"
  | "account-settings"
  | "system"
  | "broadcast"
  | "receipts"
  | "audit-log"
  | "admins";

const TABS: Array<{ id: TabId; label: string; rootOnly?: boolean }> = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Analytics" },
  /* Root only. Platform revenue is the whole P&L, and the delegated tiers exist so finance and
     support hires can work the console without seeing it. The API enforces this independently —
     hiding the tab is convenience, not the boundary. */
  { id: "revenue", label: "Revenue", rootOnly: true },
  { id: "financials", label: "Financials & Ledger" },
  { id: "referrals", label: "Referral Leaderboard" },
  { id: "reconciliation", label: "Reconciliation Queue" },
  { id: "accounts", label: "Accounts & Identity" },
  { id: "tickets", label: "Support Tickets" },
  { id: "merchants", label: "Merchants" },
  { id: "merchant-access", label: "Merchant Access" },
  { id: "kyc", label: "KYC" },
  { id: "moderation", label: "Moderation" },
  { id: "account-settings", label: "Account settings" },
  { id: "system", label: "System & Health" },
  { id: "broadcast", label: "Broadcast" },
  { id: "receipts", label: "Receipts" },
  { id: "audit-log", label: "Audit Log" },
  { id: "admins", label: "Admins" },
];

/* Typing this arms the invite-only switch. It decides whether merchant signup is open to the whole
   internet, so it should not be one stray click away — same reasoning as the maintenance switch. */
const MERCHANT_INVITE_ONLY_CONFIRMATION = "invite only";

const CARD =
  "rounded-xl border border-[#e2e8f0] bg-white p-6 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]";
const LABEL = "text-[10px] font-black uppercase tracking-wider text-[#64748b]";
const INPUT =
  "w-full rounded-lg border border-[#cbd5e1] bg-white px-3.5 py-2 text-xs text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#2775ca] focus:outline-none focus:ring-2 focus:ring-[#2775ca]/15";

const SUPPORT_EMAIL = "support@subscriptonarc.com";
export default function AdminDashboardPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [bannedAccounts, setBannedAccounts] = useState<BannedAccount[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIp[]>([]);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [viewerIsRoot, setViewerIsRoot] = useState(false);
  const [viewerWallet, setViewerWallet] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [copiedMerchant, setCopiedMerchant] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [catalogMerchantAddress, setCatalogMerchantAddress] = useState<string | null>(null);

  const [banType, setBanType] = useState<"ACCOUNT" | "IP">("ACCOUNT");
  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banBusy, setBanBusy] = useState(false);

  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [newAdminWallet, setNewAdminWallet] = useState("");
  const [newAdminLabel, setNewAdminLabel] = useState("");
  /* No default. The API refuses a grant with no scopes, so an operator has to say what this
     person may do rather than inheriting whatever the old model handed out. */
  const [newAdminScopes, setNewAdminScopes] = useState<string[]>([]);
  const [newAdminReason, setNewAdminReason] = useState("");
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [scopeBusyWallet, setScopeBusyWallet] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [editingAdminWallet, setEditingAdminWallet] = useState<string | null>(null);
  const [editAdminAliasValue, setEditAdminAliasValue] = useState("");
  const [aliasUpdateBusy, setAliasUpdateBusy] = useState(false);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [overviewData, setOverviewData] = useState<any>(null);
  const [analyticsSection, setAnalyticsSection] = useState<AnalyticsSectionId>("volume");

  const [flags, setFlags] = useState<PlatformFlags | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  /* Typing the word arms the switch. Maintenance takes the whole product down, so it
     should not be one misplaced click away. */
  const [maintenanceConfirm, setMaintenanceConfirm] = useState("");

  const [maRequests, setMaRequests] = useState<MerchantAccessRequest[]>([]);
  const [maGrants, setMaGrants] = useState<MerchantAccessGrant[]>([]);
  const [maEnforcement, setMaEnforcement] = useState<MerchantAccessEnforcement | null>(null);
  const [maLoading, setMaLoading] = useState(false);
  const [maBusy, setMaBusy] = useState<string | null>(null);
  const [maStatusFilter, setMaStatusFilter] = useState("PENDING");
  const [maGrantEmail, setMaGrantEmail] = useState("");
  const [maGrantNote, setMaGrantNote] = useState("");
  /* Keyed by request id so two rows open at once cannot share a draft, matching kycReasonDraft. */
  const [maDeclineDraft, setMaDeclineDraft] = useState<Record<string, string>>({});
  const [maCopiedEmail, setMaCopiedEmail] = useState<string | null>(null);
  const [maInviteOnlyConfirm, setMaInviteOnlyConfirm] = useState("");

  const [bcTitle, setBcTitle] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcUrl, setBcUrl] = useState("");
  const [bcAudience, setBcAudience] = useState<"users" | "merchants" | "both">(
    "users"
  );
  const [bcConfirm, setBcConfirm] = useState("");
  const [bcBusy, setBcBusy] = useState<"preview" | "send" | null>(null);
  const [deletingBroadcastId, setDeletingBroadcastId] = useState<string | null>(null);

  const [invReceiptId, setInvReceiptId] = useState("");
  const [invAddress, setInvAddress] = useState("");
  const [invReason, setInvReason] = useState("");
  const [invBusy, setInvBusy] = useState(false);

  const [kycRecords, setKycRecords] = useState<KycRecord[]>([]);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycStatusFilter, setKycStatusFilter] = useState("all");
  const [kycSearch, setKycSearch] = useState("");
  const [kycBusy, setKycBusy] = useState<string | null>(null);
  /* Keyed by verification id so two rows open at once cannot share a draft. */
  const [kycReasonDraft, setKycReasonDraft] = useState<Record<string, string>>(
    {}
  );
  const [forceTarget, setForceTarget] = useState<KycRecord | null>(null);
  const [forceReason, setForceReason] = useState("");
  const [forceExpiry, setForceExpiry] = useState("");
  const [forceConfirm, setForceConfirm] = useState("");
  const [manualWallet, setManualWallet] = useState("");
  const [manualCountry, setManualCountry] = useState("");
  const [manualLevel, setManualLevel] = useState("STANDARD");
  const [manualReason, setManualReason] = useState("");

  const [manualMerchantAddress, setManualMerchantAddress] = useState("");
  const [manualMerchantBusy, setManualMerchantBusy] = useState(false);

  const [directKycWallet, setDirectKycWallet] = useState("");
  const [directKycReason, setDirectKycReason] = useState("");
  const [directKycLevel, setDirectKycLevel] = useState("STANDARD");
  const [directKycCountry, setDirectKycCountry] = useState("US");
  const [directKycBusy, setDirectKycBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/overview");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load admin data");
      setOverviewData(json);
      setSponsor(json.sponsor ?? null);
      setMerchants(json.merchants || []);
      setBannedAccounts(json.bannedAccounts || []);
      setBannedIps(json.bannedIps || []);
      setTotalUsers(json.totalUsers ?? null);
      setViewerIsRoot(Boolean(json.viewerIsRoot));
      if (json.viewerWallet) setViewerWallet(json.viewerWallet);
    } catch (err: any) {
      setError(err.message || "Failed to load admin dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdmins = useCallback(async () => {
    setAdminsLoading(true);
    try {
      const res = await fetch("/api/admin/admins");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load admins");
      setAdmins([...(json.root || []), ...(json.delegated || [])]);
      setViewerIsRoot(Boolean(json.viewerIsRoot));
      /* Server-supplied so the picker cannot offer a scope the validator would drop. */
      if (Array.isArray(json.availableScopes)) setAvailableScopes(json.availableScopes);
    } catch (err: any) {
      setError(err.message || "Failed to load admins");
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch("/api/admin/analytics");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load analytics");
      setAnalytics(json);
    } catch (err: any) {
      setError(err.message || "Failed to load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const loadFlags = useCallback(async () => {
    setFlagsLoading(true);
    try {
      const res = await fetch("/api/admin/flags");
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to load platform flags");
      setFlags(json);
      setMaintenanceMessage(json.maintenanceMessage || "");
    } catch (err: any) {
      setError(err.message || "Failed to load platform flags");
    } finally {
      setFlagsLoading(false);
    }
  }, []);

  const loadMerchantAccess = useCallback(async () => {
    setMaLoading(true);
    try {
      const res = await fetch(
        `/api/admin/merchant-access?status=${encodeURIComponent(maStatusFilter)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load merchant access");
      setMaRequests(json.requests || []);
      setMaGrants(json.grants || []);
      setMaEnforcement(json.enforcement || null);
      setViewerIsRoot(Boolean(json.viewerIsRoot));
    } catch (err: any) {
      setError(err.message || "Failed to load merchant access");
    } finally {
      setMaLoading(false);
    }
  }, [maStatusFilter]);

  const loadKyc = useCallback(async () => {
    setKycLoading(true);
    try {
      const params = new URLSearchParams({
        status: kycStatusFilter,
        limit: "100",
      });
      if (kycSearch.trim()) params.set("search", kycSearch.trim());
      const res = await fetch(`/api/admin/kyc/review?${params.toString()}`);
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to load verifications");
      setKycRecords(json.verifications || []);
      setViewerIsRoot(Boolean(json.viewerIsRoot));
    } catch (err: any) {
      setError(err.message || "Failed to load verifications");
    } finally {
      setKycLoading(false);
    }
  }, [kycStatusFilter, kycSearch]);

  /** Ordinary review transition. Reason is required for some targets and forbidden for others. */
  const decideKyc = async (record: KycRecord, status: string) => {
    setKycBusy(record.id);
    setError(null);
    setNotice(null);
    try {
      const needsReason = (KYC_REASONS[status] || []).length > 0;
      const reasonCode = kycReasonDraft[record.id] || "";
      if (needsReason && !reasonCode) {
        throw new Error(`Pick a reason code before moving this to ${status}.`);
      }
      const res = await fetch("/api/admin/kyc/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          verificationId: record.id,
          status,
          ...(needsReason ? { reasonCode } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to update verification");
      setKycRecords((prev) =>
        prev.map((r) => (r.id === record.id ? json.verification : r))
      );
      setNotice(`${record.walletAddress.slice(0, 10)}… moved to ${status}.`);
    } catch (err: any) {
      setError(err.message || "Failed to update verification");
    } finally {
      setKycBusy(null);
    }
  };

  const forceApproveKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forceTarget) return;
    setKycBusy(forceTarget.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/kyc/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "force-approve",
          verificationId: forceTarget.id,
          reason: forceReason.trim(),
          confirm: forceConfirm,
          ...(forceExpiry
            ? { expiresAt: new Date(forceExpiry).toISOString() }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Force approval failed");
      setKycRecords((prev) =>
        prev.map((r) => (r.id === forceTarget.id ? json.verification : r))
      );
      setNotice(
        `Force-approved ${forceTarget.walletAddress}. Logged to the admin audit trail.`
      );
      setForceTarget(null);
      setForceReason("");
      setForceExpiry("");
      setForceConfirm("");
    } catch (err: any) {
      setError(err.message || "Force approval failed");
    } finally {
      setKycBusy(null);
    }
  };

  const createManualKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    setKycBusy("create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/kyc/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-manual",
          walletAddress: manualWallet.trim(),
          countryCode: manualCountry.trim(),
          requestedLevel: manualLevel,
          reason: manualReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to open verification");
      setKycRecords((prev) => [json.verification, ...prev]);
      setNotice(
        `Opened a manual verification for ${manualWallet.trim()}. It still needs a decision.`
      );
      setManualWallet("");
      setManualCountry("");
      setManualReason("");
    } catch (err: any) {
      setError(err.message || "Failed to open verification");
    } finally {
      setKycBusy(null);
    }
  };

  /* One helper for every merchant-access action: they all POST the same shape, all reload the
     queue, and all report through the same notice/error banners. */
  const merchantAccessAction = async (
    payload: Record<string, unknown>,
    busyKey: string
  ) => {
    setMaBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/merchant-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Merchant access action failed");
      setNotice(json.message || "Done.");
      await loadMerchantAccess();
      return json;
    } catch (err: any) {
      setError(err.message || "Merchant access action failed");
      return null;
    } finally {
      setMaBusy(null);
    }
  };

  const grantMerchantAccess = async (
    email: string,
    opts: { requestId?: string; note?: string } = {}
  ) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    const result = await merchantAccessAction(
      {
        action: "grant",
        email: trimmed,
        requestId: opts.requestId,
        note: opts.note?.trim() || undefined,
      },
      `grant:${opts.requestId || trimmed}`
    );
    if (result?.success) {
      setMaGrantEmail("");
      setMaGrantNote("");
    }
  };

  const declineMerchantRequest = async (requestId: string) => {
    const reason = (maDeclineDraft[requestId] || "").trim();
    if (reason.length < 3) {
      setError("Give a reason — the next admin to read this queue needs to know why.");
      return;
    }
    const result = await merchantAccessAction(
      { action: "decline", requestId, reason },
      `decline:${requestId}`
    );
    if (result?.success) {
      setMaDeclineDraft((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  };

  const revokeMerchantGrant = async (email: string) => {
    const reason = window.prompt(
      `Why are you revoking merchant access for ${email}?`,
      ""
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("A reason is required to revoke merchant access.");
      return;
    }
    await merchantAccessAction(
      { action: "revoke", email, reason: reason.trim() },
      `revoke:${email}`
    );
  };

  const regenerateMerchantInvite = async (email: string) => {
    await merchantAccessAction(
      { action: "regenerate-link", email },
      `regen:${email}`
    );
  };

  const copyInviteLink = (grant: MerchantAccessGrant) => {
    navigator.clipboard.writeText(grant.inviteUrl);
    setMaCopiedEmail(grant.email);
    setTimeout(() => setMaCopiedEmail(null), 2000);
  };

  const updateFlag = async (patch: Record<string, unknown>, key: string) => {
    setFlagBusy(key);    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update flag");
      if (json.warning) setNotice(json.warning);
      setFlags((prev) => (prev ? { ...prev, ...json.flags } : json.flags));
      setMaintenanceConfirm("");
    } catch (err: any) {
      setError(err.message || "Failed to update flag");
    } finally {
      setFlagBusy(null);
    }
  };
  const prepareMaintenanceBroadcast = (backOnline: boolean) => {
    setBcAudience("both");
    setBcTitle(backOnline ? "SubScript is back online" : "SubScript is temporarily down");
    setBcBody(
      backOnline
        ? `SubScript is back online. Thank you for your patience. Contact ${SUPPORT_EMAIL} if you still need help.`
        : `SubScript is temporarily down for maintenance. We will share an update when service is restored. Contact ${SUPPORT_EMAIL} for urgent support.`,
    );
    setBcUrl("/support");
    setBcConfirm("");
    setTab("broadcast");
  };

  const sendBroadcast = async (testOnly: boolean) => {
    if (!bcTitle.trim() || !bcBody.trim()) return;
    setBcBusy(testOnly ? "preview" : "send");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: bcAudience,
          title: bcTitle.trim(),
          body: bcBody.trim(),
          url: bcUrl.trim() || undefined,
          testOnly,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Broadcast failed");
      setNotice(
        json.warning
          ? `${json.summary || json.message} ${json.warning}`
          : json.summary || json.message
      );
      if (!testOnly) {
        setBcTitle("");
        setBcBody("");
        setBcUrl("");
        setBcConfirm("");
      }
    } catch (err: any) {
      setError(err.message || "Broadcast failed");
    } finally {
      setBcBusy(null);
    }
  };

  const deleteBroadcast = async (id: string) => {
    if (!confirm("Are you sure you want to delete this broadcast record?")) return;
    setDeletingBroadcastId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/broadcast?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to delete broadcast");
      setAnalytics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          recentBroadcasts: (prev.recentBroadcasts || []).filter((b: any) => b.id !== id),
        };
      });
      setNotice("Broadcast deleted.");
      setTimeout(() => setNotice(null), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to delete broadcast");
    } finally {
      setDeletingBroadcastId(null);
    }
  };

  const inviteToReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/receipts/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: invReceiptId.trim(),
          inviteAddress: invAddress.trim(),
          reason: invReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to invite viewer");
      setNotice(json.message);
      setInvReceiptId("");
      setInvAddress("");
      setInvReason("");
    } catch (err: any) {
      setError(err.message || "Failed to invite viewer");
    } finally {
      setInvBusy(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (tab === "admins") loadAdmins();
    if (tab === "analytics" || tab === "broadcast") loadAnalytics();
    if (tab === "system") loadFlags();
    if (tab === "kyc") loadKyc();
    /* Both: the tab renders the enforcement switch, which lives in platform_flags, alongside the
       queue that comes from the merchant-access route. */
    if (tab === "merchant-access") {
      loadFlags();
      loadMerchantAccess();
    }
  }, [tab, loadAdmins, loadAnalytics, loadFlags, loadKyc, loadMerchantAccess]);

  const handleCopySponsor = () => {
    if (!sponsor?.address) return;
    navigator.clipboard.writeText(sponsor.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleVerification = async (
    merchantAddress: string,
    currentStatus: boolean
  ) => {
    setVerifyBusy(merchantAddress);
    setError(null);
    try {
      const res = await fetch("/api/admin/merchant-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantAddress, verified: !currentStatus }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to update verification");
      setMerchants((prev) =>
        prev.map((m) =>
          m.walletAddress === merchantAddress
            ? { ...m, verified: !currentStatus }
            : m
        )
      );
    } catch (err: any) {
      setError(err.message || "Failed to update verification");
    } finally {
      setVerifyBusy(null);
    }
  };

  const handleManualVerifyMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualMerchantAddress.trim()) return;
    setManualMerchantBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/merchant-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantAddress: manualMerchantAddress.trim(), verified: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to verify merchant");
      setManualMerchantAddress("");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to verify merchant");
    } finally {
      setManualMerchantBusy(false);
    }
  };

  const handleDirectKycUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directKycWallet.trim()) return;
    setDirectKycBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kyc/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upgrade-kyc",
          walletAddress: directKycWallet.trim(),
          requestedLevel: directKycLevel,
          countryCode: directKycCountry.trim().toUpperCase() || "US",
          reason: directKycReason.trim() || "Manual KYC approval by administrator",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to upgrade KYC");
      setDirectKycWallet("");
      setDirectKycReason("");
      await loadKyc();
    } catch (err: any) {
      setError(err.message || "Failed to upgrade KYC");
    } finally {
      setDirectKycBusy(false);
    }
  };

  const handleBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!banTarget.trim()) return;
    setBanBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: banType,
          target: banTarget.trim(),
          action: "BAN",
          reason: banReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to issue ban");
      if (json.warning) setNotice(json.warning);
      setBanTarget("");
      setBanReason("");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to ban target");
    } finally {
      setBanBusy(false);
    }
  };

  const handleUnban = async (type: "ACCOUNT" | "IP", target: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, target, action: "UNBAN" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to remove ban");
      if (json.warning) setNotice(json.warning);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to remove ban");
    }
  };

  /* Narrow or widen an existing grant, one scope at a time.
   *
   * Sends the whole resulting array rather than a delta: the API replaces the set, because a
   * merge-only endpoint could never take a scope away — and taking scopes away from the
   * backfilled-wide rows is the entire point of shipping this control. */
  const handleToggleAdminScope = async (admin: AdminEntry, scope: string) => {
    const current = admin.scopes || [];
    const next = current.includes(scope)
      ? current.filter((s) => s !== scope)
      : [...current, scope];
    if (next.length === 0) {
      setError("An admin needs at least one scope. Revoke them instead if they should have none.");
      return;
    }
    setScopeBusyWallet(admin.wallet);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: admin.wallet, scopes: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update scopes");
      await loadAdmins();
    } catch (err: any) {
      setError(err.message || "Could not update scopes");
    } finally {
      setScopeBusyWallet(null);
    }
  };

  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminWallet.trim()) return;
    setAdminBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: newAdminWallet.trim(),
          label: newAdminLabel.trim() || undefined,
          scopes: newAdminScopes,
          grantReason: newAdminReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to grant admin access");
      if (json.warning) setNotice(json.warning);
      setNewAdminWallet("");
      setNewAdminLabel("");
      setNewAdminScopes([]);
      setNewAdminReason("");
      await loadAdmins();
    } catch (err: any) {
      setError(err.message || "Failed to grant admin access");
    } finally {
      setAdminBusy(false);
    }
  };

  const handleRevokeAdmin = async (wallet: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/admin/admins?wallet=${encodeURIComponent(wallet)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to revoke admin access");
      if (json.warning) setNotice(json.warning);
      await loadAdmins();
    } catch (err: any) {
      setError(err.message || "Failed to revoke admin access");
    }
  };

  const handleUpdateAdminAlias = async (wallet: string) => {
    setAliasUpdateBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          label: editAdminAliasValue.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update admin alias");
      if (json.warning) setNotice(json.warning);
      setEditingAdminWallet(null);
      setEditAdminAliasValue("");
      await loadAdmins();
    } catch (err: any) {
      setError(err.message || "Failed to update admin alias");
    } finally {
      setAliasUpdateBusy(false);
    }
  };

  const handleCopyMerchant = (wallet: string, name: string) => {
    if (!name) return;
    navigator.clipboard.writeText(name);
    setCopiedMerchant(wallet);
    setTimeout(() => setCopiedMerchant(null), 2000);
  };

  const filteredMerchants = merchants.filter(
    (m) =>
      m.merchantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.walletAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const activeTabLabel =
    TABS.find((item) => item.id === tab)?.label ?? "Overview";

  const adminSidebarItems: DashboardSidebarItem[] = [
    { id: "overview", label: "Overview", icon: Home },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    ...(viewerIsRoot ? [{ id: "revenue", label: "Revenue", icon: TrendingUp }] : []),
    { id: "financials", label: "Financials & Ledger", icon: DollarSign },
    { id: "referrals", label: "Referrals", icon: Trophy },
    { id: "reconciliation", label: "Reconciliation", icon: RefreshCcw },
    { id: "accounts", label: "Accounts & Identity", icon: Users },
    { id: "tickets", label: "Support Tickets", icon: MessageSquare },
    { id: "merchants", label: "Merchants", icon: Building2 },
    { id: "merchant-access", label: "Merchant Access", icon: UserPlus },
    { id: "kyc", label: "KYC Compliance", icon: ShieldCheck },
    { id: "moderation", label: "Moderation & Bans", icon: ShieldAlert },
    { id: "account-settings", label: "Account settings", icon: UserCheck },
    { id: "system", label: "System & Health", icon: Sliders },
    { id: "broadcast", label: "Broadcast", icon: Bell },
    { id: "receipts", label: "Receipts", icon: ReceiptText },
    { id: "admins", label: "Admin Access", icon: Shield },
  ];

  const adminSidebarFooterItems: DashboardSidebarItem[] = [];

  const currentAdminEntry = admins.find(
    (a) => viewerWallet && a.wallet.toLowerCase() === viewerWallet.toLowerCase()
  );
  const viewerAdminHandle =
    currentAdminEntry?.adminHandle ||
    (viewerIsRoot ? "Chuks.admin" : "Admin.admin");

  /* min-h-screen + a light background on mobile, and both are load-bearing.
   *
   * html/body carry `min-height: 100vh` and `background-color: #000000` (the black is deliberate,
   * so the installed PWA never flashes a white splash frame). The mobile scroller below is
   * `h-[100dvh]`, and 100dvh is the CURRENT viewport while 100vh is the viewport with the browser
   * toolbar retracted — so on any phone with a retractable toolbar this element was shorter than
   * body by the toolbar's height, and body painted that difference pure black under the console.
   * That was the black bar at the end of the page, and it survived a refresh because it is layout,
   * not state.
   *
   * min-h-[100vh] makes this element match body's own min-height so there is no strip left over,
   * and the light background means any residual sliver reads as the console's own surface
   * (#f8fafc, matching .admin-topography) instead of black. The unit is spelled out rather than
   * written as min-h-screen on purpose: this whole bug is a vh-versus-dvh mismatch, and body's
   * min-height is literally 100vh, so the value that has to match it should say so. md:min-h-0
   * hands height back to md:h-[100dvh] on desktop, where the shell is a fixed-height frame. */
  return (
    <div className="relative overflow-x-hidden bg-[#f8fafc] md:bg-[#353935] text-white font-sans min-h-[100vh] md:min-h-0 md:h-[100dvh] md:overflow-hidden">
      <div className="relative z-10 md:flex md:h-[100dvh] md:min-h-0">
        <DashboardSidebar
          className="topo-admin-header"
          items={adminSidebarItems}
          footerItems={adminSidebarFooterItems}
          activeId={tab}
          onSelect={(id) => setTab(id as TabId)}
          identity={{
            label: viewerAdminHandle,
            avatarUrl: null,
            fallback: viewerAdminHandle.charAt(0).toUpperCase(),
            onClick: () => setTab("admins"),
            title: "Arc Protocol Authority",
          }}
          accent="#2775ca"
          panelColor="#ffffff"
          ariaLabel="Admin Protocol Navigation"
          isLoading={loading && merchants.length === 0}
        />

        {/* h-[100dvh] on mobile is what makes this scroll at all. html/body both carry
            overflow-x:hidden, which per spec computes overflow-y to auto and turns body
            into its own scroll container — so an unconstrained child with overflow-y-auto
            just grows instead of scrolling, and touch drags went nowhere. The user
            dashboard already owns its mobile scroller this way; this matches it. */}
        <div className="relative z-10 min-w-0 flex-1 h-[100dvh] md:mt-[14px] md:h-[calc(100vh-14px)] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)] md:rounded-tl-[32px] border-t border-l border-white/10 overflow-y-auto overscroll-y-contain admin-topography text-[#0f172a]">
          {/* min-h-full, not min-h-screen: this sits inside a scroller with a definite
              h-[100dvh], so 100% resolves to exactly that. min-h-screen was 100vh — larger than
              the container on mobile — which forced a phantom scroll of the toolbar's height even
              on a tab with almost no content. Invisible, being white on white, but it is the same
              vh-inside-dvh mistake as the black bar above. */}
          <main className="min-h-full pt-4 sm:pt-6 pb-16">
            <div className="admin-workspace mx-auto max-w-6xl space-y-6 px-4 py-2 sm:px-8">
              <section className="topo-admin-blue flex flex-col justify-between gap-5 rounded-2xl border border-white/20 px-5 py-5 text-white shadow-[0_12px_30px_rgba(39,117,202,0.18)] sm:flex-row sm:items-end sm:px-6">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-[0.14em] text-white/75">
                    Secure operations workspace
                  </span>
                  <h2 className="mt-1 text-xl font-black text-white">
                    {activeTabLabel}
                  </h2>
                  <p className="mt-1 text-xs text-white/80">
                    Live administrative controls and auditable protocol operations.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-wider">
                  <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5">
                    Arc Mainnet
                  </span>
                  <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5">
                    {viewerIsRoot ? "Root authority" : "Delegated authority"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setInspectorOpen(true)}
                    className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/20 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-white/30"
                  >
                    <Eye className="h-3 w-3" />
                    Inspect Tx / Hash
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRefreshCounter((c) => c + 1);
                      if (tab === "admins") loadAdmins();
                      else if (tab === "analytics" || tab === "broadcast") loadAnalytics();
                      else if (tab === "system") loadFlags();
                      else if (tab === "kyc") loadKyc();
                      else if (tab === "merchant-access") {
                        loadFlags();
                        loadMerchantAccess();
                      } else if (tab === "moderation") {
                        /* Bans ride along with the main dashboard payload, so the generic
                           reload covers this tab now that holds moved to Account settings. */
                        loadData();
                      } else loadData();
                    }}
                    disabled={loading || flagsLoading || analyticsLoading || kycLoading || maLoading || adminsLoading}
                    className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-white/20 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${loading || flagsLoading || analyticsLoading || kycLoading || maLoading || adminsLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </section>

              <div className="md:hidden flex gap-2 overflow-x-auto rounded-xl border border-[#dbe3ec] bg-white p-2 shadow-sm">
                {TABS.filter((t) => !t.rootOnly || viewerIsRoot).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                tab === t.id
                  ? "border border-[#2775ca] bg-[#2775ca] text-white shadow-sm"
                  : "border border-transparent bg-white text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-medium text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs font-medium text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {tab === "overview" && (
          loading ? <AdminOverviewSkeleton /> : (
            <AdminOverviewDashboard
              overviewData={overviewData}
              analyticsData={analytics}
              sponsor={sponsor}
              merchants={merchants}
              totalUsers={totalUsers}
              onNavigateTab={setTab}
              onToggleVerification={toggleVerification}
              verifyBusy={verifyBusy}
            />
          )
        )}

        {/* No viewerIsRoot guard on the render: the component asks the API, and the API answers 403
            for a delegated admin, which it renders as an explanation. A bare `&& viewerIsRoot` here
            would show a blank pane instead if someone reached the tab after losing root. */}
        {tab === "revenue" && <AdminRevenueView key={refreshCounter} />}

        {tab === "financials" && <AdminFinancialsView key={refreshCounter} />}

        {tab === "referrals" && <AdminReferralsView key={refreshCounter} />}

        {tab === "reconciliation" && <AdminReconciliationView key={refreshCounter} />}

        {tab === "accounts" && <AdminAccountsView key={refreshCounter} />}

        {tab === "tickets" && (
          <div className={`${CARD} space-y-4`}>
            <AdminSupportTicketsView
              key={refreshCounter}
              viewerWallet={viewerWallet}
              viewerIsRoot={viewerIsRoot}
            />
          </div>
        )}

        {tab === "merchants" && (
          <div className={`${CARD} space-y-4`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wide text-[#0f172a]">
                  Merchant Verifications
                </h2>
                <p className="text-xs text-[#475569]">
                  Verified merchants show a badge at checkout and in DMs.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name or address..."
                  className={`${INPUT} pl-9`}
                />
              </div>
            </div>

            {/* Quick Manual Verify Form */}
            <form onSubmit={handleManualVerifyMerchant} className="flex flex-col sm:flex-row gap-2.5 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <input
                type="text"
                value={manualMerchantAddress}
                onChange={(e) => setManualMerchantAddress(e.target.value)}
                placeholder="Enter merchant wallet address or SubScript DNS name (e.g. acme.sub or 0x...)"
                className={`${INPUT} flex-1`}
                required
              />
              <button
                type="submit"
                disabled={manualMerchantBusy}
                className="shrink-0 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {manualMerchantBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Verify Merchant
              </button>
            </form>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                    <th className="py-3 px-3">Merchant</th>
                    <th className="py-3 px-3">Wallet Address</th>
                    <th className="py-3 px-3">Tier</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-4">
                        <SkeletonRows count={5} avatar={true} lines={2} label="Loading verified merchants..." />
                      </td>
                    </tr>
                  ) : filteredMerchants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-6 text-center text-[#64748b]"
                      >
                        No merchants found.
                      </td>
                    </tr>
                  ) : (
                    filteredMerchants.map((merchant) => (
                      <tr
                        key={merchant.walletAddress}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 border border-slate-200 font-bold text-[#0f172a] shrink-0">
                              {merchant.profilePic ? (
                                <img
                                  src={merchant.profilePic}
                                  alt={merchant.merchantName}
                                  className="h-full w-full rounded-xl object-cover"
                                />
                              ) : (
                                <Building2 className="h-4 w-4 text-[#2775ca]" />
                              )}
                            </div>
                            <span className="font-bold text-[#0f172a] uppercase tracking-wider">
                              {merchant.merchantName}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyMerchant(
                                  merchant.walletAddress,
                                  merchant.merchantName
                                )
                              }
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
                              title="Copy merchant name"
                            >
                              {copiedMerchant === merchant.walletAddress ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-mono text-[#334155]">
                          {merchant.walletAddress}
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-700">
                            {merchant.tier}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          {merchant.verified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[9px] font-bold text-emerald-800">
                              <ShieldCheck className="h-3 w-3" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[9px] font-bold text-amber-800">
                              Unverified
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => setCatalogMerchantAddress(merchant.walletAddress)}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-700 hover:bg-slate-100 transition"
                          >
                            Catalog & API
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              toggleVerification(
                                merchant.walletAddress,
                                merchant.verified
                              )
                            }
                            disabled={verifyBusy === merchant.walletAddress}
                            className={`rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                              merchant.verified
                                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            }`}
                          >
                            {verifyBusy === merchant.walletAddress ? (
                              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                            ) : merchant.verified ? (
                              "Unverify"
                            ) : (
                              "Verify"
                            )}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "kyc" && (
          <div className="space-y-6">
            <div className={`${CARD} space-y-4`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-wide text-[#0f172a]">
                    KYC Review
                  </h2>
                  <p className="text-xs text-[#475569]">
                    Approving an enterprise account also grants its
                    verified-merchant badge. Individuals only get their KYC
                    status.
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <div className="relative flex-1 sm:w-56">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={kycSearch}
                      onChange={(e) => setKycSearch(e.target.value)}
                      placeholder="Search wallet or name.sub..."
                      className={`${INPUT} pl-9`}
                    />
                  </div>
                  <select
                    value={kycStatusFilter}
                    onChange={(e) => setKycStatusFilter(e.target.value)}
                    className={`${INPUT} w-auto`}
                  >
                    {[
                      "all",
                      "PENDING",
                      "IN_REVIEW",
                      "NEEDS_INPUT",
                      "APPROVED",
                      "REJECTED",
                      "EXPIRED",
                      "REVOKED",
                    ].map((s) => (
                      <option
                        key={s}
                        value={s}
                        className="bg-white text-[#0f172a]"
                      >
                        {s === "all" ? "All statuses" : s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {kycLoading ? (
                <SkeletonRows
                  count={5}
                  avatar={false}
                  label="Loading verification queue"
                />
              ) : kycRecords.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#64748b]">
                  No verifications match this filter.
                </p>
              ) : (
                <div className="space-y-3">
                  {kycRecords.map((record) => {
                    const transitions = KYC_TRANSITIONS[record.status] || [];
                    const busy = kycBusy === record.id;
                    return (
                      <div
                        key={record.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <code className="font-mono text-xs font-semibold text-[#0f172a]">
                                {record.walletAddress}
                              </code>
                              <KycStatusPill status={record.status} />
                              {record.adminAsserted && (
                                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-800">
                                  Admin-asserted
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[11px] text-[#475569]">
                              {record.accountRole} · {record.kind} ·{" "}
                              {record.countryCode} · {record.requestedLevel} ·
                              via {record.provider}
                              {record.expiresAt
                                ? ` · expires ${new Date(
                                    record.expiresAt
                                  ).toLocaleDateString()}`
                                : ""}
                              {record.reasonCode
                                ? ` · ${record.reasonCode}`
                                : ""}
                            </p>
                            {record.decidedAt && (
                              <p className="mt-1 text-[10px] text-emerald-700 font-mono">
                                Decided{" "}
                                {new Date(record.decidedAt).toLocaleString()}
                                {record.lastAdminActor
                                  ? ` by ${record.lastAdminActor.slice(0, 8)}...${record.lastAdminActor.slice(-6)}`
                                  : record.adminAsserted
                                    ? " by an admin"
                                    : ""}
                              </p>
                            )}
                          </div>
                          {viewerIsRoot && record.status !== "APPROVED" && (
                            <button
                              type="button"
                              onClick={() => {
                                setForceTarget(record);
                                setForceReason("");
                                setForceExpiry("");
                                setForceConfirm("");
                              }}
                              className="shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 transition hover:bg-amber-100"
                            >
                              Force approve
                            </button>
                          )}
                        </div>

                        {transitions.length === 0 ? (
                          <p className="text-[10px] text-[#64748b]">
                            {record.status === "APPROVED"
                              ? "Approved. It can still be expired or revoked once it has been re-loaded."
                              : "Terminal state — the applicant must resubmit, or a root admin can force approve."}
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const codes = Array.from(
                                new Set(
                                  transitions.flatMap(
                                    (t) => KYC_REASONS[t] || []
                                  )
                                )
                              );
                              if (codes.length === 0) return null;
                              return (
                                <select
                                  value={kycReasonDraft[record.id] || ""}
                                  onChange={(e) =>
                                    setKycReasonDraft((prev) => ({
                                      ...prev,
                                      [record.id]: e.target.value,
                                    }))
                                  }
                                  className={`${INPUT} w-auto`}
                                >
                                  <option
                                    value=""
                                    className="bg-white text-[#0f172a]"
                                  >
                                    Reason…
                                  </option>
                                  {codes.map((code) => (
                                    <option
                                      key={code}
                                      value={code}
                                      className="bg-white text-[#0f172a]"
                                    >
                                      {code.replace(/_/g, " ")}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                            {transitions.map((next) => (
                              <button
                                key={next}
                                type="button"
                                disabled={busy}
                                onClick={() => decideKyc(record, next)}
                                className={`rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-50 ${
                                  next === "APPROVED"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                    : next === "REJECTED" || next === "REVOKED"
                                    ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                {busy ? (
                                  <Loader2 className="mx-auto h-3 w-3 animate-spin" />
                                ) : (
                                  next.replace("_", " ")
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {viewerIsRoot && (
              <div className={`${CARD} space-y-4 border-emerald-500/30`}>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <span className={LABEL}>Direct KYC Upgrade &amp; Approval</span>
                    <p className="mt-1 text-[11px] text-[#475569]">
                      Instantly upgrade and approve KYC for any user or merchant using their wallet address or SubScript DNS name (e.g. <code className="text-emerald-700 font-bold">name.sub</code>). Approval persists across future DNS changes as it is anchored to the underlying wallet address. Records acting admin actor and timestamp in audit logs.
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={handleDirectKycUpgrade}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <input
                    type="text"
                    value={directKycWallet}
                    onChange={(e) => setDirectKycWallet(e.target.value)}
                    placeholder="0x address or name.sub"
                    className={INPUT}
                    required
                  />
                  <input
                    type="text"
                    value={directKycCountry}
                    onChange={(e) => setDirectKycCountry(e.target.value)}
                    placeholder="Country code (e.g. US, NG)"
                    maxLength={2}
                    className={INPUT}
                    required
                  />
                  <select
                    value={directKycLevel}
                    onChange={(e) => setDirectKycLevel(e.target.value)}
                    className={INPUT}
                  >
                    <option value="STANDARD" className="bg-white text-[#0f172a]">Standard</option>
                    <option value="ENHANCED" className="bg-white text-[#0f172a]">Enhanced</option>
                  </select>
                  <input
                    type="text"
                    value={directKycReason}
                    onChange={(e) => setDirectKycReason(e.target.value)}
                    placeholder="Reason for manual upgrade"
                    className={INPUT}
                  />
                  <button
                    type="submit"
                    disabled={directKycBusy}
                    className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 sm:col-span-2 flex items-center justify-center gap-1.5"
                  >
                    {directKycBusy ? (
                      <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Upgrade &amp; Approve KYC
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {viewerIsRoot && (
              <div className={`${CARD} space-y-4 border-amber-500/30`}>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <span className={LABEL}>Open a manual verification</span>
                    <p className="mt-1 text-[11px] text-[#475569]">
                      For a wallet that never applied. The record is marked{" "}
                      <code className="text-amber-700 font-bold">manual_admin</code>{" "}
                      permanently, and records the consent as admin-supplied
                      rather than given by the user. It opens as PENDING —
                      approving it is a second, separate decision.
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={createManualKyc}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  <input
                    type="text"
                    value={manualWallet}
                    onChange={(e) => setManualWallet(e.target.value)}
                    placeholder="0x address or name.sub"
                    className={INPUT}
                    required
                  />
                  <input
                    type="text"
                    value={manualCountry}
                    onChange={(e) => setManualCountry(e.target.value)}
                    placeholder="Country code (e.g. NG)"
                    maxLength={2}
                    className={INPUT}
                    required
                  />
                  <select
                    value={manualLevel}
                    onChange={(e) => setManualLevel(e.target.value)}
                    className={INPUT}
                  >
                    <option
                      value="STANDARD"
                      className="bg-white text-[#0f172a]"
                    >
                      Standard
                    </option>
                    <option
                      value="ENHANCED"
                      className="bg-white text-[#0f172a]"
                    >
                      Enhanced
                    </option>
                  </select>
                  <input
                    type="text"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="Reason (min 10 characters, logged)"
                    className={INPUT}
                    required
                  />
                  <button
                    type="submit"
                    disabled={kycBusy === "create"}
                    className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-800 transition hover:bg-amber-100 disabled:opacity-50 sm:col-span-2"
                  >
                    {kycBusy === "create" ? (
                      <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Open verification"
                    )}
                  </button>
                </form>
              </div>
            )}

            {forceTarget && (
              <div className={`${CARD} space-y-4 border-red-500/40`}>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div>
                    <span className={LABEL}>
                      Force approve {forceTarget.walletAddress}
                    </span>
                    <p className="mt-1 text-[11px] text-[#475569]">
                      This overrides the compliance guard that stops a manual
                      verification counting as production KYC, and lifts it out
                      of{" "}
                      <strong className="text-[#0f172a]">
                        {forceTarget.status}
                      </strong>{" "}
                      regardless of the normal transition rules. Your wallet,
                      your reason, and your IP are written to the audit log.
                    </p>
                  </div>
                </div>
                <form onSubmit={forceApproveKyc} className="space-y-3">
                  <div>
                    <label className={LABEL}>Reason (min 10 characters)</label>
                    <input
                      type="text"
                      value={forceReason}
                      onChange={(e) => setForceReason(e.target.value)}
                      placeholder="Why this override is justified"
                      className={`${INPUT} mt-1.5`}
                      required
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Approval expires (defaults to 12 months)
                    </label>
                    <input
                      type="date"
                      value={forceExpiry}
                      onChange={(e) => setForceExpiry(e.target.value)}
                      className={`${INPUT} mt-1.5`}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Type “{KYC_FORCE_CONFIRMATION}” to confirm
                    </label>
                    <input
                      type="text"
                      value={forceConfirm}
                      onChange={(e) => setForceConfirm(e.target.value)}
                      placeholder={KYC_FORCE_CONFIRMATION}
                      className={`${INPUT} mt-1.5`}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={
                        forceConfirm !== KYC_FORCE_CONFIRMATION ||
                        kycBusy === forceTarget.id
                      }
                      className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-red-800 transition hover:bg-red-100 disabled:opacity-40"
                    >
                      {kycBusy === forceTarget.id ? (
                        <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Force approve"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setForceTarget(null)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {!viewerIsRoot && (
              <p className="px-1 text-[10px] text-[#64748b]">
                <FileText className="mr-1 inline h-3 w-3" />
                Force approval and manual records are restricted to root admins
                (ADMIN_WALLET_ADDRESSES).
              </p>
            )}
          </div>
        )}

        {tab === "moderation" && (
          <div className="space-y-6">
            <AdminRiskSignalsCard />
            <div className={`${CARD}`}>
              <div className="flex items-center justify-between mb-4">
                <span className={LABEL}>Security Access Control</span>
                <ShieldAlert className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-base font-bold text-[#0f172a]">
                Ban Account or IP
              </h3>
              <p className="mt-1 text-[11px] text-[#475569]">
                Wallet bans take effect on the banned user&apos;s next request —
                existing sessions stop working immediately. IP ban changes are
                checked against the shared ban store on every API request.
              </p>

              <form onSubmit={handleBan} className="mt-4 space-y-3 max-w-lg">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBanType("ACCOUNT")}
                    className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition ${
                      banType === "ACCOUNT"
                        ? "bg-red-50 border border-red-300 text-red-800 shadow-sm"
                        : "bg-slate-100 text-[#475569] hover:bg-slate-200"
                    }`}
                  >
                    Wallet Address
                  </button>
                  <button
                    type="button"
                    onClick={() => setBanType("IP")}
                    className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition ${
                      banType === "IP"
                        ? "bg-red-50 border border-red-300 text-red-800 shadow-sm"
                        : "bg-slate-100 text-[#475569] hover:bg-slate-200"
                    }`}
                  >
                    IP Address
                  </button>
                </div>

                <input
                  type="text"
                  value={banTarget}
                  onChange={(e) => setBanTarget(e.target.value)}
                  placeholder={
                    banType === "ACCOUNT"
                      ? "0x... wallet address"
                      : "192.168.1.1"
                  }
                  aria-label={
                    banType === "ACCOUNT"
                      ? "Target wallet address to ban"
                      : "Target IP address to ban"
                  }
                  className={INPUT}
                />
                <input
                  type="text"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className={INPUT}
                />
                <button
                  type="submit"
                  disabled={banBusy || !banTarget.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-red-700 disabled:opacity-40 shadow-sm"
                >
                  {banBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Enforce Ban"
                  )}
                </button>
              </form>
            </div>

            <p className="text-xs text-[#475569]">
              Freezing withdrawals moved to Account settings in the sidebar.
              Bans stay here.
            </p>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className={`${CARD} space-y-4`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                  Banned Wallets
                </h3>
                {loading ? (
                  <SkeletonRows count={3} avatar={false} lines={2} label="Loading banned wallets..." />
                ) : bannedAccounts.length === 0 ? (
                  <p className="text-xs text-[#64748b]">No banned wallets.</p>
                ) : (
                  <div className="space-y-2">
                    {bannedAccounts.map((b) => (
                      <BanRow
                        key={b.address}
                        target={b.address}
                        reason={b.reason}
                        onUnban={() => handleUnban("ACCOUNT", b.address)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className={`${CARD} space-y-4`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                  Banned IPs
                </h3>
                {loading ? (
                  <SkeletonRows count={3} avatar={false} lines={2} label="Loading banned IPs..." />
                ) : bannedIps.length === 0 ? (
                  <p className="text-xs text-[#64748b]">No banned IPs.</p>
                ) : (
                  <div className="space-y-2">
                    {bannedIps.map((b) => (
                      <BanRow
                        key={b.ip}
                        target={b.ip}
                        reason={b.reason}
                        onUnban={() => handleUnban("IP", b.ip)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "account-settings" && (
          <div className={`${CARD} space-y-4`}>
            <AdminAccountSettingsView key={refreshCounter} viewerWallet={viewerWallet} />
          </div>
        )}

        {tab === "analytics" && (
          <div className="space-y-6">
            {/* Header with Title & Refresh */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div>
                <span className={LABEL}>Protocol Analytics</span>
                <h2 className="text-xl font-black tracking-tight text-[#0f172a] mt-0.5">
                  Performance & On-Chain Intelligence
                </h2>
                <p className="text-xs text-[#64748b] mt-0.5">
                  {analytics?.generatedAt
                    ? `Live data as of ${new Date(analytics.generatedAt).toLocaleTimeString()}`
                    : "Live aggregation on Arc Mainnet"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadAnalytics}
                  disabled={analyticsLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2 text-xs font-bold text-[#2775ca] hover:bg-[#f8fafc] transition shadow-sm disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${analyticsLoading ? "animate-spin" : ""}`} />
                  Refresh Data
                </button>
              </div>
            </div>

            {/* Dual Sidebar Layout: SubSidebar on Left, Section View on Right */}
            <div className="flex flex-col lg:flex-row items-start gap-6">
              {/* Analytics Sub-Sidebar */}
              <AnalyticsSubSidebar
                activeSection={analyticsSection}
                onSelectSection={setAnalyticsSection}
                badges={{
                  volume: analytics?.volume?.last30DaysUsdc ? `$${analytics.volume.last30DaysUsdc}` : undefined,
                  subscriptions: analytics?.subscriptions?.activeTotal,
                  growth: analytics?.growth?.usersTotal,
                  kycPending: analytics?.kyc?.pending,
                  hasHealthWarning: Boolean(
                    (analytics?.health?.stuckReceipts ?? 0) > 0 ||
                    sponsor?.underfunded ||
                    (analytics?.health?.downgradeFailures ?? 0) > 0
                  ),
                }}
              />

              {/* Sub-Section Content Area */}
              <div className="flex-1 min-w-0 w-full">
                {analyticsLoading ? (
                  analyticsSection === "volume" ? (
                    <VolumeSkeleton />
                  ) : analyticsSection === "subscriptions" ? (
                    <SubscriptionsSkeleton />
                  ) : analyticsSection === "growth" ? (
                    <GrowthSkeleton />
                  ) : analyticsSection === "kyc" ? (
                    <KycSkeleton />
                  ) : (
                    <HealthSkeleton />
                  )
                ) : !analytics ? (
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center text-xs text-[#64748b]">
                    No analytics available. Click &quot;Refresh Data&quot; to fetch latest protocol metrics.
                  </div>
                ) : (
                  <>
                    {analyticsSection === "volume" && (
                      <VolumeView analytics={analytics} />
                    )}
                    {analyticsSection === "subscriptions" && (
                      <SubscriptionsView analytics={analytics} />
                    )}
                    {analyticsSection === "growth" && (
                      <GrowthView analytics={analytics} />
                    )}
                    {analyticsSection === "kyc" && (
                      <KycView
                        analytics={analytics}
                        onNavigateToKycTab={() => setTab("kyc")}
                      />
                    )}
                    {analyticsSection === "health" && (
                      <HealthView analytics={analytics} sponsor={sponsor} />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "merchant-access" && (
          <div className="space-y-6">
            {/* 1. The switch. Deliberately first: everything below behaves differently
                   depending on it, and an operator should never have to guess which mode
                   they are looking at. */}
            <div
              className={`${CARD} space-y-4 ${
                maEnforcement?.enabled ? "border-[#2775ca]/40" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={LABEL}>Invite-only merchant signup</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                    maEnforcement?.enabled
                      ? "bg-[#2775ca]/10 text-[#2775ca] border-[#2775ca]/30"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  {maEnforcement?.enabled ? "Enforced" : "Not live yet"}
                </span>
              </div>

              <p className="text-[11px] leading-relaxed text-[#475569]">
                {maEnforcement?.enabled
                  ? "Only emails granted below can open a merchant account. Everyone else who signs up gets a personal user account."
                  : "Merchant signup is open to anyone right now. Turn this on and only the emails you grant below can open a merchant account — every other signup becomes a user account."}{" "}
                A user account is never upgraded to a merchant account, in either mode.
              </p>

              {!maEnforcement?.isMainnet && (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
                  <span className="font-bold">This is a mainnet control.</span> You&apos;re on
                  testnet — grant emails now so the queue is ready, but leave the switch off until
                  mainnet.
                </p>
              )}

              {maEnforcement?.source === "env" ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-[#475569]">
                  Forced on by{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[#0f172a]">
                    ALLOW_PUBLIC_MERCHANT_SIGNUP=false
                  </code>
                  . Clear that env var and redeploy to manage it from here.
                </p>
              ) : !viewerIsRoot ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-[#475569]">
                  You can grant and revoke merchant access below, but only a root admin can change
                  whether merchant signup is invite-only at all.
                </p>
              ) : !flags ? (
                <SkeletonCard label="Loading the invite-only switch" lines={1} />
              ) : flags.merchantInviteOnlyEnabled ? (
                <button
                  type="button"
                  onClick={() =>
                    updateFlag({ merchantInviteOnlyEnabled: false }, "merchantInviteOnly")
                  }
                  disabled={flagBusy === "merchantInviteOnly"}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-black uppercase tracking-wider text-[#0f172a] transition hover:bg-slate-50 disabled:opacity-40"
                >
                  {flagBusy === "merchantInviteOnly" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Reopen public merchant signup"
                  )}
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={maInviteOnlyConfirm}
                    onChange={(e) => setMaInviteOnlyConfirm(e.target.value)}
                    placeholder={`Type "${MERCHANT_INVITE_ONLY_CONFIRMATION}" to arm`}
                    className={INPUT}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      updateFlag({ merchantInviteOnlyEnabled: true }, "merchantInviteOnly");
                      setMaInviteOnlyConfirm("");
                    }}
                    disabled={
                      flagBusy === "merchantInviteOnly" ||
                      maInviteOnlyConfirm.trim().toLowerCase() !==
                        MERCHANT_INVITE_ONLY_CONFIRMATION
                    }
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2775ca] py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#1d5fb0] disabled:opacity-30 shadow-sm"
                  >
                    {flagBusy === "merchantInviteOnly" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Make merchant signup invite-only"
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* 2. The queue. */}
            <div className={`${CARD} space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                  Access requests
                </h3>
                <select
                  value={maStatusFilter}
                  onChange={(e) => setMaStatusFilter(e.target.value)}
                  className={`${INPUT} sm:w-44`}
                >
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="DECLINED">Declined</option>
                  <option value="ALL">All</option>
                </select>
              </div>

              {maLoading ? (
                <SkeletonRows count={3} label="Loading merchant access requests" />
              ) : maRequests.length === 0 ? (
                <p className="text-xs text-[#64748b]">
                  Nothing here. Businesses land in this queue from{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-[#0f172a]">
                    /merchant-access
                  </code>
                  , or you can grant an email directly below.
                </p>
              ) : (
                <div className="space-y-3">
                  {maRequests.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#0f172a] truncate">
                            {r.companyName || "Unnamed business"}
                          </p>
                          <p className="font-mono text-[11px] text-[#475569] break-all">
                            {r.email}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                            r.status === "PENDING"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : r.status === "APPROVED"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                : "bg-slate-100 text-[#475569] border-slate-200"
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>

                      <dl className="grid gap-x-4 gap-y-1 text-[11px] text-[#475569] sm:grid-cols-2">
                        {r.contactName && (
                          <div>
                            <dt className="inline font-bold text-[#0f172a]">Contact: </dt>
                            <dd className="inline">{r.contactName}</dd>
                          </div>
                        )}
                        {r.website && (
                          <div className="min-w-0">
                            <dt className="inline font-bold text-[#0f172a]">Site: </dt>
                            <dd className="inline break-all">{r.website}</dd>
                          </div>
                        )}
                        {r.useCase && (
                          <div>
                            <dt className="inline font-bold text-[#0f172a]">Use case: </dt>
                            <dd className="inline">{r.useCase}</dd>
                          </div>
                        )}
                        {r.monthlyVolume && (
                          <div>
                            <dt className="inline font-bold text-[#0f172a]">Volume: </dt>
                            <dd className="inline">{r.monthlyVolume}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="inline font-bold text-[#0f172a]">Submitted: </dt>
                          <dd className="inline">
                            {new Date(r.createdAt).toLocaleString()}
                          </dd>
                        </div>
                      </dl>

                      {r.status === "PENDING" ? (
                        <div className="space-y-2 border-t border-slate-200 pt-3">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              type="text"
                              value={maDeclineDraft[r.id] || ""}
                              onChange={(e) =>
                                setMaDeclineDraft((prev) => ({
                                  ...prev,
                                  [r.id]: e.target.value,
                                }))
                              }
                              placeholder="Note — sent with an approval, required to decline"
                              className={`${INPUT} sm:flex-1`}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  grantMerchantAccess(r.email, {
                                    requestId: r.id,
                                    note: maDeclineDraft[r.id],
                                  })
                                }
                                disabled={maBusy === `grant:${r.id}`}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-700 disabled:opacity-40 shadow-sm"
                              >
                                {maBusy === `grant:${r.id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Approve"
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => declineMerchantRequest(r.id)}
                                disabled={maBusy === `decline:${r.id}`}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-[#0f172a] transition hover:bg-slate-50 disabled:opacity-40"
                              >
                                {maBusy === `decline:${r.id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Decline"
                                )}
                              </button>
                            </div>
                          </div>
                          <p className="text-[10px] text-[#64748b]">
                            Approving emails them an invite link tied to {r.email} and nothing else.
                            Declining is silent — reach out yourself if it deserves a reply.
                          </p>
                        </div>
                      ) : (
                        <p className="border-t border-slate-200 pt-3 text-[11px] text-[#64748b]">
                          {r.status === "APPROVED" ? "Approved" : "Declined"}
                          {r.decidedBy
                            ? ` by ${r.decidedBy.slice(0, 6)}...${r.decidedBy.slice(-4)}`
                            : ""}
                          {r.decidedAt ? ` on ${new Date(r.decidedAt).toLocaleString()}` : ""}
                          {r.decisionNote ? ` — "${r.decisionNote}"` : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Live grants — the list that actually decides who can sign up. */}
            <div className={`${CARD} space-y-3`}>
              <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                Merchant grants
              </h3>
              <p className="text-[11px] text-[#475569]">
                An invite link only works for the email it was issued to, so forwarding one grants
                nothing.
              </p>

              {maLoading ? (
                <SkeletonRows count={3} label="Loading merchant grants" />
              ) : maGrants.length === 0 ? (
                <p className="text-xs text-[#64748b]">No merchant grants yet.</p>
              ) : (
                <div className="space-y-2">
                  {maGrants.map((g) => (
                    <div
                      key={g.email}
                      className={`rounded-2xl border p-3.5 text-xs space-y-2.5 ${
                        g.revokedAt
                          ? "border-slate-200 bg-slate-100 opacity-70"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono font-bold text-[#0f172a] break-all">
                            {g.email}
                          </p>
                          <p className="mt-0.5 text-[10px] text-[#64748b]">
                            Granted by {g.grantedBy.slice(0, 6)}...{g.grantedBy.slice(-4)} on{" "}
                            {new Date(g.createdAt).toLocaleDateString()}
                            {g.note ? ` — "${g.note}"` : ""}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                            g.revokedAt
                              ? "bg-red-50 text-red-800 border-red-200"
                              : g.claimedAt
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                : "bg-amber-50 text-amber-800 border-amber-200"
                          }`}
                        >
                          {g.revokedAt ? "Revoked" : g.claimedAt ? "Claimed" : "Unclaimed"}
                        </span>
                      </div>

                      {g.claimedAt && (
                        <p className="text-[10px] text-[#64748b] break-all">
                          Opened {new Date(g.claimedAt).toLocaleString()}
                          {g.claimedWallet ? ` by ${g.claimedWallet}` : ""}
                        </p>
                      )}
                      {g.revokedAt && g.revokeReason && (
                        <p className="text-[10px] text-red-800">
                          Revoked: {g.revokeReason}
                        </p>
                      )}

                      {!g.revokedAt && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => copyInviteLink(g)}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#0f172a] transition hover:bg-slate-50"
                          >
                            <Copy className="h-3 w-3" />
                            {maCopiedEmail === g.email ? "Copied" : "Copy invite link"}
                          </button>
                          {!g.claimedAt && (
                            <button
                              type="button"
                              onClick={() => regenerateMerchantInvite(g.email)}
                              disabled={maBusy === `regen:${g.email}`}
                              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-[#0f172a] transition hover:bg-slate-50 disabled:opacity-40"
                            >
                              {maBusy === `regen:${g.email}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              New link
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => revokeMerchantGrant(g.email)}
                            disabled={maBusy === `revoke:${g.email}`}
                            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-800 transition hover:bg-red-100 disabled:opacity-40"
                          >
                            {maBusy === `revoke:${g.email}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            Revoke
                          </button>
                        </div>
                      )}
                      {g.claimedAt && !g.revokedAt && (
                        <p className="text-[10px] text-[#64748b]">
                          Revoking now kills the link but leaves the merchant account
                          running. Ban it under Moderation, or freeze its withdrawals
                          under Account settings.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. For businesses that reached us somewhere other than the form. */}
            <div className={`${CARD} space-y-3`}>
              <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                Grant access directly
              </h3>
              <p className="text-[11px] text-[#475569]">
                For a business that reached you on X or by email instead of the request form. The
                email can&apos;t already have a SubScript account — a user account is never upgraded
                to a merchant account.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  grantMerchantAccess(maGrantEmail, { note: maGrantNote });
                }}
                className="flex flex-col gap-3 sm:flex-row sm:items-center"
              >
                <input
                  type="email"
                  value={maGrantEmail}
                  onChange={(e) => setMaGrantEmail(e.target.value)}
                  placeholder="billing@company.com"
                  className={`${INPUT} sm:flex-1`}
                />
                <input
                  type="text"
                  value={maGrantNote}
                  onChange={(e) => setMaGrantNote(e.target.value)}
                  placeholder="Note (optional)"
                  className={`${INPUT} sm:w-56`}
                />
                <button
                  type="submit"
                  disabled={
                    maBusy === `grant:${maGrantEmail.trim()}` || !maGrantEmail.trim()
                  }
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#2775ca] px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#1d5fb0] disabled:opacity-40 shadow-sm"
                >
                  {maBusy === `grant:${maGrantEmail.trim()}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Grant
                </button>
              </form>
            </div>
          </div>
        )}

        {tab === "system" && (
          <div className="space-y-6">
            <AdminSystemHealthCard key={refreshCounter} />
            <AdminRelayerBalancesCard key={refreshCounter} />
            {!flags || flagsLoading ? (
              <>
                <SkeletonToggleRows
                  count={2}
                  label="Loading sign-in method switches"
                />
                <SkeletonCard label="Loading maintenance mode" lines={2} />
              </>
            ) : (
              <>
                <div className={`${CARD} space-y-4`}>
                  <span className={LABEL}>Sign-in methods</span>

                  <Toggle
                    title="Continue with Google"
                    description={
                      flags.googleEnvConfigured === false
                        ? "Disabled at build time (NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED is unset), so this switch has no effect until that env var is set and deployed."
                        : "Turning this off hides the button and makes the server refuse the flow, so an open tab cannot still use it."
                    }
                    enabled={flags.googleSigninEnabled}
                    disabled={
                      flagBusy === "google" ||
                      flags.googleEnvConfigured === false
                    }
                    busy={flagBusy === "google"}
                    onToggle={() =>
                      updateFlag(
                        { googleSigninEnabled: !flags.googleSigninEnabled },
                        "google"
                      )
                    }
                  />

                  <Toggle
                    title="Connect external wallet"
                    description="Hides every connect-wallet button and makes /api/auth/verify-signature refuse the signature, so an open tab cannot still sign in. Also removes browser-wallet payment from checkout — payers fall back to signing in and paying from their SubScript wallet. Email and embedded wallets are unaffected."
                    enabled={flags.externalWalletEnabled}
                    disabled={flagBusy === "wallet"}
                    busy={flagBusy === "wallet"}
                    onToggle={() =>
                      updateFlag(
                        { externalWalletEnabled: !flags.externalWalletEnabled },
                        "wallet"
                      )
                    }
                  />

                  <Toggle
                    title="Local Bank Transfer"
                    description="Controls whether the Local Bank Transfer option is offered in the user deposit modal. Turning this off disables and hides local bank transfers for all users across the platform."
                    enabled={flags.localBankTransferEnabled}
                    disabled={flagBusy === "bank"}
                    busy={flagBusy === "bank"}
                    onToggle={() =>
                      updateFlag(
                        { localBankTransferEnabled: !flags.localBankTransferEnabled },
                        "bank"
                      )
                    }
                  />
                </div>

                <div
                  className={`${CARD} space-y-4 ${
                    flags.maintenanceEnabled ? "border-red-500/40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={LABEL}>Maintenance Mode</span>
                    {flags.maintenanceEnabled && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-800 border border-red-200">
                        Site is down
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#475569]">
                    Returns 503 across the whole product. This console, the
                    admin API, and sign-in stay reachable so you can always turn
                    it back off.
                  </p>

                  <input
                    type="text"
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    placeholder="Message shown to visitors (optional)"
                    className={INPUT}
                  />

                  {flags.maintenanceEnabled ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateFlag({ maintenanceEnabled: false }, "maintenance")
                      }
                      disabled={flagBusy === "maintenance"}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-emerald-700 disabled:opacity-40 shadow-sm"
                    >
                      {flagBusy === "maintenance" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Bring the site back online"
                      )}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={maintenanceConfirm}
                        onChange={(e) => setMaintenanceConfirm(e.target.value)}
                        placeholder='Type "take it down" to arm'
                        className={INPUT}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateFlag(
                            {
                              maintenanceEnabled: true,
                              maintenanceMessage:
                                maintenanceMessage.trim() || null,
                            },
                            "maintenance"
                          )
                        }
                        disabled={
                          flagBusy === "maintenance" ||
                          maintenanceConfirm.trim().toLowerCase() !==
                            "take it down"
                        }
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-red-700 disabled:opacity-30 shadow-sm"
                      >
                        {flagBusy === "maintenance" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Take SubScript down"
                        )}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => prepareMaintenanceBroadcast(flags.maintenanceEnabled)}
                    className="w-full rounded-xl border border-[#2775ca]/30 bg-[#2775ca]/10 py-2.5 text-xs font-bold text-[#2775ca] transition hover:bg-[#2775ca]/20"
                  >
                    Prepare {flags.maintenanceEnabled ? "back-online" : "app-down"} notification
                  </button>
                  <p className="text-[10px] text-[#64748b]">
                    The notification is prepared for users and merchants and includes {SUPPORT_EMAIL}.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "broadcast" && (
          <div className="space-y-6">
            <div className={`${CARD} space-y-4`}>
              <div className="flex items-center justify-between">
                <span className={LABEL}>Push Notification</span>
                <Bell className="h-5 w-5 text-[#2775ca]" />
              </div>
              <p className="text-[11px] text-[#475569]">
                Delivered to everyone in the audience who has push enabled. This
                cannot be recalled once sent — preview it on your own wallet
                first.
              </p>

              <div className="flex flex-wrap gap-2">
                {(["users", "merchants", "both"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      setBcAudience(a);
                      setBcConfirm("");
                    }}
                    className={`rounded-xl px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${
                      bcAudience === a
                        ? "bg-[#2775ca]/15 border border-[#2775ca]/40 text-[#2775ca]"
                        : "border border-slate-200 bg-white text-[#475569] hover:bg-slate-100"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={bcTitle}
                onChange={(e) => setBcTitle(e.target.value)}
                placeholder="Notification title"
                maxLength={120}
                className={INPUT}
              />
              <textarea
                value={bcBody}
                onChange={(e) => setBcBody(e.target.value)}
                placeholder="Message body"
                maxLength={400}
                rows={3}
                className={`${INPUT} resize-none`}
              />
              <input
                type="text"
                value={bcUrl}
                onChange={(e) => setBcUrl(e.target.value)}
                placeholder="Link to open on tap (optional, e.g. /dashboard)"
                className={INPUT}
              />

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => sendBroadcast(true)}
                  disabled={
                    bcBusy !== null || !bcTitle.trim() || !bcBody.trim()
                  }
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 shadow-sm"
                >
                  {bcBusy === "preview" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Send to myself first"
                  )}
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2">
                <input
                  type="text"
                  value={bcConfirm}
                  onChange={(e) => setBcConfirm(e.target.value)}
                  placeholder={`Type "${bcAudience}" to confirm the audience`}
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={() => sendBroadcast(false)}
                  disabled={
                    bcBusy !== null ||
                    !bcTitle.trim() ||
                    !bcBody.trim() ||
                    bcConfirm.trim().toLowerCase() !== bcAudience
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2775ca] py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#1d5fb0] disabled:opacity-30 shadow-sm"
                >
                  {bcBusy === "send" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Send to all ${bcAudience}`
                  )}
                </button>
              </div>
            </div>

            {analyticsLoading ? (
              <div className={`${CARD} space-y-3`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                  Recent Broadcasts
                </h3>
                <SkeletonRows count={3} avatar={false} lines={2} label="Loading broadcast history..." />
              </div>
            ) : analytics && (analytics.recentBroadcasts || []).length > 0 ? (
              <div className={`${CARD} space-y-3`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                  Recent Broadcasts
                </h3>
                <div className="space-y-2">
                  {analytics.recentBroadcasts.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-xs flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-[#0f172a] truncate">
                            {b.title}
                          </p>
                          <span className="text-[10px] text-[#64748b] shrink-0">
                            {new Date(b.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#475569]">
                          {b.audience} · {b.sentCount}/{b.totalRecipients}{" "}
                          delivered
                          {b.failedCount > 0 && ` · ${b.failedCount} failed`}
                        </p>
                      </div>
                      {Boolean(b.id) && (
                        <button
                          type="button"
                          onClick={() => deleteBroadcast(b.id)}
                          disabled={deletingBroadcastId === b.id}
                          className="p-2 rounded-xl text-red-600 hover:bg-red-50 transition border border-transparent hover:border-red-200 shrink-0 disabled:opacity-40"
                          title="Delete broadcast record"
                        >
                          {deletingBroadcastId === b.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {tab === "receipts" && (
          <div className={`${CARD} space-y-4`}>
            <div className="flex items-center justify-between">
              <span className={LABEL}>Receipt Access</span>
              <ReceiptText className="h-5 w-5 text-[#2775ca]" />
            </div>
            <h3 className="text-base font-bold text-[#0f172a]">
              Invite an address to view a receipt
            </h3>
            <p className="text-[11px] text-[#475569]">
              Grants a wallet permission to view someone else&apos;s payment
              record. The reason is recorded in the audit log alongside the
              payer and merchant.
            </p>

            <form onSubmit={inviteToReceipt} className="space-y-3 max-w-lg">
              <input
                type="text"
                value={invReceiptId}
                onChange={(e) => setInvReceiptId(e.target.value)}
                placeholder="Receipt ID"
                className={INPUT}
              />
              <input
                type="text"
                value={invAddress}
                onChange={(e) => setInvAddress(e.target.value)}
                placeholder="0x... address to grant access"
                className={INPUT}
              />
              <input
                type="text"
                value={invReason}
                onChange={(e) => setInvReason(e.target.value)}
                placeholder="Reason (required — e.g. support ticket #123)"
                className={INPUT}
              />
              <button
                type="submit"
                disabled={
                  invBusy ||
                  !invReceiptId.trim() ||
                  !invAddress.trim() ||
                  invReason.trim().length < 3
                }
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2775ca] py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#1d5fb0] disabled:opacity-40 shadow-sm"
              >
                {invBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Grant access"
                )}
              </button>
            </form>
          </div>
        )}

        {tab === "audit-log" && (
          <div className={`${CARD} space-y-4`}>
            <AdminAuditLogView key={refreshCounter} viewerWallet={viewerWallet} />
          </div>
        )}

        {tab === "admins" && (
          <div className="space-y-6">
            <div className={CARD}>
              <div className="flex items-center justify-between mb-4">
                <span className={LABEL}>Access Management</span>
                <Users className="h-5 w-5 text-[#2775ca]" />
              </div>
              <h3 className="text-base font-bold text-[#0f172a]">Admin Wallets</h3>
              <p className="mt-1 text-[11px] text-[#475569]">
                <span className="font-bold text-[#0f172a]">Root</span> admins
                come from the{" "}
                <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[#0f172a]">ADMIN_WALLET_ADDRESSES</code>{" "}
                environment variable and cannot be revoked here — that is the
                recovery path if this console is ever misconfigured. Only root
                admins can grant or revoke access.
              </p>

              {viewerIsRoot ? (
                <form onSubmit={handleGrantAdmin} className="mt-4 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={newAdminWallet}
                      onChange={(e) => setNewAdminWallet(e.target.value)}
                      placeholder="0x... wallet address"
                      className={`${INPUT} sm:flex-1`}
                    />
                    <input
                      type="text"
                      value={newAdminLabel}
                      onChange={(e) => setNewAdminLabel(e.target.value)}
                      placeholder="Alias (optional)"
                      className={`${INPUT} sm:w-48`}
                    />
                  </div>

                  {/* Scopes are required. The submit stays disabled until one is picked, because a
                      grant with no scopes is refused server-side anyway and a silent default is
                      how every admin ended up with full powers in the first place. */}
                  <div>
                    <p className="text-[11px] font-bold text-[#0f172a]">
                      What may this admin do?
                    </p>
                    <p className="text-[11px] text-[#475569]">
                      Pick the narrowest set that lets them do their job. You can widen it later.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {availableScopes.map((scope) => {
                        const selected = newAdminScopes.includes(scope);
                        return (
                          <button
                            key={scope}
                            type="button"
                            onClick={() =>
                              setNewAdminScopes((prev) =>
                                prev.includes(scope)
                                  ? prev.filter((s) => s !== scope)
                                  : [...prev, scope],
                              )
                            }
                            className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                              selected
                                ? "border-[#2775ca] bg-[#2775ca] text-white"
                                : "border-slate-300 bg-white text-[#475569] hover:border-[#2775ca]"
                            }`}
                          >
                            {scope}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={newAdminReason}
                      onChange={(e) => setNewAdminReason(e.target.value)}
                      placeholder="Why do they need access? (optional, but future you will want it)"
                      className={`${INPUT} sm:flex-1`}
                    />
                    <button
                      type="submit"
                      disabled={adminBusy || !newAdminWallet.trim() || newAdminScopes.length === 0}
                      className="flex items-center justify-center gap-2 rounded-xl bg-[#2775ca] px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#1d5fb0] disabled:opacity-40 shadow-sm"
                    >
                      {adminBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Grant
                    </button>
                  </div>
                </form>
              ) : (
                <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-[#475569]">
                  You have admin access but are not a root admin, so you cannot
                  add or remove admins.
                </p>
              )}
            </div>

            <div className={`${CARD} space-y-3`}>
              <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                Current Admins
              </h3>
              {adminsLoading ? (
                <SkeletonRows count={4} label="Loading administrators" />
              ) : admins.length === 0 ? (
                <p className="text-xs text-[#64748b]">No admins found.</p>
              ) : (
                <div className="space-y-2">
                  {admins.map((a) => (
                    <div
                      key={a.wallet}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Shield
                          className={`h-4 w-4 shrink-0 ${
                            a.tier === "root"
                              ? "text-[#2775ca]"
                              : "text-slate-400"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono font-bold text-[#0f172a] truncate">
                            {a.adminHandle || (a.tier === "root" ? "Chuks.admin" : (a.label ? `${a.label}.admin` : "Admin.admin"))}
                          </p>
                          <p className="font-mono text-[10px] text-[#64748b] truncate">
                            {a.wallet} {a.tier === "root" && "• Root authority"}
                          </p>
                          {a.tier === "root" ? (
                            <p className="text-[10px] text-[#64748b]">
                              Root — configured in environment, not revocable here
                            </p>
                          ) : editingAdminWallet === a.wallet ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleUpdateAdminAlias(a.wallet);
                              }}
                              className="mt-1.5 flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={editAdminAliasValue}
                                onChange={(e) =>
                                  setEditAdminAliasValue(e.target.value)
                                }
                                placeholder="Admin alias..."
                                maxLength={120}
                                className={`${INPUT} !py-1 !px-2.5 !text-[11px] max-w-[200px]`}
                                autoFocus
                              />
                              <button
                                type="submit"
                                disabled={aliasUpdateBusy}
                                className="flex items-center gap-1 rounded-lg bg-[#2775ca] px-2.5 py-1 text-[10px] font-bold text-white hover:bg-[#1d5fb0] transition disabled:opacity-40"
                              >
                                {aliasUpdateBusy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "Save"
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAdminWallet(null);
                                  setEditAdminAliasValue("");
                                }}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition"
                              >
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-[#64748b] mt-0.5">
                              {a.label ? (
                                <span className="font-bold text-[#0f172a] bg-slate-200 px-1.5 py-0.5 rounded border border-slate-300">
                                  {a.label}
                                </span>
                              ) : (
                                <span className="italic text-slate-400">
                                  No alias
                                </span>
                              )}
                              {viewerIsRoot && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAdminWallet(a.wallet);
                                    setEditAdminAliasValue(a.label || "");
                                  }}
                                  className="inline-flex items-center justify-center h-4 w-4 rounded text-slate-400 hover:text-[#2775ca] transition ml-0.5"
                                  title={a.label ? "Edit alias" : "Set alias"}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                              <span>·</span>
                              <span>
                                Granted by{" "}
                                {a.grantedBy
                                  ? `${a.grantedBy.slice(0, 10)}…`
                                  : "unknown"}
                              </span>
                              {a.expiresAt && (
                                <>
                                  <span>·</span>
                                  <span>
                                    {a.expired ? "Expired" : "Expires"}{" "}
                                    {new Date(a.expiresAt).toLocaleDateString()}
                                  </span>
                                </>
                              )}
                            </div>
                          )}

                          {/* Scopes. Root can click a chip to grant or take it away; everyone else
                              sees the same set read-only, because knowing what a colleague can do
                              is not sensitive but changing it is. */}
                          {a.tier === "delegated" && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {availableScopes.map((scope) => {
                                const held = (a.scopes || []).includes(scope);
                                if (!viewerIsRoot && !held) return null;
                                const busy = scopeBusyWallet === a.wallet;
                                return (
                                  <button
                                    key={scope}
                                    type="button"
                                    disabled={!viewerIsRoot || busy}
                                    onClick={() => handleToggleAdminScope(a, scope)}
                                    title={
                                      viewerIsRoot
                                        ? held
                                          ? `Remove "${scope}"`
                                          : `Grant "${scope}"`
                                        : undefined
                                    }
                                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold border transition disabled:opacity-50 ${
                                      held
                                        ? "border-[#2775ca]/30 bg-[#2775ca]/10 text-[#2775ca]"
                                        : "border-slate-200 bg-white text-slate-400 hover:border-[#2775ca]"
                                    } ${viewerIsRoot ? "cursor-pointer" : "cursor-default"}`}
                                  >
                                    {scope}
                                  </button>
                                );
                              })}
                              {a.grantReason && (
                                <span className="ml-1 text-[10px] italic text-[#475569]">
                                  {a.grantReason}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {a.tier === "delegated" && a.legacyFullScope && (
                          <span
                            className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-800"
                            title="Granted before scopes existed, so it was backfilled with everything except governance. Narrow it to what they actually need."
                          >
                            needs narrowing
                          </span>
                        )}
                        {a.tier === "delegated" && a.expired && (
                          <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                            expired
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                            a.tier === "root"
                              ? "bg-[#2775ca]/10 border-[#2775ca]/30 text-[#2775ca]"
                              : "bg-slate-100 border-slate-200 text-slate-700"
                          }`}
                        >
                          {a.tier}
                        </span>
                        {a.tier === "delegated" && viewerIsRoot && (
                          <button
                            type="button"
                            onClick={() => handleRevokeAdmin(a.wallet)}
                            className="flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100 transition"
                          >
                            <Trash2 className="h-3 w-3" />
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  </div>
</div>

      <AdminTransactionInspectorModal
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
      />

      <AdminMerchantCatalogModal
        merchantAddress={catalogMerchantAddress}
        isOpen={Boolean(catalogMerchantAddress)}
        onClose={() => setCatalogMerchantAddress(null)}
      />
</div>
);
}

function Stat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number | string;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        danger
          ? "border-amber-300 bg-amber-50"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <p
        className={`text-2xl font-black ${
          danger ? "text-amber-800" : "text-[#0f172a]"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
        {label}
      </p>
    </div>
  );
}

/* Status chip for the KYC queue */
function KycStatusPill({ status }: { status: string }) {
  const tone =
    status === "APPROVED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : status === "REJECTED" || status === "REVOKED"
      ? "border-red-200 bg-red-50 text-red-900"
      : status === "NEEDS_INPUT" || status === "EXPIRED"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-100 text-slate-800";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${tone}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/* Switch row for the System tab */
function Toggle({
  title,
  description,
  enabled,
  disabled,
  busy,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-[#0f172a]">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#475569]">
          {description}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={enabled}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40 ${
          enabled
            ? "border-[#2775ca] bg-[#2775ca]"
            : "border-slate-300 bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full transition-all ${
            enabled ? "left-6 bg-white shadow-sm" : "left-1 bg-white shadow-sm"
          }`}
        />
        {busy && (
          <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />
        )}
      </button>
    </div>
  );
}

function BanRow({
  target,
  reason,
  onUnban,
}: {
  target: string;
  reason?: string | null;
  onUnban: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="min-w-0">
        <p className="font-mono font-bold text-[#0f172a] truncate">{target}</p>
        {reason && <p className="text-[10px] text-[#475569]">{reason}</p>}
      </div>
      <button
        type="button"
        onClick={onUnban}
        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100 transition shrink-0 shadow-sm"
      >
        Unban
      </button>
    </div>
  );
}

