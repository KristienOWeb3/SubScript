import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";

const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";

export async function POST(request: Request) {
    try {
        // 1. Authenticate the merchant session
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        // 2. Connect to network
        const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
        const adminPrivateKey = process.env.PRIVATE_KEY;

        if (!adminPrivateKey) {
            return NextResponse.json({ error: "Configuration Error: Admin private key missing on server" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

        // 3. Verify merchant is Premium on-chain
        const contractABI = [
            "function merchantTiers(address) view returns (uint8)",
            "function nextSubscriptionId() view returns (uint256)",
            "function subscriptions(uint256) view returns (address, address, uint256, uint256, uint256, bool)",
            "function executePayment(uint256 _subId) external",
            "function isPaymentDue(uint256 _subId) view returns (bool)"
        ];

        const contract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, contractABI, adminWallet);

        const tier = await contract.merchantTiers(walletAddress);
        if (Number(tier) < 1) {
            return NextResponse.json({ error: "Forbidden: Manual keeper execution is a Premium feature." }, { status: 403 });
        }

        // 4. Find and execute due subscriptions for this merchant
        const nextIdBig = await contract.nextSubscriptionId();
        const nextId = Number(nextIdBig);
        const executedSubs = [];
        const errors = [];

        for (let i = 1; i < nextId; i++) {
            try {
                const sub = await contract.subscriptions(i);
                const merchant = sub[1];
                const isActive = sub[5];

                if (merchant.toLowerCase() === walletAddress.toLowerCase() && isActive) {
                    const isDue = await contract.isPaymentDue(i);
                    if (isDue) {
                        console.log(`[Manual Keeper] Sub #${i} is due. Executing payment...`);
                        const tx = await contract.executePayment(i);
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
