import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS, STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";

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
            "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive, address settlementToken, address paymentToken)",
            "function executePayment(uint256 _subId, uint256 _sequenceId) external",
            "function isPaymentDue(uint256 _subId, uint256 _sequenceId) view returns (bool)",
            "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)"
        ];

        const routerContract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, routerABI, adminWallet);
        const standardContract = new ethers.Contract(STANDARD_CONTRACT_ADDRESS, standardABI, adminWallet);

        const tier = await routerContract.merchantTiers(walletAddress);
        if (Number(tier) < 1) {
            return NextResponse.json({ error: "Forbidden: Manual keeper execution is a Premium feature." }, { status: 403 });
        }

        /* 4. Find and execute due subscriptions for this merchant */
        const nextIdBig = await standardContract.nextSubscriptionId();
        const nextId = Number(nextIdBig);
        const executedSubs = [];
        const errors = [];

        for (let i = 1; i < nextId; i++) {
            try {
                const sub = await standardContract.subscriptions(i);
                const merchant = sub.merchant;
                const isActive = sub.isActive;

                if (merchant.toLowerCase() === walletAddress.toLowerCase() && isActive) {
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
