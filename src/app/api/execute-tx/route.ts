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
import { getRpcProviderForWrite } from "@/lib/payments/rpc";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { getWalletCustody } from "@/lib/custody";

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
            .select("encrypted_private_key, circle_wallet_id, provider")
            .eq("wallet_address", wallet.toLowerCase())
            .maybeSingle();

        if (walletError || !walletRecord) {
            return NextResponse.json({ error: "Embedded wallet not found for authenticated user" }, { status: 404 });
        }
        /* External (browser) wallets sign client-side; server-sponsored execution needs a
           server-held custody (a legacy encrypted key or a Circle MPC wallet). */
        if (walletRecord.provider === "external_wallet" || (!walletRecord.encrypted_private_key && !walletRecord.circle_wallet_id)) {
            return NextResponse.json({ error: "Server-sponsored execution is only available for embedded wallet sessions." }, { status: 403 });
        }

        /* Resolve the call into a backend-agnostic (functionSignature, params). uint256 args are
           passed as decimal strings — validated via BigInt() and accepted by both ethers (legacy)
           and Circle's abiParameters (MPC). */
        let contractAddress = "";
        let functionSignature = "";
        let params: unknown[] = [];

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
                    return NextResponse.json({ error: "Unauthorized spender address. Approve only the SubScript standard or router contract." }, { status: 400 });
                }

                contractAddress = USDC_NATIVE_GAS_ADDRESS;
                functionSignature = "approve(address,uint256)";
                params = [spender, BigInt(amount).toString()];
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
                functionSignature = "transfer(address,uint256)";
                params = [to, BigInt(amount).toString()];
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
                functionSignature = "createSubscription(address,uint256,uint256)";
                params = [merchant, BigInt(amount).toString(), BigInt(period).toString()];
                break;
            }
            case "withdraw": {
                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                functionSignature = "withdraw()";
                params = [];
                break;
            }
            case "cancelSubscription": {
                const { subscriptionId } = args;
                if (subscriptionId === undefined || subscriptionId === null) {
                    return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
                }

                contractAddress = STANDARD_CONTRACT_ADDRESS;
                functionSignature = "cancelSubscription(uint256)";
                params = [BigInt(subscriptionId).toString()];
                break;
            }
            case "configurePayoutDestination": {
                const { payoutAddress } = args;
                if (!payoutAddress || typeof payoutAddress !== "string" || !payoutAddress.startsWith("0x") || payoutAddress.length !== 42) {
                    return NextResponse.json({ error: "Invalid payout address. Address must be a valid 0x hex format." }, { status: 400 });
                }

                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                functionSignature = "configurePayoutDestination(address)";
                params = [payoutAddress];
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
                functionSignature = "registerViewKey(bytes32)";
                params = [viewKeyHash];
                break;
            }
            default:
                return NextResponse.json({ error: `Unsupported execution action: ${action}` }, { status: 400 });
        }

        try {
            if (action === "withdraw") {
                console.log(`[Withdrawal Requested] session: ${wallet}, action: ${action}, target: ${wallet}, requestId: ${requestId}`);
            }

            let txHash: string | null;

            if (walletRecord.circle_wallet_id) {
                /* Circle MPC (SCA) wallet: sign + execute via the custody provider. Gas is sponsored
                   by Circle Gas Station on Arc, so no SPONSOR_PRIVATE_KEY top-up is needed. */
                const custody = await getWalletCustody(wallet);
                const result = await custody.executeContract({ contractAddress, functionSignature, params });
                txHash = result.txHash;
            } else {
                /* Legacy encrypted-key wallet: preserved fire-and-return path. USER actions get a
                   just-in-time USDC gas top-up so a checkout never spends the user's principal on gas. */
                if (accountRole === "USER") {
                    await requireGasSponsored(wallet.toLowerCase());
                }
                const privateKey = decryptPrivateKey(walletRecord.encrypted_private_key!);
                const { provider, rpcEndpoint } = await getRpcProviderForWrite();
                const walletSigner = new ethers.Wallet(privateKey, provider);
                const contract = new ethers.Contract(contractAddress, [`function ${functionSignature}`], walletSigner);
                const fnName = functionSignature.slice(0, functionSignature.indexOf("("));
                const tx = await contract[fnName](...params);
                console.log(`[execute-tx] submitted ${fnName} through ${rpcEndpoint}: ${tx.hash}`);
                txHash = tx.hash;
            }

            if (action === "withdraw") {
                console.log(`[Withdrawal Executed] session: ${wallet}, txHash: ${txHash}, requestId: ${requestId}`);
            }

            return NextResponse.json({ success: true, txHash }, { status: 200 });

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
