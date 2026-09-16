import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { getAccountKycTier } from "@/lib/kyc/tier";

export const maxDuration = 300;

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        /* Verify KYC before creating a provider or signer so Tier 0 requests cannot reach RPC side effects. */
        const tierInfo = await getAccountKycTier(walletAddress);
        if (!tierInfo.isTier1) {
            return NextResponse.json({
                error: "Forbidden: Manual keeper execution requires Tier 1 verification (link a verified email)."
            }, { status: 403 });
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

        /* Resolve IDs from the merchant-indexed event so work scales with this merchant, not the protocol. */
        const merchantLower = walletAddress.toLowerCase();
        const createdFilter = standardContract.filters.SubscriptionCreated(null, null, walletAddress);
        const createdLogs = await standardContract.queryFilter(createdFilter);
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
                if (sub.merchant.toLowerCase() === merchantLower && sub.isActive) {
                    let sequenceId = 1;
                    while (await standardContract.isSequenceExecuted(i, sequenceId)) sequenceId++;
                    if (await standardContract.isPaymentDue(i, sequenceId)) {
                        const tx = await standardContract.executePayment(i, sequenceId);
                        await tx.wait();
                        executedSubs.push({ subId: `sub_${i}`, txHash: tx.hash });
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
