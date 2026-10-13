"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useReducedMotion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import TransactionPinInput from "@/components/TransactionPinInput";
import type { TransactionPinChallenge, TransactionPinPrompt, TransactionPinReview } from "@/lib/client/transactionPin";
import { cancelPendingTransactionPinRequests, loadTransactionPinStatus, type TransactionPinStatus } from "@/lib/client/transactionPin";

let active = false;
let cancelActive: (() => void) | undefined;

function acquirePromptLock() {
    if (active) return false;
    active = true;
    return true;
}

export function cancelTransactionPinPrompt() {
    cancelPendingTransactionPinRequests();
    cancelActive?.();
}

function ReviewDetails({ value, listLabel = "Item" }: { value: unknown; listLabel?: string }) {
    if (Array.isArray(value)) return <ol className="space-y-3">{value.map((item, index) => <li key={index} className="rounded-xl border border-black/10 p-3 dark:border-white/15"><p className="mb-2 text-xs font-bold">{listLabel} {index + 1}</p><ReviewDetails value={item} /></li>)}</ol>;
    if (value && typeof value === "object") return <dl className="space-y-3">{Object.entries(value).map(([key, item]) => {
        if (item == null || (typeof item === "object" && Object.keys(item).length === 0)) return null;
        if (["request", "parameters", "args"].includes(key)) return <div key={key}><ReviewDetails value={item} /></div>;
        const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/usdc/ig, "USDC").replace(/^receiver Address$/i, "Recipient");
        return <div key={key} className={typeof item === "object" ? "" : "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-2"}><dt className="text-xs capitalize text-gray-600 dark:text-gray-300">{label}</dt><dd className={`break-all font-medium ${typeof item === "object" ? "mt-1" : ""}`}>{typeof item === "object" ? <ReviewDetails value={item} listLabel={key === "recipients" ? "Recipient" : "Item"} /> : String(item)}</dd></div>;
    })}</dl>;
    return <p className="break-all">{String(value ?? "")}</p>;
}

