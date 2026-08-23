"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Copy,
    Check,
    FileText,
    Filter,
    Loader2,
    RefreshCw,
    ShieldAlert,
} from "@/components/icons";
import { SkeletonRows } from "@/components/ui/skeletons";

/* Shape of a single row as served by GET /api/admin/audit-log. */
export interface AuditLogRow {
    id: string;
    actor: string;
    action: string;
    target: string | null;
    detail: unknown | null;
    ip: string | null;
    createdAt: string;
}

interface AuditLogResponse {
    rows?: AuditLogRow[];
    nextCursor?: string | null;
    actions?: string[];
    error?: string;
}

interface AdminAuditLogViewProps {
    viewerWallet?: string | null;
}

/* Actions that overrule a normal outcome or change who holds power. The log's taxonomy was
   built so an auditor can pull these out of routine traffic, so the table marks them. */
const OVERRIDE_ACTIONS = new Set([
    "KYC_FORCE_APPROVE",
    "KYC_MANUAL_CREATE",
    "BAN_ACCOUNT",
    "BAN_IP",
    "ADMIN_WALLET_GRANT",
    "ADMIN_WALLET_REVOKE",
    "MAINTENANCE_SET",
    "WITHDRAWAL_HOLD_SET",
]);

/* Typing a wallet fires one request per keystroke without this. 350ms sits above a paste
   burst and below the gap between characters, so a pasted address resolves in one call. */
const FILTER_DEBOUNCE_MS = 350;

const FIELD_LABEL = "text-[10px] font-black uppercase tracking-wider text-[#64748b]";
const FIELD_INPUT =
    "w-full rounded-lg border border-[#cbd5e1] bg-white px-3.5 py-2 text-xs text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#2775ca] focus:outline-none focus:ring-2 focus:ring-[#2775ca]/15";

