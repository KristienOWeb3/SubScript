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
import { executeWithRpcFallback } from "@/lib/payments/rpc";

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
    },
    {
        type: "function",
        name: "merchantBalances",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
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

        /* Circuit Breaker Check */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("*")
            .eq("id", 1)
            .maybeSingle();

        if (settings) {
            if (action === "depositAndCommit" && !settings.deposits_enabled) {
                return NextResponse.json({ error: "Service Unavailable: Deposits are currently disabled by circuit breaker." }, { status: 503 });
            }
            if ((action === "withdraw" || action === "withdrawWithProof") && !settings.withdrawals_enabled) {
                return NextResponse.json({ error: "Service Unavailable: Withdrawals are currently disabled by circuit breaker." }, { status: 503 });
            }
            if (action === "verifyAndActivate" && !settings.premium_enabled) {
                return NextResponse.json({ error: "Service Unavailable: Premium activations are currently disabled by circuit breaker." }, { status: 503 });
            }
        }

        const { data: walletRecord, error: walletError } = await supabase
            .from("user_embedded_wallets")
            .select("encrypted_private_key")
            .eq("wallet_address", wallet.toLowerCase())
            .maybeSingle();

        if (walletError || !walletRecord) {
            return NextResponse.json({ error: "Embedded wallet not found for authenticated user" }, { status: 404 });
        }

        const privateKey = decryptPrivateKey(walletRecord.encrypted_private_key);

        let contractAddress = "";
        let contractAbi: any = null;
        let functionName = "";
        let finalArgs: any[] = [];
        let pendingAuditDetails: any = null;

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

                /* Idempotency check: query database to prevent duplicate withdrawals */
                const { data: existingWithdrawal } = await supabase
                    .from("private_withdrawals")
                    .select("withdrawal_tx_hash, status")
                    .eq("nullifier_hash", nullifierHash)
                    .maybeSingle();

                if (existingWithdrawal && (existingWithdrawal.status === "PENDING" || existingWithdrawal.status === "BROADCASTED" || existingWithdrawal.status === "CONFIRMED")) {
                    if (existingWithdrawal.withdrawal_tx_hash) {
                        console.log(`[idempotency] Duplicate withdrawal submission detected for nullifier: ${nullifierHash}. Returning existing tx: ${existingWithdrawal.withdrawal_tx_hash}`);
                        return NextResponse.json({ success: true, txHash: existingWithdrawal.withdrawal_tx_hash }, { status: 200 });
                    }
                }

                /* Verify merchant premium tier on-chain */
                let merchantTier = 0;
                try {
                    await executeWithRpcFallback(async (provider) => {
                        const routerContract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, SUBSCRIPT_ABI, provider);
                        merchantTier = Number(await routerContract.merchantTiers(merchant));
                    });
                } catch (err: any) {
                    console.error("Failed to read merchant tier on-chain:", err);
                }
                if (merchantTier < 1) {
                    return NextResponse.json({ error: "Forbidden: Private routing operations require an active premium tier." }, { status: 403 });
                }

                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "withdrawWithProof";
                finalArgs = [proof, nullifierHash, merchant, target];

                /* Capture details for server-side pre-audit insert */
                pendingAuditDetails = {
                    merchant,
                    target,
                    commitmentHash: proof[1],
                    nullifierHash
                };
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

        /* Server-Side Pre-Audit log generation on the trusted path for embedded wallet withdrawals */
        if (action === "withdrawWithProof" && pendingAuditDetails) {
            try {
                let merchantBalanceBefore = 0;
                let routerBalanceBefore = 0;
                let currentBlockNumber = 0;
                let currentChainId = 0;

                try {
                    await executeWithRpcFallback(async (provider) => {
                        const routerContract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, SUBSCRIPT_ABI, provider);
                        const usdcContract = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, ERC20_ABI, provider);
                        
                        const merchantBal = await routerContract.merchantBalances(pendingAuditDetails.merchant);
                        const routerBal = await usdcContract.balanceOf(SUBSCRIPT_ROUTER_ADDRESS);
                        const block = await provider.getBlockNumber();
                        const network = await provider.getNetwork();
                        
                        merchantBalanceBefore = Number(ethers.formatUnits(merchantBal, 6));
                        routerBalanceBefore = Number(ethers.formatUnits(routerBal, 6));
                        currentBlockNumber = Number(block);
                        currentChainId = Number(network.chainId);
                    });
                } catch (snapErr: any) {
                    console.error("Failed to snapshot balances before withdrawal:", snapErr);
                }

                await supabase
                    .from("private_withdrawals")
                    .upsert({
                        merchant_address: pendingAuditDetails.merchant.toLowerCase(),
                        destination_address: pendingAuditDetails.target.toLowerCase(),
                        amount: merchantBalanceBefore,
                        commitment_hash: pendingAuditDetails.commitmentHash,
                        nullifier_hash: pendingAuditDetails.nullifierHash,
                        status: "PENDING",
                        proof_type: "commit_reveal",
                        merchant_balance_before: merchantBalanceBefore,
                        router_balance_before: routerBalanceBefore,
                        block_number: currentBlockNumber,
                        chain_id: currentChainId,
                        updated_at: new Date().toISOString()
                    }, { onConflict: "nullifier_hash" });
            } catch (dbErr: any) {
                console.error(`[db_updated] Failed to record pre-withdrawal audit log: ${dbErr.message}`);
            }
        }

        try {
            /* Execute contract transaction with RPC redundancy failover wrapper */
            const { result: tx, rpcEndpoint } = await executeWithRpcFallback(async (provider) => {
                const walletSigner = new ethers.Wallet(privateKey, provider);
                const contract = new ethers.Contract(contractAddress, contractAbi, walletSigner);
                const method = contract[functionName] as any;
                if (typeof method !== "function") {
                    throw new Error(`METHOD_NOT_FOUND: ${functionName}`);
                }
                return await method(...finalArgs);
            });

            /* Post-Execution Success Audit Sync */
            if (action === "withdrawWithProof" && pendingAuditDetails) {
                let merchantBalanceAfter = 0;
                let routerBalanceAfter = 0;
                try {
                    await executeWithRpcFallback(async (provider) => {
                        const routerContract = new ethers.Contract(SUBSCRIPT_ROUTER_ADDRESS, SUBSCRIPT_ABI, provider);
                        const usdcContract = new ethers.Contract(USDC_NATIVE_GAS_ADDRESS, ERC20_ABI, provider);
                        
                        const merchantBal = await routerContract.merchantBalances(pendingAuditDetails.merchant);
                        const routerBal = await usdcContract.balanceOf(SUBSCRIPT_ROUTER_ADDRESS);
                        
                        merchantBalanceAfter = Number(ethers.formatUnits(merchantBal, 6));
                        routerBalanceAfter = Number(ethers.formatUnits(routerBal, 6));
                    });
                } catch (snapErr: any) {
                    console.error("Failed to snapshot balances after withdrawal:", snapErr);
                }

                try {
                    await supabase
                        .from("private_withdrawals")
                        .update({
                            withdrawal_tx_hash: tx.hash.toLowerCase(),
                            status: "BROADCASTED",
                            merchant_balance_after: merchantBalanceAfter,
                            router_balance_after: routerBalanceAfter,
                            rpc_endpoint: rpcEndpoint,
                            updated_at: new Date().toISOString()
                        })
                        .eq("nullifier_hash", pendingAuditDetails.nullifierHash);
                } catch (dbErr: any) {
                    console.error(`[db_updated] Failed to update successful withdrawal audit: ${dbErr.message}`);
                }
            }

            return NextResponse.json({ success: true, txHash: tx.hash }, { status: 200 });

        } catch (err: any) {
            console.error("EVM execution error:", err);
            
            const revertReason = err?.reason || err?.info?.error?.message || err?.message || "Transaction execution failed";

            /* Post-Execution Failure Audit Sync */
            if (action === "withdrawWithProof" && pendingAuditDetails) {
                try {
                    await supabase
                        .from("private_withdrawals")
                        .update({
                            status: "FAILED",
                            error_message: revertReason,
                            updated_at: new Date().toISOString()
                        })
                        .eq("nullifier_hash", pendingAuditDetails.nullifierHash);
                } catch (dbErr: any) {
                    console.error(`[db_updated] Failed to record failed withdrawal audit: ${dbErr.message}`);
                }
            }

            return NextResponse.json({ error: `Execution reverted: ${revertReason}` }, { status: 400 });
        }

    } catch (err: any) {
        console.error("Execute TX API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
