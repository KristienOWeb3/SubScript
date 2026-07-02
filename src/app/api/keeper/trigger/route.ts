import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS, STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";

export const maxDuration = 300;

export async function POST(request: Request) {
    try {
        /* 1. Authenticate the merchant session */
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        /* 2. Connect to network */
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;

        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

        /* 3. Verify merchant is Premium on-chain */
        const routerABI = [
            "function merchantTiers(address) view returns (uint8)"
        ];
        const standardABI = [
            "function nextSubscriptionId() view returns (uint256)",
            "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive)",
            "function executePayment(uint256 _subId, uint256 _sequenceId) external",
            "function isPaymentDue(uint256 _subId, uint256 _sequenceId) view returns (bool)",
            "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)",
            "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)"
        ];

        const routerContract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, routerABI, adminWallet);
        const standardContract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, standardABI, adminWallet);

        const tier = await routerContract.merchantTiers(walletAddress);
        if (Number(tier) < 1) {
            return NextResponse.json({ error: "Forbidden: Manual keeper execution is a Premium feature." }, { status: 403 });
        }

        /* 4. Find and execute due subscriptions for THIS merchant only.
              Resolve candidate ids from the `merchant`-indexed SubscriptionCreated topic rather
              than scanning every id from 1..nextSubscriptionId — the work is now bounded by the
              merchant's own subscription count, not the whole contract's, so it won't time out as
              the protocol grows. */
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
                    while (await standardContract.isSequenceExecuted(i, sequenceId)) {
                        sequenceId++;
                    }

                    const isDue = await standardContract.isPaymentDue(i, sequenceId);
                    if (isDue) {
                        console.log(`[Manual Keeper] Sub #${i} is due (Sequence ${sequenceId}). Executing payment...`);
                        const tx = await standardContract.executePayment(i, sequenceId);
                        await tx.wait();
                        executedSubs.push({ subId: `sub_${i}`, txHash: tx.hash });
                    }
                }
            } catch (err: any) {
                console.error(`[Manual Keeper] Failed to process sub #${i}:`, err);
                errors.push({ subId: `sub_${i}`, error: err.message || "Execution error" });
            }
        }

        return NextResponse.json({
            success: true,
            executedCount: executedSubs.length,
            executed: executedSubs,
            errors: errors
        }, { status: 200 });

    } catch (error: any) {
        console.error("Manual keeper trigger error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
