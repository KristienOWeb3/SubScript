"use client";

/* High-fidelity relative duration picker component for Payment Links with perfected motion blur animations */

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronDown } from "@/components/icons";

interface DurationPickerProps {
    value: number; /* Total minutes */
    onChange: (minutes: number) => void;
}

export default function DurationPicker({ value, onChange }: DurationPickerProps) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;

    const [hourDir, setHourDir] = useState<number>(1);
    const [minDir, setMinDir] = useState<number>(1);

    const prevHoursRef = useRef(hours);
    const prevMinsRef = useRef(minutes);

    const setHours = (h: number, dir = 1) => {
        const validatedH = Math.max(0, Math.min(720, h));
        setHourDir(dir);
        prevHoursRef.current = hours;
        onChange(validatedH * 60 + minutes);
    };

    const setMinutes = (m: number, dir = 1) => {
        const validatedM = Math.max(0, Math.min(59, m));
        setMinDir(dir);
        prevMinsRef.current = minutes;
        onChange(hours * 60 + validatedM);
    };

    const incrementHours = () => {
        if (hours < 720) {
            setHours(hours + 1, 1);
        } else {
            setHours(0, 1);
        }
    };

    const decrementHours = () => {
        if (hours > 0) {
            setHours(hours - 1, -1);
        } else {
            setHours(720, -1);
        }
    };

    const incrementMinutes = () => {
        if (minutes < 59) {
            setMinutes(minutes + 1, 1);
        } else {
            setMinutes(0, 1);
        }
    };

    const decrementMinutes = () => {
        if (minutes > 0) {
            setMinutes(minutes - 1, -1);
        } else {
            setMinutes(59, -1);
        }
    };

    const quickSelects = [
        { label: "12 Hours", mins: 12 * 60 },
        { label: "24 Hours", mins: 24 * 60 },
        { label: "7 Days", mins: 7 * 24 * 60 },
        { label: "30 Days", mins: 30 * 24 * 60 },
    ];

    const prevHours = hours === 0 ? 720 : hours - 1;
    const nextHours = hours === 720 ? 0 : hours + 1;
    const prevMinutes = minutes === 0 ? 59 : minutes - 1;
    const nextMinutes = minutes === 59 ? 0 : minutes + 1;

    /* Perfected vertical velocity motion blur variants */
    const motionBlurVariants = {
        enter: (dir: number) => ({
            y: dir > 0 ? 28 : -28,
            opacity: 0,
            filter: "blur(4px)",
            scale: 0.98,
        }),
        center: {
            y: 0,
            opacity: 1,
            filter: "blur(0px)",
            scale: 1,
        },
        exit: (dir: number) => ({
            y: dir > 0 ? -28 : 28,
            opacity: 0,
            filter: "blur(4px)",
            scale: 0.98,
        }),
    };

    const transitionConfig = {
        y: { type: "spring", stiffness: 480, damping: 32, mass: 0.7 },
        opacity: { duration: 0.14, ease: "easeOut" },
        filter: { duration: 0.16, ease: "easeOut" },
        scale: { duration: 0.14 },
    };

    return (
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] p-5 shadow-sm w-full select-none transition-colors">
            <div className="flex justify-center items-center gap-6 sm:gap-8 mb-5">
                {/* Hours Selector Column */}
                <div className="flex flex-col items-center w-24 sm:w-28">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#082824]/60 dark:text-white/60 mb-2">
                        Hours
                    </span>

                    <button
                        type="button"
                        onClick={incrementHours}
                        className="p-1.5 rounded-full text-[#082824]/50 dark:text-white/50 hover:text-[#082824] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition hover:scale-110 active:scale-90"
                        aria-label="Increase hours"
                    >
                        <ChevronUp className="w-5 h-5 stroke-[2.5]" />
                    </button>

                    {/* Tumbler with top/bottom fade gradient mask */}
                    <div className="relative flex flex-col items-center justify-center my-1 h-20 w-full overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]">
                        <button
                            type="button"
                            onClick={incrementHours}
                            className="text-xs text-[#082824]/30 dark:text-white/30 hover:text-[#082824]/60 dark:hover:text-white/60 font-mono transition-opacity cursor-pointer h-4 leading-none"
                            tabIndex={-1}
                        >
                            {String(prevHours).padStart(2, "0")}
                        </button>

                        <div className="h-10 flex items-center justify-center overflow-hidden">
                            <AnimatePresence mode="popLayout" custom={hourDir}>
                                <motion.div
                                    key={hours}
                                    custom={hourDir}
                                    variants={motionBlurVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    transition={transitionConfig}
                                    className="text-3xl sm:text-4xl font-black font-mono py-1 tracking-tight text-[#082824] dark:text-[#f4f4f5]"
                                >
                                    {String(hours).padStart(2, "0")}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        <button
                            type="button"
                            onClick={decrementHours}
                            className="text-xs text-[#082824]/30 dark:text-white/30 hover:text-[#082824]/60 dark:hover:text-white/60 font-mono transition-opacity cursor-pointer h-4 leading-none"
                            tabIndex={-1}
                        >
                            {String(nextHours).padStart(2, "0")}
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={decrementHours}
                        className="p-1.5 rounded-full text-[#082824]/50 dark:text-white/50 hover:text-[#082824] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition hover:scale-110 active:scale-90"
                        aria-label="Decrease hours"
                    >
                        <ChevronDown className="w-5 h-5 stroke-[2.5]" />
                    </button>
                </div>

                {/* Separator Colon */}
                <div className="text-3xl sm:text-4xl font-black text-[#082824]/30 dark:text-white/30 font-mono self-center mt-3">
                    :
                </div>

                {/* Minutes Selector Column */}
                <div className="flex flex-col items-center w-24 sm:w-28">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#082824]/60 dark:text-white/60 mb-2">
                        Minutes
                    </span>

                    <button
                        type="button"
                        onClick={incrementMinutes}
                        className="p-1.5 rounded-full text-[#082824]/50 dark:text-white/50 hover:text-[#082824] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition hover:scale-110 active:scale-90"
                        aria-label="Increase minutes"
                    >
                        <ChevronUp className="w-5 h-5 stroke-[2.5]" />
                    </button>

                    {/* Tumbler with top/bottom fade gradient mask */}
                    <div className="relative flex flex-col items-center justify-center my-1 h-20 w-full overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]">
                        <button
                            type="button"
                            onClick={incrementMinutes}
                            className="text-xs text-[#082824]/30 dark:text-white/30 hover:text-[#082824]/60 dark:hover:text-white/60 font-mono transition-opacity cursor-pointer h-4 leading-none"
                            tabIndex={-1}
                        >
                            {String(prevMinutes).padStart(2, "0")}
                        </button>

                        <div className="h-10 flex items-center justify-center overflow-hidden">
                            <AnimatePresence mode="popLayout" custom={minDir}>
                                <motion.div
                                    key={minutes}
                                    custom={minDir}
                                    variants={motionBlurVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    transition={transitionConfig}
                                    className="text-3xl sm:text-4xl font-black font-mono py-1 tracking-tight text-[#082824] dark:text-[#f4f4f5]"
                                >
                                    {String(minutes).padStart(2, "0")}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        <button
                            type="button"
                            onClick={decrementMinutes}
                            className="text-xs text-[#082824]/30 dark:text-white/30 hover:text-[#082824]/60 dark:hover:text-white/60 font-mono transition-opacity cursor-pointer h-4 leading-none"
                            tabIndex={-1}
                        >
                            {String(nextMinutes).padStart(2, "0")}
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={decrementMinutes}
                        className="p-1.5 rounded-full text-[#082824]/50 dark:text-white/50 hover:text-[#082824] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition hover:scale-110 active:scale-90"
                        aria-label="Decrease minutes"
                    >
                        <ChevronDown className="w-5 h-5 stroke-[2.5]" />
                    </button>
                </div>
            </div>

            {/* Bottom Quick-Select Section */}
            <div className="border-t border-black/10 dark:border-white/10 pt-4 flex flex-wrap gap-2 justify-center">
                {quickSelects.map((chip) => {
                    const isSelected = value === chip.mins;
                    return (
                        <button
                            key={chip.label}
                            type="button"
                            onClick={() => {
                                const newH = Math.floor(chip.mins / 60);
                                const newM = chip.mins % 60;
                                setHourDir(newH >= hours ? 1 : -1);
                                setMinDir(newM >= minutes ? 1 : -1);
                                onChange(chip.mins);
                            }}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-150 border shadow-sm ${
                                isSelected
                                    ? "bg-[#082824] dark:bg-white text-white dark:text-black border-[#082824] dark:border-white"
                                    : "bg-white/80 dark:bg-white/5 text-[#082824]/75 dark:text-white/75 border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#082824] dark:hover:text-white"
                            }`}
                        >
                            {chip.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
