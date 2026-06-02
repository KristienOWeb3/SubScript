import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { decryptPrivateKey } from "@/lib/crypto";
import { getSessionWallet } from "@/lib/auth";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const STANDARD_CONTRACT_ADDRESS = "0x3c7f095575C66eF21D501D63E265A51240849924";
const isProdEnv = process.env.NODE_ENV === "production";

const ERC20_ABI = [
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    },
    {
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    }
];

const SUBSCRIPT_ABI = [
    {
        type: "function",
        name: "depositAndCommit",
        stateMutability: "nonpayable",
        inputs: [
            { name: "commitment", type: "bytes32" },
            { name: "amount", type: "uint256" }
        ],
        outputs: []
    },
    {
        type: "function",
        name: "withdraw",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: []
    },
    {
        type: "function",
        name: "cancelSubscription",
        stateMutability: "nonpayable",
        inputs: [{ name: "_subId", type: "uint256" }],
        outputs: []
    },
    {
        type: "function",
        name: "configurePayoutDestination",
        stateMutability: "nonpayable",
        inputs: [{ name: "_newDestination", type: "address" }],
        outputs: []
    }
];

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || !body.action || !body.args) {
            return NextResponse.json({ error: "Action and arguments are required" }, { status: 400 });
        }

        const { action, args } = body;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Server Configuration Error: Supabase client not initialized." }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: walletRecord, error: walletError } = await supabase
            .from("user_embedded_wallets")
            .select("encrypted_private_key")
            .eq("wallet_address", wallet.toLowerCase())
            .maybeSingle();

        if (walletError || !walletRecord) {
            return NextResponse.json({ error: "Embedded wallet not found for authenticated user" }, { status: 404 });
        }

        const privateKey = decryptPrivateKey(walletRecord.encrypted_private_key);
        const rpcUrl = isProdEnv
            ? "https://rpc.mainnet.arc.network"
            : "https://rpc.testnet.arc.network";
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const walletSigner = new ethers.Wallet(privateKey, provider);

        let contractAddress = "";
        let contractAbi: any = null;
        let functionName = "";
        let finalArgs: any[] = [];

        switch (action) {
            case "approveUsdc": {
                const { spender, amount } = args;
                if (!spender || typeof spender !== "string") {
                    return NextResponse.json({ error: "Invalid spender address" }, { status: 400 });
                }
                const normalizedSpender = spender.toLowerCase();
                const PREMIUM_RECIPIENT = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295";
                if (
                    normalizedSpender !== SUBSCRIPT_ROUTER_ADDRESS.toLowerCase() &&
                    normalizedSpender !== STANDARD_CONTRACT_ADDRESS.toLowerCase() &&
                    normalizedSpender !== PREMIUM_RECIPIENT.toLowerCase()
                ) {
                    return NextResponse.json({ error: "Unauthorized spender address. Approve only standard, router, or premium subscript contracts." }, { status: 400 });
                }
                
                contractAddress = USDC_NATIVE_GAS_ADDRESS;
                contractAbi = ERC20_ABI;
                functionName = "approve";
                finalArgs = [spender, BigInt(amount)];
                break;
            }
            case "depositAndCommit": {
                const { commitment, amount } = args;
                if (!commitment || typeof commitment !== "string" || !commitment.startsWith("0x")) {
                    return NextResponse.json({ error: "Invalid commitment hash format" }, { status: 400 });
                }
                
                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "depositAndCommit";
                finalArgs = [commitment, BigInt(amount)];
                break;
            }
            case "transferUsdc": {
                const { to, amount } = args;
                if (!to || typeof to !== "string") {
                    return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
                }
                
                const PREMIUM_RECIPIENT = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295";
                if (to.toLowerCase() !== PREMIUM_RECIPIENT.toLowerCase()) {
                    return NextResponse.json({ error: "Unauthorized transfer recipient. Transfer only to SubScript premium payout account." }, { status: 400 });
                }

                contractAddress = USDC_NATIVE_GAS_ADDRESS;
                contractAbi = ERC20_ABI;
                functionName = "transfer";
                finalArgs = [to, BigInt(amount)];
                break;
            }
            case "withdraw": {
                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "withdraw";
                finalArgs = [];
                break;
            }
            case "cancelSubscription": {
                const { subscriptionId } = args;
                if (subscriptionId === undefined || subscriptionId === null) {
                    return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
                }

                const { data: merchant } = await supabase
                    .from("merchants")
                    .select("tier")
                    .eq("wallet_address", wallet.toLowerCase())
                    .maybeSingle();

                const isPremium = merchant ? merchant.tier >= 1 : false;
                
                contractAddress = isPremium ? SUBSCRIPT_ROUTER_ADDRESS : STANDARD_CONTRACT_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "cancelSubscription";
                finalArgs = [BigInt(subscriptionId)];
                break;
            }
            case "configurePayoutDestination": {
                const { payoutAddress } = args;
                if (!payoutAddress || typeof payoutAddress !== "string" || !payoutAddress.startsWith("0x") || payoutAddress.length !== 42) {
                    return NextResponse.json({ error: "Invalid payout address. Address must be a valid 0x hex format." }, { status: 400 });
                }

                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "configurePayoutDestination";
                finalArgs = [payoutAddress];
                break;
            }
            case "setMerchantTier": {
                const { merchant, tier } = args;
                if (!merchant || typeof merchant !== "string" || !merchant.startsWith("0x") || merchant.length !== 42) {
                    return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
                }
                const PREMIUM_RECIPIENT = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295";
                contractAddress = PREMIUM_RECIPIENT;
                contractAbi = [
                    {
                        type: "function",
                        name: "setMerchantTier",
                        stateMutability: "nonpayable",
                        inputs: [
                            { name: "_merchant", type: "address" },
                            { name: "_tier", type: "uint8" }
                        ],
                        outputs: []
                    }
                ];
                functionName = "setMerchantTier";
                finalArgs = [merchant, Number(tier)];
                break;
            }
            default:
                return NextResponse.json({ error: `Unsupported execution action: ${action}` }, { status: 400 });
        }

        try {
            const contract = new ethers.Contract(contractAddress, contractAbi, walletSigner);
            const method = contract[functionName] as any;
            if (typeof method !== "function") {
                return NextResponse.json({ error: `Method ${functionName} does not exist on contract` }, { status: 400 });
            }
            
            const tx = await method(...finalArgs);
            return NextResponse.json({ success: true, txHash: tx.hash }, { status: 200 });
        } catch (err: any) {
            console.error("EVM execution error:", err);
            
            const revertReason = err?.reason || err?.info?.error?.message || err?.message || "Transaction execution failed";
            return NextResponse.json({ error: `Execution reverted: ${revertReason}` }, { status: 400 });
        }

    } catch (err: any) {
        console.error("Execute TX API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
