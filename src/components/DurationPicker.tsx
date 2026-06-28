/* High-fidelity relative duration picker component for Payment Links */

import { useState, useEffect } from "react";
import { ChevronUp, ChevronDown } from "@/components/icons";

interface DurationPickerProps {
    value: number; /* Total minutes */
    onChange: (minutes: number) => void;
}

export default function DurationPicker({ value, onChange }: DurationPickerProps) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;

    const setHours = (h: number) => {
        const validatedH = Math.max(0, Math.min(720, h));
        onChange(validatedH * 60 + minutes);
    };

    const setMinutes = (m: number) => {
        const validatedM = Math.max(0, Math.min(59, m));
        onChange(hours * 60 + validatedM);
    };

    const incrementHours = () => {
        if (hours < 720) {
            setHours(hours + 1);
        } else {
            setHours(0);
        }
    };

    const decrementHours = () => {
        if (hours > 0) {
            setHours(hours - 1);
        } else {
            setHours(720);
        }
    };

    const incrementMinutes = () => {
        if (minutes < 59) {
            setMinutes(minutes + 1);
        } else {
            setMinutes(0);
        }
    };

    const decrementMinutes = () => {
        if (minutes > 0) {
            setMinutes(minutes - 1);
        } else {
            setMinutes(59);
        }
    };

    const quickSelects = [
        { label: "12 Hours", mins: 12 * 60 },
        { label: "24 Hours", mins: 24 * 60 },
        { label: "7 Days", mins: 7 * 24 * 60 },
        { label: "30 Days", mins: 30 * 24 * 60 }
    ];

    const prevHours = hours === 0 ? 720 : hours - 1;
    const nextHours = hours === 720 ? 0 : hours + 1;
    const prevMinutes = minutes === 0 ? 59 : minutes - 1;
    const nextMinutes = minutes === 59 ? 0 : minutes + 1;

    return (
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5 backdrop-blur-md shadow-xl w-full">
            <div className="flex justify-around items-center gap-6 mb-6">
                {/* Hours Selector Column */}
                <div className="flex flex-col items-center w-24">
                    <span className="text-[10px] uppercase tracking-wider text-white/40 mb-3 font-semibold">Hours</span>
                    
                    <button
                        type="button"
                        onClick={decrementHours}
                        className="p-1 text-white/40 hover:text-white transition-colors"
                        aria-label="Decrease hours"
                    >
                        <ChevronUp className="w-5 h-5" />
                    </button>
                    
                    <div className="flex flex-col items-center select-none my-1">
                        <button
                            type="button"
                            onClick={decrementHours}
                            className="text-xs text-white/20 hover:text-white/40 font-mono transition-opacity cursor-pointer h-5 leading-none"
                        >
                            {String(prevHours).padStart(2, "0")}
                        </button>
                        
                        <div className="text-3xl font-bold text-white font-mono py-1.5 scale-110 tracking-tight transition-transform">
                            {String(hours).padStart(2, "0")}
                        </div>
                        
                        <button
                            type="button"
                            onClick={incrementHours}
                            className="text-xs text-white/20 hover:text-white/40 font-mono transition-opacity cursor-pointer h-5 leading-none"
                        >
                            {String(nextHours).padStart(2, "0")}
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={incrementHours}
                        className="p-1 text-white/40 hover:text-white transition-colors"
                        aria-label="Increase hours"
                    >
                        <ChevronDown className="w-5 h-5" />
                    </button>
                </div>

                {/* Separator Colon */}
                <div className="text-3xl font-bold text-white/20 font-mono self-center mt-4">:</div>

                {/* Minutes Selector Column */}
                <div className="flex flex-col items-center w-24">
                    <span className="text-[10px] uppercase tracking-wider text-white/40 mb-3 font-semibold">Minutes</span>
                    
                    <button
                        type="button"
                        onClick={decrementMinutes}
                        className="p-1 text-white/40 hover:text-white transition-colors"
                        aria-label="Decrease minutes"
                    >
                        <ChevronUp className="w-5 h-5" />
                    </button>
                    
                    <div className="flex flex-col items-center select-none my-1">
                        <button
                            type="button"
                            onClick={decrementMinutes}
                            className="text-xs text-white/20 hover:text-white/40 font-mono transition-opacity cursor-pointer h-5 leading-none"
                        >
                            {String(prevMinutes).padStart(2, "0")}
                        </button>
                        
                        <div className="text-3xl font-bold text-white font-mono py-1.5 scale-110 tracking-tight transition-transform">
                            {String(minutes).padStart(2, "0")}
                        </div>
                        
                        <button
                            type="button"
                            onClick={incrementMinutes}
                            className="text-xs text-white/20 hover:text-white/40 font-mono transition-opacity cursor-pointer h-5 leading-none"
                        >
                            {String(nextMinutes).padStart(2, "0")}
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={incrementMinutes}
                        className="p-1 text-white/40 hover:text-white transition-colors"
                        aria-label="Increase minutes"
                    >
                        <ChevronDown className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Bottom Quick-Select Section */}
            <div className="border-t border-white/5 pt-4 flex flex-wrap gap-2 justify-center">
                {quickSelects.map((chip) => {
                    const isSelected = value === chip.mins;
                    return (
                        <button
                            key={chip.label}
                            type="button"
                            onClick={() => onChange(chip.mins)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                                isSelected
                                    ? "border-[#00d2b4]/30 bg-[#00d2b4]/10 text-[#00d2b4] hover:bg-[#00d2b4]/15"
                                    : "border-white/5 bg-white/[0.02] hover:bg-white/[0.06] text-white/70 hover:text-white hover:border-white/10"
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
