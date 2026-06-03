import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { decryptPrivateKey } from "@/lib/crypto";
import { getSessionWallet } from "@/lib/auth";
import {
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";
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
        name: "verifyAndActivate",
        stateMutability: "nonpayable",
        inputs: [
            { name: "proof", type: "bytes32[]" },
            { name: "nullifierHash", type: "bytes32" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "period", type: "uint256" }
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
        name: "withdrawWithProof",
        stateMutability: "nonpayable",
        inputs: [
            { name: "proof", type: "bytes32[]" },
            { name: "nullifierHash", type: "bytes32" },
            { name: "merchant", type: "address" },
            { name: "target", type: "address" }
        ],
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
                if (
                    normalizedSpender !== SUBSCRIPT_ROUTER_ADDRESS.toLowerCase() &&
                    normalizedSpender !== STANDARD_CONTRACT_ADDRESS.toLowerCase()
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
            case "verifyAndActivate": {
                const { proof, nullifierHash, merchant, amount, period } = args;
                if (!Array.isArray(proof) || proof.length < 2 || proof.some((item) => typeof item !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item))) {
                    return NextResponse.json({ error: "Invalid proof payload" }, { status: 400 });
                }
                if (!nullifierHash || typeof nullifierHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nullifierHash)) {
                    return NextResponse.json({ error: "Invalid nullifier hash" }, { status: 400 });
                }
                if (!merchant || typeof merchant !== "string" || merchant.toLowerCase() !== PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
                    return NextResponse.json({ error: "Invalid premium payment recipient" }, { status: 400 });
                }

                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "verifyAndActivate";
                finalArgs = [proof, nullifierHash, merchant, BigInt(amount), BigInt(period)];
                break;
            }
            case "transferUsdc": {
                const { to, amount } = args;
                if (!to || typeof to !== "string") {
                    return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
                }
                
                if (to.toLowerCase() !== PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
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
            case "withdrawWithProof": {
                const { proof, nullifierHash, merchant, target } = args;
                if (!Array.isArray(proof) || proof.length < 2 || proof.some((item) => typeof item !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item))) {
                    return NextResponse.json({ error: "Invalid proof payload" }, { status: 400 });
                }
                if (!nullifierHash || typeof nullifierHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nullifierHash)) {
                    return NextResponse.json({ error: "Invalid nullifier hash" }, { status: 400 });
                }
                if (!merchant || typeof merchant !== "string" || !merchant.startsWith("0x") || merchant.length !== 42) {
                    return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
                }
                if (!target || typeof target !== "string" || !target.startsWith("0x") || target.length !== 42) {
                    return NextResponse.json({ error: "Invalid target address" }, { status: 400 });
                }

                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "withdrawWithProof";
                finalArgs = [proof, nullifierHash, merchant, target];
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
