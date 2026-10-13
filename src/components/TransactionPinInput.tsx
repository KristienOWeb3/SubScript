"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Delete } from "lucide-react";
import { haptics } from "@/lib/client/haptics";

type Feedback = "idle" | "error" | "success";

export default function TransactionPinInput({ value, onChange, label, id, disabled = false, feedback = "idle", attempt = 0, filled = value.length, describedBy, keypadOpen = false, autoComplete = "off", mobileLayout }: {
    value: string; onChange: (value: string) => void; label: string; id?: string;
    disabled?: boolean; feedback?: Feedback; attempt?: number; filled?: number;
    describedBy?: string; keypadOpen?: boolean; autoComplete?: "off" | "one-time-code"; mobileLayout?: boolean;
}) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const reduceMotion = useReducedMotion();
    const [matchesMobile, setMatchesMobile] = useState(false);
    const mobile = mobileLayout ?? matchesMobile;
    const [focused, setFocused] = useState(keypadOpen);
    const [activeIndex, setActiveIndex] = useState(Math.min(value.length, 5));
    const [editingSlot, setEditingSlot] = useState(false);
    const inputs = useRef<(HTMLInputElement | null)[]>([]);

    const [stagger, setStagger] = useState<{ feedback: Feedback; attempt: number; count: number }>({ feedback: "idle", attempt: 0, count: 0 });
    const staggerIndex = reduceMotion ? 6 : stagger.feedback === feedback && stagger.attempt === attempt ? stagger.count : 0;

    useEffect(() => {
        if (feedback === "idle" || reduceMotion) return;
        let current = 0;
        const interval = setInterval(() => {
            current += 1;
            setStagger({ feedback, attempt, count: current });
            if (current >= 6) {
                clearInterval(interval);
            }
        }, 45);
        return () => clearInterval(interval);
    }, [feedback, attempt, reduceMotion]);

    useEffect(() => {
        if (feedback === "error") {
            haptics.error();
        } else if (feedback === "success") {
            haptics.success();
        }
    }, [feedback, attempt]);

    useEffect(() => {
        if (mobileLayout !== undefined) return;
        const query = window.matchMedia("(max-width: 639px)");
        const update = () => setMatchesMobile(query.matches);
        update(); query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, [mobileLayout]);
    function focusSlot(index: number) {
        inputs.current[index]?.focus({ preventScroll: true });
        inputs.current[index]?.select();
    }
    function updateValue(next: string, nextIndex: number) {
        if (disabled) return;
        focusSlot(nextIndex);
        if (next === value) return;
        const isDelete = next.length < value.length;
        onChange(next);
        if (!reduceMotion) {
            if (isDelete) {
                haptics.lightSnap();
            } else if (next.length === 6) {
                haptics.mediumImpact();
            } else {
                haptics.microTick();
            }
        }
    }
    function enterDigits(digits: string, index: number) {
        const clean = digits.replace(/\D/g, "").slice(0, 6 - index);
        if (!clean) return;
        const start = Math.min(index, value.length);
        const next = (value.slice(0, start) + clean + value.slice(start + clean.length)).slice(0, 6);
        updateValue(next, Math.min(start + clean.length, 5));
    }
    function deleteDigit(index: number) {
        const target = value[index] ? index : Math.min(index - 1, value.length - 1);
        if (target < 0) return;
        updateValue(value.slice(0, target) + value.slice(target + 1), target);
    }
    function pressKey(key: string) {
        if (key === "delete") updateValue(value.slice(0, -1), Math.max(value.length - 1, 0));
        else enterDigits(key, editingSlot ? activeIndex : Math.min(value.length, 5));
        setEditingSlot(false);
    }
    return <div className="ph-no-capture ph-mask" data-ph-no-capture data-private="true" data-pin-feedback={feedback}>
        <label htmlFor={inputId} className="block text-sm font-semibold tracking-tight text-[#082824] dark:text-white">{label}</label>
        <motion.div key={attempt} initial={{ x: 0 }}
            animate={{ x: feedback === "error" && !reduceMotion ? [0, -7, 6, -4, 3, 0] : 0 }}
            transition={{ duration: 0.38, ease: "easeOut" }}
            role="group" aria-label={`${label} digits`}
            className="mt-3 grid grid-cols-6 gap-1.5 sm:gap-2"
            onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setFocused(false); }}>
                {Array.from({ length: 6 }, (_, index) => {
                    const isSlotActive = (feedback === "error" || feedback === "success") && index < staggerIndex;
                    const slotFeedback: Feedback = isSlotActive ? feedback : "idle";
                    return <div key={index}
                        className="relative flex min-w-0 items-center justify-center text-[#082824] dark:text-white">
                        <input ref={node => { inputs.current[index] = node; }} id={index === 0 ? inputId : `${inputId}-${index}`}
                            type="password" inputMode={mobile ? "none" : "numeric"} readOnly={mobile}
                            aria-label={index === 0 ? label : `${label}, digit ${index + 1} of 6`}
                            autoComplete={index === 0 ? autoComplete : "off"} maxLength={1} pattern="[0-9]" required
                            data-pin-slot data-pin-field data-pin-slot-feedback={slotFeedback} data-private="true" data-ph-no-capture="true"
                            aria-describedby={describedBy} aria-invalid={feedback === "error"} disabled={disabled}
                            value={value[index] ?? ""} autoFocus={index === 0 && attempt > 0 && !mobile}
                            onPointerDown={() => setEditingSlot(true)}
                            onFocus={event => { setFocused(true); setActiveIndex(index); event.currentTarget.select(); }}
                            onChange={event => { if (event.target.value) enterDigits(event.target.value, index); else deleteDigit(index); }}
                            onPaste={event => { event.preventDefault(); enterDigits(event.clipboardData.getData("text"), index); }}
                            onKeyDown={event => {
                                if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); deleteDigit(index); }
                                else if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); focusSlot(Math.max(0, Math.min(5, index + (event.key === "ArrowLeft" ? -1 : 1)))); }
                                else if (mobile && /^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey) { event.preventDefault(); enterDigits(event.key, index); }
                            }}
                            style={
                                slotFeedback === "error"
                                    ? {
                                          borderColor: "var(--color-red-500, #ef4444)",
                                          borderWidth: "2px",
                                          boxShadow: "none",
                                      }
                                    : slotFeedback === "success"
                                    ? {
                                          borderColor: "var(--color-emerald-500, #10b981)",
                                          borderWidth: "2px",
                                          boxShadow: "none",
                                      }
                                    : undefined
                            }
                            className={`h-14 w-full min-w-0 touch-manipulation rounded-xl border bg-white/65 text-center text-transparent caret-transparent selection:bg-transparent selection:text-transparent transition-colors duration-75 focus:outline-none sm:h-16 motion-reduce:transition-none dark:bg-white/5 ${slotFeedback === "error" ? "border-red-500 border-2" : slotFeedback === "success" ? "border-emerald-500 border-2" : "border-[#082824]/20 focus:border-[#2775CA] dark:border-white/25"}`} />
                        <motion.span initial={false} animate={{ opacity: index < filled ? 1 : 0, scale: index < filled ? 1 : 0.65 }}
                            aria-hidden="true" transition={{ duration: reduceMotion ? 0 : 0.16 }} className="pointer-events-none absolute h-2.5 w-2.5 rounded-full bg-current shadow-none" />
                    </div>;
                })}
        </motion.div>
        {mobile && (focused || keypadOpen) && <div role="group" aria-label="PIN keypad" className="mx-auto mt-5 grid max-w-xs grid-cols-3 justify-items-center gap-x-3 gap-y-2.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"].map(key => key === "" ? <span key="spacer" /> :
                <motion.button key={key} type="button" aria-label={key === "delete" ? "Delete last digit" : key}
                    disabled={disabled || (key === "delete" ? value.length === 0 : value.length === 6 && !editingSlot)}
                    whileTap={reduceMotion ? undefined : { scale: 0.93 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => pressKey(key)}
                    className={`flex h-16 w-16 touch-manipulation items-center justify-center rounded-full text-2xl font-medium focus-visible:outline-2 focus-visible:outline-[#2775CA] disabled:opacity-40 [@media(min-height:900px)]:h-20 [@media(min-height:900px)]:w-20 ${key === "delete" ? "bg-transparent enabled:active:bg-[#D3E3E8]/50 dark:enabled:active:bg-white/10" : "bg-[#D3E3E8] text-[#082824] enabled:active:bg-[#bfd5dd] enabled:active:shadow-inner dark:bg-white/10 dark:text-white dark:enabled:active:bg-white/20"}`}>
                    {key === "delete" ? <Delete aria-hidden="true" className="h-7 w-7" /> : key}
                </motion.button>)}
        </div>}
    </div>;
}
