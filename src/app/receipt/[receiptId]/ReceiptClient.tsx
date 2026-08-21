"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useSignMessage, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { CheckCircle2, Lock, UserPlus, Loader2, ExternalLink, ShieldAlert, Key, Copy, Check, Download } from "@/components/icons";
import { Identity } from "@/components/Identity";
import { resolveAliasForAddress } from "@/lib/alias/resolve";
import { merchantDisplayName } from "@/lib/identityDisplay";
import { buildWalletAuthMessage } from "@/lib/walletAuthMessage";
import { financialStatusMeta } from "@/components/FinancialStatusBadge";
import { usePlatformFlags } from "@/hooks/usePlatformFlags";

interface ReceiptClientProps {
    receiptId: string;
}

/* The checkout's palette (src/app/pay/[id]/PublicPayClient.tsx), so a payer who just came from
   there recognises the document: ivory page, white card, hairline borders, #111827 ink. The
   accent stays SubScript teal. #00d2b4 is a fill colour — as text on white it sits at 1.9:1 — so
   anything teal and readable uses the darker ink below (4.9:1). */
const ACCENT_INK = "#007f70";

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

function formatPaidAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/* Settlement writes the on-chain memo into memo_note, and that memo IS the receipt id. So a
   receipt with nothing a person typed still has a memo_note — it just reads as a hex string.
   Treat that as "no note" everywhere rather than showing the id twice on one page. */
function humanNote(memoNote: unknown, receiptId: string): string | null {
    if (typeof memoNote !== "string") return null;
    const trimmed = memoNote.trim();
    if (!trimmed || trimmed.toLowerCase() === receiptId.toLowerCase()) return null;
    if (/^rcpt-[0-9a-f]{32}$/i.test(trimmed)) return null;
    return trimmed;
}

