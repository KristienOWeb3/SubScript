import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "ethers";
import crypto from "crypto";
import {
    getWalletCustody,
    deterministicIdempotencyKey,
    cancelSubscriptionIdempotencyKey,
    CirclePaymasterPolicyError,
} from "@/lib/custody";
import { getSessionWallet } from "@/lib/auth";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import {
    CONFIDENTIAL_CONTRACT_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { classifyGasPayer } from "@/lib/sponsor/policy";
import { estimateArcNetworkFeeMicros, chargeNetworkFee } from "@/lib/sponsor/userPaidTransfer";
import { readUsdcBalance } from "@/lib/vault/onchain";
import { assertProviderRateLimit, ProviderRateLimitError } from "@/lib/providerRateLimit";
import { createDmAndNotify } from "@/lib/dms/notifications";
import { assertWithdrawalAllowed, WithdrawalHeldError } from "@/lib/admin/withdrawalHolds";
import { assertAccountNotHalted, AccountHaltError } from "@/lib/accountHalt";
import { bindTxToReceipt } from "@/lib/receipts/binding";
import { authorizeFinancialStepUp } from "@/lib/auth/stepUp";

/* Custody execution waits for on-chain confirmation (required for Circle SCA wallets,
   whose tx hash only exists once confirmed), so give the route enough headroom. */
export const maxDuration = 120;

const isProdEnv = process.env.NODE_ENV === "production";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/* Ceiling on sponsored USDC sends per wallet per hour. SubScript pays the gas for each one, so this
   bounds our exposure by transaction count — the thing that actually costs us — while leaving the
   amount uncapped, since the funds belong to the merchant. Comfortably above any real payout
   cadence without granting an unbounded sponsored-transaction budget. */
const SPONSORED_TRANSFERS_PER_HOUR = 10;
/* Actions each role may invoke through this dispatcher. Being allowlisted here does NOT mean the
   action is gas-sponsored — the gas payer is decided per action by classifyGasPayer (e.g. an
   ordinary transferUsdc is user-paid). */
const USER_ALLOWED_ACTIONS = new Set(["approveUsdc", "transferUsdc"]);
const MERCHANT_ALLOWED_ACTIONS = new Set([
    "approveUsdc",
    "transferUsdc",
    "withdraw",
    "cancelSubscription",
    "configurePayoutDestination",
    "registerViewKey",
    "commitViewKey",
    "revealViewKey"
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
        name: "withdrawTo",
        stateMutability: "nonpayable",
        inputs: [{ name: "_recipient", type: "address" }],
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
    },
    {
        type: "function",
        name: "commitViewKey",
        stateMutability: "nonpayable",
        inputs: [{ name: "_commitment", type: "bytes32" }],
        outputs: []
    },
    {
        type: "function",
        name: "revealViewKey",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_viewKeyHash", type: "bytes32" },
            { name: "_salt", type: "bytes32" }
        ],
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

        /* Legacy accounts (pre role-first signup) have no account_roles row; heal them
           via the shared resolver (explicit role > merchants row > backfilled USER)
           instead of blocking sponsored execution with a "finish signup" dead end. */
        const accountRole = roleData?.role || await resolveAccountRoleWithBackfill(wallet);
        if (!accountRole) {
            return NextResponse.json({ error: "Forbidden: Account role is required for sponsored execution." }, { status: 403 });
        }
        if (accountRole === "USER" && !USER_ALLOWED_ACTIONS.has(action)) {
            return NextResponse.json({ error: "Forbidden: User accounts cannot execute this action." }, { status: 403 });
        }
        if (accountRole === "ENTERPRISE" && !MERCHANT_ALLOWED_ACTIONS.has(action)) {
            return NextResponse.json({ error: "Forbidden: Merchant account action is not allowlisted." }, { status: 403 });
        }

        /* Enforce Mandatory Tier 1 KYC Check: every user or merchant must be at least Tier 1 before making transactions */
        const { getAccountKycTier } = await import("@/lib/kyc/tier");
        const callerTier = await getAccountKycTier(wallet);
        if (callerTier.tier < 1) {
            return NextResponse.json({
                error: "Transactions require Tier 1 verification. Please link and verify your email to continue."
            }, { status: 403 });
        }

        /* Circuit Breaker Check — fail CLOSED for withdrawals. Only the withdraw path consults this
           flag, so the read is scoped to that branch (every other action avoids a wasted round trip).
           Previously the check was nested in `if (settings)`, so a missing settings row or a failed
           read silently allowed withdrawals, defeating the breaker exactly when the DB is unhealthy.
           Withdrawals now proceed only when the row exists and `withdrawals_enabled` is explicitly set. */
        if (action === "withdraw") {
            const { data: settings, error: settingsError } = await supabase
                .from("system_settings")
                .select("withdrawals_enabled")
                .eq("id", 1)
                .maybeSingle();

            if (settingsError || !settings || !settings.withdrawals_enabled) {
                /* Log every trip, distinguishing DB-unhealthy from intentionally-disabled, so a 503
                   is diagnosable. */
                if (settingsError) {
                    console.error(`[execute-tx] Circuit-breaker settings read failed; blocking withdrawal: ${settingsError.message}. requestId: ${requestId}`);
                } else if (!settings) {
                    console.warn(`[execute-tx] Circuit breaker: system_settings row missing; blocking withdrawal. requestId: ${requestId}`);
                } else {
                    console.warn(`[execute-tx] Circuit breaker: withdrawals_enabled is false; blocking withdrawal. requestId: ${requestId}`);
                }
                return NextResponse.json({ error: "Service Unavailable: Withdrawals are currently disabled by circuit breaker." }, { status: 503 });
            }

            /* Per-account hold, checked after the global breaker and before any signing. The
               breaker above is all-or-nothing for the whole platform; this is the one-account
               freeze an operator places during a payout dispute. Handled inline rather than by
               letting WithdrawalHeldError reach the outer catch, which maps everything to 500 —
               a held account must read as a refusal, not a fault. */
            try {
                await assertWithdrawalAllowed(wallet, "MERCHANT");
                /* The account holder's own brake, alongside the operator-placed hold. Same inline
                   handling for the same reason: a hold is a refusal, and the outer catch maps
                   everything to 500. */
                await assertAccountNotHalted(wallet);
            } catch (holdError: any) {
                if (holdError instanceof WithdrawalHeldError) {
                    console.warn(`[execute-tx] Withdrawal hold blocked ${wallet.toLowerCase()}. requestId: ${requestId}`);
                    return NextResponse.json({ error: holdError.message }, { status: holdError.status });
                }
                if (holdError instanceof AccountHaltError) {
                    console.warn(`[execute-tx] Account hold blocked withdrawal from ${wallet.toLowerCase()}. requestId: ${requestId}`);
                    return NextResponse.json({ error: holdError.message }, { status: holdError.status });
                }
                throw holdError;
            }
        }
        if (action === "transferUsdc") {
            try {
                await assertWithdrawalAllowed(wallet, accountRole === "ENTERPRISE" ? "MERCHANT" : "USER");
                await assertAccountNotHalted(wallet);
            } catch (holdError: any) {
                if (holdError instanceof WithdrawalHeldError) {
                    console.warn(`[execute-tx] Withdrawal hold blocked merchant transfer from ${wallet.toLowerCase()}. requestId: ${requestId}`);
                    return NextResponse.json(
                        { error: holdError.message },
                        { status: holdError.status },
                    );
                }
                if (holdError instanceof AccountHaltError) {
                    console.warn(`[execute-tx] Account hold blocked transfer from ${wallet.toLowerCase()}. requestId: ${requestId}`);
                    return NextResponse.json(
                        { error: holdError.message },
                        { status: holdError.status },
                    );
                }
                throw holdError;
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
        if (walletRecord.provider === "external_wallet" || (!walletRecord.encrypted_private_key && !walletRecord.circle_wallet_id)) {
            return NextResponse.json({ error: "Server-sponsored execution is only available for embedded wallet sessions." }, { status: 403 });
        }

        let contractAddress = "";
        let contractAbi: any = null;
        let functionName = "";
        let finalArgs: any[] = [];
        /* Durable idempotency key for actions that are idempotent by identity (e.g. cancel a
           specific, terminal sub — a retried submit after a timed-out response must not double-
           submit). Left null for repeatable actions (approve/withdraw/transfer/subscribe), which
           instead fall back to a request-scoped key so retries dedupe only when the client reuses
           its x-request-id, never blocking a legitimately distinct future operation. */
        let durableIdempotencyKey: string | null = null;
        /* Set only for an ordinary user-paid transfer (transferUsdc); drives the network-fee balance
           guard and the fee-recovery charge below. Left null for sponsored/other actions. */
        let userPaidTransferAmount: bigint | null = null;

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
                contractAbi = ERC20_ABI;
                functionName = "approve";
                finalArgs = [spender, BigInt(amount)];
                break;
            }
            case "transferUsdc": {
                const { to, amount } = args;
                if (!to || typeof to !== "string" || !isAddress(to)) {
                    return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
                }
                const normalizedTo = getAddress(to).toLowerCase();

                /* Validate the caller-supplied EVM destination; authentication, custody,
                   ownership, and amount validation are enforced above. */
                if (normalizedTo === ZERO_ADDRESS) {
                    return NextResponse.json({ error: "Recipient cannot be the zero address." }, { status: 400 });
                }
                if (normalizedTo === wallet.toLowerCase()) {
                    return NextResponse.json({ error: "Recipient cannot be your own wallet address." }, { status: 400 });
                }

                let transferAmount: bigint;
                try {
                    transferAmount = BigInt(amount);
                } catch {
                    return NextResponse.json({ error: "Invalid transfer amount" }, { status: 400 });
                }
                if (transferAmount <= 0n) {
                    return NextResponse.json({ error: "Transfer amount must be greater than zero." }, { status: 400 });
                }

                try {
                    assertProviderRateLimit({
                        provider: "sponsored-usdc-transfer",
                        key: wallet.toLowerCase(),
                        limit: SPONSORED_TRANSFERS_PER_HOUR,
                        windowMs: 60 * 60 * 1000,
                    });
                } catch (limitError: any) {
                    const retryAfter = limitError instanceof ProviderRateLimitError ? limitError.retryAfterSeconds : 3600;
                    console.warn(`[execute-tx] Sponsored transfer rate limit hit by ${wallet.toLowerCase()}. requestId: ${requestId}`);
                    return NextResponse.json(
                        { error: `Too many sponsored transfers. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
                        { status: 429, headers: { "Retry-After": String(retryAfter) } },
                    );
                }

                contractAddress = USDC_NATIVE_GAS_ADDRESS;
                contractAbi = ERC20_ABI;
                functionName = "transfer";
                finalArgs = [getAddress(to), transferAmount];
                userPaidTransferAmount = transferAmount;
                break;
            }
            case "withdraw": {
                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                const withdrawTarget = args?.to;
                if (withdrawTarget === undefined || withdrawTarget === null || withdrawTarget === "") {
                    functionName = "withdraw";
                    finalArgs = [];
                } else if (typeof withdrawTarget === "string" && isAddress(withdrawTarget)) {
                    const normalizedTarget = getAddress(withdrawTarget).toLowerCase();
                    if (normalizedTarget === ZERO_ADDRESS) {
                        return NextResponse.json({ error: "Withdrawal recipient cannot be the zero address." }, { status: 400 });
                    }

                    const { data: merchant, error: merchantError } = await supabase
                        .from("merchants")
                        .select("payout_destination")
                        .eq("wallet_address", wallet.toLowerCase())
                        .maybeSingle();
                    if (merchantError) {
                        console.error(`[execute-tx] Failed to verify payout destination: ${merchantError.message}`);
                        return NextResponse.json({ error: "Unable to verify withdrawal recipient" }, { status: 503 });
                    }
                    const registeredPayout = typeof merchant?.payout_destination === "string" && isAddress(merchant.payout_destination)
                        ? getAddress(merchant.payout_destination).toLowerCase()
                        : null;
                    const isPreauthorizedDestination = normalizedTarget === wallet.toLowerCase()
                        || normalizedTarget === registeredPayout;
                    if (!isPreauthorizedDestination) {
                        const stepUp = await authorizeFinancialStepUp({
                            headers: request.headers,
                            wallet,
                            binding: { action: "withdrawTo", recipient: normalizedTarget },
                        });
                        if (!stepUp.ok) {
                            return NextResponse.json({ error: stepUp.error }, { status: stepUp.status });
                        }
                    }
                    functionName = "withdrawTo";
                    finalArgs = [getAddress(withdrawTarget)];
                } else {
                    return NextResponse.json({ error: "Invalid withdrawal recipient address" }, { status: 400 });
                }
                durableIdempotencyKey = deterministicIdempotencyKey(`withdraw:${wallet.toLowerCase()}:${requestId}`);
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
                /* Terminal, single-use subId → safe to dedupe across any retry. Shared with the
                   cancelFromEmbedded path via the custody helper so both derive the identical key. */
                durableIdempotencyKey = cancelSubscriptionIdempotencyKey(STANDARD_CONTRACT_ADDRESS, subscriptionId);
                break;
            }
            case "configurePayoutDestination": {
                const { payoutAddress } = args;
                if (!payoutAddress || typeof payoutAddress !== "string" || !isAddress(payoutAddress)) {
                    return NextResponse.json({ error: "Invalid payout address. Address must be a valid 0x hex format." }, { status: 400 });
                }
                const normalizedPayout = getAddress(payoutAddress).toLowerCase();
                if (normalizedPayout === ZERO_ADDRESS) {
                    return NextResponse.json({ error: "Payout address cannot be the zero address." }, { status: 400 });
                }

                const stepUp = await authorizeFinancialStepUp({
                    headers: request.headers,
                    wallet,
                    binding: { action: "configurePayoutDestination", recipient: normalizedPayout },
                });
                if (!stepUp.ok) {
                    return NextResponse.json({ error: stepUp.error }, { status: stepUp.status });
                }

                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "configurePayoutDestination";
                finalArgs = [getAddress(payoutAddress)];
                break;
            }
            case "registerViewKey": {
                const { viewKeyHash } = args;
                if (!viewKeyHash || typeof viewKeyHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(viewKeyHash)) {
                    return NextResponse.json({ error: "Invalid view key hash. Expected bytes32 hex." }, { status: 400 });
                }

                contractAddress = CONFIDENTIAL_CONTRACT_ADDRESS;
                contractAbi = CONFIDENTIAL_ABI;
                functionName = "registerViewKey";
                finalArgs = [viewKeyHash];
                break;
            }
            case "commitViewKey": {
                const { commitment } = args;
                if (!commitment || typeof commitment !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(commitment)) {
                    return NextResponse.json({ error: "Invalid commitment. Expected bytes32 hex." }, { status: 400 });
                }

                contractAddress = CONFIDENTIAL_CONTRACT_ADDRESS;
                contractAbi = CONFIDENTIAL_ABI;
                functionName = "commitViewKey";
                finalArgs = [commitment];
                break;
            }
            case "revealViewKey": {
                const { viewKeyHash: revealHash, salt } = args;
                if (!revealHash || typeof revealHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(revealHash)) {
                    return NextResponse.json({ error: "Invalid view key hash. Expected bytes32 hex." }, { status: 400 });
                }
                if (!salt || typeof salt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(salt)) {
                    return NextResponse.json({ error: "Invalid salt. Expected bytes32 hex." }, { status: 400 });
                }

                contractAddress = CONFIDENTIAL_CONTRACT_ADDRESS;
                contractAbi = CONFIDENTIAL_ABI;
                functionName = "revealViewKey";
                finalArgs = [revealHash, salt];
                break;
            }
            default:
                return NextResponse.json({ error: `Unsupported execution action: ${action}` }, { status: 400 });
        }

        try {
            if (action === "withdraw") {
                console.log(`[Withdrawal Requested] session: ${wallet}, action: ${action}, target: ${wallet}, requestId: ${requestId}`);
            }

            /* Classify who pays gas from the concrete action, server-side (never a client flag). This
               pass narrows only the ordinary peer transfer (transferUsdc) to USER-PAID: it skips
               sponsorship and recovers the Arc network fee from the sender. Every other action keeps
               its existing sponsored behavior and is migrated in a later pass. */
            const gasDecision = classifyGasPayer({ kind: "execute_action", action });
            const isUserPaidTransfer = action === "transferUsdc" && userPaidTransferAmount !== null && !gasDecision.sponsored;
            let networkFeeMicros = BigInt(0);
            let networkFeeUsdc = "0";
            if (isUserPaidTransfer) {
                const fee = await estimateArcNetworkFeeMicros(1);
                networkFeeMicros = fee.feeMicros;
                networkFeeUsdc = fee.feeUsdc;
                const bal = await readUsdcBalance(wallet.toLowerCase()).catch(() => null);
                if (bal !== null && bal < (userPaidTransferAmount as bigint) + fee.feeMicros) {
                    return NextResponse.json({
                        error: `Insufficient balance for this transfer plus the ~${fee.feeUsdc} USDC Arc network fee.`,
                        code: "INSUFFICIENT_BALANCE_FOR_FEE",
                    }, { status: 422 });
                }
            } else {
                /* Sponsorship is a precondition for sponsored execution: if it cannot be confirmed,
                   abort before custody submits anything so the no-funds-touched guarantee holds.
                   Custody is detected server-side — Circle SCA wallets resolve through Gas Station
                   with no sponsor transfer; only legacy EOA wallets get a bounded, durable top-up. */
                await requireSponsoredGas({
                    wallet: wallet.toLowerCase(),
                    action: "execute_tx",
                    requestKey: `execute-tx:${requestId}:${action}:${wallet.toLowerCase()}`,
                });
            }

            /* Custody routing: execute through Circle's contract-execution API. */
            const custody = await getWalletCustody(wallet.toLowerCase());

            const { txHash } = await custody.executeContract({
                contractAddress,
                abi: contractAbi,
                functionName,
                args: finalArgs,
                /* Domain key where the op is terminal/idempotent; otherwise request-scoped
                   (client can reuse x-request-id to make a retry dedupe). */
                idempotencyKey: durableIdempotencyKey ?? deterministicIdempotencyKey(`req:${requestId}:${action}`),
                gasPayer: isUserPaidTransfer ? "wallet" : "platform",
            });
            console.log(`[execute-tx] executed ${functionName} via ${custody.kind} custody: ${txHash}`);

            /* User-paid peer transfer: recover the Arc network fee from the sender after it settled.
               Logged-not-thrown on failure inside chargeNetworkFee — the transfer is irreversible. */
            if (isUserPaidTransfer && networkFeeMicros > BigInt(0)) {
                await chargeNetworkFee({
                    wallet: wallet.toLowerCase(),
                    feeMicros: networkFeeMicros,
                    requestKey: `execute-tx-fee:${requestId}:${wallet.toLowerCase()}`,
                });
            }

            let boundReceiptId: string | undefined;
            try {
                if (action === "transferUsdc" && args.to && args.amount) {
                    const bound = await bindTxToReceipt(supabase, {
                        txHash,
                        payerAddress: wallet,
                        merchantAddress: String(args.to),
                        amountUsdc: args.amount,
                        title: "USDC Transfer",
                        isShielded: body.isShielded || false,
                    });
                    boundReceiptId = bound.receiptId;
                }
            } catch (bindingErr) {
                console.error(`[execute-tx] Non-fatal receipt binding error for tx ${txHash}:`, bindingErr);
            }

            if (action === "withdraw") {
                console.log(`[Withdrawal Executed] session: ${wallet}, txHash: ${txHash}, requestId: ${requestId}`);
                await createDmAndNotify({
                    senderAddress: wallet,
                    receiverAddress: wallet,
                    messageType: "WITHDRAWAL",
                    title: "Sent from balance to wallet",
                    description: `Withdrew USDC balance to external wallet address`,
                    txHash,
                    dedupeKey: `withdraw-activity:${txHash}`,
                }).catch((err) => console.error("Failed to record withdrawal DM:", err));
            }

            return NextResponse.json({ success: true, txHash, receiptId: boundReceiptId, networkFeeUsdc }, { status: 200 });

        } catch (err: any) {
            console.error("EVM execution error:", err);
            
            if (err instanceof CirclePaymasterPolicyError || err?.code === "CIRCLE_PAYMASTER_POLICY_REQUIRED") {
                return NextResponse.json({
                    error: err.message,
                    code: "CIRCLE_PAYMASTER_POLICY_REQUIRED",
                    requestId,
                }, { status: 503 });
            }

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
