import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import crypto from "crypto";
import { decryptPrivateKey } from "@/lib/crypto";
import { getSessionWallet } from "@/lib/auth";
import {
    CONFIDENTIAL_CONTRACT_ADDRESS,
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";
import { executeWithRpcFallback } from "@/lib/payments/rpc";

const isProdEnv = process.env.NODE_ENV === "production";
const USER_SPONSORED_ACTIONS = new Set(["approveUsdc", "transferUsdc"]);
const MERCHANT_SPONSORED_ACTIONS = new Set([
    "approveUsdc",
    "transferUsdc",
    "createPremiumSubscription",
    "withdraw",
    "cancelSubscription",
    "configurePayoutDestination",
    "registerViewKey"
]);

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
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
    }
];

const SUBSCRIPT_ABI = [
    {
        type: "function",
        name: "createSubscription",
        stateMutability: "nonpayable",
        inputs: [
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
    },
    {
        type: "function",
        name: "merchantBalances",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
    }
];

const CONFIDENTIAL_ABI = [
    {
        type: "function",
        name: "registerViewKey",
        stateMutability: "nonpayable",
        inputs: [{ name: "_viewKeyHash", type: "bytes32" }],
        outputs: []
    }
];

export async function POST(request: Request) {
    try {
        const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
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

        const { data: roleData, error: roleError } = await supabase
            .from("account_roles")
            .select("role")
            .eq("address", wallet.toLowerCase())
            .maybeSingle();

        if (roleError) {
            console.error(`[execute-tx] Failed to query account role: ${roleError.message}`);
            return NextResponse.json({ error: "Unable to verify account role" }, { status: 500 });
        }

        const accountRole = roleData?.role || null;
        if (!accountRole) {
            return NextResponse.json({ error: "Forbidden: Account role is required for sponsored execution." }, { status: 403 });
        }
        if (accountRole === "USER" && !USER_SPONSORED_ACTIONS.has(action)) {
            return NextResponse.json({ error: "Forbidden: User accounts cannot execute merchant-sponsored actions." }, { status: 403 });
        }
        if (accountRole === "ENTERPRISE" && !MERCHANT_SPONSORED_ACTIONS.has(action)) {
            return NextResponse.json({ error: "Forbidden: Merchant account action is not allowlisted for sponsorship." }, { status: 403 });
        }

        /* Enforce Backend Tier Checks */
        const premiumActions = ["configurePayoutDestination"];
        if (premiumActions.includes(action)) {
            const merchantToCheck = wallet;
            const { data: merchantData, error: merchantErr } = await supabase
                .from("merchants")
                .select("tier")
                .eq("wallet_address", merchantToCheck.toLowerCase())
                .maybeSingle();

            if (merchantErr) {
                console.error(`[execute-tx] Failed to query merchant: ${merchantErr.message}`);
            }
            const dbMerchantTier = merchantData ? merchantData.tier : "FREE";
            if (dbMerchantTier === "FREE") {
                console.warn(`[execute-tx] Forbidden: Action ${action} requires active premium tier for merchant ${merchantToCheck}. requestId: ${requestId}`);
                return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
            }
        }

        /* Circuit Breaker Check */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("*")
            .eq("id", 1)
            .maybeSingle();

        if (settings) {
            if (action === "withdraw" && !settings.withdrawals_enabled) {
                return NextResponse.json({ error: "Service Unavailable: Withdrawals are currently disabled by circuit breaker." }, { status: 503 });
            }
        }

        const { data: walletRecord, error: walletError } = await supabase
            .from("user_embedded_wallets")
            .select("encrypted_private_key, provider")
            .eq("wallet_address", wallet.toLowerCase())
            .maybeSingle();

        if (walletError || !walletRecord) {
            return NextResponse.json({ error: "Embedded wallet not found for authenticated user" }, { status: 404 });
        }
        if (walletRecord.provider === "external_wallet" || !walletRecord.encrypted_private_key) {
            return NextResponse.json({ error: "Server-sponsored execution is only available for embedded wallet sessions." }, { status: 403 });
        }

        const privateKey = decryptPrivateKey(walletRecord.encrypted_private_key);

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
            case "createPremiumSubscription": {
                const { merchant, amount, period } = args;
                if (!merchant || typeof merchant !== "string") {
                    return NextResponse.json({ error: "Invalid premium subscription recipient" }, { status: 400 });
                }
                if (merchant.toLowerCase() !== PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
                    return NextResponse.json({ error: "Unauthorized subscription recipient. Sponsored subscriptions can only target the SubScript premium account." }, { status: 400 });
                }
                if (amount === undefined || period === undefined) {
                    return NextResponse.json({ error: "amount and period are required" }, { status: 400 });
                }

                contractAddress = STANDARD_CONTRACT_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "createSubscription";
                finalArgs = [merchant, BigInt(amount), BigInt(period)];
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

                contractAddress = STANDARD_CONTRACT_ADDRESS;
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
            case "registerViewKey": {
                const { viewKeyHash } = args;
                if (!viewKeyHash || typeof viewKeyHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(viewKeyHash)) {
                    return NextResponse.json({ error: "Invalid view key hash. Expected bytes32 hex." }, { status: 400 });
                }

                const { data: merchantData, error: merchantErr } = await supabase
                    .from("merchants")
                    .select("tier")
                    .eq("wallet_address", wallet.toLowerCase())
                    .maybeSingle();

                if (merchantErr) {
                    console.error(`[execute-tx] Failed to query merchant for view key registration: ${merchantErr.message}`);
                }
                if (!merchantData || merchantData.tier === "FREE") {
                    return NextResponse.json({ error: "Forbidden: Premium merchant tier required to register a view key." }, { status: 403 });
                }

                contractAddress = CONFIDENTIAL_CONTRACT_ADDRESS;
                contractAbi = CONFIDENTIAL_ABI;
                functionName = "registerViewKey";
                finalArgs = [viewKeyHash];
                break;
            }
            default:
                return NextResponse.json({ error: `Unsupported execution action: ${action}` }, { status: 400 });
        }

        try {
            if (action === "withdraw") {
                console.log(`[Withdrawal Requested] session: ${wallet}, action: ${action}, target: ${wallet}, requestId: ${requestId}`);
            }

            /* Execute contract transaction with RPC redundancy failover wrapper */
            const { result: tx } = await executeWithRpcFallback(async (provider) => {
                const walletSigner = new ethers.Wallet(privateKey, provider);
                const contract = new ethers.Contract(contractAddress, contractAbi, walletSigner);
                const method = contract[functionName] as any;
                if (typeof method !== "function") {
                    throw new Error(`METHOD_NOT_FOUND: ${functionName}`);
                }
                return await method(...finalArgs);
            });

            if (action === "withdraw") {
                console.log(`[Withdrawal Executed] session: ${wallet}, txHash: ${tx.hash}, requestId: ${requestId}`);
            }

            return NextResponse.json({ success: true, txHash: tx.hash }, { status: 200 });

        } catch (err: any) {
            console.error("EVM execution error:", err);
            
            const revertReason = err?.reason || err?.info?.error?.message || err?.message || "Transaction execution failed";

            if (action === "withdraw") {
                console.error(`[Withdrawal Failed] session: ${wallet}, action: ${action}, error: ${revertReason}, requestId: ${requestId}`);
            }

            return NextResponse.json({ error: `Execution reverted: ${revertReason}` }, { status: 400 });
        }

    } catch (err: any) {
        console.error("Execute TX API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
