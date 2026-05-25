"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Terminal as TerminalIcon, ArrowLeft, Server, Key, Power, Code2 } from "lucide-react";

import TabBlock, { CodeBlock } from "@/components/docs/TabBlock";
import ExpandableSection from "@/components/docs/ExpandableSection";
import { FeatureItem } from "@/components/docs/FeatureCard";
import Navbar from "@/components/Navbar";

// Code snippets
const sessionKeyConceptCode = `// The Session Key Pattern
// 1. User approves a SessionKey with strict limits
// 2. Merchant can charge within those limits
// 3. User can revoke the key INSTANTLY at any time

SessionKey {
    merchantAddress: "0x...",
    maxAmount: 14.99,      // USDC
    interval: 30 days,
    expiresAt: 2027-01-01
}`;

const sessionKeySolidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@subscript/core/SessionKeyManager.sol";

contract MySubscription is SessionKeyManager {
    
    function createSessionKey(
        address merchant,
        uint256 maxAmount,
        uint256 intervalDays
    ) external returns (bytes32 keyId) {
        keyId = _createSessionKey(
            msg.sender,        // subscriber
            merchant,
            maxAmount,
            intervalDays * 1 days
        );
        
        emit SessionKeyCreated(keyId, msg.sender, merchant);
    }
}`;

const sessionKeyNextJsCode = `import { useSubScript } from '@subscript/react';

export function SubscribeButton({ merchantId, amount }) {
    const { createSessionKey, isLoading } = useSubScript();
    
    const handleSubscribe = async () => {
        const sessionKey = await createSessionKey({
            merchant: merchantId,
            maxAmount: amount,
            intervalDays: 30,
        });
        
        console.log('Session Key:', sessionKey.id);
    };
    
    return (
        <button onClick={handleSubscribe} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Subscribe'}
        </button>
    );
}`;

const killSwitchConceptCode = `// The Kill Switch
// One function call. That's it.
// The merchant can NEVER charge you again.

revokeSessionKey(keyId)
// ✓ Instant (sub-second finality)
// ✓ Unilateral (merchant can't block)
// ✓ On-chain (immutable record)`;

const killSwitchSolidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

function revokeSessionKey(bytes32 keyId) external {
    SessionKey storage key = sessionKeys[keyId];
    
    require(
        msg.sender == key.subscriber,
        "SubScript: Only subscriber can revoke"
    );
    
    key.isActive = false;
    key.revokedAt = block.timestamp;
    
    emit SessionKeyRevoked(keyId, msg.sender);
}

// Merchant's charge attempt after revocation:
function charge(bytes32 keyId, uint256 amount) external {
    SessionKey storage key = sessionKeys[keyId];
    
    require(key.isActive, "SubScript: Key revoked"); // ← FAILS
    // ...
}`;

const killSwitchNextJsCode = `import { useSubScript } from '@subscript/react';

