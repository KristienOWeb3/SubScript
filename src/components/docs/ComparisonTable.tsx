"use client";

import { CheckCircle, XCircle } from "lucide-react";

interface ComparisonRow {
    feature: string;
    legacy: string | boolean;
    subscript: string | boolean;
}

interface ComparisonTableProps {
    rows: ComparisonRow[];
    legacyTitle?: string;
    subscriptTitle?: string;
}

export default function ComparisonTable({
    rows,
    legacyTitle = "Legacy Pull (Banks)",
    subscriptTitle = "SubScript Push (Arc)",
}: ComparisonTableProps) {
    const renderCell = (value: string | boolean, isSubScript: boolean) => {
        if (typeof value === "boolean") {
            return value ? (
                <CheckCircle className={`w-5 h-5 ${isSubScript ? "text-emerald-400" : "text-slate-500"}`} />
            ) : (
                <XCircle className={`w-5 h-5 ${isSubScript ? "text-slate-500" : "text-red-400"}`} />
            );
        }
        return <span className="text-sm">{value}</span>;
    };

    return (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-3 bg-slate-950">
                <div className="p-4 border-r border-slate-800">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Feature
                    </span>
                </div>
                <div className="p-4 border-r border-slate-800 bg-red-950/20">
                    <span className="text-xs font-semibold uppercase tracking-wider text-red-400">
                        {legacyTitle}
                    </span>
                </div>
                <div className="p-4 bg-emerald-950/20">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                        {subscriptTitle}
                    </span>
                </div>
            </div>

            {/* Rows */}
            {rows.map((row, index) => (
                <div
                    key={index}
                    className="grid grid-cols-3 border-t border-slate-800 hover:bg-slate-900/50 transition-colors"
                >
                    <div className="p-4 border-r border-slate-800 text-slate-300 font-medium">
                        {row.feature}
                    </div>
                    <div className="p-4 border-r border-slate-800 flex items-center text-slate-400">
                        {renderCell(row.legacy, false)}
                    </div>
                    <div className="p-4 flex items-center text-white">
                        {renderCell(row.subscript, true)}
                    </div>
                </div>
            ))}
        </div>
    );
}

// Pre-configured comparison data for Push vs Pull
export const pushVsPullComparison: ComparisonRow[] = [
    {
        feature: "Cancel Anytime",
        legacy: false,
        subscript: true,
    },
    {
        feature: "Double-Billing Protection",
        legacy: false,
        subscript: true,
    },
    {
        feature: "Instant Revocation",
        legacy: "3-5 business days",
        subscript: "Sub-second",
    },
    {
        feature: "Overdraft Fees",
        legacy: "$35 bank fee",
        subscript: "Transaction reverts",
    },
    {
        feature: "Payment Control",
        legacy: "Merchant pulls",
        subscript: "You push",
    },
    {
        feature: "Gas Token",
        legacy: "N/A",
        subscript: "USDC (stable)",
    },
];
