"use client";

import { useEffect, useRef, useState } from "react";
import { readPinResponse, readTransactionPinStatus, type TransactionPinStatus } from "@/lib/client/transactionPin";
import { getDashboardUrl } from "@/utils/navigation";
import { validTransactionPin } from "@/lib/auth/transactionPinFormat";
import TransactionPinInput from "@/components/TransactionPinInput";
import TransactionPinSettingsSkeleton from "@/components/TransactionPinSettingsSkeleton";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ChevronLeft, KeyRound, ShieldCheck, Wallet } from "lucide-react";

export default function TransactionPinSettings({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void } = {}) {
    const [status, setStatus] = useState<TransactionPinStatus | null>(null);
    const [loadError, setLoadError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const [resendAt, setResendAt] = useState(0);
    const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
    const [email, setEmail] = useState("");
    const [dashboardPath, setDashboardPath] = useState("/dashboard-router");
    const [action, setAction] = useState<"enroll" | "change" | "reset">("enroll");
    const [challengeId, setChallengeId] = useState("");
    const [code, setCode] = useState("");
    const [pin, setPin] = useState("");
    const [confirm, setConfirm] = useState("");
    const [currentPin, setCurrentPin] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<"idle" | "error" | "success">("idle");
    const [attempt, setAttempt] = useState(0);
    const [mobile, setMobile] = useState(false);
    const [step, setStep] = useState(0);
    const [emailVerified, setEmailVerified] = useState(false);
    const proof = useRef<{ token: string; action: string; expiresAt: number } | null>(null);
    const busyRef = useRef(false);
    const reduceMotion = useReducedMotion();
    const steps = action === "change" ? ["code", "current", "new", "confirm"] : ["code", "new", "confirm"];
    const currentStep = steps[step];
    const required = status?.required !== false;
    const enteringPin = required && mobile && Boolean(challengeId);
    const controller = useRef(new AbortController());
    useEffect(() => {
        const query = window.matchMedia("(max-width: 639px)");
        const update = () => setMobile(query.matches);
        update(); query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        const current = new AbortController();
        controller.current = current;
        const signal = current.signal;
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
        Promise.all([fetch("/api/user/transaction-pin", { signal: requestSignal, cache: "no-store" }), fetch("/api/auth/session", { signal: requestSignal, cache: "no-store" })])
            .then(async ([pinResponse, sessionResponse]) => {
                const pinStatus = await readTransactionPinStatus(pinResponse); const session = await sessionResponse.json();
                if (!sessionResponse.ok || session?.loggedIn !== true || !["USER", "ENTERPRISE"].includes(session.role)) throw new Error("Sign in to manage your transaction PIN.");
                if (signal.aborted) return;
                setStatus(pinStatus); setNow(Date.now()); setEmail(typeof session.email === "string" ? session.email : "");
                setDashboardPath(getDashboardUrl(session.role, "/dashboard")); setAction(value => pinStatus.configured ? value === "enroll" ? "change" : value : "enroll");
            }).catch(() => { if (!signal.aborted) setLoadError("Unable to load PIN settings. Check your connection and sign-in, then retry."); });
        return () => { current.abort(); proof.current = null; };
    }, [refresh]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, []);
    function reload() {
        proof.current = null; setEmailVerified(false);
        setStatus(null); setEmail(""); setLoadError(""); setRefresh(value => value + 1);
    }
    async function post(path: string, body: unknown, stepUpToken?: string) {
        const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(stepUpToken ? { "x-step-up-token": stepUpToken } : {}) }, body: JSON.stringify(body), signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(20_000)]) });
        const result = await readPinResponse(response);
        if (path === "/api/auth/otp/send") {
            const retryAfter = Number(response.headers.get("Retry-After") || result.retryAfterSeconds);
            if (Number.isFinite(retryAfter) && retryAfter > 0) {
                setNow(Date.now()); setResendAt(Date.now() + retryAfter * 1000);
            }
        }
        if (!response.ok) throw new Error(result.error || "Verification failed. Please retry.");
        return result;
    }
    async function sendCode() {
        if (busyRef.current || Date.now() < resendAt) return;
        busyRef.current = true;
        setBusy(true); setFeedback("idle"); setMessage("");
        try {
            const result = await post("/api/auth/otp/send", { email, purpose: "financial_step_up", stepUp: { action: `transaction-pin:${action}` } });
            if (typeof result.challengeId !== "string" || !result.challengeId) throw new Error("Unable to send code. Please retry.");
            if (controller.current.signal.aborted) return;
            proof.current = null; setEmailVerified(false);
            setStep(0); setCode(""); setPin(""); setConfirm(""); setCurrentPin("");
            setChallengeId(result.challengeId); setMessage("Verification code sent. Check your inbox.");
        } catch (error) { if (!controller.current.signal.aborted) setMessage(error instanceof Error ? error.message : "Unable to send code."); }
        finally { busyRef.current = false; setBusy(false); }
    }
    async function verifyEmailCode() {
        if (busyRef.current || code.length !== 6) return false;
        busyRef.current = true; setBusy(true); setMessage(""); setFeedback("idle");
        const startedAt = Date.now();
        try {
            const verified = await post("/api/auth/otp/verify", { email, code, challengeId, purpose: "financial_step_up", stepUp: { action: `transaction-pin:${action}` } });
            if (typeof verified.stepUpToken !== "string" || !verified.stepUpToken) throw new Error("Email verification did not complete. Send a fresh code and retry.");
            if (controller.current.signal.aborted) return false;
            const seconds = typeof verified.expiresInSeconds === "number" && verified.expiresInSeconds > 0 ? Math.min(verified.expiresInSeconds, 300) : 300;
            proof.current = { token: verified.stepUpToken, action, expiresAt: startedAt + seconds * 1000 };
            setFeedback("success"); setMessage("Email verified.");
            await new Promise(resolve => setTimeout(resolve, reduceMotion ? 120 : 380));
            if (controller.current.signal.aborted) return false;
            setEmailVerified(true); setCode(""); setFeedback("idle"); setMessage("Email verified.");
            return true;
        } catch (error) {
            if (!controller.current.signal.aborted) {
                proof.current = null; setEmailVerified(false); setCode(""); setFeedback("error"); setAttempt(value => value + 1);
                setMessage(error instanceof Error ? error.message : "Unable to verify email code. Please retry.");
            }
            return false;
        } finally { busyRef.current = false; setBusy(false); }
    }
    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (busyRef.current) return;
        if (mobile && step < steps.length - 1) { void nextStep(); return; }
        if (!emailVerified) { await verifyEmailCode(); return; }
        const authorization = proof.current;
        if (!authorization || authorization.action !== action || authorization.expiresAt <= Date.now()) {
            proof.current = null; setEmailVerified(false); setChallengeId(""); setStep(0); setCode(""); setPin(""); setConfirm(""); setCurrentPin("");
            setMessage("Email verification expired. Send a fresh code before continuing."); return;
        }
        if (pin !== confirm) { setFeedback("error"); setAttempt(value => value + 1); setMessage("The new PINs do not match."); return; }
        if (!validTransactionPin(pin)) { setFeedback("error"); setAttempt(value => value + 1); setMessage("Choose a six-digit PIN without a repeated or sequential pattern."); return; }
        const newPin = pin; const oldPin = currentPin;
        proof.current = null; busyRef.current = true;
        setPin(""); setConfirm(""); setCurrentPin(""); setCode(""); setBusy(true); setFeedback("idle"); setMessage("");
        try {
            const result = await post(`/api/user/transaction-pin/${action}`, { pin: newPin, ...(action === "change" ? { currentPin: oldPin } : {}) }, authorization.token);
            if (result.success !== true || result.configured !== true) throw new Error("PIN update could not be confirmed. Check its status before retrying.");
            if (controller.current.signal.aborted) return;
            setFeedback("success");
            await new Promise(resolve => setTimeout(resolve, 380));
            if (controller.current.signal.aborted) return;
            setStatus({ required: true, configured: true, coolingOffUntil: result.coolingOffUntil });
            setChallengeId(""); setEmailVerified(false); setAction("change");
            setMessage(action === "reset" ? "Transaction PIN reset. Outbound transactions are held for 24 hours during recovery." : "Transaction PIN saved.");
        } catch (error) {
            if (!controller.current.signal.aborted) {
                setFeedback("error"); setAttempt(value => value + 1);
                await new Promise(resolve => setTimeout(resolve, 380));
                if (controller.current.signal.aborted) return;
                setChallengeId("");
                setMessage(`${error instanceof Error ? error.message : "Unable to save PIN."} Send a fresh verification code before retrying.`);
                // A timed-out save may have committed; reload before choosing enroll/change.
                reload();
            }
        }
        finally { busyRef.current = false; setBusy(false); }
    }
    const stepValue = currentStep === "code" ? code : currentStep === "current" ? currentPin : currentStep === "new" ? pin : confirm;
    async function nextStep() {
        if (busyRef.current) return;
        if (currentStep === "code") {
            if (emailVerified && proof.current && proof.current.expiresAt > Date.now()) { setStep(value => value + 1); setMessage(""); return; }
            if (emailVerified) {
                proof.current = null; setEmailVerified(false); setChallengeId(""); setStep(0); setCode(""); setPin(""); setConfirm(""); setCurrentPin("");
                setMessage("Email verification expired. Send a fresh code before continuing."); return;
            }
            if (await verifyEmailCode() && !controller.current.signal.aborted) { setStep(value => value + 1); setMessage(""); }
            return;
        }
        if (stepValue.length !== 6) return;
        if (currentStep === "new" && !validTransactionPin(pin)) {
            setFeedback("error"); setAttempt(value => value + 1);
            setMessage("Choose a six-digit PIN without a repeated or sequential pattern."); return;
        }
        setStep(value => value + 1); setFeedback("idle"); setMessage("");
    }
    const Container = embedded ? "div" : "main";
    return <Container className={`transaction-pin-settings ph-no-capture ph-mask text-gray-900 dark:text-white ${embedded ? "space-y-6" : `min-h-screen bg-[#FFFFF0] px-4 dark:bg-[#060608] ${enteringPin ? "py-6" : "py-10"}`}`} data-ph-no-capture>
        {embedded && <div className="flex items-center gap-4">
            <button type="button" aria-label="Back to Security" onClick={onBack} className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all"><ChevronLeft aria-hidden="true" className="h-5 w-5" /></button>
            <h2 className="text-sm font-black uppercase tracking-wider text-black">Transaction PIN</h2>
        </div>}
        <section className={`rounded-[2rem] border border-[#082824]/10 bg-white/60 p-5 shadow-[0_12px_48px_rgba(8,40,36,0.045)] sm:p-8 dark:border-white/10 dark:bg-white/[0.03] ${embedded ? "" : "mx-auto max-w-lg"}`}>
            {!embedded && <><a href={dashboardPath} className="inline-flex items-center gap-2 text-xs font-semibold text-[#2775CA] transition-colors hover:text-[#1f63ab]"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />Back to dashboard</a>
            <div className="mt-6 flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#D3E3E8]/60 text-[#082824] dark:bg-white/10 dark:text-white"><KeyRound aria-hidden="true" className="h-5 w-5" /></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#082824]/50 dark:text-white/50">Wallet security</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#082824] dark:text-white">Transaction PIN</h1></div>
            </div></>}
            {!enteringPin && required && <p className="mt-4 text-sm leading-relaxed text-[#082824]/65 dark:text-white/65">Protect payments from your SubScript wallet with a private six-digit PIN. Verify your email whenever you set, change, or reset it.</p>}
            {status && !required && <div className="mt-6 rounded-2xl border border-[#082824]/10 bg-[#D3E3E8]/25 p-5 dark:border-white/10 dark:bg-white/5"><Wallet aria-hidden="true" className="h-5 w-5 text-[#2775CA]" /><h2 className="mt-3 text-base font-semibold">Your wallet handles approvals</h2><p className="mt-2 text-sm leading-relaxed text-[#082824]/65 dark:text-white/65">External wallets do not need a transaction PIN. Review and approve outgoing payments in your connected wallet.</p></div>}
            {!status && !loadError && !message && <TransactionPinSettingsSkeleton />}
            {loadError && <div className="mt-4 space-y-3"><p role="alert">{loadError}</p><button type="button" onClick={reload} className="rounded-xl border px-4 py-2">Retry loading PIN settings</button></div>}
            {status?.lockedUntil && Date.parse(status.lockedUntil) > now && <p className="mt-3 text-sm">PIN locked until {new Date(status.lockedUntil).toLocaleString()}.</p>}
            {status?.coolingOffUntil && Date.parse(status.coolingOffUntil) > now && <p className="mt-3 text-sm">Cooling-off period ends {new Date(status.coolingOffUntil).toLocaleString()}.</p>}
            {required && status?.configured && !enteringPin && <div className="my-5 flex gap-2 rounded-2xl bg-[#082824]/5 p-1 dark:bg-white/5">{(["change", "reset"] as const).map(value => <button key={value} disabled={busy} aria-pressed={action === value} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${action === value ? "bg-white text-[#082824] shadow-sm dark:bg-white/10 dark:text-white" : "text-[#082824]/55 dark:text-white/60"}`} onClick={() => { proof.current = null; setEmailVerified(false); setAction(value); setStep(0); setFeedback("idle"); setChallengeId(""); setCode(""); setPin(""); setConfirm(""); setCurrentPin(""); setMessage(""); }}>{value === "change" ? "Change PIN" : "Forgot PIN"}</button>)}</div>}
            {status && required && !email && <p role="alert" className="mt-4">Link and verify an email in dashboard settings before setting up a PIN.</p>}
            {status && required && email && <form onSubmit={save} className="mt-6 space-y-5">
                {(!enteringPin || currentStep === "code") && <div className="space-y-3 rounded-2xl border border-[#082824]/10 bg-white/50 p-4 dark:border-white/10 dark:bg-white/5"><p className="flex items-center gap-2 text-xs font-semibold text-[#082824]/65 dark:text-white/65"><ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-[#2775CA]" />Email verification</p><p className="text-sm leading-relaxed"><span className="block text-xs text-[#082824]/55 dark:text-white/55">Verification email</span><span className="block break-words [overflow-wrap:anywhere]">{email}</span></p>
                <button type="button" disabled={busy || resendSeconds > 0} onClick={sendCode} className="rounded-xl border border-[#2775CA]/25 bg-[#2775CA]/5 px-4 py-2.5 text-sm font-semibold text-[#2775CA] transition-colors hover:bg-[#2775CA]/10 disabled:opacity-50">{resendSeconds > 0 ? `Request another code in ${resendSeconds}s` : challengeId ? "Send a fresh code" : "Send verification code"}</button></div>}
                {challengeId && <>
                    {emailVerified && (!mobile || currentStep === "code") && <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Email verified.</p>}
                    {mobile && <div className="space-y-2.5"><p aria-live="polite" className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#082824]/50 dark:text-white/50">Step {step + 1} of {steps.length}</p><div aria-hidden="true" className="flex gap-1.5">{steps.map((value, index) => <span key={value} className={`h-1 flex-1 rounded-full transition-colors duration-200 ${index <= step ? "bg-[#2775CA]" : "bg-[#082824]/10 dark:bg-white/10"}`} />)}</div></div>}
                    <motion.div key={mobile ? currentStep : "desktop"} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
                        {(!mobile || currentStep === "code") && !emailVerified && <TransactionPinInput label="Email code" value={code} onChange={value => { setCode(value); proof.current = null; setEmailVerified(false); setFeedback("idle"); }} autoComplete="one-time-code" disabled={busy} feedback={feedback} attempt={attempt} keypadOpen={mobile} />}
                        {emailVerified && action === "change" && (!mobile || currentStep === "current") && <TransactionPinInput label="Current PIN" value={currentPin} onChange={value => { setCurrentPin(value); setFeedback("idle"); }} disabled={busy} feedback={feedback} attempt={attempt} filled={busy && feedback !== "error" ? 6 : currentPin.length} keypadOpen={mobile} />}
                        {emailVerified && (!mobile || currentStep === "new") && <><TransactionPinInput label="New PIN" value={pin} onChange={value => { setPin(value); setFeedback("idle"); }} disabled={busy} feedback={feedback} attempt={attempt} filled={busy && feedback !== "error" ? 6 : pin.length} describedBy="pin-format-hint" keypadOpen={mobile} />
                        <p id="pin-format-hint" className="text-xs leading-relaxed text-[#082824]/55 dark:text-white/55">Avoid repeated digits and consecutive sequences.</p></>}
                        {emailVerified && (!mobile || currentStep === "confirm") && <TransactionPinInput label="Confirm new PIN" value={confirm} onChange={value => { setConfirm(value); setFeedback("idle"); }} disabled={busy} feedback={feedback} attempt={attempt} filled={busy && feedback !== "error" ? 6 : confirm.length} keypadOpen={mobile} />}
                    </motion.div>
                    {action === "reset" && <p className="text-sm">Resetting a forgotten PIN starts a 24-hour cooling-off period. Outbound transactions are held during recovery.</p>}
                    <div className={mobile ? "flex items-center gap-3" : ""}>
                    {mobile && step > 0 && <button type="button" aria-label="Back" disabled={busy} onClick={() => { setStep(value => value - 1); setFeedback("idle"); setMessage(""); }} className="p-2 rounded-full hover:bg-black/5 text-black/60 hover:text-black transition-all disabled:opacity-50"><ChevronLeft aria-hidden="true" className="h-5 w-5" /></button>}
                    {mobile && step < steps.length - 1 ? <button type="button" disabled={busy || (currentStep === "code" && emailVerified ? false : stepValue.length !== 6)} onClick={() => void nextStep()} className="w-full rounded-xl bg-[#2775CA] p-3 font-bold text-white disabled:opacity-50">{busy && currentStep === "code" ? "Verifying code…" : "Continue"}</button> : !emailVerified ? <button type="button" disabled={busy || code.length !== 6} onClick={() => void verifyEmailCode()} className="w-full rounded-xl bg-[#2775CA] p-3 font-bold text-white disabled:opacity-50">{busy ? "Verifying code…" : "Verify email code"}</button> :
                    <button disabled={busy || pin.length !== 6 || confirm.length !== 6 || (action === "change" && currentPin.length !== 6)} className="w-full rounded-xl bg-[#2775CA] p-3 font-bold text-white disabled:opacity-50">{busy ? "Verifying…" : "Save PIN"}</button>}
                    </div>
                </>}
            </form>}
            {message && <p role="status" className="mt-4 text-sm">{message}</p>}
        </section>
    </Container>;
}
