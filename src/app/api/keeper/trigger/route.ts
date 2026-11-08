import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { getAccountKycTier } from "@/lib/kyc/tier";
import { consumeDistributedRateLimit } from "@/lib/distributedRateLimit";
import crypto from "crypto";

export const maxDuration = 300;

function isAuthorizedKeeper(request: Request): boolean {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.KEEPER_SECRET, process.env.CRON_SECRET]
        .filter((value): value is string => Boolean(value));

    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

export async function POST(request: Request) {
    try {
        const isKeeper = isAuthorizedKeeper(request);
        let walletAddress: string | null = null;

        if (isKeeper) {
            try {
                const body = await request.clone().json().catch(() => null);
                if (body && typeof body.walletAddress === "string") {
                    walletAddress = body.walletAddress;
                }
            } catch {
                // Optional body parsing for keeper
            }
        } else {
            walletAddress = await getSessionWallet(request.headers);
            if (!walletAddress) {
                return NextResponse.json({ error: "Unauthorized: Missing valid session or bearer secret." }, { status: 401 });
            }

            /* Verify KYC before creating a provider or signer so Tier 0 requests cannot reach RPC side effects. */
            const tierInfo = await getAccountKycTier(walletAddress);
            if (!tierInfo.isTier1) {
                return NextResponse.json({
                    error: "Forbidden: Manual keeper execution requires Tier 1 verification (link a verified email)."
                }, { status: 403 });
            }
        }

        const rateLimitKey = isKeeper ? "keeper-cron" : (walletAddress ? walletAddress.toLowerCase() : "anonymous");
        const rateLimit = await consumeDistributedRateLimit({
            scope: "keeper-trigger",
            key: rateLimitKey,
            limit: isKeeper ? 30 : 5,
            windowSeconds: 60,
        });
        if (!rateLimit.ok) {
            return NextResponse.json(
                { error: "Too many keeper requests. Please try again later." },
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
            );
        }

        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;
        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
        const standardABI = [
            "function nextSubscriptionId() view returns (uint256)",
            "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
            "function executePayment(uint256 _subId, uint256 _sequenceId) external",
            "function isPaymentDue(uint256 _subId, uint256 _sequenceId) view returns (bool)",
            "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)",
            "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)"
        ];
        const standardContract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, standardABI, adminWallet);

        /* Resolve IDs from the merchant-indexed event bounded by recent block range so work scales efficiently */
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 10000);
        const merchantLower = walletAddress ? walletAddress.toLowerCase() : null;
        const createdFilter = standardContract.filters.SubscriptionCreated(null, null, walletAddress || null);
        const createdLogs = await standardContract.queryFilter(createdFilter, fromBlock, currentBlock);
        const subIds = Array.from(new Set(
            createdLogs
                .map((log) => (log as ethers.EventLog).args?.subId)
                .filter((subId) => subId !== undefined && subId !== null)
                .map((subId) => Number(subId))
        ));

        const executedSubs = [];
        const errors = [];
        for (const i of subIds) {
            try {
                const sub = await standardContract.subscriptions(i);
                const period = Number(sub.period);
                const nextPayment = Number(sub.nextPayment);
                const isTargetMerchant = !merchantLower || sub.merchant.toLowerCase() === merchantLower;

                if (isTargetMerchant && sub.isActive && period > 0) {
                    const now = Math.floor(Date.now() / 1000);
                    if (now >= nextPayment) {
                        const seq = Math.floor((now - nextPayment) / period) + 1;
                        if (!await standardContract.isSequenceExecuted(i, seq) && await standardContract.isPaymentDue(i, seq)) {
                            const tx = await standardContract.executePayment(i, seq);
                            await tx.wait();
                            executedSubs.push({ subId: `sub_${i}`, sequenceId: seq, txHash: tx.hash });
                        }
                    }
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Execution error";
                console.error(`[Manual Keeper] Failed to process sub #${i}:`, err);
                errors.push({ subId: `sub_${i}`, error: message });
            }
        }

        return NextResponse.json({
            success: true,
            executedCount: executedSubs.length,
            executed: executedSubs,
            errors,
        }, { status: 200 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal Server Error";
        console.error("Manual keeper trigger error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
