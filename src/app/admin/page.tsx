"use client";

import React, { useEffect, useState } from "react";
import { 
  Building2, 
  CheckCircle2, 
  Copy, 
  Download, 
  Loader2, 
  Lock, 
  Plus, 
  RefreshCw, 
  Search, 
  Shield, 
  ShieldAlert, 
  ShieldCheck, 
  User, 
  Wallet, 
  X 
} from "@/components/icons";

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
  createdAt: string;
};

type BannedIp = {
  ip: string;
  reason?: string | null;
  createdAt: string;
};

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sponsorWalletAddress, setSponsorWalletAddress] = useState<string | null>(null);
  const [sponsorBalanceUsdc, setSponsorBalanceUsdc] = useState<string>("0");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [bannedAccounts, setBannedAccounts] = useState<BannedAccount[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIp[]>([]);

  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  /* Ban Form state */
  const [banType, setBanType] = useState<"ACCOUNT" | "IP">("ACCOUNT");
  const [banTarget, setBanTarget] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banBusy, setBanBusy] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/overview");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load admin data");
      setSponsorWalletAddress(json.sponsorWalletAddress);
      setSponsorBalanceUsdc(json.sponsorBalanceUsdc || "0");
      setMerchants(json.merchants || []);
      setBannedAccounts(json.bannedAccounts || []);
      setBannedIps(json.bannedIps || []);
    } catch (err: any) {
      setError(err.message || "Failed to load admin dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopySponsor = () => {
    if (!sponsorWalletAddress) return;
    navigator.clipboard.writeText(sponsorWalletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleVerification = async (merchantAddress: string, currentStatus: boolean) => {
    setVerifyBusy(merchantAddress);
    try {
      const res = await fetch("/api/admin/merchant-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantAddress, verified: !currentStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update verification");
      setMerchants((prev) =>
        prev.map((m) => (m.walletAddress === merchantAddress ? { ...m, verified: !currentStatus } : m))
      );
    } catch (err: any) {
      alert(err.message || "Failed to update verification");
    } finally {
      setVerifyBusy(null);
    }
  };

  const handleBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!banTarget.trim()) return;
    setBanBusy(true);
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
      setBanTarget("");
      setBanReason("");
      await loadData();
    } catch (err: any) {
      alert(err.message || "Failed to ban target");
    } finally {
      setBanBusy(false);
    }
  };

  const handleUnban = async (type: "ACCOUNT" | "IP", target: string) => {
    try {
      const res = await fetch("/api/admin/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, target, action: "UNBAN" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to remove ban");
      await loadData();
    } catch (err: any) {
      alert(err.message || "Failed to remove ban");
    }
  };

  const filteredMerchants = merchants.filter(
    (m) =>
      m.merchantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.walletAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-black text-white p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#ccff00]/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] border border-[#ccff00]/30">
                admin.subscriptonarc.com
              </span>
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">
              System Control Center
            </h1>
            <p className="text-xs text-white/50">
              Manage gas sponsorship, merchant verifications, and platform access control.
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh Data
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-medium text-red-300">
            {error}
          </div>
        )}

        {/* Top Grid: Gas Sponsor & System Stats */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Gas Sponsor Wallet Card */}
          <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-white/40">
                  Gas Sponsor Wallet
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/30">
                  Live Gas Relayer
                </span>
              </div>
              <div className="mt-4">
                <p className="text-3xl font-black tracking-tight text-white">
                  {sponsorBalanceUsdc} <span className="text-base font-bold text-[#ccff00]">USDC</span>
                </p>
                <p className="mt-1 text-[11px] text-white/50">
                  Available gas reserve on Arc network for user sponsorship.
                </p>
              </div>
            </div>

            <div className="mt-6 border-t border-white/5 pt-4 space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/60 p-3">
                <code className="truncate font-mono text-xs text-white/80">
                  {sponsorWalletAddress || "Not configured (SPONSOR_PRIVATE_KEY)"}
                </code>
                {sponsorWalletAddress && (
                  <button
                    type="button"
                    onClick={handleCopySponsor}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/15 transition"
                    title="Copy Sponsor Address"
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4 text-[#ccff00]" /> : <Copy className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {sponsorWalletAddress && (
                <p className="text-[10px] text-white/40">
                  To fund gas: send native USDC on Arc network directly to the address above.
                </p>
              )}
            </div>
          </div>

          {/* Issue Ban Card */}
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-black uppercase tracking-wider text-white/40">
                  Security Access Control
                </span>
                <ShieldAlert className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="text-base font-bold text-white">Ban Account or IP</h3>
              <p className="mt-1 text-[11px] text-white/50">
                Immediately block malicious wallets or IP addresses from interacting with the protocol.
              </p>
            </div>

            <form onSubmit={handleBan} className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBanType("ACCOUNT")}
                  className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition ${
                    banType === "ACCOUNT" ? "bg-red-500/20 border border-red-500/40 text-red-300" : "bg-white/5 text-white/50"
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
                placeholder={banType === "ACCOUNT" ? "0x... wallet address" : "192.168.1.1 IP address"}
                className="w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-red-400/50 focus:outline-none"
              />

              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-red-400/50 focus:outline-none"
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
        </div>

        {/* Merchant Verification Section */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black uppercase tracking-wide text-white">Merchant Verifications</h2>
              <p className="text-xs text-white/50">Verify or revoke merchant status across SubScript checkout and DMs.</p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/30" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search merchant name or address..."
                className="w-full rounded-xl border border-white/10 bg-black/60 pl-9 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-[#ccff00]/40 focus:outline-none"
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

        {/* Active Bans Section */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Banned Accounts */}
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl space-y-4">
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Banned Wallet Accounts</h3>
            {bannedAccounts.length === 0 ? (
              <p className="text-xs text-white/40">No banned wallet accounts.</p>
            ) : (
              <div className="space-y-2">
                {bannedAccounts.map((b) => (
                  <div key={b.address} className="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-white truncate">{b.address}</p>
                      {b.reason && <p className="text-[10px] text-white/50">{b.reason}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnban("ACCOUNT", b.address)}
                      className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/70 hover:bg-white/15 transition shrink-0"
                    >
                      Unban
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Banned IPs */}
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl space-y-4">
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Banned IP Addresses</h3>
            {bannedIps.length === 0 ? (
              <p className="text-xs text-white/40">No banned IP addresses.</p>
            ) : (
              <div className="space-y-2">
                {bannedIps.map((b) => (
                  <div key={b.ip} className="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-white truncate">{b.ip}</p>
                      {b.reason && <p className="text-[10px] text-white/50">{b.reason}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnban("IP", b.ip)}
                      className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/70 hover:bg-white/15 transition shrink-0"
                    >
                      Unban
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
