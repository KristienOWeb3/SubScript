"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface Tab {
    id: string;
    label: string;
    content: React.ReactNode;
}

interface TabBlockProps {
    tabs: Tab[];
    defaultTab?: string;
}

export default function TabBlock({ tabs, defaultTab }: TabBlockProps) {
    const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);

    const activeContent = tabs.find((tab) => tab.id === activeTab)?.content;

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            {/* Tab Headers */}
            <div className="flex border-b border-slate-800 bg-slate-950/50">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative px-6 py-3 text-sm font-medium transition-colors ${activeTab === tab.id
                                ? "text-white"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                    >
                        {tab.label}
                        {activeTab === tab.id && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="p-6"
            >
                {activeContent}
            </motion.div>
        </div>
    );
}

// Pre-built code block component for code tabs
interface CodeBlockProps {
    code: string;
    language?: string;
}

export function CodeBlock({ code, language = "typescript" }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative group">
            <div className="absolute top-3 right-3 z-10">
                <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                >
                    {copied ? "Copied!" : "Copy"}
                </button>
            </div>
            <pre className="bg-slate-950 rounded-lg p-4 overflow-x-auto text-sm">
                <code className={`language-${language} text-slate-300`}>
                    {code}
                </code>
            </pre>
        </div>
    );
}
