"use client";

import { useState } from "react";

type Props = {
    planName: string;
    priceLabel: string;
    onSelectSubScript: () => void;
    onSelectCard?: () => void;
};

export function PaymentMethodSelector({
    planName,
    priceLabel,
    onSelectSubScript,
    onSelectCard,
}: Props) {
    const [selectedMethod, setSelectedMethod] = useState<"card" | "subscript">("subscript");
    const [isCardModalOpen, setIsCardModalOpen] = useState(false);

    const handleConfirm = () => {
        if (selectedMethod === "subscript") {
            onSelectSubScript();
        } else {
            if (onSelectCard) {
                onSelectCard();
            } else {
                setIsCardModalOpen(true);
            }
        }
    };

    return (
        <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/90 p-6 text-slate-100 shadow-2xl backdrop-blur-md">
            <div className="mb-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Checkout</span>
                <h3 className="text-lg font-bold text-white">Choose payment method</h3>
                <p className="text-xs text-slate-400 mt-1">
                    Select how you would like to pay for <span className="font-semibold text-slate-200">{planName}</span> ({priceLabel}).
                </p>
            </div>

            <div className="space-y-3 mb-6">
                {/* Option 1: Card */}
                <label
                    onClick={() => setSelectedMethod("card")}
                    className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                        selectedMethod === "card"
                            ? "border-emerald-500 bg-emerald-500/10 text-white shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                            : "border-slate-800 bg-slate-800/40 text-slate-300 hover:border-slate-700"
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedMethod === "card" ? "border-emerald-400 bg-emerald-400" : "border-slate-600"}`}>
                            {selectedMethod === "card" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                        </div>
                        <div>
                            <p className="text-xs font-bold">Credit / Debit Card</p>
                            <p className="text-[10px] text-slate-400">Visa, Mastercard, Amex</p>
                        </div>
                    </div>
                    <span className="text-xs font-semibold text-slate-400">Card</span>
                </label>

                {/* Option 2: SubScript (USDC) */}
                <label
                    onClick={() => setSelectedMethod("subscript")}
                    className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                        selectedMethod === "subscript"
                            ? "border-emerald-500 bg-emerald-500/10 text-white shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                            : "border-slate-800 bg-slate-800/40 text-slate-300 hover:border-slate-700"
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedMethod === "subscript" ? "border-emerald-400 bg-emerald-400" : "border-slate-600"}`}>
                            {selectedMethod === "subscript" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                <p className="text-xs font-bold text-emerald-400">SubScript</p>
                                <span className="bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-mono font-bold">USDC</span>
                            </div>
                            <p className="text-[10px] text-slate-400">Gas-free auto-renewals & PAYG vault</p>
                        </div>
                    </div>
                </label>
            </div>

            <button
                type="button"
                onClick={handleConfirm}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg shadow-emerald-500/20"
            >
                Continue with {selectedMethod === "subscript" ? "SubScript" : "Card"} →
            </button>

            {isCardModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-xs w-full text-center space-y-4">
                        <h4 className="text-sm font-bold text-white">Card Payment Demo</h4>
                        <p className="text-xs text-slate-400">
                            Traditional card payment simulated. To experience instant zero-friction USDC subscriptions and PAYG, choose SubScript!
                        </p>
                        <button
                            type="button"
                            onClick={() => setIsCardModalOpen(false)}
                            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
                        >
                            Back to Checkout
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
