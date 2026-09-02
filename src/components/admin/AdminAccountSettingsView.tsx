"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertCircle,
    Building2,
    CheckCircle2,
    Clock,
    Loader2,
    Lock,
    RefreshCw,
    Search,
    ShieldOff,
    Sliders,
    User,
    Users,
} from "@/components/icons";
import { SkeletonRows } from "@/components/ui/skeletons";

/* Account-level settings for a single wallet.
 *
 * The one setting here today is the withdrawal hold, driven by /api/admin/withdrawal-holds.
 * That route's validation is the contract this form follows: a reason of 3+ characters is
 * mandatory when placing a hold, an expiry must be in the future, and alias resolution
 * (merchant.sub) happens server-side on POST, so nothing here tries to repeat it.
 *
 * GET returns the 200 most recent holds with an `active` flag, so a lookup that finds
 * nothing can only claim "nothing in the 200 most recent" and the copy says exactly that.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

type HoldScope = "USER" | "MERCHANT" | "BOTH";

interface WithdrawalHold {
    address: string;
    scope: string;
    reason: string | null;
    placedBy: string;
    expiresAt: string | null;
    createdAt: string;
    active: boolean;
}

/* The route answers 404 for two unrelated things: the admin guard hiding itself from a
   caller it doesn't recognise, and "there is no hold here to clear". They need different
   words, so the kind travels with the message instead of everything landing in one red box. */
type FeedbackKind = "auth" | "no-hold" | "validation" | "server";

interface Feedback {
    kind: FeedbackKind;
    message: string;
}

const SCOPE_OPTIONS: Array<{ value: HoldScope; label: string; blurb: string; Icon: typeof User }> = [
    {
        value: "USER",
        label: "User side",
        blurb: "Stops the withdrawals they make as a subscriber. Their merchant payouts, if they run plans, still go out.",
        Icon: User,
    },
    {
        value: "MERCHANT",
        label: "Merchant side",
        blurb: "Stops the payouts they take as a merchant. Money they hold as a subscriber can still move.",
        Icon: Building2,
    },
    {
        value: "BOTH",
        label: "Both sides",
        blurb: "Stops every withdrawal path for this wallet. Pick this when you don't yet know which side the money leaves through.",
        Icon: Users,
    },
];

