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
} from "@/components/icons";
import {
  SkeletonCard,
  SkeletonRows,
  SkeletonStatGrid,
  SkeletonToggleRows,
} from "@/components/ui/skeletons";
import { AdminOverviewDashboard } from "@/components/admin/overview/AdminOverviewDashboard";
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
} from "@/components/admin/analytics/AnalyticsSkeletons";

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

/* Which exits a hold closes. One address can be both a merchant and a user, and the two
   withdraw through different endpoints, so freezing a merchant payout must not have to
   freeze that same person's consumer vault refunds. */
type HoldScope = "USER" | "MERCHANT" | "BOTH";

type WithdrawalHold = {
  address: string;
  scope: HoldScope;
  reason?: string | null;
  placedBy: string;
  expiresAt: string | null;
  createdAt: string;
  /* Server-computed. An expired row is kept for the audit trail but no longer blocks. */
  active: boolean;
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
  grantedBy?: string;
  createdAt?: string;
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
  googleEnvConfigured?: boolean;
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
  | "merchants"
  | "kyc"
  | "moderation"
  | "system"
  | "broadcast"
  | "receipts"
  | "admins";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Analytics" },
  { id: "merchants", label: "Merchants" },
  { id: "kyc", label: "KYC" },
  { id: "moderation", label: "Moderation" },
  { id: "system", label: "System" },
  { id: "broadcast", label: "Broadcast" },
  { id: "receipts", label: "Receipts" },
  { id: "admins", label: "Admins" },
];

const CARD =
  "rounded-xl border border-[#e2e8f0] bg-white p-6 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]";