export function TransactionPinDialog({ challenge, review, signal, onDone, onCancel, inline = false, mobileLayout }: {
    challenge: TransactionPinChallenge; review: TransactionPinReview; signal?: AbortSignal | null;
    onDone: (token: string) => void; onCancel: () => void; inline?: boolean; mobileLayout?: boolean;
}) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<"idle" | "error" | "success">("idle");
    const [attempt, setAttempt] = useState(0);
    const [filled, setFilled] = useState(0);
    const reduceMotion = useReducedMotion();
    const successTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const busyRef = useRef(false);
    const controller = useRef(new AbortController());
    const cancelButton = useRef<HTMLButtonElement>(null);
    const cancel = () => { controller.current.abort(); clearTimeout(successTimer.current); clearTimeout(feedbackTimer.current); onCancel(); };
    const editPin = (value: string) => {
        clearTimeout(feedbackTimer.current);
        setPin(value); setFilled(value.length); setFeedback("idle"); setError("");
    };
    const setupUrl = typeof window !== "undefined" && (window.location.hostname === "subscriptonarc.com" || window.location.hostname.endsWith(".subscriptonarc.com"))
        ? "https://dashboard.subscriptonarc.com/dashboard/transaction-pin" : "/dashboard/transaction-pin";
    const goToSetup = (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        cancel();
        window.location.assign(setupUrl);
    };
    useEffect(() => {
        if (controller.current.signal.aborted) controller.current = new AbortController();
        const current = controller.current;
        const previous = document.activeElement as HTMLElement | null;
        cancelButton.current?.focus();
        return () => { current.abort(); clearTimeout(successTimer.current); clearTimeout(feedbackTimer.current); if (previous?.isConnected) previous.focus(); };
    }, []);
    async function authorize(event: React.FormEvent) {
        event.preventDefault();
        if (busyRef.current || pin.length !== 6 || controller.current.signal.aborted || signal?.aborted) return;
        busyRef.current = true;
        clearTimeout(feedbackTimer.current);
        const submittedPin = pin;
        setFilled(pin.length); setPin(""); setBusy(true); setError(""); setFeedback("idle");
        let authorized = false;
        try {
            const response = await fetch("/api/user/transaction-pin/authorize", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ challengeId: challenge.challengeId, pin: submittedPin }),
                signal: signal ? AbortSignal.any([signal, controller.current.signal]) : controller.current.signal,
            });
            const result = await response.json();
            if (!response.ok || typeof result.token !== "string" || !result.token) throw new Error(result.error || "PIN authorization failed. Try again.");
            if (controller.current.signal.aborted || signal?.aborted) return;
            authorized = true;
            setFeedback("success");
            successTimer.current = setTimeout(() => {
                if (!controller.current.signal.aborted && !signal?.aborted) onDone(result.token);
            }, reduceMotion ? 120 : 380);
        } catch (reason) {
            if (!controller.current.signal.aborted && !signal?.aborted) {
                setFeedback("error");
                setAttempt(value => value + 1);
                const message = reason instanceof Error ? reason.message : "Authorization failed";
                setError(message === "Transaction PIN authorization was refused." ? "" : message);
                feedbackTimer.current = setTimeout(() => {
                    if (!controller.current.signal.aborted) {
                        setFilled(0);
                    }
                }, 380);
            }
        } finally { if (!authorized) { busyRef.current = false; if (!controller.current.signal.aborted && !signal?.aborted) setBusy(false); } }
    }
    if (inline) {
        return <div className="ph-no-capture ph-mask w-full text-[#111827] dark:text-white" data-ph-no-capture data-send-pin="true" onKeyDown={event => {
            if (event.key === "Escape") { event.stopPropagation(); cancel(); }
            if (event.key === "Tab") {
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]'));
                const first = controls[0]; const last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }}>
            <section aria-labelledby="transaction-pin-title" className="w-full">
                {/* Header matching Send Modal flow */}
                <div className="relative flex items-center justify-center h-[40px] mb-3">
                    <button
                        ref={cancelButton}
                        type="button"
                        onClick={cancel}
                        aria-label="Back"
                        className="absolute left-0 flex h-[36px] w-[36px] items-center justify-center rounded-full border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition"
                    >
                        <span aria-hidden="true" className="text-lg leading-none -mt-0.5">‹</span>
                        <span className="sr-only">Back</span>
                    </button>
                    <h2 id="transaction-pin-title" className="text-sm font-bold tracking-wide text-[#111827] dark:text-white">
                        {challenge.configured ? "Transaction PIN" : "Set up your transaction PIN"}
                    </h2>
                </div>

                {challenge.configured ? (
                    <form onSubmit={authorize} noValidate className="space-y-3">
                        <TransactionPinInput
                            id="transaction-pin"
                            label="input transaction PIN"
                            value={pin}
                            onChange={editPin}
                            disabled={busy}
                            feedback={feedback}
                            attempt={attempt}
                            filled={filled}
                            describedBy={error ? "transaction-pin-error" : undefined}
                            keypadOpen
                            mobileLayout={mobileLayout}
                        />
                        {error && <p id="transaction-pin-error" role="alert" className="mt-2 text-center text-xs font-semibold text-red-500">{error}</p>}
                        {feedback === "success" && <p role="status" className="mt-2 text-center text-xs font-semibold text-emerald-500">PIN verified</p>}

                        <div className="pt-1">
                            <button
                                type="submit"
                                disabled={busy || pin.length !== 6}
                                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] active:scale-[0.98] py-3.5 font-bold text-sm text-white shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                                {busy ? "Verifying…" : "Authorize"}
                            </button>
                        </div>

                        <div className="text-center pt-0.5">
                            <a
                                href={setupUrl}
                                onClick={goToSetup}
                                className="text-xs font-semibold text-[#2775CA] hover:underline"
                            >
                                Forgot PIN? Reset →
                            </a>
                        </div>
                    </form>
                ) : (
                    <div className="space-y-4 py-2">
                        <p className="text-xs text-black/70 dark:text-white/70 leading-relaxed">
                            Before sending money or making a transaction, set up your six-digit transaction PIN with email verification. Then return and retry your transaction.
                        </p>
                        <div className="flex gap-2.5 pt-2">
                            <button
                                ref={cancelButton}
                                type="button"
                                onClick={cancel}
                                className="flex-1 rounded-2xl border border-black/15 dark:border-white/15 px-4 py-3 text-xs font-bold hover:bg-black/5 dark:hover:bg-white/5 transition"
                            >
                                Back
                            </button>
                            <a
                                href={setupUrl}
                                onClick={goToSetup}
                                className="flex-1 rounded-2xl bg-[#2775CA] px-4 py-3 text-center text-xs font-bold text-white shadow-md hover:bg-[#1f62ab] transition"
                            >
                                Set up PIN
                            </a>
                        </div>
                    </div>
                )}
            </section>
        </div>;
    }

    return <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/65 p-4" onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); cancel(); }
        if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]'));
            const first = controls[0]; const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    }}>
        <section role="dialog" aria-modal={true} aria-labelledby="transaction-pin-title" className="ph-no-capture ph-mask max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-[2rem] border border-[#082824]/10 bg-[#FFFFF0] p-5 text-[#082824] shadow-[0_24px_80px_rgba(8,40,36,0.18)] sm:p-7 dark:border-white/10 dark:bg-[#111116] dark:text-white" data-ph-no-capture>
            <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#082824]/50 dark:text-white/50"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#2775CA]" />Secure approval</p>
            <h2 id="transaction-pin-title" className="text-xl font-semibold tracking-tight">{challenge.configured ? "Authorize transaction" : "Set up your transaction PIN"}</h2>
            {challenge.configured && <><p className="mt-2 break-words font-medium">{review.operation}</p>
                <p className="mt-2 text-xs leading-relaxed text-[#082824]/60 dark:text-white/60">Review all recipients, amounts, and authorization parameters before continuing.</p>
                <div className="my-4 max-h-24 overflow-auto rounded-2xl border border-[#082824]/10 bg-white/50 p-4 text-sm sm:max-h-64 dark:border-white/10 dark:bg-white/5"><ReviewDetails value={review.details} /></div></>}
            {challenge.configured ? <form onSubmit={authorize} noValidate>
                <TransactionPinInput id="transaction-pin" label="Six-digit transaction PIN" value={pin} onChange={editPin} disabled={busy} feedback={feedback} attempt={attempt} filled={filled} describedBy={error ? "transaction-pin-error" : undefined} keypadOpen />
                {error && <p id="transaction-pin-error" role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
                {feedback === "success" && <p role="status" className="mt-2 text-sm text-emerald-600">PIN verified</p>}
                <div className="mt-4 flex gap-3"><button ref={cancelButton} type="button" onClick={cancel} className="rounded-xl border px-4 py-3">Cancel</button><button type="submit" disabled={busy || pin.length !== 6} className="flex-1 rounded-xl bg-[#2775CA] px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "Verifying…" : "Authorize"}</button></div>
                <a href={setupUrl} className="mt-4 inline-block text-sm text-[#2775CA]" onClick={goToSetup}>Forgot PIN? Reset</a>
            </form> : <><p className="mt-3 text-sm">Before sending money or making a transaction, set up your six-digit transaction PIN with email verification. Then return and retry your transaction.</p><div className="mt-4 flex gap-3"><button ref={cancelButton} onClick={cancel} className="rounded-xl border px-4 py-3">Cancel</button><a href={setupUrl} onClick={goToSetup} className="rounded-xl bg-[#2775CA] px-4 py-3 text-white">Set up PIN</a></div></>}
        </section>
    </div>;
}

