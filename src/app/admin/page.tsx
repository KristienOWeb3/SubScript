"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "@/components/icons";
import {
  SkeletonCard,
  SkeletonRows,
  SkeletonStatGrid,
  SkeletonToggleRows,
} from "@/components/ui/skeletons";

type Merchant = {
  walletAddress: string;
  merchantName: string;
  tier: string;
  verified: boolean;
  profilePic?: string | null;
  createdAt: string;
};

type BannedAccount = { address: string; reason?: string | null; bannedBy?: string; createdAt: string };
type BannedIp = { ip: string; reason?: string | null; bannedBy?: string; createdAt: string };

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
  health: { revocationPending: number; downgradeFailures: number; stuckReceipts: number };
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

const CARD = "rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl";
const LABEL = "text-[10px] font-black uppercase tracking-wider text-white/40";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-[#ccff00]/40 focus:outline-none";

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [bannedAccounts, setBannedAccounts] = useState<BannedAccount[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIp[]>([]);
  const [viewerIsRoot, setViewerIsRoot] = useState(false);

  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  const [banType, setBanType] = useState<"ACCOUNT" | "IP">("ACCOUNT");
  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banBusy, setBanBusy] = useState(false);

  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [newAdminWallet, setNewAdminWallet] = useState("");
  const [newAdminLabel, setNewAdminLabel] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [flags, setFlags] = useState<PlatformFlags | null>(null);
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  /* Typing the word arms the switch. Maintenance takes the whole product down, so it
     should not be one misplaced click away. */
  const [maintenanceConfirm, setMaintenanceConfirm] = useState("");

  const [bcTitle, setBcTitle] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcUrl, setBcUrl] = useState("");
  const [bcAudience, setBcAudience] = useState<"users" | "merchants" | "both">("users");
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
  const [kycReasonDraft, setKycReasonDraft] = useState<Record<string, string>>({});
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
      setSponsor(json.sponsor ?? null);
      setMerchants(json.merchants || []);
      setBannedAccounts(json.bannedAccounts || []);
      setBannedIps(json.bannedIps || []);
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
      if (!res.ok) throw new Error(json.error || "Failed to load platform flags");
      setFlags(json);
      setMaintenanceMessage(json.maintenanceMessage || "");
    } catch (err: any) {
      setError(err.message || "Failed to load platform flags");
    }
  }, []);

  const loadKyc = useCallback(async () => {
    setKycLoading(true);
    try {
      const params = new URLSearchParams({ status: kycStatusFilter, limit: "100" });
      if (kycSearch.trim()) params.set("search", kycSearch.trim());
      const res = await fetch(`/api/admin/kyc/review?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load verifications");
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
      if (!res.ok) throw new Error(json.error || "Failed to update verification");
      setKycRecords((prev) => prev.map((r) => (r.id === record.id ? json.verification : r)));
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
          ...(forceExpiry ? { expiresAt: new Date(forceExpiry).toISOString() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Force approval failed");
      setKycRecords((prev) => prev.map((r) => (r.id === forceTarget.id ? json.verification : r)));
      setNotice(`Force-approved ${forceTarget.walletAddress}. Logged to the admin audit trail.`);
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
      setNotice(`Opened a manual verification for ${manualWallet.trim()}. It still needs a decision.`);
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
      setNotice(json.warning ? `${json.summary || json.message} ${json.warning}` : json.summary || json.message);
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
  }, [loadData]);

  useEffect(() => {
    if (tab === "admins") loadAdmins();
    if (tab === "analytics") loadAnalytics();
    if (tab === "system") loadFlags();
    if (tab === "kyc") loadKyc();
  }, [tab, loadAdmins, loadAnalytics, loadFlags, loadKyc]);

  const handleCopySponsor = () => {
    if (!sponsor?.address) return;
    navigator.clipboard.writeText(sponsor.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleVerification = async (merchantAddress: string, currentStatus: boolean) => {
    setVerifyBusy(merchantAddress);
    setError(null);
    try {
      const res = await fetch("/api/admin/merchant-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantAddress, verified: !currentStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update verification");
      setMerchants((prev) =>
        prev.map((m) => (m.walletAddress === merchantAddress ? { ...m, verified: !currentStatus } : m)),
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
        body: JSON.stringify({ wallet: newAdminWallet.trim(), label: newAdminLabel.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to grant admin access");
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
      const res = await fetch(`/api/admin/admins?wallet=${encodeURIComponent(wallet)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to revoke admin access");
      if (json.warning) setNotice(json.warning);
      await loadAdmins();
    } catch (err: any) {
      setError(err.message || "Failed to revoke admin access");
    }
  };

  const filteredMerchants = merchants.filter(
    (m) =>
      m.merchantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.walletAddress.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <main className="min-h-screen bg-black text-white p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#ccff00]/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] border border-[#ccff00]/30">
                admin.subscriptonarc.com
              </span>
              {viewerIsRoot && (
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white/60 border border-white/10">
                  root
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">
              System Control Center
            </h1>
            <p className="text-xs text-white/50">
              Gas sponsorship, merchant verification, access control, and admin management.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (tab === "admins") loadAdmins();
              else if (tab === "analytics") loadAnalytics();
              else if (tab === "system") loadFlags();
              else if (tab === "kyc") loadKyc();
              else loadData();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                tab === t.id
                  ? "bg-[#ccff00]/15 border border-[#ccff00]/40 text-[#ccff00]"
                  : "border border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className={`${CARD} flex flex-col justify-between`}>
              <div>
                <div className="flex items-center justify-between">
                  <span className={LABEL}>Gas Sponsor Wallet</span>
                  {sponsor?.emergencyStop ? (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-300 border border-red-500/30">
                      Emergency Stop
                    </span>
                  ) : sponsor?.underfunded ? (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-300 border border-amber-500/30">
                      Underfunded
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/30">
                      Live Gas Relayer
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <p className="text-3xl font-black tracking-tight text-white">
                    {sponsor?.balanceUsdc
                      ? Number(sponsor.balanceUsdc).toLocaleString(undefined, { maximumFractionDigits: 4 })
                      : sponsor?.configured
                        ? "—"
                        : "0"}{" "}
                    <span className="text-base font-bold text-[#ccff00]">USDC</span>
                  </p>
                  <p className="mt-1 text-[11px] text-white/50">
                    Native gas reserve on Arc. Each sponsored action tops a user up by {sponsor?.topupUsdc ?? "0.10"} USDC.
                  </p>
                  {sponsor?.estimatedTopupsRemaining !== null && sponsor?.estimatedTopupsRemaining !== undefined && (
                    <p className="mt-2 text-[11px] font-bold text-white/70">
                      ≈ {sponsor.estimatedTopupsRemaining.toLocaleString()} sponsored actions remaining
                    </p>
                  )}
                  {sponsor?.underfunded && (
                    <p className="mt-2 text-[11px] font-bold text-amber-300">
                      Below the safe threshold — sponsored payments will start failing. Send USDC to the address below.
                    </p>
                  )}
                  {sponsor?.error && (
                    <p className="mt-2 text-[11px] text-red-300">Balance unavailable: {sponsor.error}</p>
                  )}
                </div>
              </div>

              <div className="mt-6 border-t border-white/5 pt-4 space-y-3">
                <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/60 p-3">
                  <code className="truncate font-mono text-xs text-white/80">
                    {sponsor?.address || "Not configured (SPONSOR_PRIVATE_KEY)"}
                  </code>
                  {sponsor?.address && (
                    <button
                      type="button"
                      onClick={handleCopySponsor}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/15 transition"
                      title="Copy sponsor address"
                    >
                      {copied ? <CheckCircle2 className="h-4 w-4 text-[#ccff00]" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {sponsor?.address && (
                  <p className="text-[10px] text-white/40">
                    To fund gas: send native USDC on Arc directly to this address.
                  </p>
                )}
              </div>
            </div>

            <div className={`${CARD} space-y-4`}>
              <span className={LABEL}>At a glance</span>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Merchants" value={merchants.length} />
                <Stat label="Verified" value={merchants.filter((m) => m.verified).length} />
                <Stat label="Banned wallets" value={bannedAccounts.length} />
                <Stat label="Banned IPs" value={bannedIps.length} />
              </div>
            </div>
          </div>
        )}

        {tab === "merchants" && (
          <div className={`${CARD} space-y-4`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wide text-white">Merchant Verifications</h2>
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
                      <td colSpan={5} className="py-6 text-center text-white/40">
                        No merchants found.
                      </td>
                    </tr>
                  ) : (
                    filteredMerchants.map((m) => (
                      <tr key={m.walletAddress} className="hover:bg-white/[0.02]">
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/10 font-bold text-white shrink-0">
                              {m.profilePic ? (
                                <img src={m.profilePic} alt={m.merchantName} className="h-full w-full rounded-xl object-cover" />
                              ) : (
                                <Building2 className="h-4 w-4 text-[#ccff00]" />
                              )}
                            </div>
                            <span className="font-bold text-white uppercase tracking-wider">{m.merchantName}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-mono text-white/60">{m.walletAddress}</td>
                        <td className="py-3.5 px-3">
                          <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] font-bold text-white/70">
                            {m.tier}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          {m.verified ? (
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
                            onClick={() => toggleVerification(m.walletAddress, m.verified)}
                            disabled={verifyBusy === m.walletAddress}
                            className={`rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                              m.verified
                                ? "border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20"
                                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                            }`}
                          >
                            {verifyBusy === m.walletAddress ? (
                              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                            ) : m.verified ? (
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
                  <h2 className="text-lg font-black uppercase tracking-wide text-white">KYC Review</h2>
                  <p className="text-xs text-white/50">
                    Approving an enterprise account also grants its verified-merchant badge.
                    Individuals only get their KYC status.
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <div className="relative flex-1 sm:w-56">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/30" />
                    <input
                      type="text"
                      value={kycSearch}
                      onChange={(e) => setKycSearch(e.target.value)}
                      placeholder="Search wallet..."
                      className={`${INPUT} pl-9`}
                    />
                  </div>
                  <select
                    value={kycStatusFilter}
                    onChange={(e) => setKycStatusFilter(e.target.value)}
                    className={`${INPUT} w-auto`}
                  >
                    {["all", "PENDING", "IN_REVIEW", "NEEDS_INPUT", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"].map(
                      (s) => (
                        <option key={s} value={s} className="bg-[#121212] text-white">
                          {s === "all" ? "All statuses" : s.replace("_", " ")}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              {kycLoading && kycRecords.length === 0 ? (
                <SkeletonRows count={5} avatar={false} label="Loading verification queue" />
              ) : kycRecords.length === 0 ? (
                <p className="py-6 text-center text-xs text-white/40">No verifications match this filter.</p>
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
                              <code className="font-mono text-xs text-white/80">{record.walletAddress}</code>
                              <KycStatusPill status={record.status} />
                              {record.adminAsserted && (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                                  Admin-asserted
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[10px] text-white/40">
                              {record.accountRole} · {record.kind} · {record.countryCode} ·{" "}
                              {record.requestedLevel} · via {record.provider}
                              {record.expiresAt
                                ? ` · expires ${new Date(record.expiresAt).toLocaleDateString()}`
                                : ""}
                              {record.reasonCode ? ` · ${record.reasonCode}` : ""}
                            </p>
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
                                new Set(transitions.flatMap((t) => KYC_REASONS[t] || [])),
                              );
                              if (codes.length === 0) return null;
                              return (
                                <select
                                  value={kycReasonDraft[record.id] || ""}
                                  onChange={(e) =>
                                    setKycReasonDraft((prev) => ({ ...prev, [record.id]: e.target.value }))
                                  }
                                  className={`${INPUT} w-auto`}
                                >
                                  <option value="" className="bg-[#121212] text-white">
                                    Reason…
                                  </option>
                                  {codes.map((code) => (
                                    <option key={code} value={code} className="bg-[#121212] text-white">
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
                                {busy ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : next.replace("_", " ")}
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
                      <code className="text-amber-300">manual_admin</code> permanently, and records the
                      consent as admin-supplied rather than given by the user. It opens as PENDING —
                      approving it is a second, separate decision.
                    </p>
                  </div>
                </div>
                <form onSubmit={createManualKyc} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    value={manualWallet}
                    onChange={(e) => setManualWallet(e.target.value)}
                    placeholder="0x wallet address"
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
                    <option value="STANDARD" className="bg-[#121212] text-white">Standard</option>
                    <option value="ENHANCED" className="bg-[#121212] text-white">Enhanced</option>
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
                    <span className={LABEL}>Force approve {forceTarget.walletAddress}</span>
                    <p className="mt-1 text-[11px] text-white/50">
                      This overrides the compliance guard that stops a manual verification counting as
                      production KYC, and lifts it out of{" "}
                      <strong className="text-white/70">{forceTarget.status}</strong> regardless of the
                      normal transition rules. Your wallet, your reason, and your IP are written to the
                      audit log.
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
                    <label className={LABEL}>Approval expires (defaults to 12 months)</label>
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
                      disabled={forceConfirm !== KYC_FORCE_CONFIRMATION || kycBusy === forceTarget.id}
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
              <h3 className="text-base font-bold text-white">Ban Account or IP</h3>
              <p className="mt-1 text-[11px] text-white/50">
                Wallet bans take effect on the banned user&apos;s next request — existing sessions stop working
                immediately. IP bans apply to API traffic and can take up to an hour to lift everywhere.
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
                      banType === "IP" ? "bg-red-500/20 border border-red-500/40 text-red-300" : "bg-white/5 text-white/50"
                    }`}
                  >
                    IP Address
                  </button>
                </div>

                <input
                  type="text"
                  value={banTarget}
                  onChange={(e) => setBanTarget(e.target.value)}
                  placeholder={banType === "ACCOUNT" ? "0x... wallet address" : "192.168.1.1"}
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
                  {banBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enforce Ban"}
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className={`${CARD} space-y-4`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Banned Wallets</h3>
                {bannedAccounts.length === 0 ? (
                  <p className="text-xs text-white/40">No banned wallets.</p>
                ) : (
                  <div className="space-y-2">
                    {bannedAccounts.map((b) => (
                      <BanRow key={b.address} target={b.address} reason={b.reason} onUnban={() => handleUnban("ACCOUNT", b.address)} />
                    ))}
                  </div>
                )}
              </div>

              <div className={`${CARD} space-y-4`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Banned IPs</h3>
                {bannedIps.length === 0 ? (
                  <p className="text-xs text-white/40">No banned IPs.</p>
                ) : (
                  <div className="space-y-2">
                    {bannedIps.map((b) => (
                      <BanRow key={b.ip} target={b.ip} reason={b.reason} onUnban={() => handleUnban("IP", b.ip)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "analytics" && (
          <div className="space-y-6">
            {analyticsLoading && !analytics ? (
              <>
                <SkeletonCard label="Loading volume transacted" lines={1} />
                <SkeletonStatGrid count={4} columns={4} label="Loading subscription metrics" />
                <SkeletonStatGrid count={4} columns={2} label="Loading growth and health metrics" />
              </>
            ) : !analytics ? (
              <div className={`${CARD} text-xs text-white/40`}>No analytics available.</div>
            ) : (
              <>
                <div className={`${CARD} space-y-4`}>
                  <div className="flex items-center justify-between">
                    <span className={LABEL}>Volume Transacted</span>
                    <span className="text-[10px] text-white/30">
                      as of {new Date(analytics.generatedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Total settled" value={`$${analytics.volume.totalUsdc}`} />
                    <Stat label="Payments" value={analytics.volume.paymentCount} />
                    <Stat label="Average payment" value={`$${analytics.volume.averageUsdc}`} />
                    <Stat label="Last 30 days" value={`$${analytics.volume.last30DaysUsdc}`} />
                  </div>
                  <p className="text-[10px] text-white/40">
                    Settled volume counts confirmed on-chain receipts. Checkout links have moved
                    ${analytics.volume.checkoutVolumeUsdc} across {analytics.volume.checkoutCount} credited payments.
                  </p>
                </div>

                <div className={`${CARD} space-y-4`}>
                  <span className={LABEL}>Subscriptions</span>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Active (customer)" value={analytics.subscriptions.activeCustomer} />
                    <Stat label="Active (premium)" value={analytics.subscriptions.activePremium} />
                    <Stat label="Active total" value={analytics.subscriptions.activeTotal} />
                    <Stat label="Cancelling" value={analytics.subscriptions.cancellingAtPeriodEnd} />
                  </div>
                  <p className="text-[10px] text-white/40">
                    Customer subscriptions are plans your merchants sell. Premium is merchants subscribing to
                    SubScript — your own revenue.
                  </p>
                </div>

                <div className={`${CARD} space-y-4`}>
                  <span className={LABEL}>Users</span>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Total users" value={analytics.growth.usersTotal} />
                    <Stat label="Individuals" value={analytics.growth.usersRoleUser} />
                    <Stat label="Enterprise" value={analytics.growth.usersRoleEnterprise} />
                    <Stat label="New (30d)" value={analytics.growth.usersNew30d} />
                  </div>
                  <p className="text-[10px] text-white/40">
                    Every signed-up account has a role, so this is the headline user count. The
                    merchant and customer figures below are subsets that overlap each other — a
                    merchant who also pays for things is counted in both — so do not add them up.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className={`${CARD} space-y-4`}>
                    <span className={LABEL}>Growth</span>
                    <div className="grid grid-cols-2 gap-3">
                      <Stat label="Merchants" value={analytics.growth.merchantsTotal} />
                      <Stat label="Verified" value={analytics.growth.merchantsVerified} />
                      <Stat label="New merchants (30d)" value={analytics.growth.merchantsNew30d} />
                      <Stat label="Customers" value={analytics.growth.customersTotal} />
                    </div>
                  </div>

                  <div className={`${CARD} space-y-4`}>
                    <span className={LABEL}>Health</span>
                    <div className="grid grid-cols-2 gap-3">
                      <Stat label="Revocations pending" value={analytics.health.revocationPending} danger={analytics.health.revocationPending > 0} />
                      <Stat label="Downgrade failures" value={analytics.health.downgradeFailures} danger={analytics.health.downgradeFailures > 0} />
                      <Stat label="Stuck receipts" value={analytics.health.stuckReceipts} danger={analytics.health.stuckReceipts > 0} />
                      <Stat label="KYC awaiting review" value={analytics.kyc.pending} danger={analytics.kyc.pending > 0} />
                    </div>
                    <p className="text-[10px] text-white/40">
                      Stuck receipts are unconfirmed for more than 7 days — usually a memo that never finalized on chain.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "system" && (
          <div className="space-y-6">
            {!flags ? (
              <>
                <SkeletonToggleRows count={2} label="Loading sign-in method switches" />
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
                    disabled={flagBusy === "google" || flags.googleEnvConfigured === false}
                    busy={flagBusy === "google"}
                    onToggle={() => updateFlag({ googleSigninEnabled: !flags.googleSigninEnabled }, "google")}
                  />

                  <Toggle
                    title="Connect external wallet"
                    description="Hides every connect-wallet button and makes /api/auth/verify-signature refuse the signature, so an open tab cannot still sign in. Also removes browser-wallet payment from checkout — payers fall back to signing in and paying from their SubScript wallet. Email and embedded wallets are unaffected."
                    enabled={flags.externalWalletEnabled}
                    disabled={flagBusy === "wallet"}
                    busy={flagBusy === "wallet"}
                    onToggle={() => updateFlag({ externalWalletEnabled: !flags.externalWalletEnabled }, "wallet")}
                  />
                </div>

                <div className={`${CARD} space-y-4 ${flags.maintenanceEnabled ? "border-red-500/40" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className={LABEL}>Maintenance Mode</span>
                    {flags.maintenanceEnabled && (
                      <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-300 border border-red-500/30">
                        Site is down
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/50">
                    Returns 503 across the whole product. This console, the admin API, and sign-in stay reachable
                    so you can always turn it back off.
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
                      onClick={() => updateFlag({ maintenanceEnabled: false }, "maintenance")}
                      disabled={flagBusy === "maintenance"}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 py-2.5 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-40"
                    >
                      {flagBusy === "maintenance" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Bring the site back online"}
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
                            { maintenanceEnabled: true, maintenanceMessage: maintenanceMessage.trim() || null },
                            "maintenance",
                          )
                        }
                        disabled={flagBusy === "maintenance" || maintenanceConfirm.trim().toLowerCase() !== "take it down"}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500/20 border border-red-500/40 py-2.5 text-xs font-black uppercase tracking-wider text-red-300 transition hover:bg-red-500/30 disabled:opacity-30"
                      >
                        {flagBusy === "maintenance" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Take SubScript down"}
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
                <Bell className="h-5 w-5 text-[#ccff00]" />
              </div>
              <p className="text-[11px] text-white/50">
                Delivered to everyone in the audience who has push enabled. This cannot be recalled once sent —
                preview it on your own wallet first.
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
                        ? "bg-[#ccff00]/15 border border-[#ccff00]/40 text-[#ccff00]"
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
                  disabled={bcBusy !== null || !bcTitle.trim() || !bcBody.trim()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-40"
                >
                  {bcBusy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send to myself first"}
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
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#ccff00]/15 border border-[#ccff00]/40 py-2.5 text-xs font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/25 disabled:opacity-30"
                >
                  {bcBusy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Send to all ${bcAudience}`}
                </button>
              </div>
            </div>

            {analytics && analytics.recentBroadcasts.length > 0 && (
              <div className={`${CARD} space-y-3`}>
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Recent Broadcasts</h3>
                <div className="space-y-2">
                  {analytics.recentBroadcasts.map((b) => (
                    <div key={b.id} className="rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-white truncate">{b.title}</p>
                        <span className="text-[10px] text-white/40 shrink-0">
                          {new Date(b.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-white/50">
                        {b.audience} · {b.sentCount}/{b.totalRecipients} delivered
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
              <ReceiptText className="h-5 w-5 text-[#ccff00]" />
            </div>
            <h3 className="text-base font-bold text-white">Invite an address to view a receipt</h3>
            <p className="text-[11px] text-white/50">
              Grants a wallet permission to view someone else&apos;s payment record. The reason is recorded in the
              audit log alongside the payer and merchant.
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
                disabled={invBusy || !invReceiptId.trim() || !invAddress.trim() || invReason.trim().length < 3}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#ccff00]/15 border border-[#ccff00]/40 py-2 text-xs font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/25 disabled:opacity-40"
              >
                {invBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant access"}
              </button>
            </form>
          </div>
        )}

        {tab === "admins" && (
          <div className="space-y-6">
            <div className={CARD}>
              <div className="flex items-center justify-between mb-4">
                <span className={LABEL}>Access Management</span>
                <Users className="h-5 w-5 text-[#ccff00]" />
              </div>
              <h3 className="text-base font-bold text-white">Admin Wallets</h3>
              <p className="mt-1 text-[11px] text-white/50">
                <span className="font-bold text-white/70">Root</span> admins come from the{" "}
                <code className="font-mono">ADMIN_WALLET_ADDRESSES</code> environment variable and cannot be
                revoked here — that is the recovery path if this console is ever misconfigured. Only root admins
                can grant or revoke access.
              </p>

              {viewerIsRoot ? (
                <form onSubmit={handleGrantAdmin} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
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
                    placeholder="Label (optional)"
                    className={`${INPUT} sm:w-48`}
                  />
                  <button
                    type="submit"
                    disabled={adminBusy || !newAdminWallet.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-[#ccff00]/15 border border-[#ccff00]/40 px-4 py-2 text-xs font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/25 disabled:opacity-40"
                  >
                    {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Grant
                  </button>
                </form>
              ) : (
                <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/50">
                  You have admin access but are not a root admin, so you cannot add or remove admins.
                </p>
              )}
            </div>

            <div className={`${CARD} space-y-3`}>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Current Admins {adminsLoading && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
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
                      <div className="flex items-center gap-3 min-w-0">
                        <Shield
                          className={`h-4 w-4 shrink-0 ${a.tier === "root" ? "text-[#ccff00]" : "text-white/40"}`}
                        />
                        <div className="min-w-0">
                          <p className="font-mono font-bold text-white truncate">{a.wallet}</p>
                          <p className="text-[10px] text-white/50">
                            {a.tier === "root" ? (
                              "Root — configured in environment, not revocable here"
                            ) : (
                              <>
                                {a.label ? `${a.label} · ` : ""}
                                Granted by {a.grantedBy ? `${a.grantedBy.slice(0, 10)}…` : "unknown"}
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold border ${
                            a.tier === "root"
                              ? "bg-[#ccff00]/10 border-[#ccff00]/30 text-[#ccff00]"
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
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${danger ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-white/5 bg-white/[0.03]"}`}>
      <p className={`text-2xl font-black ${danger ? "text-amber-300" : "text-white"}`}>{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">{label}</p>
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
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${tone}`}>
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
        <p className="mt-1 text-[11px] leading-relaxed text-white/50">{description}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={enabled}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-40 ${
          enabled ? "border-[#ccff00]/50 bg-[#ccff00]/25" : "border-white/15 bg-white/10"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full transition-all ${
            enabled ? "left-6 bg-[#ccff00]" : "left-1 bg-white/50"
          }`}
        />
        {busy && <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />}
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
