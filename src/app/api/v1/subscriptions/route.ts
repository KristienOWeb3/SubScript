import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";

const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";

const SUBSCRIPT_ABI = [
    {
        inputs: [],
        name: "nextSubscriptionId",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "uint256" }],
        name: "subscriptions",
        outputs: [
            { name: "subscriber", type: "address" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "period", type: "uint256" },
            { name: "nextPayment", type: "uint256" },
            { name: "isActive", type: "bool" },
        ],
        stateMutability: "view",
        type: "function",
    },
] as const;

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

// GET /api/v1/subscriptions - Public endpoint for merchant servers to query subscriptions
export async function GET(request: Request) {
    try {
        // 1. Authenticate secret API key from the Authorization header
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized: Missing or invalid Authorization header" }, { status: 401 });
        }

        const secretKey = authHeader.substring(7).trim(); // Remove "Bearer "
        if (!secretKey.startsWith("sk_test_")) {
            return NextResponse.json({ error: "Unauthorized: Invalid secret API key format" }, { status: 401 });
        }

        // Validate secret key in the database
        const keyRecord = await prisma.apiKey.findFirst({
            where: {
                secretKeyPlain: secretKey,
                revoked: false,
            },
        });

        if (!keyRecord) {
            return NextResponse.json({ error: "Unauthorized: Active secret key not found" }, { status: 401 });
        }

        const merchantWallet = keyRecord.walletAddress.toLowerCase();

        // 2. Parse query parameters
        const { searchParams } = new URL(request.url);
        const subIdParam = searchParams.get("id");
        const subscriberParam = searchParams.get("subscriber");

        if (!subIdParam && !subscriberParam) {
            return NextResponse.json({ error: "Bad Request: Provide either 'id' or 'subscriber' parameter" }, { status: 400 });
        }

        // Case A: Query by Subscription ID
        if (subIdParam) {
            // Support formats like "sub_1" or "1"
            const cleanedIdStr = subIdParam.replace(/^sub_/, "");
            const subId = parseInt(cleanedIdStr, 10);

            if (isNaN(subId) || subId <= 0) {
                return NextResponse.json({ error: "Bad Request: Invalid subscription ID format" }, { status: 400 });
            }

            try {
                // Read from smart contract
                const subscription = await publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ABI,
                    functionName: "subscriptions",
                    args: [BigInt(subId)],
                });

                const [subscriber, merchant, amount, period, nextPayment, isActive] = subscription;

                // Security check: Verify that this subscription belongs to the querying merchant
                if (merchant.toLowerCase() !== merchantWallet) {
                    return NextResponse.json({ error: "Forbidden: This subscription does not belong to your merchant wallet" }, { status: 403 });
                }

                // Return details
                return NextResponse.json({
                    id: `sub_${subId}`,
                    subscriber,
                    merchant,
                    amount: formatUnits(amount, 6),
                    amountRaw: amount.toString(),
                    periodSeconds: Number(period),
                    nextPaymentTimestamp: Number(nextPayment),
                    nextPaymentDate: new Date(Number(nextPayment) * 1000).toISOString(),
                    isActive,
                }, { status: 200 });
            } catch (err: any) {
                console.error(`Error reading subId ${subId} from contract:`, err);
                return NextResponse.json({ error: "Subscription not found on-chain" }, { status: 404 });
            }
        }

        // Case B: Query by Subscriber Address
        if (subscriberParam) {
            const subscriberWallet = subscriberParam.toLowerCase();
            if (!subscriberWallet.startsWith("0x") || subscriberWallet.length !== 42) {
                return NextResponse.json({ error: "Bad Request: Invalid subscriber address" }, { status: 400 });
            }

            // Scan on-chain subscriptions to find active ones for this merchant + subscriber
            try {
                const nextIdBig = await publicClient.readContract({
                    address: SUBSCRIPT_ROUTER_ADDRESS,
                    abi: SUBSCRIPT_ABI,
                    functionName: "nextSubscriptionId",
                });
                const nextId = Number(nextIdBig);

                const activeSubscriptions = [];

                // Read subscriptions in chunks to prevent RPC payload overload
                const idList = Array.from({ length: nextId - 1 }, (_, i) => i + 1);
                
                // For efficiency, run queries in parallel batches
                const batchSize = 20;
                for (let i = 0; i < idList.length; i += batchSize) {
                    const chunk = idList.slice(i, i + batchSize);
                    const results = await Promise.all(
                        chunk.map(async (id) => {
                            try {
                                const sub = await publicClient.readContract({
                                    address: SUBSCRIPT_ROUTER_ADDRESS,
                                    abi: SUBSCRIPT_ABI,
                                    functionName: "subscriptions",
                                    args: [BigInt(id)],
                                });
                                return { id, data: sub };
                            } catch {
                                return null;
                            }
                        })
                    );

                    for (const res of results) {
                        if (res && res.data) {
                            const [subPayer, subMerchant, amount, period, nextPayment, isActive] = res.data;
                            if (
                                subPayer.toLowerCase() === subscriberWallet &&
                                subMerchant.toLowerCase() === merchantWallet
                            ) {
                                activeSubscriptions.push({
                                    id: `sub_${res.id}`,
                                    subscriber: subPayer,
                                    merchant: subMerchant,
                                    amount: formatUnits(amount, 6),
                                    amountRaw: amount.toString(),
                                    periodSeconds: Number(period),
                                    nextPaymentTimestamp: Number(nextPayment),
                                    nextPaymentDate: new Date(Number(nextPayment) * 1000).toISOString(),
                                    isActive,
                                });
                            }
                        }
                    }
                }

                return NextResponse.json({ subscriptions: activeSubscriptions }, { status: 200 });
            } catch (err: any) {
                console.error("Error scanning subscriptions on-chain:", err);
                return NextResponse.json({ error: "Failed to scan subscriptions on-chain" }, { status: 500 });
            }
        }

        return NextResponse.json({ error: "Bad Request" }, { status: 400 });
    } catch (error: any) {
        console.error("Public API subscriptions fetch error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