/* Same truncation the support ticket queue uses, so wallets read the same across admin tabs. */
function shortValue(value: string): string {
    if (value.length <= 14) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatStamp(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString(undefined, {
        year: "2-digit",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatDetail(detail: unknown): string | null {
    if (detail === null || detail === undefined) return null;
    if (typeof detail === "string") return detail;
    try {
        return JSON.stringify(detail, null, 2);
    } catch {
        return String(detail);
    }
}

export function AdminAuditLogView({ viewerWallet }: AdminAuditLogViewProps) {
    // Text fields keep a draft copy that settles into the applied value after a pause.
    const [actorDraft, setActorDraft] = useState("");
    const [targetDraft, setTargetDraft] = useState("");
    const [actor, setActor] = useState("");
    const [target, setTarget] = useState("");
    // The dropdown and the date pickers are single deliberate clicks, so they apply at once.
    const [action, setAction] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [overridesOnly, setOverridesOnly] = useState(false);

    const [rows, setRows] = useState<AuditLogRow[]>([]);
    const [actions, setActions] = useState<string[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The route answers 404 for a stale session and for a non-admin alike, on purpose.
    const [lockedOut, setLockedOut] = useState(false);

    // Guards against a slow first page landing after a newer one and overwriting it.
    const requestSeq = useRef(0);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setActor(actorDraft.trim()), FILTER_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [actorDraft]);

    useEffect(() => {
        const timer = setTimeout(() => setTarget(targetDraft.trim()), FILTER_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [targetDraft]);

    useEffect(() => {
        return () => {
            if (copyTimer.current) clearTimeout(copyTimer.current);
        };
    }, []);

    const load = useCallback(
        async (cursor: string | null) => {
            const seq = ++requestSeq.current;
            if (cursor) setLoadingMore(true);
            else setLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams();
                if (actor) params.set("actor", actor);
                if (action) params.set("action", action);
                if (target) params.set("target", target);
                if (from) params.set("from", from);
                if (to) params.set("to", to);
                if (cursor) params.set("cursor", cursor);

                const res = await fetch(`/api/admin/audit-log?${params.toString()}`);

                if (res.status === 404) {
                    if (seq === requestSeq.current) {
                        setLockedOut(true);
                        setRows([]);
                        setNextCursor(null);
                    }
                    return;
                }

                const data: AuditLogResponse | null = await res.json().catch(() => null);
                if (!res.ok) {
                    throw new Error(data?.error || "The log didn't load. Try again.");
                }
                if (seq !== requestSeq.current) return;

                setLockedOut(false);
                const incoming = Array.isArray(data?.rows) ? data.rows : [];
                setRows((prev) => (cursor ? [...prev, ...incoming] : incoming));
                setNextCursor(data?.nextCursor ?? null);
                if (Array.isArray(data?.actions) && data.actions.length > 0) {
                    setActions(data.actions);
                }
                if (!cursor) setExpanded({});
            } catch (err) {
                if (seq !== requestSeq.current) return;
                setError(err instanceof Error ? err.message : "The log didn't load. Try again.");
            } finally {
                if (seq === requestSeq.current) {
                    setLoading(false);
                    setLoadingMore(false);
                }
            }
        },
        [actor, action, target, from, to],
    );

    useEffect(() => {
        load(null);
    }, [load]);

    const hasFilters = Boolean(actor || action || target || from || to);

    const clearFilters = () => {
        setActorDraft("");
        setTargetDraft("");
        setActor("");
        setTarget("");
        setAction("");
        setFrom("");
        setTo("");
        setOverridesOnly(false);
    };

    const overrideCount = useMemo(
        () => rows.filter((row) => OVERRIDE_ACTIONS.has(row.action)).length,
        [rows],
    );

    const visibleRows = useMemo(
        () => (overridesOnly ? rows.filter((row) => OVERRIDE_ACTIONS.has(row.action)) : rows),
        [rows, overridesOnly],
    );

    const copy = async (key: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedKey(key);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopiedKey(null), 1400);
        } catch {
            setError("Couldn't copy that. Your browser blocked clipboard access.");
        }
    };

    const toggleRow = (id: string) => {
        setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const viewer = viewerWallet ? viewerWallet.toLowerCase() : null;

    return (
        <div className="space-y-4 font-sans">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-black uppercase tracking-wide text-[#0f172a]">
                        <FileText className="h-5 w-5 text-[#2775ca]" /> Audit log
                    </h2>
                    <p className="text-xs text-[#475569]">
                        Who changed what, and what it was before they changed it. Newest first.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => load(null)}
                    disabled={loading}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
            </div>

            {/* Filters */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL}>Actor</span>
                        <input
                            type="text"
                            value={actorDraft}
                            onChange={(e) => setActorDraft(e.target.value)}
                            placeholder="Wallet address"
                            className={FIELD_INPUT}
                        />
                    </label>

                    <label className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL}>Action</span>
                        <select
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            className={FIELD_INPUT}
                        >
                            <option value="">Any action</option>
                            {actions.map((name) => (
                                <option key={name} value={name}>
                                    {OVERRIDE_ACTIONS.has(name) ? `${name} (override)` : name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL}>Target</span>
                        <input
                            type="text"
                            value={targetDraft}
                            onChange={(e) => setTargetDraft(e.target.value)}
                            placeholder="Wallet, IP, or subject"
                            className={FIELD_INPUT}
                        />
                    </label>

                    <label className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL}>From</span>
                        <input
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                            className={FIELD_INPUT}
                        />
                    </label>

                    <label className="flex flex-col gap-1.5">
                        <span className={FIELD_LABEL}>To</span>
                        <input
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            className={FIELD_INPUT}
                        />
                    </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setOverridesOnly((v) => !v)}
                            aria-pressed={overridesOnly}
                            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                                overridesOnly
                                    ? "border-[#b45309] bg-[#fffbeb] text-[#92400e] shadow-sm"
                                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                        >
                            <Filter className="h-3.5 w-3.5" />
                            Overrides only
                            {overridesOnly ? <Check className="h-3.5 w-3.5" /> : null}
                        </button>

                        <p className="text-[11px] text-slate-500">
                            <ShieldAlert className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-[#b45309]" />
                            The bar and the Override tag flag high-risk actions.
                        </p>
                    </div>

                    {hasFilters || overridesOnly ? (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                            Clear filters
                        </button>
                    ) : null}
                </div>

                {overridesOnly ? (
                    <p className="mt-2 text-[11px] font-medium text-[#92400e]">
                        Showing {overrideCount} of the {rows.length} rows loaded so far. This filter
                        runs on what's already on screen, so load more to look further back.
                    </p>
                ) : null}
            </div>

            {error && !lockedOut ? (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            ) : null}

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {lockedOut ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                        <ShieldAlert className="h-8 w-8 text-slate-300" />
                        <p className="text-sm font-bold text-[#0f172a]">
                            This session can&apos;t read the audit log
                        </p>
                        <p className="max-w-sm text-xs text-slate-500">
                            Your admin session either expired or this wallet isn&apos;t an admin.
                            Sign in again, then try once more.
                        </p>
                        <button
                            type="button"
                            onClick={() => load(null)}
                            className="mt-2 rounded-xl bg-[#2775ca] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#2064b0]"
                        >
                            Try again
                        </button>
                    </div>
                ) : loading && rows.length === 0 ? (
                    <div className="p-4">
                        <SkeletonRows count={8} avatar={false} lines={2} label="Loading audit log entries..." />
                    </div>
                ) : visibleRows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                        <FileText className="h-8 w-8 text-slate-300" />
                        <p className="text-xs font-semibold text-slate-500">
                            {overridesOnly
                                ? "No overrides in what's loaded so far. Load more to keep looking."
                                : hasFilters
                                  ? "No actions match those filters."
                                  : "Nothing's been logged yet."}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] border-collapse text-left">
                            <caption className="sr-only">
                                Admin actions, newest first. Rows marked Override are high-risk
                                actions.
                            </caption>
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                    <th scope="col" className="w-8 px-2 py-2.5">
                                        <span className="sr-only">Show detail</span>
                                    </th>
                                    <th
                                        scope="col"
                                        className="px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#64748b]"
                                    >
                                        When
                                    </th>
                                    <th
                                        scope="col"
                                        className="px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#64748b]"
                                    >
                                        Actor
                                    </th>
                                    <th
                                        scope="col"
                                        className="px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#64748b]"
                                    >
                                        Action
                                    </th>
                                    <th
                                        scope="col"
                                        className="px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#64748b]"
                                    >
                                        Target
                                    </th>
                                    <th
                                        scope="col"
                                        className="px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#64748b]"
                                    >
                                        IP
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRows.map((row) => {
                                    const isOverride = OVERRIDE_ACTIONS.has(row.action);
                                    const detail = formatDetail(row.detail);
                                    const isOpen = Boolean(expanded[row.id]);
                                    const isViewer = Boolean(viewer && row.actor.toLowerCase() === viewer);

                                    /* The rail is a shape, not a hue: 4px of border on the first cell
                                       against none for routine rows, so it survives greyscale and a
                                       colour-blind reader. The Override word and the shield carry the
                                       same signal for anyone who can't see either. */
                                    const railClass = isOverride
                                        ? "border-l-4 border-l-[#b45309]"
                                        : "border-l-4 border-l-transparent";

                                    return (
                                        <React.Fragment key={row.id}>
                                            <tr
                                                className={`border-b border-slate-100 align-top transition ${
                                                    isOverride
                                                        ? "bg-[#fffbeb] hover:bg-[#fef3c7]"
                                                        : "hover:bg-slate-50"
                                                }`}
                                            >
                                                <td className={`px-2 py-3 ${railClass}`}>
                                                    {detail ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleRow(row.id)}
                                                            aria-expanded={isOpen}
                                                            aria-label={
                                                                isOpen
                                                                    ? "Hide detail"
                                                                    : "Show detail"
                                                            }
                                                            title={isOpen ? "Hide detail" : "Show detail"}
                                                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                                                        >
                                                            {isOpen ? (
                                                                <ChevronDown className="h-3.5 w-3.5" />
                                                            ) : (
                                                                <ChevronRight className="h-3.5 w-3.5" />
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <span
                                                            className="block h-6 w-6"
                                                            aria-hidden="true"
                                                        />
                                                    )}
                                                </td>

                                                <td
                                                    className="whitespace-nowrap px-3 py-3 text-[11px] font-medium text-slate-600"
                                                    title={row.createdAt}
                                                >
                                                    {formatStamp(row.createdAt)}
                                                </td>

                                                <td className="px-3 py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                copy(`actor-${row.id}`, row.actor)
                                                            }
                                                            title={`${row.actor} (click to copy)`}
                                                            aria-label={`Actor ${row.actor}. Copy.`}
                                                            className="flex items-center gap-1 rounded font-mono text-[11px] font-semibold text-[#0f172a] transition hover:text-[#2775ca]"
                                                        >
                                                            {shortValue(row.actor)}
                                                            {copiedKey === `actor-${row.id}` ? (
                                                                <Check className="h-3 w-3 text-emerald-600" />
                                                            ) : (
                                                                <Copy className="h-3 w-3 text-slate-300" />
                                                            )}
                                                        </button>
                                                        {isViewer ? (
                                                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600">
                                                                You
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>

                                                <td className="px-3 py-3">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {isOverride ? (
                                                            <span className="sr-only">
                                                                High-risk override.
                                                            </span>
                                                        ) : null}
                                                        <span
                                                            className={`font-mono text-[11px] uppercase tracking-wide text-[#0f172a] ${
                                                                isOverride
                                                                    ? "font-black"
                                                                    : "font-semibold"
                                                            }`}
                                                        >
                                                            {row.action}
                                                        </span>
                                                        {isOverride ? (
                                                            <span
                                                                title="High-risk override action"
                                                                className="flex items-center gap-1 rounded border border-[#b45309] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#92400e]"
                                                            >
                                                                <ShieldAlert className="h-2.5 w-2.5" />
                                                                Override
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>

                                                <td className="px-3 py-3">
                                                    {row.target ? (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                copy(
                                                                    `target-${row.id}`,
                                                                    row.target as string,
                                                                )
                                                            }
                                                            title={`${row.target} (click to copy)`}
                                                            aria-label={`Target ${row.target}. Copy.`}
                                                            className="flex items-center gap-1 rounded font-mono text-[11px] font-medium text-slate-700 transition hover:text-[#2775ca]"
                                                        >
                                                            {shortValue(row.target)}
                                                            {copiedKey === `target-${row.id}` ? (
                                                                <Check className="h-3 w-3 text-emerald-600" />
                                                            ) : (
                                                                <Copy className="h-3 w-3 text-slate-300" />
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-400">
                                                            None
                                                        </span>
                                                    )}
                                                </td>

                                                <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-slate-500">
                                                    {row.ip || "Not recorded"}
                                                </td>
                                            </tr>

                                            {detail && isOpen ? (
                                                <tr
                                                    className={
                                                        isOverride
                                                            ? "border-b border-slate-100 bg-[#fffbeb]"
                                                            : "border-b border-slate-100 bg-slate-50"
                                                    }
                                                >
                                                    <td className={`px-2 ${railClass}`} />
                                                    <td colSpan={5} className="px-3 pb-4 pt-1">
                                                        <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
                                                            <pre className="max-h-64 flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[#0f172a]">
                                                                {detail}
                                                            </pre>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    copy(
                                                                        `detail-${row.id}`,
                                                                        detail,
                                                                    )
                                                                }
                                                                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 transition hover:bg-slate-50"
                                                            >
                                                                {copiedKey === `detail-${row.id}` ? (
                                                                    <>
                                                                        <Check className="h-3 w-3 text-emerald-600" />
                                                                        Copied
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Copy className="h-3 w-3" />
                                                                        Copy
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Paging */}
                {!lockedOut && rows.length > 0 ? (
                    <div className="flex items-center justify-center border-t border-slate-100 bg-white px-4 py-3">
                        {nextCursor ? (
                            <button
                                type="button"
                                onClick={() => load(nextCursor)}
                                disabled={loadingMore || loading}
                                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                            >
                                {loadingMore ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2775ca]" />
                                        Loading…
                                    </>
                                ) : (
                                    "Load more"
                                )}
                            </button>
                        ) : (
                            <p className="text-[11px] font-medium text-slate-400">
                                That&apos;s the end of the log.
                            </p>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
