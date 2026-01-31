"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Terminal, ArrowLeft, Copy, Check, Server, Key, Power, Code2 } from "lucide-react";

import TabBlock, { CodeBlock } from "@/components/docs/TabBlock";
import ExpandableSection from "@/components/docs/ExpandableSection";
import { FeatureItem } from "@/components/docs/FeatureCard";

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

export default function DevelopersPage() {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* Navigation */}
            <nav className="fixed w-full z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                            <Terminal className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-xl font-bold">SubScript</span>
                        <span className="text-slate-500 text-sm ml-2">Docs</span>
                    </Link>
                    <div className="hidden md:flex space-x-6 text-sm font-medium text-slate-400">
                        <Link href="/docs" className="hover:text-white transition">Overview</Link>
                        <Link href="/docs/developers" className="text-white">Developers</Link>
                        <Link href="/docs/demo" className="hover:text-white transition">Demo</Link>
                    </div>
                    <Link
                        href="/"
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-medium transition"
                    >
                        Launch App
                    </Link>
                </div>
            </nav>

            {/* Content */}
            <div className="pt-24 pb-16 px-4 sm:px-6">
                <div className="max-w-4xl mx-auto">
                    {/* Back Link */}
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition mb-8"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Overview
                    </Link>

                    {/* Header */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-12"
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center">
                                <Code2 className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <h1 className="text-3xl font-bold">Developer SDK</h1>
                                <p className="text-slate-400">Copy-paste integration guides</p>
                            </div>
                        </div>
                    </motion.div>

                    {/* Network Configuration */}
                    <section className="mb-12">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <Server className="w-5 h-5 text-blue-400" />
                            Network Configuration
                        </h2>

                        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div>
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">Network</span>
                                    <p className="text-white font-mono">Arc Testnet</p>
                                </div>
                                <div>
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">Chain ID</span>
                                    <p className="text-white font-mono">5042002</p>
                                </div>
                                <div className="sm:col-span-2">
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">RPC Endpoint</span>
                                    <p className="text-blue-400 font-mono text-sm break-all">
                                        https://rpc.testnet.arc.network
                                    </p>
                                </div>
                                <div>
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">Native Currency</span>
                                    <p className="text-white font-mono">USDC</p>
                                </div>
                                <div>
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">Block Explorer</span>
                                    <a
                                        href="https://explorer.arc.network"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 hover:text-blue-300 transition"
                                    >
                                        explorer.arc.network ↗
                                    </a>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Session Key Integration */}
                    <section className="mb-12">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <Key className="w-5 h-5 text-purple-400" />
                            Creating a Session Key
                        </h2>
                        <p className="text-slate-400 mb-6">
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
                                            <p className="text-slate-400 mb-4">
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
                    <section className="mb-12">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <Power className="w-5 h-5 text-red-400" />
                            The Kill Switch
                        </h2>
                        <p className="text-slate-400 mb-6">
                            One function call. Instant. Unilateral. The merchant cannot block or delay it.
                        </p>

                        <TabBlock
                            tabs={[
                                {
                                    id: "concept",
                                    label: "Concept",
                                    content: (
                                        <div>
                                            <p className="text-slate-400 mb-4">
                                                <code className="text-red-400">revokeSessionKey()</code> is the user's
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
                    <section className="mb-12 space-y-4">
                        <h2 className="text-xl font-bold mb-4">Technical Details</h2>

                        <ExpandableSection title="ERC-4337 Account Abstraction" variant="deep-dive">
                            <p className="mb-4">
                                SubScript leverages <strong className="text-white">ERC-4337</strong> for:
                            </p>
                            <ul className="list-disc list-inside text-slate-400 space-y-2">
                                <li><strong className="text-white">Session Keys</strong> - Scoped permissions without full wallet access</li>
                                <li><strong className="text-white">Paymasters</strong> - Pay gas in USDC instead of native tokens</li>
                                <li><strong className="text-white">Bundlers</strong> - Batch transactions for efficiency</li>
                            </ul>
                        </ExpandableSection>

                        <ExpandableSection title="Double-Billing Prevention Logic" variant="deep-dive">
                            <p className="mb-4">
                                Every Session Key tracks <code className="text-blue-400">lastPaymentTimestamp</code>.
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
                            <p className="text-slate-400 mt-4">
                                If the merchant tries to charge before the interval, the transaction reverts.
                                <strong className="text-white"> No disputes. No chargebacks. Math.</strong>
                            </p>
                        </ExpandableSection>
                    </section>

                    {/* Next Steps */}
                    <section className="rounded-xl border border-slate-800 bg-slate-900/30 p-6">
                        <h2 className="text-xl font-bold mb-4">Next Steps</h2>
                        <div className="space-y-4">
                            <FeatureItem
                                icon={Terminal}
                                title="Try the Demo"
                                description="See the Kill Switch in action with a simulated wallet flow."
                                iconColor="text-amber-400"
                            />
                            <Link
                                href="/docs/demo"
                                className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition mt-2"
                            >
                                Go to Interactive Demo →
                            </Link>
                        </div>
                    </section>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-slate-800 py-8 bg-slate-950">
                <div className="max-w-7xl mx-auto px-6 text-center text-sm text-slate-500">
                    © 2026 SubScript Protocol. Built on Arc Network.
                </div>
            </footer>
        </div>
    );
}