function shortAddress(value: string): string {
    if (!value || value.length < 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatMoment(iso: string | null): string {
    if (!iso) return "";
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/* datetime-local wants local wall-clock text, not an ISO string. A minute of headroom keeps
   the browser's own picker from offering a value the API will reject as already past. */
function localMinuteFromNow(): string {
    const d = new Date(Date.now() + 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminAccountSettingsView({ viewerWallet }: { viewerWallet: string | null }): React.ReactElement {
    const [holds, setHolds] = useState<WithdrawalHold[]>([]);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);

    const [lookup, setLookup] = useState("");
    const [scope, setScope] = useState<HoldScope>("BOTH");
    const [reason, setReason] = useState("");
    const [expiresAt, setExpiresAt] = useState("");

    const [submitting, setSubmitting] = useState<"hold" | "clear" | null>(null);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [minExpiry] = useState(localMinuteFromNow);

    const fetchHolds = useCallback(async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const res = await fetch("/api/admin/withdrawal-holds");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    res.status === 404
                        ? "The API didn't recognise you as an admin. Reload and sign in again."
                        : data?.error || "Couldn't load the holds.",
                );
            }
            setHolds(Array.isArray(data?.holds) ? data.holds : []);
            setListError(null);
        } catch (err) {
            setListError(err instanceof Error ? err.message : "Couldn't load the holds.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        /* `loading` already starts true, so the first fetch doesn't have to ask for the spinner
           and the mount still shows one. */
        fetchHolds();
    }, [fetchHolds]);

    const trimmedLookup = lookup.trim();
    const lookupIsAddress = ADDRESS_PATTERN.test(trimmedLookup);
    const lookupIsAlias = !lookupIsAddress && trimmedLookup.includes(".");

    /* Holds are keyed by address, so the client can only match an address. An alias only
       becomes an address once the server resolves it on POST. */
    const matchedHold = useMemo(() => {
        if (!lookupIsAddress) return null;
        const needle = trimmedLookup.toLowerCase();
        return holds.find((h) => h.address.toLowerCase() === needle) ?? null;
    }, [holds, lookupIsAddress, trimmedLookup]);

    const submit = async (placing: boolean) => {
        if (submitting) return;
        setFeedback(null);
        setSuccess(null);

        if (!trimmedLookup) {
            setFeedback({ kind: "validation", message: "Enter a wallet address or a .sub name first." });
            return;
        }

        const trimmedReason = reason.trim();
        let isoExpiry: string | null = null;

        if (placing) {
            if (trimmedReason.length < 3) {
                setFeedback({
                    kind: "validation",
                    message: "Write a reason of at least three characters. The API rejects anything shorter.",
                });
                return;
            }
            if (expiresAt) {
                const parsed = new Date(expiresAt);
                if (Number.isNaN(parsed.getTime())) {
                    setFeedback({ kind: "validation", message: "That expiry isn't a date the API can read." });
                    return;
                }
                /* Guarding here as well as server-side: a past expiry writes a hold that never
                   blocks anything, and the operator walks away thinking the money is frozen. */
                if (parsed.getTime() <= Date.now()) {
                    setFeedback({
                        kind: "validation",
                        message: "The expiry has to be in the future. A date that's already gone is a hold that blocks nothing.",
                    });
                    return;
                }
                isoExpiry = parsed.toISOString();
            }
        }

        setSubmitting(placing ? "hold" : "clear");
        try {
            const res = await fetch("/api/admin/withdrawal-holds", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    placing
                        ? { address: trimmedLookup, hold: true, scope, reason: trimmedReason, expiresAt: isoExpiry }
                        : { address: trimmedLookup, hold: false, reason: trimmedReason || undefined },
                ),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const apiMessage = typeof data?.error === "string" ? data.error : "";
                /* The guard's 404 body is literally "Not Found". Anything else on a 404 came
                   from the clear path, which means the hold wasn't there to begin with. */
                if (res.status === 404 && (!apiMessage || apiMessage === "Not Found")) {
                    setFeedback({
                        kind: "auth",
                        message: "The API didn't recognise you as an admin, so it answered Not Found. Your session may have lapsed. Reload and sign in again.",
                    });
                } else if (res.status === 404) {
                    setFeedback({ kind: "no-hold", message: apiMessage });
                } else if (res.status === 400) {
                    setFeedback({ kind: "validation", message: apiMessage || "The API turned that down." });
                } else {
                    setFeedback({ kind: "server", message: apiMessage || "The API couldn't finish that." });
                }
                return;
            }

            const resolved = typeof data?.address === "string" ? data.address : trimmedLookup;
            /* Pin the field to the address the server resolved, so an alias lookup can read
               its own hold state afterwards. */
            setLookup(resolved);

            if (placing) {
                setSuccess(`Hold placed on ${shortAddress(resolved)}. It's in the audit log now.`);
                setReason("");
                setExpiresAt("");
            } else {
                setSuccess(`Hold cleared on ${shortAddress(resolved)}. Withdrawals can move again.`);
                setReason("");
            }
            await fetchHolds(false);
        } catch {
            setFeedback({ kind: "server", message: "The request didn't get through. Check your connection and try again." });
        } finally {
            setSubmitting(null);
        }
    };

    const activeCount = holds.filter((h) => h.active).length;
    const lapsedCount = holds.length - activeCount;

    return (
        <div className="space-y-4 font-sans">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-black uppercase tracking-wide text-[#0f172a]">
                        <Sliders className="h-5 w-5 text-[#2775ca]" /> Account settings
                    </h2>
                    <p className="text-xs text-[#475569]">
                        Settings that belong to one account rather than to a case. A withdrawal hold lives here because
                        it's a switch on the account, not a punishment.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => fetchHolds(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
            </div>

            {/* Audit note. Knowing the row is permanent changes how carefully people use this. */}
            <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                <p className="leading-relaxed">
                    Every hold you set or clear is written to the admin audit log with your wallet, the reason, the scope
                    and the time. Re-scoping an existing hold records the old values too.
                    {viewerWallet ? (
                        <>
                            {" "}You're signed in as{" "}
                            <span className="font-mono font-semibold">{shortAddress(viewerWallet)}</span>.
                        </>
                    ) : null}
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* Lookup + current state */}
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-5">
                    <div>
                        <h3 className="text-sm font-black text-[#0f172a]">Look up an account</h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            A wallet address, or a SubScript name like merchant.sub. The server resolves names for you.
                        </p>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-slate-400" />
                        <input
                            type="text"
                            value={lookup}
                            onChange={(e) => setLookup(e.target.value)}
                            placeholder="0x… or merchant.sub"
                            spellCheck={false}
                            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 font-mono text-xs text-[#0f172a] placeholder-slate-400 transition focus:border-[#2775ca] focus:outline-none"
                        />
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        {!trimmedLookup ? (
                            <p className="text-[11px] leading-relaxed text-slate-500">
                                Paste an address to see whether this account is already on hold, and why.
                            </p>
                        ) : lookupIsAlias ? (
                            <p className="text-[11px] leading-relaxed text-slate-500">
                                Names get resolved when you place or clear the hold, so we can't read the current state
                                from one yet. Paste the wallet address if you want to check first.
                            </p>
                        ) : !lookupIsAddress ? (
                            <p className="text-[11px] leading-relaxed text-amber-700">
                                That's neither a wallet address nor a name with a dot in it. The API will turn it down.
                            </p>
                        ) : loading ? (
                            <p className="flex items-center gap-2 text-[11px] text-slate-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2775ca]" /> Checking the recent holds…
                            </p>
                        ) : !matchedHold ? (
                            <div className="space-y-1">
                                <p className="text-[11px] font-bold text-slate-700">
                                    No hold on this account in the 200 most recent.
                                </p>
                                <p className="text-[11px] leading-relaxed text-slate-500">
                                    That's all this page can see. An older hold, set and cleared long ago, wouldn't show
                                    up here. The audit log is the place to check that.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                            matchedHold.active
                                                ? "bg-rose-100 text-rose-800"
                                                : "bg-slate-200 text-slate-600"
                                        }`}
                                    >
                                        {matchedHold.active ? "On hold" : "Lapsed"}
                                    </span>
                                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-700">
                                        {matchedHold.scope}
                                    </span>
                                </div>

                                <p className="font-mono text-[11px] text-slate-600">{matchedHold.address}</p>

                                <dl className="space-y-1 text-[11px] text-slate-600">
                                    <div>
                                        <dt className="font-bold text-slate-500">Reason</dt>
                                        <dd className="leading-relaxed text-slate-700">
                                            {matchedHold.reason || "Nothing was written down."}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="font-bold text-slate-500">Placed by</dt>
                                        <dd className="font-mono text-slate-700">
                                            {shortAddress(matchedHold.placedBy)}
                                            {viewerWallet &&
                                            matchedHold.placedBy.toLowerCase() === viewerWallet.toLowerCase()
                                                ? " (you)"
                                                : ""}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="font-bold text-slate-500">Placed</dt>
                                        <dd className="text-slate-700">{formatMoment(matchedHold.createdAt)}</dd>
                                    </div>
                                    <div>
                                        <dt className="font-bold text-slate-500">Expiry</dt>
                                        <dd className="leading-relaxed text-slate-700">
                                            {!matchedHold.expiresAt
                                                ? "None. It stays until somebody clears it."
                                                : matchedHold.active
                                                  ? `Lapses ${formatMoment(matchedHold.expiresAt)}.`
                                                  : `Lapsed ${formatMoment(matchedHold.expiresAt)}. The row is kept as a record and no longer blocks withdrawals.`}
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                        )}
                    </div>
                </div>

                {/* Place or clear */}
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-7">
                    <div>
                        <h3 className="text-sm font-black text-[#0f172a]">Place or clear a withdrawal hold</h3>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            A hold only touches withdrawal paths. Whoever you hold can still sign in and answer your
                            questions, which is the point of a hold rather than a ban. It won't recall a withdrawal
                            that's already on-chain.
                        </p>
                    </div>

                    <fieldset className="space-y-2">
                        <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            What should it stop?
                        </legend>
                        <div className="space-y-2">
                            {SCOPE_OPTIONS.map(({ value, label, blurb, Icon }) => {
                                const selected = scope === value;
                                return (
                                    <label
                                        key={value}
                                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition ${
                                            selected
                                                ? "border-[#2775ca] bg-[#2775ca]/5 ring-1 ring-[#2775ca]/20"
                                                : "border-slate-100 bg-white hover:border-slate-300 hover:bg-slate-50"
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="withdrawal-hold-scope"
                                            value={value}
                                            checked={selected}
                                            onChange={() => setScope(value)}
                                            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#2775ca]"
                                        />
                                        <div className="min-w-0">
                                            <span className="flex items-center gap-1.5 text-xs font-bold text-[#0f172a]">
                                                <Icon className="h-3.5 w-3.5 text-[#2775ca]" /> {label}
                                            </span>
                                            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                                                {blurb}
                                            </span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>

                    <div>
                        <label
                            htmlFor="withdrawal-hold-reason"
                            className="text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                            Why
                        </label>
                        <p className="mb-1.5 mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            Required, and at least three characters. This freezes somebody else's money, and in six
                            months the audit row is the only account of why. Write it for whoever reads it then.
                        </p>
                        <textarea
                            id="withdrawal-hold-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value.slice(0, 300))}
                            rows={3}
                            placeholder="Chargeback dispute #418, holding payouts until the merchant replies"
                            className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-[#0f172a] placeholder-slate-400 transition focus:border-[#2775ca] focus:outline-none"
                        />
                        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                            <span>{reason.trim().length < 3 ? "Three characters minimum." : "Good to go."}</span>
                            <span>{reason.length}/300</span>
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor="withdrawal-hold-expiry"
                            className="text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                            Lapses on
                        </label>
                        <p className="mb-1.5 mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            Optional, and it has to be in the future. Leave it empty and the hold stays put until
                            somebody clears it.
                        </p>
                        <input
                            id="withdrawal-hold-expiry"
                            type="datetime-local"
                            value={expiresAt}
                            min={minExpiry}
                            onChange={(e) => setExpiresAt(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-[#0f172a] transition focus:border-[#2775ca] focus:outline-none sm:w-64"
                        />
                    </div>

                    {feedback && (
                        <div
                            className={`space-y-1 rounded-xl border p-2.5 text-xs ${
                                feedback.kind === "auth"
                                    ? "border-slate-300 bg-slate-100 text-slate-700"
                                    : feedback.kind === "no-hold"
                                      ? "border-amber-300 bg-amber-50 text-amber-800"
                                      : "border-red-200 bg-red-50 text-red-700"
                            }`}
                        >
                            <p className="flex items-start gap-2 font-semibold">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{feedback.message}</span>
                            </p>
                            {feedback.kind === "no-hold" && (
                                <p className="pl-6 text-[11px] leading-relaxed">
                                    Nothing was changed, and nothing needed to be. Withdrawals for that account were
                                    already free to move.
                                </p>
                            )}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{success}</span>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <button
                            type="button"
                            onClick={() => submit(true)}
                            disabled={submitting !== null || !trimmedLookup || reason.trim().length < 3}
                            className="flex items-center gap-1.5 rounded-xl bg-[#2775ca] px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#2064b0] disabled:opacity-40"
                        >
                            {submitting === "hold" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Lock className="h-3.5 w-3.5" />
                            )}
                            Place hold
                        </button>

                        <button
                            type="button"
                            onClick={() => submit(false)}
                            disabled={submitting !== null || !trimmedLookup}
                            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
                        >
                            {submitting === "clear" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <ShieldOff className="h-3.5 w-3.5" />
                            )}
                            Clear hold
                        </button>

                        <span className="text-[10px] text-slate-400">
                            Clearing doesn't need a reason, but one still helps the next reader.
                        </span>
                    </div>
                </div>
            </div>

            {/* Every hold on record */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-black text-[#0f172a]">Holds on record</h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            The 200 most recent, newest first. {activeCount} in force, {lapsedCount} lapsed.
                        </p>
                    </div>
                </div>

                {listError && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{listError}</span>
                    </div>
                )}

                {loading ? (
                    <div className="p-4">
                        <SkeletonRows count={4} avatar={false} lines={2} label="Loading active withdrawal holds..." />
                    </div>
                ) : holds.length === 0 && !listError ? (
                    <div className="flex h-32 flex-col items-center justify-center gap-2 p-4 text-center text-slate-400">
                        <Lock className="h-8 w-8 text-slate-300" />
                        <span className="text-xs font-semibold text-slate-500">Nobody is on hold right now.</span>
                        <span className="text-[11px] text-slate-400">
                            Look an account up above when you need to freeze a payout.
                        </span>
                    </div>
                ) : (
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left">
                            <thead>
                                <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">
                                    <th className="pb-2 pr-3">Account</th>
                                    <th className="pb-2 pr-3">Stops</th>
                                    <th className="pb-2 pr-3">State</th>
                                    <th className="pb-2 pr-3">Why</th>
                                    <th className="pb-2 pr-3">Placed by</th>
                                    <th className="pb-2 pr-3">Placed</th>
                                    <th className="pb-2">Expiry</th>
                                </tr>
                            </thead>
                            <tbody>
                                {holds.map((h) => {
                                    const isViewers =
                                        Boolean(viewerWallet) &&
                                        h.placedBy.toLowerCase() === viewerWallet?.toLowerCase();
                                    return (
                                        <tr
                                            key={`${h.address}-${h.createdAt}`}
                                            className={`border-b border-slate-100 align-top text-[11px] last:border-0 ${
                                                h.active ? "text-slate-700" : "text-slate-400"
                                            }`}
                                        >
                                            <td className="py-2.5 pr-3">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setLookup(h.address);
                                                        setFeedback(null);
                                                        setSuccess(null);
                                                    }}
                                                    className="font-mono font-semibold text-[#2775ca] hover:underline"
                                                    title="Load this account into the lookup"
                                                >
                                                    {shortAddress(h.address)}
                                                </button>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600">
                                                    {h.scope}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                                        h.active
                                                            ? "bg-rose-100 text-rose-800"
                                                            : "bg-slate-200 text-slate-600"
                                                    }`}
                                                >
                                                    {h.active ? "In force" : "Lapsed"}
                                                </span>
                                            </td>
                                            <td className="max-w-[240px] py-2.5 pr-3 leading-relaxed">
                                                {h.reason || <span className="italic text-slate-400">Not recorded</span>}
                                            </td>
                                            <td className="py-2.5 pr-3 font-mono">
                                                {shortAddress(h.placedBy)}
                                                {isViewers && <span className="ml-1 font-sans text-slate-400">(you)</span>}
                                            </td>
                                            <td className="whitespace-nowrap py-2.5 pr-3">{formatMoment(h.createdAt)}</td>
                                            <td className="whitespace-nowrap py-2.5">
                                                {h.expiresAt ? (
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3 shrink-0 text-slate-400" />
                                                        {formatMoment(h.expiresAt)}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">No expiry</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                            Lapsed rows are kept on purpose. The hold stopped blocking withdrawals when it expired, and
                            the row stays behind as the record that it happened.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
