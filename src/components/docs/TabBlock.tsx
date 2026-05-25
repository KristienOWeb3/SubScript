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
        <div className="rounded-3xl border border-white/5 bg-white/[0.01] liquid-glass overflow-hidden shadow-2xl">
            {/* Tab Headers */}
            <div className="flex border-b border-white/5 bg-white/[0.02]">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative px-6 py-4 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === tab.id
                                ? "text-white"
                                : "text-white/50 hover:text-white"
                            }`}
                    >
                        {tab.label}
                        {activeTab === tab.id && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00d2b4]"
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
            <div className="absolute top-4 right-4 z-10">
                <button
                    onClick={handleCopy}
                    className="px-4 py-1.5 text-xs font-bold rounded-full bg-white text-black hover:bg-white/90 transition-colors"
                >
                    {copied ? "Copied!" : "Copy"}
                </button>
            </div>
            <pre className="bg-black/50 border border-white/5 rounded-2xl p-6 overflow-x-auto text-xs leading-relaxed font-mono">
                <code className={`language-${language} text-white/70`}>
                    {code}
                </code>
            </pre>
        </div>
    );
}