export default function ReceiptClient({ receiptId }: ReceiptClientProps) {
    const { address: connectedAddress, isConnected } = useAccount();
    const { connect, isPending: isConnecting } = useConnect();
    const { signMessageAsync } = useSignMessage();
    const { externalWalletEnabled } = usePlatformFlags();

    const [loading, setLoading] = useState(true);
    const [receipt, setReceipt] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [sessionWallet, setSessionWallet] = useState<string | null>(null);
    const [authRequired, setAuthRequired] = useState(false);
    const [merchantName, setMerchantName] = useState<string | null>(null);
    const [referenceCopied, setReferenceCopied] = useState(false);

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
                setError("This receipt is private, and this account isn't on it.");
            } else if (!res.ok) {
                setError(data.error || "We couldn't load this receipt.");
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
            setError("Something went wrong loading this receipt.");
        } finally {
            setLoading(false);
        }
    }, [receiptId]);

    useEffect(() => {
        fetchReceiptDetails();
    }, [fetchReceiptDetails]);

    /* The headline needs the merchant's name as a STRING for the last fallback, which the
       Identity component can't hand back. Same cached resolver Identity uses, so the two agree
       and only one request goes out. */
    useEffect(() => {
        const address = receipt?.merchant_address;
        if (!address) return;
        let active = true;
        resolveAliasForAddress(address)
            .then((alias) => {
                if (active) setMerchantName(alias ? merchantDisplayName(alias) : null);
            })
            .catch(() => undefined);
        return () => { active = false; };
    }, [receipt?.merchant_address]);

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
            setError(err.message || "We couldn't verify that wallet.");
            setLoading(false);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setInviteError(null);
        setInviteSuccess(null);
        if (!inviteAddress || !inviteAddress.startsWith("0x") || inviteAddress.length !== 42) {
            setInviteError("That doesn't look like a wallet address. It starts with 0x and has 42 characters.");
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
                setInviteError(data.error || "We couldn't give that address access.");
            } else {
                setInviteSuccess(`${formatAddress(inviteAddress)} can open this receipt now.`);
                const added = inviteAddress.toLowerCase();
                if (!invitedList.includes(added)) {
                    setInvitedList(prev => [...prev, added]);
                }
                setInviteAddress("");
            }
        } catch (err: any) {
            console.error("Invite error:", err);
            setInviteError("Something went wrong. Try again.");
        } finally {
            setInviting(false);
        }
    };

    const copyReference = async () => {
        try {
            await navigator.clipboard.writeText(receiptId);
            setReferenceCopied(true);
            setTimeout(() => setReferenceCopied(false), 2000);
        } catch {
            setReferenceCopied(false);
        }
    };

    const pageShell = "subscript-receipt min-h-screen bg-[#FFFFF0] text-black selection:bg-[#00d2b4]/20 selection:text-black font-sans px-4 py-8 sm:px-6 sm:py-12";

    const brandLockup = (
        <div className="text-center mb-8">
            <p className="text-2xl font-extrabold tracking-tight text-[#111827]">
                SubScript <span className="font-serif italic font-normal" style={{ color: ACCENT_INK }}>receipt</span>
            </p>
        </div>
    );

    if (loading) {
        return (
            <main className={`${pageShell} flex items-center justify-center`}>
                <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
                    <Loader2 className="h-9 w-9 animate-spin" style={{ color: ACCENT_INK }} />
                    <p className="text-sm text-black/60">Opening your receipt…</p>
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
            <main className={`${pageShell} flex items-center justify-center`}>
                <div className="w-full max-w-md">
                    {brandLockup}
                    <section className="rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm text-center space-y-6">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-black/10 bg-[#f8fafc] text-black/60">
                            <Lock className="h-6 w-6" />
                        </div>

                        <div className="space-y-2">
                            <h1 className="text-xl font-extrabold tracking-tight text-[#111827]">This receipt is private</h1>
                            <p className="text-sm leading-relaxed text-black/65">
                                Only the payer, the merchant, and people they invite can open it. Sign in with the account that's on the receipt.
                            </p>
                        </div>

                        {authRequired ? (
                            <div className="rounded-2xl border border-black/10 bg-[#f8fafc] p-4 space-y-4">
                                <p className="text-sm text-black/65">
                                    {connectedAddress
                                        ? `Verify that you own ${formatAddress(connectedAddress)} to check your access.`
                                        : externalWalletEnabled
                                          ? "Connect your wallet to check your access."
                                          : "Sign in to check your access."}
                                </p>

                                {!connectedAddress ? (
                                    <div className="grid gap-3">
                                        <Link href={`/signin?next=${encodeURIComponent(`/receipt/${receiptId}`)}`} className="w-full rounded-2xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 transition hover:bg-[#00d2b4]/85">Sign in with email or Google</Link>
                                        {/* Hidden while external wallets are paused. The signature would
                                            be refused by /api/auth/verify-signature anyway. */}
                                        {externalWalletEnabled && (
                                            <button
                                                onClick={() => connect({ connector: injected() })}
                                                disabled={isConnecting}
                                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm font-bold text-[#111827] flex items-center justify-center gap-2 transition hover:bg-black/[0.04] disabled:opacity-50"
                                            >
                                                {isConnecting ? "Connecting…" : "Use browser wallet"}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleAuthenticate}
                                        className="w-full rounded-2xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 transition hover:bg-[#00d2b4]/85"
                                    >
                                        Verify this wallet
                                        <Key className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3 text-left">
                                <p className="text-sm leading-relaxed text-red-900">
                                    {connectedWalletDiffersFromSession
                                        ? `You're signed in as ${formatAddress(sessionWallet || "")}, but ${formatAddress(connectedAddress || "")} is connected. Verify the connected one to check its access.`
                                        : connectedAddress
                                        ? `${formatAddress(connectedAddress)} isn't on this receipt, so it can't open it.`
                                        : error}
                                </p>
                                {connectedWalletDiffersFromSession ? (
                                    <button
                                        onClick={handleAuthenticate}
                                        className="w-full rounded-2xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 transition hover:bg-[#00d2b4]/85"
                                    >
                                        Verify {formatAddress(connectedAddress || "")}
                                        <Key className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={fetchReceiptDetails}
                                        className="text-sm font-bold text-[#111827] underline underline-offset-2 hover:opacity-70"
                                    >
                                        Check again
                                    </button>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </main>
        );
    }

    // 2. Receipt Details State (Authorized)
    const paidAt = receipt.confirmed_at || receipt.created_at;
    const claimHref = `/signup?next=/user&claimReceipt=${encodeURIComponent(receiptId)}`;
    const receiptStatus = financialStatusMeta(receipt.status);
    const receiptConfirmed = receiptStatus.tone === "success";
    const note = humanNote(receipt.memo_note, receipt.receipt_id);

    /* The subject of the document, in falling order of how much a person would recognise it.
       The receipt id is deliberately absent from this chain: it is the reference, not the
       subject, and it appears once, near the foot of the page. */
    const subject = (typeof receipt.title === "string" && receipt.title.trim())
        || note
        || `Payment to ${merchantName || "a SubScript merchant"}`;

    const statusChrome = receiptConfirmed
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : receiptStatus.tone === "failure"
            ? "border-red-200 bg-red-50 text-red-800"
            : receiptStatus.tone === "pending"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-black/15 bg-[#f8fafc] text-black/70";

    const rowLabel = "shrink-0 text-sm text-black/55";
    const rowValue = "min-w-0 text-right text-sm font-semibold text-[#111827]";

    return (
        <main className={pageShell}>
            <div className="mx-auto w-full max-w-2xl space-y-5">
                {brandLockup}

                <article className="receipt-document rounded-3xl border border-black/15 bg-white p-6 sm:p-8 shadow-sm">
                    <header className="flex items-start justify-between gap-5">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-black/55">Receipt for</p>
                            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-[#111827] break-words">
                                {subject}
                            </h1>
                        </div>
                        <div className={`shrink-0 grid h-12 w-12 place-items-center rounded-2xl border ${statusChrome}`} aria-hidden="true">
                            {receiptConfirmed ? <CheckCircle2 className="h-6 w-6" /> : receiptStatus.tone === "failure" ? <ShieldAlert className="h-6 w-6" /> : receiptStatus.tone === "pending" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Lock className="h-6 w-6" />}
                        </div>
                    </header>

                    <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3 rounded-2xl border border-black/10 bg-[#f8fafc] p-5">
                        <span className="text-sm text-black/60">Amount paid</span>
                        <span className="text-3xl sm:text-4xl font-extrabold tracking-tight" style={{ color: ACCENT_INK }}>
                            {formatUsdc(receipt.amount_usdc)} USDC
                        </span>
                    </div>

                    {/* Hairline rows rather than a grid of cards: this is the part someone reads
                        line by line, and hairlines survive a print far better than nested fills. */}
                    <dl className="mt-2 divide-y divide-black/10">
                        <div className="flex items-baseline justify-between gap-6 py-4">
                            <dt className={rowLabel}>Paid to</dt>
                            <dd className={rowValue}>
                                <Identity
                                    address={receipt.merchant_address}
                                    fallback={formatAddress(receipt.merchant_address)}
                                    placeholderClassName="bg-black/10"
                                />
                            </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-6 py-4">
                            <dt className={rowLabel}>Paid by</dt>
                            <dd className={rowValue}>
                                <Identity
                                    address={receipt.payer_address}
                                    fallback={formatAddress(receipt.payer_address)}
                                    placeholderClassName="bg-black/10"
                                />
                            </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-6 py-4">
                            <dt className={rowLabel}>Paid on</dt>
                            <dd className={rowValue}>{formatPaidAt(paidAt)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-6 py-4">
                            <dt className={rowLabel}>Status</dt>
                            <dd className="min-w-0 text-right">
                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${statusChrome}`}>
                                    {receiptStatus.label}
                                </span>
                            </dd>
                        </div>
                        {/* No note, no block. The field used to fall back to the receipt id, which
                            put the same hex string on the page twice. */}
                        {note && (
                            <div className="py-4">
                                <dt className={rowLabel}>Note</dt>
                                <dd className="mt-1 text-sm leading-relaxed text-[#111827] break-words">{note}</dd>
                            </div>
                        )}
                    </dl>

                    <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-black/60">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT_INK }} />
                        <span>Only the payer, the merchant, and people they invite can open this page. The link on its own isn't enough.</span>
                    </p>

                    <div className="mt-5 rounded-2xl border border-black/10 bg-[#f8fafc] p-4">
                        <p className="text-sm font-semibold text-[#111827]">Reference</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-black/55">
                            The memo written on Arc with this payment. Quote it if you ever need to ask about it.
                        </p>
                        <div className="mt-2.5 flex items-center gap-2">
                            <code className="min-w-0 flex-1 break-all rounded-xl border border-black/10 bg-white px-3 py-2 font-mono text-xs text-black/70">
                                {receipt.receipt_id}
                            </code>
                            <button
                                type="button"
                                onClick={copyReference}
                                className="receipt-screen-only shrink-0 rounded-xl border border-black/15 bg-white px-3 py-2 text-xs font-bold text-[#111827] transition hover:bg-black/[0.04]"
                            >
                                {referenceCopied ? (
                                    <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> Copied</span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" /> Copy</span>
                                )}
                            </button>
                        </div>
                        <span aria-live="polite" className="sr-only">{referenceCopied ? "Reference copied" : ""}</span>
                    </div>

                    {!sessionWallet && <div className="receipt-screen-only mt-5 rounded-2xl border p-5 space-y-4" style={{ borderColor: "rgba(0,210,180,0.35)", backgroundColor: "rgba(0,210,180,0.08)" }}>
                        <p className="text-sm leading-relaxed text-[#111827]">
                            Set up a SubScript account and this receipt sits with the rest of your payments, with limits you set.
                        </p>
                        <Link
                            href={claimHref}
                            className="w-full rounded-2xl bg-[#00d2b4] px-4 py-3 text-sm font-bold text-black flex items-center justify-center gap-2 transition hover:bg-[#00d2b4]/85"
                        >
                            Continue with Google
                            <ExternalLink className="h-4 w-4" />
                        </Link>
                    </div>}
                </article>

                {/* Expenses and tax are what a receipt is actually for, so the print path is a
                    first-class action rather than something to find in a browser menu. */}
                <div className="receipt-screen-only flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-2 rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm font-bold text-[#111827] shadow-sm transition hover:bg-black/[0.04]"
                    >
                        <Download className="h-4 w-4" /> Save as PDF
                    </button>
                    <Link href="/dashboard-router" className="inline-flex items-center rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm font-bold text-black/70 shadow-sm transition hover:text-[#111827]">
                        Back to dashboard
                    </Link>
                </div>

                {/* 3. Owner Access: Invite Address Form */}
                {isOwner && (
                    <section id="invite-section" className="receipt-screen-only rounded-3xl border border-black/15 bg-white p-6 shadow-sm space-y-5 scroll-mt-24">
                        <div>
                            <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-[#111827]">
                                <UserPlus className="h-4 w-4" style={{ color: ACCENT_INK }} /> Let someone else see this
                            </h2>
                            <p className="mt-1.5 text-sm leading-relaxed text-black/60">
                                Paste the wallet address of the person you want to show it to, and they'll be able to open this page. Handy for an accountant or a bookkeeper. You can add more than one.
                            </p>
                        </div>

                        <form onSubmit={handleInvite} className="flex flex-col gap-2 sm:flex-row">
                            <input
                                id="invite-input"
                                type="text"
                                value={inviteAddress}
                                onChange={(e) => setInviteAddress(e.target.value)}
                                placeholder="0x1234…5678"
                                aria-label="Wallet address to give access to"
                                className="min-w-0 flex-1 rounded-2xl border border-black/15 bg-white px-4 py-3 font-mono text-sm text-[#111827] placeholder-black/35 transition focus:border-[#00d2b4] focus:outline-none"
                            />
                            <button
                                type="submit"
                                disabled={inviting || !inviteAddress}
                                className="shrink-0 rounded-2xl bg-[#00d2b4] px-5 py-3 text-sm font-bold text-black transition hover:bg-[#00d2b4]/85 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Give access"}
                            </button>
                        </form>

                        {inviteError && <p className="text-sm text-red-700" role="alert">{inviteError}</p>}
                        {inviteSuccess && <p className="text-sm font-semibold" style={{ color: ACCENT_INK }} role="status">{inviteSuccess}</p>}

                        {invitedList.length > 0 && (
                            <div className="space-y-2 border-t border-black/10 pt-4">
                                <p className="text-sm font-semibold text-[#111827]">Can open this receipt</p>
                                <ul className="grid gap-1.5">
                                    {invitedList.map((addr, idx) => (
                                        <li key={idx} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-[#f8fafc] px-3 py-2 text-sm">
                                            <Identity
                                                address={addr}
                                                fallback={formatAddress(addr)}
                                                className="min-w-0 truncate text-black/70"
                                                placeholderClassName="bg-black/10"
                                            />
                                            <span className="shrink-0 text-xs font-semibold" style={{ color: ACCENT_INK }}>
                                                Has access
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>
                )}
            </div>
        </main>
    );
}
