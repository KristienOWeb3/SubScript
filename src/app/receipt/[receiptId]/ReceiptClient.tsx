"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useSignMessage, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { CheckCircle2, Lock, Eye, EyeOff, UserPlus, Loader2, ExternalLink, ShieldAlert, Key } from "@/components/icons";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";
import { Identity } from "@/components/Identity";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";

interface ReceiptClientProps {
    receiptId: string;
}

function formatAddress(address: string) {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdc(value: string | number | bigint) {
    return (Number(value) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export default function ReceiptClient({ receiptId }: ReceiptClientProps) {
    const { address: connectedAddress, isConnected } = useAccount();
    const { connect, isPending: isConnecting } = useConnect();
    const { signMessageAsync } = useSignMessage();

    const [loading, setLoading] = useState(true);
    const [receipt, setReceipt] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [sessionWallet, setSessionWallet] = useState<string | null>(null);
    const [authRequired, setAuthRequired] = useState(false);
    
    const [inviteAddress, setInviteAddress] = useState("");
    const [inviting, setInviting] = useState(false);
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
    const [invitedList, setInvitedList] = useState<string[]>([]);

    /* Deep link from the dashboard "Grant access" button: scroll to + focus the invite
       form once the receipt is loaded and the viewer is the owner. */
    useEffect(() => {
        if (loading || !receipt || typeof window === "undefined") return;
        if (new URLSearchParams(window.location.search).get("invite") !== "1") return;
        const payer = receipt.payer_address?.toLowerCase();
        const merchant = receipt.merchant_address?.toLowerCase();
        if (!sessionWallet || (sessionWallet !== payer && sessionWallet !== merchant)) return;
        const el = document.getElementById("invite-section");
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => (document.getElementById("invite-input") as HTMLInputElement | null)?.focus(), 400);
        }
    }, [loading, receipt, sessionWallet]);

    const fetchReceiptDetails = useCallback(async () => {
        setLoading(true);
        setError(null);
        setAuthRequired(false);
        try {
            // Check session wallet first
            const sessionRes = await fetch("/api/auth/session");
            const sessionData = await sessionRes.json();
            
            if (sessionData.loggedIn && sessionData.wallet) {
                setSessionWallet(sessionData.wallet.toLowerCase());
            } else {
                setSessionWallet(null);
            }

            // Fetch receipt
            const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`);
            const data = await res.json();

            if (res.status === 401) {
                setAuthRequired(true);
            } else if (res.status === 403) {
                setError("Private Receipt: You do not have permission to view this receipt.");
            } else if (!res.ok) {
                setError(data.error || "Failed to load receipt details.");
            } else {
                setReceipt(data.receipt);
                if (data.receipt.invited_addresses) {
                    setInvitedList(
                        data.receipt.invited_addresses
                            .split(",")
                            .map((a: string) => a.trim().toLowerCase())
                            .filter(Boolean)
                    );
                }
            }
        } catch (err: any) {
            console.error("Error fetching receipt:", err);
            setError("An error occurred while loading receipt details.");
        } finally {
            setLoading(false);
        }
    }, [receiptId]);

    useEffect(() => {
        fetchReceiptDetails();
    }, [fetchReceiptDetails]);

    // Handle wallet change vs session mismatch
    useEffect(() => {
        if (isConnected && connectedAddress && sessionWallet && connectedAddress.toLowerCase() !== sessionWallet.toLowerCase()) {
            // Connected wallet changed, recheck/reauth
            fetchReceiptDetails();
        }
    }, [connectedAddress, isConnected, sessionWallet, fetchReceiptDetails]);

    const handleAuthenticate = async () => {
        if (!connectedAddress) {
            connect({ connector: injected() });
            return;
        }

        setLoading(true);
        setError(null);
        try {
            // 1. Get nonce
            const nonceRes = await fetch("/api/auth/nonce");
            const nonceData = await nonceRes.json();
            if (!nonceData.nonce) throw new Error("Failed to get SIWE nonce");

            // 2. Sign message
            const message = buildWalletAuthMessage({ address: connectedAddress, nonce: nonceData.nonce, domain: window.location.host, uri: window.location.origin });
            const signature = await signMessageAsync({ message });

            // 3. Verify signature
            const verifyRes = await fetch("/api/auth/verify-signature", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    address: connectedAddress,
                    signature,
                    nonce: nonceData.nonce
                })
            });

            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) {
                throw new Error(verifyData.error || "Authentication failed");
            }

            // 4. Reload receipt details
            await fetchReceiptDetails();
        } catch (err: any) {
            console.error("Authentication error:", err);
            setError(err.message || "Failed to authenticate wallet.");
            setLoading(false);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setInviteError(null);
        setInviteSuccess(null);
        if (!inviteAddress || !inviteAddress.startsWith("0x") || inviteAddress.length !== 42) {
            setInviteError("Please enter a valid Ethereum address");
            return;
        }

        setInviting(true);
        try {
            const res = await fetch("/api/receipts/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    receiptId,
                    inviteAddress
                })
            });

            const data = await res.json();
            if (!res.ok) {
                setInviteError(data.error || "Failed to invite address.");
            } else {
                setInviteSuccess(`Successfully invited ${formatAddress(inviteAddress)}!`);
                const added = inviteAddress.toLowerCase();
                if (!invitedList.includes(added)) {
                    setInvitedList(prev => [...prev, added]);
                }
                setInviteAddress("");
            }
        } catch (err: any) {
            console.error("Invite error:", err);
            setInviteError("An error occurred while inviting viewer.");
        } finally {
            setInviting(false);
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-[#060608] text-white px-4 py-8 sm:px-6 sm:py-10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-[#00d2b4]" />
                    <p className="text-white/60 text-sm tracking-wide">Loading secure receipt...</p>
                </div>
            </main>
        );
    }

    const payer = receipt?.payer_address?.toLowerCase();
    const merchant = receipt?.merchant_address?.toLowerCase();
    const isOwner = sessionWallet && (sessionWallet === payer || sessionWallet === merchant);
    const connectedWalletDiffersFromSession = Boolean(
        connectedAddress && sessionWallet && connectedAddress.toLowerCase() !== sessionWallet
    );

    // 1. Access Denied State (Not Logged In / Non-Authorized Wallet)
    if (authRequired || error) {
        return (
            <main className="min-h-screen bg-[#060608] text-white px-4 py-8 sm:px-6 sm:py-10 flex items-center justify-center">
                <section className="w-full max-w-lg border border-white/5 bg-white/[0.02] backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
                    <div className="mx-auto rounded-full bg-red-500/10 border border-red-500/20 p-4 w-16 h-16 flex items-center justify-center text-red-400">
                        <Lock className="h-8 w-8" />
                    </div>

                    <div className="space-y-2">
                        <h1 className="text-xl font-bold tracking-tight">Private Receipt</h1>
                        <p className="text-sm text-white/60 leading-relaxed">
                            This receipt is protected under Arc's Opt-In Privacy standard. Only the merchant, payer, SubScript treasury, or explicitly invited addresses can view it.
                        </p>
                    </div>

                    {authRequired ? (
                        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                            <p className="text-xs text-white/40">
                                {connectedAddress 
                                    ? `Authenticate wallet ${formatAddress(connectedAddress)} to check access.` 
                                    : "Connect your wallet to verify receipt access."}
                            </p>
                            
                            {!connectedAddress ? (
                                <button
                                    onClick={() => connect({ connector: injected() })}
                                    className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 hover:bg-white/90 transition"
                                >
                                    Connect Wallet
                                </button>
                            ) : (
                                <button
                                    onClick={handleAuthenticate}
                                    className="w-full rounded-xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 hover:bg-[#00d2b4]/90 transition"
                                >
                                    Verify Wallet Ownership
                                    <Key className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/10 space-y-3">
                            <p className="text-xs text-red-300">
                                {connectedWalletDiffersFromSession
                                    ? `This browser is signed in as ${formatAddress(sessionWallet || "")}, but ${formatAddress(connectedAddress || "")} is connected.`
                                    : connectedAddress
                                    ? `Wallet ${formatAddress(connectedAddress)} is not authorized to view this receipt.`
                                    : "Unauthorized to view receipt details."}
                            </p>
                            {connectedWalletDiffersFromSession ? (
                                <button
                                    onClick={handleAuthenticate}
                                    className="w-full rounded-xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 hover:bg-[#00d2b4]/90 transition"
                                >
                                    Verify {formatAddress(connectedAddress || "")}
                                    <Key className="h-4 w-4" />
                                </button>
                            ) : (
                                <button
                                    onClick={fetchReceiptDetails}
                                    className="text-xs font-bold text-white underline hover:text-white/80"
                                >
                                    Try checking session again
                                </button>
                            )}
                        </div>
                    )}
                </section>
            </main>
        );
    }

    // 2. Receipt Details State (Authorized)
    const paidAt = receipt.confirmed_at || receipt.created_at;
    const claimHref = `/signup?next=/user&claimReceipt=${encodeURIComponent(receiptId)}`;

    return (
        <main className="min-h-screen bg-[#060608] text-white px-4 py-8 sm:px-6 sm:py-10 flex items-center justify-center">
            <div className="w-full max-w-lg space-y-6">
                <section className="w-full border border-white/10 bg-white/[0.03] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-8">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <p className="text-[10px] uppercase tracking-[0.24em] text-white/40">SubScript Receipt</p>
                                <span className="inline-flex items-center gap-1 rounded bg-[#00d2b4]/10 px-1.5 py-0.5 text-[9px] font-medium text-[#00d2b4] border border-[#00d2b4]/20">
                                    <Lock className="h-2.5 w-2.5" /> Opt-In Privacy
                                </span>
                            </div>
                            <h1 className="mt-2 text-2xl font-bold tracking-tight break-words">{receipt.receipt_id}</h1>
                        </div>
                        <div className="rounded-2xl bg-emerald-400/10 border border-emerald-400/20 p-3 text-emerald-300">
                            <CheckCircle2 className="h-6 w-6" />
                        </div>
                    </div>

                    <div className="grid gap-4">
                        <div className="border border-white/10 rounded-2xl p-5 bg-black/20">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Amount</p>
                            <p className="mt-1 text-4xl font-bold text-[#00d2b4]">${formatUsdc(receipt.amount_usdc)} USDC</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Sender</p>
                                <Identity address={receipt.payer_address} className="mt-1 block text-white/85 text-xs" />
                            </div>
                            <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Date</p>
                                <p className="mt-1 text-white/85 text-xs">{new Date(paidAt).toLocaleString()}</p>
                            </div>
                        </div>

                        <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Merchant</p>
                            <Identity address={receipt.merchant_address} className="mt-1 block text-white/85 text-xs" />
                        </div>

                        <div className="border border-white/10 rounded-2xl p-4 bg-black/20">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Memo note</p>
                            <p className="mt-1 text-white/85 break-words text-xs">{receipt.memo_note || receipt.receipt_id}</p>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-[#00d2b4]/25 bg-[#00d2b4]/10 p-5 space-y-4">
                        <p className="text-sm leading-relaxed text-white/85">
                            Claim your permanent SubScript account to manage this subscription and lock in spending limits.
                        </p>
                        <Link
                            href={claimHref}
                            className="w-full rounded-xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 hover:bg-[#00d2b4]/90 transition"
                        >
                            Continue with Google
                            <ExternalLink className="h-4 w-4" />
                        </Link>
                    </div>
                </section>

                {/* 3. Owner Access: Invite Address Form */}
                {isOwner && (
                    <section id="invite-section" className="border border-[#00d2b4]/15 bg-white/[0.02] backdrop-blur-md rounded-3xl p-6 shadow-2xl space-y-6 scroll-mt-24">
                        <div>
                            <h2 className="text-sm font-bold flex items-center gap-2">
                                <UserPlus className="h-4 w-4 text-[#00d2b4]" /> Invite Address to View Receipt
                            </h2>
                            <p className="text-xs text-white/40 mt-1">
                                As receipt owner, you can grant read access to auditors, customers, or third-parties.
                            </p>
                        </div>

                        <form onSubmit={handleInvite} className="flex gap-2">
                            <input
                                id="invite-input"
                                type="text"
                                value={inviteAddress}
                                onChange={(e) => setInviteAddress(e.target.value)}
                                placeholder="0x..."
                                className="flex-1 rounded-xl bg-black/40 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder-white/30 focus:border-[#00d2b4] focus:outline-none transition"
                            />
                            <button
                                type="submit"
                                disabled={inviting || !inviteAddress}
                                className="rounded-xl bg-white text-black px-4 py-2 text-xs font-bold hover:bg-white/90 disabled:bg-white/40 disabled:text-black/60 transition flex items-center gap-1"
                            >
                                {inviting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Invite"}
                            </button>
                        </form>

                        {inviteError && <p className="text-xs text-red-400">{inviteError}</p>}
                        {inviteSuccess && <p className="text-xs text-emerald-400">{inviteSuccess}</p>}

                        {invitedList.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-white/5">
                                <p className="text-[10px] uppercase tracking-wider text-white/35">Authorized Viewers</p>
                                <div className="grid gap-1.5">
                                    {invitedList.map((addr, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-white/[0.02] border border-white/5">
                                            <Identity address={addr} className="text-white/60" />
                                            <span className="text-[9px] text-[#00d2b4] bg-[#00d2b4]/5 border border-[#00d2b4]/10 px-1 py-0.5 rounded font-mono">
                                                Authorized
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                )}
            </div>
        </main>
    );
}