const LABEL = "text-[10px] font-black uppercase tracking-wider text-[#64748b]";
const INPUT =
  "w-full rounded-lg border border-[#cbd5e1] bg-white px-3.5 py-2 text-xs text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#2775ca] focus:outline-none focus:ring-2 focus:ring-[#2775ca]/15";

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

  const [copied, setCopied] = useState(false);
  const [copiedMerchant, setCopiedMerchant] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  const [banType, setBanType] = useState<"ACCOUNT" | "IP">("ACCOUNT");
  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banBusy, setBanBusy] = useState(false);

  const [holds, setHolds] = useState<WithdrawalHold[]>([]);
  const [holdsLoading, setHoldsLoading] = useState(false);
  const [holdTarget, setHoldTarget] = useState("");
  const [holdScope, setHoldScope] = useState<HoldScope>("BOTH");
  const [holdReason, setHoldReason] = useState("");
  const [holdExpiry, setHoldExpiry] = useState("");
  const [holdBusy, setHoldBusy] = useState<string | null>(null);

  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [newAdminWallet, setNewAdminWallet] = useState("");
  const [newAdminLabel, setNewAdminLabel] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [editingAdminWallet, setEditingAdminWallet] = useState<string | null>(null);
  const [editAdminAliasValue, setEditAdminAliasValue] = useState("");
  const [aliasUpdateBusy, setAliasUpdateBusy] = useState(false);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [overviewData, setOverviewData] = useState<any>(null);
  const [analyticsSection, setAnalyticsSection] = useState<AnalyticsSectionId>("volume");

  const [flags, setFlags] = useState<PlatformFlags | null>(null);
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  /* Typing the word arms the switch. Maintenance takes the whole product down, so it
     should not be one misplaced click away. */
  const [maintenanceConfirm, setMaintenanceConfirm] = useState("");

  const [bcTitle, setBcTitle] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcUrl, setBcUrl] = useState("");
  const [bcAudience, setBcAudience] = useState<"users" | "merchants" | "both">(
    "users"
  );
  const [bcConfirm, setBcConfirm] = useState("");
  const [bcBusy, setBcBusy] = useState<"preview" | "send" | null>(null);

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
    try {
      const res = await fetch("/api/admin/flags");
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to load platform flags");
      setFlags(json);
      setMaintenanceMessage(json.maintenanceMessage || "");
    } catch (err: any) {
      setError(err.message || "Failed to load platform flags");
    }
  }, []);

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

  const updateFlag = async (patch: Record<string, unknown>, key: string) => {
    setFlagBusy(key);
    setError(null);
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
    loadAnalytics();
  }, [loadData, loadAnalytics]);

  /* Declared above the tab effect below, which both calls it and lists it as a dependency. As a
     const it is in the temporal dead zone until this line runs, so declaring it further down threw
     on every render that reached the dependency array. */
  const loadWithdrawalHolds = useCallback(async () => {
    setHoldsLoading(true);
    try {
      const res = await fetch("/api/admin/withdrawal-holds");
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to load withdrawal holds");
      setHolds(json.holds || []);
    } catch (err: any) {
      setError(err.message || "Failed to load withdrawal holds");
    } finally {
      setHoldsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "admins") loadAdmins();
    if (tab === "analytics") loadAnalytics();
    if (tab === "system") loadFlags();
    if (tab === "kyc") loadKyc();
    if (tab === "moderation") loadWithdrawalHolds();
  }, [tab, loadAdmins, loadAnalytics, loadFlags, loadKyc, loadWithdrawalHolds]);

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

  const handlePlaceHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdTarget.trim()) return;
    setHoldBusy("place");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/withdrawal-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: holdTarget.trim(),
          hold: true,
          scope: holdScope,
          reason: holdReason.trim(),
          /* datetime-local yields a value with no zone; let the browser attach the local
             offset so an operator typing 18:00 gets 18:00 their time, not UTC. */
          expiresAt: holdExpiry ? new Date(holdExpiry).toISOString() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to place withdrawal hold");
      setNotice(
        `Withdrawals frozen for ${holdTarget
          .trim()
          .toLowerCase()} (${holdScope}). Logged to the admin audit trail.`
      );
      setHoldTarget("");
      setHoldReason("");
      setHoldExpiry("");
      await loadWithdrawalHolds();
    } catch (err: any) {
      setError(err.message || "Failed to place withdrawal hold");
    } finally {
      setHoldBusy(null);
    }
  };

  const handleLiftHold = async (address: string) => {
    setHoldBusy(address);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/withdrawal-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, hold: false }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to lift withdrawal hold");
      setNotice(
        `Withdrawals released for ${address}. Logged to the admin audit trail.`
      );
      await loadWithdrawalHolds();
    } catch (err: any) {
      setError(err.message || "Failed to lift withdrawal hold");
    } finally {
      setHoldBusy(null);
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
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || "Failed to grant admin access");
      if (json.warning) setNotice(json.warning);
      setNewAdminWallet("");
      setNewAdminLabel("");
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
    { id: "merchants", label: "Merchants", icon: Building2 },
    { id: "kyc", label: "KYC Compliance", icon: ShieldCheck },
    { id: "moderation", label: "Moderation & Bans", icon: ShieldAlert },
    { id: "system", label: "System Flags", icon: Sliders },
    { id: "broadcast", label: "Broadcast", icon: Bell },
    { id: "receipts", label: "Receipts", icon: ReceiptText },
    { id: "admins", label: "Admin Access", icon: Shield },
  ];

  const adminSidebarFooterItems: DashboardSidebarItem[] = [
    { id: "merchant", label: "Merchant Dashboard", icon: Building2, href: "/merchant" },
    { id: "user", label: "User Dashboard", icon: Users, href: "/user" },
    { id: "docs", label: "Documentation", icon: FileText, href: "/support", newTab: true },
  ];

  return (
    <div className="relative overflow-x-hidden bg-[#353935] text-white font-sans md:h-[100dvh] md:overflow-hidden">
      <div className="relative z-10 md:flex md:h-[100dvh] md:min-h-0">
        <DashboardSidebar
          className="topo-admin-header"
          items={adminSidebarItems}
          footerItems={adminSidebarFooterItems}
          activeId={tab}
          onSelect={(id) => setTab(id as TabId)}
          identity={{
            label: viewerIsRoot ? "root.subscript.admin" : "admin.subscriptonarc.com",
            avatarUrl: null,
            fallback: viewerIsRoot ? "R" : "A",
            onClick: () => setTab("admins"),
            title: "Arc Protocol Authority",
          }}
          accent="#2775ca"
          panelColor="#ffffff"
          ariaLabel="Admin Protocol Navigation"
          isLoading={loading && merchants.length === 0}
        />

        <div className="relative z-10 min-w-0 flex-1 md:mt-[14px] md:h-[calc(100vh-14px)] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)] md:rounded-tl-[32px] border-t border-l border-white/10 overflow-y-auto overscroll-contain admin-topography text-[#0f172a]">
          <main className="min-h-screen pt-4 sm:pt-6 pb-16">
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
                    onClick={() => {
                      if (tab === "admins") loadAdmins();
                      else if (tab === "analytics") loadAnalytics();
                      else if (tab === "system") loadFlags();
                      else if (tab === "kyc") loadKyc();
                      else if (tab === "moderation") {
                        loadWithdrawalHolds();
                        loadData();
                      } else loadData();
                    }}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-white/20 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </section>

              <div className="md:hidden flex gap-2 overflow-x-auto rounded-xl border border-[#dbe3ec] bg-white p-2 shadow-sm">
                {TABS.map((t) => (
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
        )}

        {tab === "merchants" && (
          <div className={`${CARD} space-y-4`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wide text-white">
                  Merchant Verifications
                </h2>
                <p className="text-xs text-white/50">
                  Verified merchants show a badge at checkout and in DMs.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/30" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name or address..."
                  className={`${INPUT} pl-9`}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-white/40">
                    <th className="py-3 px-3">Merchant</th>
                    <th className="py-3 px-3">Wallet Address</th>
                    <th className="py-3 px-3">Tier</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredMerchants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-6 text-center text-white/40"
                      >
                        No merchants found.
                      </td>
                    </tr>
                  ) : (
                    filteredMerchants.map((merchant) => (
                      <tr
                        key={merchant.walletAddress}
                        className="hover:bg-white/[0.02]"
                      >
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/10 font-bold text-white shrink-0">
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
                            <span className="font-bold text-white uppercase tracking-wider">
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
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/15 transition"
                              title="Copy merchant name"
                            >
                              {copiedMerchant === merchant.walletAddress ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-mono text-white/60">
                          {merchant.walletAddress}
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] font-bold text-white/70">
                            {merchant.tier}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          {merchant.verified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-bold text-emerald-300">
                              <ShieldCheck className="h-3 w-3" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                              Unverified
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right">
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
                                ? "border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20"
                                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
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
                  <h2 className="text-lg font-black uppercase tracking-wide text-white">
                    KYC Review
                  </h2>
                  <p className="text-xs text-white/50">
                    Approving an enterprise account also grants its
                    verified-merchant badge. Individuals only get their KYC
                    status.
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <div className="relative flex-1 sm:w-56">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/30" />
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
                        className="bg-[#121212] text-white"
                      >
                        {s === "all" ? "All statuses" : s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {kycLoading && kycRecords.length === 0 ? (
                <SkeletonRows
                  count={5}
                  avatar={false}
                  label="Loading verification queue"
                />
              ) : kycRecords.length === 0 ? (
                <p className="py-6 text-center text-xs text-white/40">
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
                        className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <code className="font-mono text-xs text-white/80">
                                {record.walletAddress}
                              </code>
                              <KycStatusPill status={record.status} />
                              {record.adminAsserted && (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                                  Admin-asserted
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[10px] text-white/40">
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
                              <p className="mt-1 text-[9px] text-[#00d2b4]/90 font-mono">
                                Decided{" "}
                                {new Date(record.decidedAt).toLocaleString()}
                                {record.adminAsserted
                                  ? " (upgraded by admin)"
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
                              className="shrink-0 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-400/20"
                            >
                              Force approve
                            </button>
                          )}
                        </div>

                        {transitions.length === 0 ? (
                          <p className="text-[10px] text-white/30">
                            {record.status === "APPROVED"
                              ? "Approved. It can still be expired or revoked once it has been re-loaded."
                              : "Terminal state — the applicant must resubmit, or a root admin can force approve."}
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              /* One dropdown serving every transition offered on this row. The
                                 server validates the code against the specific target status, so
                                 a code picked for REJECTED and then applied to APPROVED is
                                 refused there rather than silently accepted. */
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
                                    className="bg-[#121212] text-white"
                                  >
                                    Reason…
                                  </option>
                                  {codes.map((code) => (
                                    <option
                                      key={code}
                                      value={code}
                                      className="bg-[#121212] text-white"
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
                                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                                    : next === "REJECTED" || next === "REVOKED"
                                    ? "border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20"
                                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
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
              <div className={`${CARD} space-y-4 border-amber-500/30`}>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div>
                    <span className={LABEL}>Open a manual verification</span>
                    <p className="mt-1 text-[11px] text-white/50">
                      For a wallet that never applied. The record is marked{" "}
                      <code className="text-amber-300">manual_admin</code>{" "}
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
                      className="bg-[#121212] text-white"
                    >
                      Standard
                    </option>
                    <option
                      value="ENHANCED"
                      className="bg-[#121212] text-white"
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
                    className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50 sm:col-span-2"
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
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                  <div>
                    <span className={LABEL}>
                      Force approve {forceTarget.walletAddress}
                    </span>
                    <p className="mt-1 text-[11px] text-white/50">
                      This overrides the compliance guard that stops a manual
                      verification counting as production KYC, and lifts it out
                      of{" "}
                      <strong className="text-white/70">
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
                      className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
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
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/70 transition hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {!viewerIsRoot && (
              <p className="px-1 text-[10px] text-white/35">
                <FileText className="mr-1 inline h-3 w-3" />
                Force approval and manual records are restricted to root admins
                (ADMIN_WALLET_ADDRESSES).
              </p>
            )}
          </div>
        )}

        {tab === "moderation" && (
          <div className="space-y-6">
            <div className={`${CARD}`}>
              <div className="flex items-center justify-between mb-4">
                <span className={LABEL}>Security Access Control</span>
                <ShieldAlert className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="text-base font-bold text-white">
                Ban Account or IP
              </h3>
              <p className="mt-1 text-[11px] text-white/50">
                Wallet bans take effect on the banned user&apos;s next request —
                existing sessions stop working immediately. IP bans apply to API
                traffic and can take up to an hour to lift everywhere.
              </p>

              <form onSubmit={handleBan} className="mt-4 space-y-3 max-w-lg">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBanType("ACCOUNT")}
                    className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition ${
                      banType === "ACCOUNT"
                        ? "bg-red-500/20 border border-red-500/40 text-red-300"
                        : "bg-white/5 text-white/50"
                    }`}
                  >
                    Wallet Address
                  </button>
                  <button
                    type="button"
                    onClick={() => setBanType("IP")}
                    className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition ${
                      banType === "IP"
                        ? "bg-red-500/20 border border-red-500/40 text-red-300"
                        : "bg-white/5 text-white/50"
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
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500/20 border border-red-500/40 py-2 text-xs font-black uppercase tracking-wider text-red-300 transition hover:bg-red-500/30 disabled:opacity-40"
                >
                  {banBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Enforce Ban"
                  )}
                </button>
              </form>
            </div>

            <div className={`${CARD} space-y-4 border-amber-500/30`}>
              <div className="flex items-center justify-between">
                <span className={LABEL}>Payout Control</span>
                <ShieldAlert className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Freeze Withdrawals
                </h3>
                <p className="mt-1 text-[11px] text-white/50">
                  Stops funds leaving one account while everything else keeps
                  working — the person can still sign in, read receipts, and
                  reply to you. Use this for a payout dispute or a suspected
                  drainer; a ban would lock them out of the conversation
                  entirely.
                </p>
              </div>

              <form onSubmit={handlePlaceHold} className="space-y-3 max-w-lg">
                <input
                  type="text"
                  value={holdTarget}
                  onChange={(e) => setHoldTarget(e.target.value)}
                  placeholder="0x... wallet address"
                  aria-label="Wallet address to freeze withdrawals for"
                  className={INPUT}
                />

                <div>
                  <p className={`${LABEL} mb-1.5`}>Which exits close</p>
                  <div className="flex items-center gap-2">
                    {(["USER", "MERCHANT", "BOTH"] as const).map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => setHoldScope(scope)}
                        className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition ${
                          holdScope === scope
                            ? "bg-amber-500/20 border border-amber-500/40 text-amber-300"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        }`}
                      >
                        {scope === "USER"
                          ? "Vault"
                          : scope === "MERCHANT"
                          ? "Merchant"
                          : "Both"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-white/35">
                    {holdScope === "USER"
                      ? "Blocks vault withdrawals only. Merchant payouts to this address still run."
                      : holdScope === "MERCHANT"
                      ? "Blocks merchant claims only. This person's own vault refunds still run."
                      : "Blocks every withdrawal path for this address."}
                  </p>
                </div>

                <input
                  type="text"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="Reason (required — recorded in the audit log)"
                  aria-label="Reason for the withdrawal hold"
                  className={INPUT}
                />

                <div>
                  <label
                    htmlFor="hold-expiry"
                    className={`${LABEL} mb-1.5 block`}
                  >
                    Lift automatically at (optional)
                  </label>
                  <input
                    id="hold-expiry"
                    type="datetime-local"
                    value={holdExpiry}
                    onChange={(e) => setHoldExpiry(e.target.value)}
                    className={INPUT}
                  />
                  <p className="mt-1.5 text-[10px] text-white/35">
                    Leave empty to hold until an admin lifts it.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={
                    holdBusy === "place" ||
                    !holdTarget.trim() ||
                    holdReason.trim().length < 3
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500/20 border border-amber-500/40 py-2 text-xs font-black uppercase tracking-wider text-amber-300 transition hover:bg-amber-500/30 disabled:opacity-40"
                >
                  {holdBusy === "place" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Freeze Withdrawals"
                  )}
                </button>
              </form>
            </div>

            <div className={`${CARD} space-y-4`}>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Withdrawal Holds
              </h3>
              {holdsLoading && holds.length === 0 ? (
                <SkeletonRows
                  count={3}
                  avatar={false}
                  label="Loading withdrawal holds"
                />
              ) : holds.length === 0 ? (
                <p className="text-xs text-white/40">No withdrawal holds.</p>
              ) : (
                <div className="space-y-2">
                  {holds.map((h) => (
                    <div
                      key={h.address}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-3 ${
                        h.active
                          ? "border-amber-500/25 bg-amber-500/5"
                          : "border-white/5 bg-white/[0.03]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-mono text-[11px] text-white/80">
                            {h.address}
                          </p>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                              h.active
                                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                                : "border-white/10 bg-white/5 text-white/40"
                            }`}
                          >
                            {h.active ? h.scope : "LAPSED"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-white/40">
                          {h.reason || "No reason recorded"}
                        </p>
                        {/* Who and when, per the audit requirement — the console should answer
                            "who froze this" without anyone opening the database. */}
                        <p className="mt-0.5 truncate text-[9px] text-white/30">
                          By {h.placedBy} on{" "}
                          {new Date(h.createdAt).toLocaleString()}
                          {h.expiresAt
                            ? ` · ${h.active ? "lifts" : "lifted"} ${new Date(
                                h.expiresAt
                              ).toLocaleString()}`
                            : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLiftHold(h.address)}
                        disabled={holdBusy === h.address}
                        className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/70 transition hover:bg-white/10 disabled:opacity-40"
                      >
                        {holdBusy === h.address ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Lift"
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className={`${CARD} space-y-4`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Banned Wallets
                </h3>
                {bannedAccounts.length === 0 ? (
                  <p className="text-xs text-white/40">No banned wallets.</p>
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
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Banned IPs
                </h3>
                {bannedIps.length === 0 ? (
                  <p className="text-xs text-white/40">No banned IPs.</p>
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
                {analyticsLoading && !analytics ? (
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

        {tab === "system" && (
          <div className="space-y-6">
            {!flags ? (
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
                </div>

                <div
                  className={`${CARD} space-y-4 ${
                    flags.maintenanceEnabled ? "border-red-500/40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={LABEL}>Maintenance Mode</span>
                    {flags.maintenanceEnabled && (
                      <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-300 border border-red-500/30">
                        Site is down
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/50">
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
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 py-2.5 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40"
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
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500/20 border border-red-500/40 py-2.5 text-xs font-black uppercase tracking-wider text-red-300 transition hover:bg-red-500/30 disabled:opacity-30"
                      >
                        {flagBusy === "maintenance" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Take SubScript down"
                        )}
                      </button>
                    </div>
                  )}
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
              <p className="text-[11px] text-white/50">
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
                        : "border border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
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
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-40"
                >
                  {bcBusy === "preview" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Send to myself first"
                  )}
                </button>
              </div>

              <div className="border-t border-white/5 pt-4 space-y-2">
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
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2775ca]/15 border border-[#2775ca]/40 py-2.5 text-xs font-black uppercase tracking-wider text-[#2775ca] transition hover:bg-[#2775ca]/25 disabled:opacity-30"
                >
                  {bcBusy === "send" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Send to all ${bcAudience}`
                  )}
                </button>
              </div>
            </div>

            {analytics && analytics.recentBroadcasts.length > 0 && (
              <div className={`${CARD} space-y-3`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Recent Broadcasts
                </h3>
                <div className="space-y-2">
                  {analytics.recentBroadcasts.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-white truncate">
                          {b.title}
                        </p>
                        <span className="text-[10px] text-white/40 shrink-0">
                          {new Date(b.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-white/50">
                        {b.audience} · {b.sentCount}/{b.totalRecipients}{" "}
                        delivered
                        {b.failedCount > 0 && ` · ${b.failedCount} failed`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "receipts" && (
          <div className={`${CARD} space-y-4`}>
            <div className="flex items-center justify-between">
              <span className={LABEL}>Receipt Access</span>
              <ReceiptText className="h-5 w-5 text-[#2775ca]" />
            </div>
            <h3 className="text-base font-bold text-white">
              Invite an address to view a receipt
            </h3>
            <p className="text-[11px] text-white/50">
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
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#2775ca]/15 border border-[#2775ca]/40 py-2 text-xs font-black uppercase tracking-wider text-[#2775ca] transition hover:bg-[#2775ca]/25 disabled:opacity-40"
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

        {tab === "admins" && (
          <div className="space-y-6">
            <div className={CARD}>
              <div className="flex items-center justify-between mb-4">
                <span className={LABEL}>Access Management</span>
                <Users className="h-5 w-5 text-[#2775ca]" />
              </div>
              <h3 className="text-base font-bold text-white">Admin Wallets</h3>
              <p className="mt-1 text-[11px] text-white/50">
                <span className="font-bold text-white/70">Root</span> admins
                come from the{" "}
                <code className="font-mono">ADMIN_WALLET_ADDRESSES</code>{" "}
                environment variable and cannot be revoked here — that is the
                recovery path if this console is ever misconfigured. Only root
                admins can grant or revoke access.
              </p>

              {viewerIsRoot ? (
                <form
                  onSubmit={handleGrantAdmin}
                  className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
                >
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
                  <button
                    type="submit"
                    disabled={adminBusy || !newAdminWallet.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[#2775ca]/15 border border-[#2775ca]/40 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#2775ca] transition hover:bg-[#2775ca]/25 disabled:opacity-40"
                  >
                    {adminBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Grant
                  </button>
                </form>
              ) : (
                <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/50">
                  You have admin access but are not a root admin, so you cannot
                  add or remove admins.
                </p>
              )}
            </div>

            <div className={`${CARD} space-y-3`}>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Current Admins{" "}
                {adminsLoading && (
                  <Loader2 className="inline h-3 w-3 animate-spin ml-1" />
                )}
              </h3>
              {admins.length === 0 && !adminsLoading ? (
                <p className="text-xs text-white/40">No admins found.</p>
              ) : (
                <div className="space-y-2">
                  {admins.map((a) => (
                    <div
                      key={a.wallet}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Shield
                          className={`h-4 w-4 shrink-0 ${
                            a.tier === "root"
                              ? "text-[#2775ca]"
                              : "text-white/40"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono font-bold text-white truncate">
                            {a.wallet}
                          </p>
                          {a.tier === "root" ? (
                            <p className="text-[10px] text-white/50">
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
                                className="flex items-center gap-1 rounded-lg bg-[#2775ca]/20 border border-[#2775ca]/40 px-2.5 py-1 text-[10px] font-bold text-[#2775ca] hover:bg-[#2775ca]/30 transition disabled:opacity-40"
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
                                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/60 hover:bg-white/10 transition"
                              >
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-white/50 mt-0.5">
                              {a.label ? (
                                <span className="font-bold text-white/90 bg-white/10 px-1.5 py-0.5 rounded border border-white/10">
                                  {a.label}
                                </span>
                              ) : (
                                <span className="italic text-white/30">
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
                                  className="inline-flex items-center justify-center h-4 w-4 rounded text-white/40 hover:text-[#2775ca] transition ml-0.5"
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
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                            a.tier === "root"
                              ? "bg-[#2775ca]/10 border-[#2775ca]/30 text-[#2775ca]"
                              : "bg-white/5 border-white/10 text-white/60"
                          }`}
                        >
                          {a.tier}
                        </span>
                        {a.tier === "delegated" && viewerIsRoot && (
                          <button
                            type="button"
                            onClick={() => handleRevokeAdmin(a.wallet)}
                            className="flex items-center gap-1 rounded-xl border border-red-400/30 bg-red-400/10 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-400/20 transition"
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
          ? "border-amber-500/30 bg-amber-500/[0.06]"
          : "border-white/5 bg-white/[0.03]"
      }`}
    >
      <p
        className={`text-2xl font-black ${
          danger ? "text-amber-300" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
        {label}
      </p>
    </div>
  );
}

/* Status chip for the KYC queue. Colour carries the same meaning as elsewhere in the console:
   green settled-good, red settled-bad, amber needs a human, white/neutral in flight. */
function KycStatusPill({ status }: { status: string }) {
  const tone =
    status === "APPROVED"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : status === "REJECTED" || status === "REVOKED"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : status === "NEEDS_INPUT" || status === "EXPIRED"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : "border-white/10 bg-white/5 text-white/70";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${tone}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/* Switch row for the System tab. Kept dumb — every state change round-trips through the
   API so the rendered state always reflects what the server actually stored. */
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
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/50">
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
            ? "border-[#2775ca]/50 bg-[#2775ca]/25"
            : "border-white/15 bg-white/10"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full transition-all ${
            enabled ? "left-6 bg-[#2775ca]" : "left-1 bg-white/50"
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
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-xs">
      <div className="min-w-0">
        <p className="font-mono font-bold text-white truncate">{target}</p>
        {reason && <p className="text-[10px] text-white/50">{reason}</p>}
      </div>
      <button
        type="button"
        onClick={onUnban}
        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/70 hover:bg-white/15 transition shrink-0"
      >
        Unban
      </button>
    </div>
  );
}
