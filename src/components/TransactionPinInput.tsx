"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Delete } from "lucide-react";

type Feedback = "idle" | "error" | "success";

export default function TransactionPinInput({ value, onChange, label, id, disabled = false, feedback = "idle", attempt = 0, filled = value.length, describedBy, keypadOpen = false, autoComplete = "off" }: {
    value: string; onChange: (value: string) => void; label: string; id?: string;
    disabled?: boolean; feedback?: Feedback; attempt?: number; filled?: number;
    describedBy?: string; keypadOpen?: boolean; autoComplete?: "off" | "one-time-code";
}) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const reduceMotion = useReducedMotion();
    const [mobile, setMobile] = useState(false);
    const [focused, setFocused] = useState(keypadOpen);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 639px)");
        const update = () => setMobile(query.matches);
        update(); query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    function pressKey(key: string) {
        const next = key === "delete" ? value.slice(0, -1) : (value + key).slice(0, 6);
        if (disabled || next === value) return;
        onChange(next);
        if (!reduceMotion && typeof navigator.vibrate === "function") {
            try { navigator.vibrate(10); } catch { /* Entry still works when device feedback is unavailable. */ }
        }
    }
    return <div className="ph-no-capture ph-mask" data-ph-no-capture data-private="true" data-pin-feedback={feedback}>
        <label htmlFor={inputId} className="block text-sm font-semibold tracking-tight text-[#082824] dark:text-white">{label}</label>
        <motion.div key={attempt} initial={{ x: 0 }}
            animate={{ x: feedback === "error" && !reduceMotion ? [0, -7, 6, -4, 3, 0] : 0 }}
            transition={{ duration: 0.38, ease: "easeOut" }}
            data-pin-field
            className={`relative mt-3 rounded-2xl border bg-white/65 shadow-[0_2px_8px_rgba(8,40,36,0.025)] transition-colors duration-200 focus-within:ring-2 focus-within:ring-[#2775CA]/20 motion-reduce:transition-none dark:bg-white/5 ${feedback === "error" ? "border-red-500" : feedback === "success" ? "border-emerald-500" : "border-[#082824]/20 focus-within:border-[#2775CA] dark:border-white/25"}`}>
            <div aria-hidden="true" className="grid grid-cols-6 px-4">
                {Array.from({ length: 6 }, (_, index) => <div key={index} data-pin-slot
                    className="flex h-16 min-w-0 items-center justify-center text-[#082824] dark:text-white">
                    <motion.span initial={false} animate={{ opacity: index < filled ? 1 : 0, scale: index < filled ? 1 : 0.65 }}
                        transition={{ duration: reduceMotion ? 0 : 0.16 }} className="h-2.5 w-2.5 rounded-full bg-current" />
                </div>)}
            </div>
            <input id={inputId} type="password" inputMode={mobile ? "none" : "numeric"}
                readOnly={mobile} autoComplete={autoComplete} maxLength={6} pattern="[0-9]{6}" required
                data-private="true" data-ph-no-capture="true" aria-describedby={describedBy}
                aria-invalid={feedback === "error"} disabled={disabled} value={value} autoFocus={attempt > 0 && !mobile}
                onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget)) setFocused(false); }}
                onChange={event => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="absolute inset-0 h-full w-full cursor-text opacity-0" />
        </motion.div>
        {mobile && (focused || keypadOpen) && <div role="group" aria-label="PIN keypad" className="mx-auto mt-5 grid max-w-xs grid-cols-3 justify-items-center gap-x-3 gap-y-2.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"].map(key => key === "" ? <span key="spacer" /> :
                <motion.button key={key} type="button" aria-label={key === "delete" ? "Delete last digit" : key}
                    disabled={disabled || (key === "delete" ? value.length === 0 : value.length === 6)}
                    whileTap={reduceMotion ? undefined : { scale: 0.93 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => pressKey(key)}
                    className={`flex h-16 w-16 touch-manipulation items-center justify-center rounded-full text-2xl font-medium focus-visible:outline-2 focus-visible:outline-[#2775CA] disabled:opacity-40 [@media(min-height:900px)]:h-20 [@media(min-height:900px)]:w-20 ${key === "delete" ? "bg-transparent enabled:active:bg-[#D3E3E8]/50 dark:enabled:active:bg-white/10" : "bg-[#D3E3E8] text-[#082824] enabled:active:bg-[#bfd5dd] enabled:active:shadow-inner dark:bg-white/10 dark:text-white dark:enabled:active:bg-white/20"}`}>
                    {key === "delete" ? <Delete aria-hidden="true" className="h-7 w-7" /> : key}
                </motion.button>)}
        </div>}
    </div>;
}