/** Keeps a Send approval inside its existing surface while sharing the global approval lock. */
export function useInlineTransactionPinPrompt(onPresent?: () => Promise<void>, onDismiss?: (approved: boolean) => Promise<void>) {
    const [request, setRequest] = useState<{
        challenge: TransactionPinChallenge; review: TransactionPinReview; signal: AbortSignal;
        onDone: (token: string) => void; onCancel: () => void;
    } | null>(null);
    const callbacks = useRef({ onPresent, onDismiss });
    useLayoutEffect(() => { callbacks.current = { onPresent, onDismiss }; }, [onPresent, onDismiss]);
    const cancel = useRef<(() => void) | undefined>(undefined);
    const preparedStatus = useRef<{ startedAt: number; controller: AbortController; promise: Promise<TransactionPinStatus> } | null>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel.current?.(); }; }, []);
    const prepareSetup = useCallback(() => {
        if (preparedStatus.current && !preparedStatus.current.controller.signal.aborted && Date.now() - preparedStatus.current.startedAt < 30_000) return;
        preparedStatus.current?.controller.abort();
        const controller = new AbortController();
        const prepared = { startedAt: Date.now(), controller, promise: loadTransactionPinStatus(controller.signal) };
        preparedStatus.current = prepared;
        // Read enrollment while the sender reviews. The server still creates and validates each transaction challenge.
        void prepared.promise.catch(() => { if (preparedStatus.current === prepared) preparedStatus.current = null; });
    }, []);
    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => { if (!cancelled) prepareSetup(); });
        return () => { cancelled = true; preparedStatus.current?.controller.abort(); preparedStatus.current = null; };
    }, [prepareSetup]);

    const prompt: TransactionPinPrompt = (challenge, review, signal) => {
        signal?.throwIfAborted();
        if (!acquirePromptLock()) return Promise.reject(new Error("Finish the current PIN authorization before starting another transaction."));
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            let settled = false;
            let presented = Promise.resolve();
            const finish = async (token?: string) => {
                if (settled) return;
                settled = true;
                controller.abort();
                signal?.removeEventListener("abort", abort);
                window.removeEventListener("pagehide", abort);
                if (mounted.current) {
                    try {
                        await presented;
                        if (mounted.current && !signal?.aborted) await callbacks.current.onDismiss?.(Boolean(token));
                    } catch { token = undefined; }
                    if (mounted.current) setRequest(null);
                }
                active = false;
                if (cancelActive === abort) cancelActive = undefined;
                cancel.current = undefined;
                if (token && mounted.current && !signal?.aborted) resolve(token);
                else reject(new DOMException("Transaction authorization cancelled", "AbortError"));
            };
            const abort = () => { void finish(); };
            cancelActive = abort;
            cancel.current = abort;
            signal?.addEventListener("abort", abort, { once: true });
            window.addEventListener("pagehide", abort, { once: true });
            setRequest({ challenge, review, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, onDone: token => { void finish(token); }, onCancel: abort });
            presented = callbacks.current.onPresent?.() ?? Promise.resolve();
            void presented.catch(abort);
        });
    };
    prompt.getSetupStatus = async signal => {
        signal.throwIfAborted();
        const prepared = preparedStatus.current;
        if (!prepared || prepared.controller.signal.aborted || Date.now() - prepared.startedAt >= 30_000) return loadTransactionPinStatus(signal);
        const abort = () => prepared.controller.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        try {
            const status = await prepared.promise;
            signal.throwIfAborted();
            return status;
        } finally { signal.removeEventListener("abort", abort); }
    };
    return { request, prompt, prepareSetup, cancel: () => cancel.current?.() };
}

export const promptTransactionPin: TransactionPinPrompt = (challenge, review, signal) => {
    signal?.throwIfAborted();
    if (!acquirePromptLock()) return Promise.reject(new Error("Finish the current PIN authorization before starting another transaction."));
    return new Promise((resolve, reject) => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        let settled = false;
        const finish = (token?: string) => {
            if (settled) return;
            settled = true; active = false; cancelActive = undefined;
            signal?.removeEventListener("abort", abort);
            window.removeEventListener("pagehide", abort);
            root.unmount(); host.remove();
            if (token) resolve(token); else reject(new DOMException("Transaction authorization cancelled", "AbortError"));
        };
        const abort = () => finish();
        cancelActive = abort;
        signal?.addEventListener("abort", abort, { once: true });
        window.addEventListener("pagehide", abort, { once: true });
        root.render(<TransactionPinDialog challenge={challenge} review={review} signal={signal} onDone={finish} onCancel={abort} />);
    });
};