export function CancelButton({ sessionKeyId }) {
    const { revokeSessionKey, isRevoking } = useSubScript();
    
    const handleCancel = async () => {
        const tx = await revokeSessionKey(sessionKeyId);
        
        // Malachite BFT: ~0.4s finality
        console.log('Revoked! TX:', tx.hash);
    };
    
    return (
        <button 
            onClick={handleCancel} 
            disabled={isRevoking}
            className="bg-red-600 text-white px-4 py-2 rounded"
        >
            {isRevoking ? 'Cancelling...' : 'Cancel Subscription'}
        </button>
    );
}`;

export default function DeveloperPage() {
    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-black text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background Orbs */}
            <div className="absolute top-0 right-1/4 w-[600px] h-[400px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />

            {/* Content */}
            <div className="pt-36 pb-16 px-6 sm:px-12">
                <div className="max-w-4xl mx-auto">
                    {/* Back Link */}
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors mb-8 text-xs font-bold uppercase tracking-wider"
                    >
                        <ArrowLeft className="w-4 h-4 text-[#00d2b4]" />
                        Back to Overview
                    </Link>

                    {/* Header */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-14 flex flex-col items-center sm:items-start"
                    >
                        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
                            <div className="w-12 h-12 rounded-2xl bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center">
                                <Code2 className="w-5 h-5 text-[#00d2b4]" />
                            </div>
                            <div>
                                <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Developer Portal</span>
                                <h1 className="text-3xl sm:text-4xl font-extrabold uppercase mt-1 text-white tracking-tight">
                                    Developer <span className="font-serif italic text-[#00d2b4] lowercase font-normal">sdk</span>
                                </h1>
                            </div>
                        </div>
                    </motion.div>

                    {/* Network Configuration */}
                    <section className="mb-16">
                        <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white uppercase tracking-wider">
                            <Server className="w-5 h-5 text-[#00d2b4]" />
                            Network Configuration
                        </h2>

                        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl">
                            <div className="grid sm:grid-cols-2 gap-6">
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Network</span>
                                    <p className="text-white font-mono text-xs mt-1">Arc Testnet</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Chain ID</span>
                                    <p className="text-white font-mono text-xs mt-1">5042002</p>
                                </div>
                                <div className="sm:col-span-2">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">RPC Endpoint</span>
                                    <p className="text-[#00d2b4] font-mono text-xs break-all mt-1">
                                        https://rpc.testnet.arc.network
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Native Currency</span>
                                    <p className="text-white font-mono text-xs mt-1">USDC</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Block Explorer</span>
                                    <a
                                        href="https://explorer.arc.network"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#00d2b4] hover:text-white font-semibold flex items-center gap-1 text-xs mt-1 transition-colors"
                                    >
                                        explorer.arc.network ↗
                                    </a>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Session Key Integration */}
                    <section className="mb-16">
                        <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-white uppercase tracking-wider">
                            <Key className="w-5 h-5 text-[#d4a853]" />
                            Creating a Session Key
                        </h2>
                        <p className="text-xs sm:text-sm text-white/50 mb-6 leading-relaxed">
                            Session Keys allow users to authorize recurring payments with strict limits.
                            The user signs once; your app handles the rest.
                        </p>

                        <TabBlock
                            tabs={[
                                {
                                    id: "concept",
                                    label: "Concept",
                                    content: (
                                        <div>
                                            <p className="text-xs text-white/50 mb-4 leading-relaxed">
                                                Think of a Session Key as a <strong className="text-white">permission slip</strong> with
                                                built-in limits. The user says: "You can charge me up to $X every Y days."
                                            </p>
                                            <CodeBlock code={sessionKeyConceptCode} language="typescript" />
                                        </div>
                                    ),
                                },
                                {
                                    id: "solidity",
                                    label: "Solidity",
                                    content: <CodeBlock code={sessionKeySolidityCode} language="solidity" />,
                                },
                                {
                                    id: "nextjs",
                                    label: "Next.js",
                                    content: <CodeBlock code={sessionKeyNextJsCode} language="tsx" />,
                                },
                            ]}
                            defaultTab="concept"
                        />
                    </section>

                    {/* Kill Switch Integration */}
                    <section className="mb-16">
                        <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-white uppercase tracking-wider">
                            <Power className="w-5 h-5 text-red-400" />
                            The Kill Switch
                        </h2>
                        <p className="text-xs sm:text-sm text-white/50 mb-6 leading-relaxed">
                            One function call. Instant. Unilateral. The merchant cannot block or delay it.
                        </p>

                        <TabBlock
                            tabs={[
                                {
                                    id: "concept",
                                    label: "Concept",
                                    content: (
                                        <div>
                                            <p className="text-xs text-white/50 mb-4 leading-relaxed">
                                                <code className="text-red-400 font-mono">revokeSessionKey()</code> is the user's
                                                <strong className="text-white"> nuclear option</strong>. Once called,
                                                any future charge attempt from the merchant will <strong className="text-white">revert on-chain</strong>.
                                            </p>
                                            <CodeBlock code={killSwitchConceptCode} language="typescript" />
                                        </div>
                                    ),
                                },
                                {
                                    id: "solidity",
                                    label: "Solidity",
                                    content: <CodeBlock code={killSwitchSolidityCode} language="solidity" />,
                                },
                                {
                                    id: "nextjs",
                                    label: "Next.js",
                                    content: <CodeBlock code={killSwitchNextJsCode} language="tsx" />,
                                },
                            ]}
                            defaultTab="concept"
                        />
                    </section>

                    {/* Deep Dives */}
                    <section className="mb-16 space-y-4">
                        <h2 className="text-xl font-bold mb-6 text-white uppercase tracking-wider">Technical Details</h2>

                        <ExpandableSection title="ERC-4337 Account Abstraction" variant="deep-dive">
                            <p className="mb-4 text-xs leading-relaxed text-white/50">
                                SubScript leverages <strong className="text-white">ERC-4337</strong> for:
                            </p>
                            <ul className="list-disc list-inside text-xs text-white/50 space-y-2 leading-relaxed">
                                <li><strong className="text-white">Session Keys</strong> - Scoped permissions without full wallet access</li>
                                <li><strong className="text-white">Paymasters</strong> - Pay gas in USDC instead of native tokens</li>
                                <li><strong className="text-white">Bundlers</strong> - Batch transactions for efficiency</li>
                            </ul>
                        </ExpandableSection>

                        <ExpandableSection title="Double-Billing Prevention Logic" variant="deep-dive">
                            <p className="mb-4 text-xs leading-relaxed text-white/50">
                                Every Session Key tracks <code className="text-[#00d2b4] font-mono">lastPaymentTimestamp</code>.
                                The contract enforces a strict interval check:
                            </p>
                            <CodeBlock
                                code={`require(
    block.timestamp >= lastPaymentTimestamp + interval,
    "SubScript: Interval not reached"
);

// After successful charge:
lastPaymentTimestamp = block.timestamp;`}
                                language="solidity"
                            />
                            <p className="text-white/50 mt-4 text-xs leading-relaxed">
                                If the merchant tries to charge before the interval, the transaction reverts.
                                <strong className="text-white"> No disputes. No chargebacks. Math.</strong>
                            </p>
                        </ExpandableSection>
                    </section>

                    {/* Next Steps */}
                    <section className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl">
                        <h2 className="text-xl font-bold mb-5 text-white uppercase tracking-wider">Next Steps</h2>
                        <div className="space-y-4">
                            <FeatureItem
                                icon={TerminalIcon}
                                title="Try the Demo"
                                description="See the Kill Switch in action with a simulated wallet flow."
                                iconColor="text-[#00d2b4]"
                            />
                            <Link
                                href="/docs/demo"
                                className="inline-flex items-center gap-1.5 text-[#00d2b4] hover:text-white text-xs font-bold uppercase tracking-widest transition-colors mt-2"
                            >
                                Go to Interactive Demo →
                            </Link>
                        </div>
                    </section>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-white/5 py-12 bg-[#111111]/30">
                <div className="max-w-7xl mx-auto px-6 sm:px-12 text-center text-xs text-white/40">
                    © 2026 SubScript Protocol. Built on Arc Network.
                </div>
            </footer>
        </main>
    );
}
