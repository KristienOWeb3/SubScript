/* Next.js Server Verifier for Privacy Premium Upgrades */
import { NextResponse } from "next/server";
import { createPublicClient, http, decodeFunctionData } from "viem";
import { PrismaClient } from "@prisma/client";
import { arcTestnet } from "@/lib/wagmi";
import { 
    STANDARD_CONTRACT_ADDRESS, 
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS 
} from "@/lib/contracts/constants";
import { STANDARD_SUBSCRIPT_ABI } from "@/lib/contracts/abis";

const prisma = new PrismaClient();

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { txHash } = body;

        if (!txHash || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
        }

        /* 1. Fetch transaction receipt to verify success and target */
        const receipt = await publicClient.getTransactionReceipt({
            hash: txHash as `0x${string}`,
        });

        if (receipt.status !== "success") {
            return NextResponse.json({ error: "Transaction reverted on-chain" }, { status: 400 });
        }

        if (receipt.to?.toLowerCase() !== STANDARD_CONTRACT_ADDRESS.toLowerCase()) {
            return NextResponse.json({ error: "Transaction did not target standard SubScriptPSA contract" }, { status: 400 });
        }

        /* 2. Fetch transaction details to decode and assert input data */
        const transaction = await publicClient.getTransaction({
            hash: txHash as `0x${string}`,
        });

        const decoded = decodeFunctionData({
            abi: STANDARD_SUBSCRIPT_ABI,
            data: transaction.input,
        });

        if (decoded.functionName !== "createSubscription") {
            return NextResponse.json({ error: "Incorrect function call payload" }, { status: 400 });
        }

        const [merchant, amount, period] = decoded.args as [string, bigint, bigint];

        if (
            merchant.toLowerCase() !== PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase() ||
            amount !== BigInt(10000000) ||
            period !== BigInt(2592000)
        ) {
            return NextResponse.json({ error: "Incorrect parameters for premium upgrade subscription" }, { status: 400 });
        }

        /* 3. Execute the database update */
        const payerAddress = transaction.from;

        await prisma.merchant.upsert({
            where: { walletAddress: payerAddress },
            update: { tier: "PREMIUM" },
            create: {
                walletAddress: payerAddress,
                tier: "PREMIUM",
                payoutDestination: payerAddress,
                availableBalanceUsdc: BigInt(0),
                reservedBalanceUsdc: BigInt(0),
                shieldedPayoutsEnabled: false,
            },
        });

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: any) {
        console.error("Upgrade verification error:", error);
        return NextResponse.json({ error: error.message || "Verification failed" }, { status: 500 });
    }
}
