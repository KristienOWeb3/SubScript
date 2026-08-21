import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { getWalletCustody, deterministicIdempotencyKey, cancelSubscriptionIdempotencyKey } from "@/lib/custody";
import { getSessionWallet } from "@/lib/auth";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import {
    CONFIDENTIAL_CONTRACT_ADDRESS,
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";
import { PREMIUM_PRICE } from "@/lib/payments/constants";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { assertProviderRateLimit, ProviderRateLimitError } from "@/lib/providerRateLimit";
import { createDmAndNotify } from "@/lib/dms/notifications";
import { assertWithdrawalAllowed, WithdrawalHeldError } from "@/lib/admin/withdrawalHolds";
import { assertAccountNotHalted, AccountHaltError } from "@/lib/accountHalt";

/* Custody execution waits for on-chain confirmation (required for Circle SCA wallets,
   whose tx hash only exists once confirmed), so give the route enough headroom. */
export const maxDuration = 120;

const isProdEnv = process.env.NODE_ENV === "production";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/* Ceiling on sponsored USDC sends per wallet per hour. SubScript pays the gas for each one, so this
   bounds our exposure by transaction count — the thing that actually costs us — while leaving the
   amount uncapped, since the funds belong to the merchant. Comfortably above any real payout
   cadence, and it covers the Premium payment that shares this action. */
const SPONSORED_TRANSFERS_PER_HOUR = 10;
const USER_SPONSORED_ACTIONS = new Set(["approveUsdc", "transferUsdc"]);
const MERCHANT_SPONSORED_ACTIONS = new Set([
    "approveUsdc",
    "transferUsdc",
    "createPremiumSubscription",
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

        const FINANCIAL_ACTIONS = new Set(["transferUsdc", "createPremiumSubscription", "withdraw"]);
        const effectiveRequestId = request.headers.get("x-request-id") || requestId;

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
                if (!to || typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
                    return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
                }
                const normalizedTo = to.toLowerCase();

                /* This action used to accept PREMIUM_PAYMENT_RECIPIENT_ADDRESS and nothing else,
                   because it was written for one job: paying SubScript for Premium with sponsored
                   gas. The dashboard's Send dialog routes through here too, so every merchant send
                   to a real destination was refused with "Transfer only to SubScript premium payout
                   account" — the feature only ever worked for external wallets, which skip this
                   route and pay their own gas.
                   The recipient allow-list is gone, but the reason it existed is not: SubScript pays
                   the gas for every call here, so the cost scales with the NUMBER of transfers, not
                   their value. An unbounded sponsored send is a drain on the sponsor wallet, and a
                   dry sponsor breaks every sponsored action, not just sends. So the bound moved from
                   "who you may pay" to "how often we will pay for it", which is the quantity that
                   actually costs us. Value is deliberately uncapped: it is the merchant's money. */
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
                finalArgs = [to, transferAmount];
                break;
            }
            case "createPremiumSubscription": {
                const PREMIUM_PERIOD_SECONDS = 2592000;
                const { merchant } = args;
                if (!merchant || typeof merchant !== "string") {
                    return NextResponse.json({ error: "Invalid premium subscription recipient" }, { status: 400 });
                }
                if (merchant.toLowerCase() !== PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
                    return NextResponse.json({ error: "Unauthorized subscription recipient. Sponsored subscriptions can only target the SubScript premium account." }, { status: 400 });
                }

                contractAddress = STANDARD_CONTRACT_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                functionName = "createSubscription";
                finalArgs = [merchant, BigInt(PREMIUM_PRICE), BigInt(PREMIUM_PERIOD_SECONDS)];
                durableIdempotencyKey = deterministicIdempotencyKey(`premium-sub:${wallet.toLowerCase()}:${requestId}`);
                break;
            }
            case "withdraw": {
                contractAddress = SUBSCRIPT_ROUTER_ADDRESS;
                contractAbi = SUBSCRIPT_ABI;
                const withdrawTarget = args?.to;
                if (withdrawTarget === undefined || withdrawTarget === null || withdrawTarget === "") {
                    functionName = "withdraw";
                    finalArgs = [];
                } else if (typeof withdrawTarget === "string" && /^0x[0-9a-fA-F]{40}$/.test(withdrawTarget)) {
                    functionName = "withdrawTo";
                    finalArgs = [withdrawTarget];
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
            case "commitViewKey": {
                const { commitment } = args;
                if (!commitment || typeof commitment !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(commitment)) {
                    return NextResponse.json({ error: "Invalid commitment. Expected bytes32 hex." }, { status: 400 });
                }

                const { data: merchantDataC, error: merchantErrC } = await supabase
                    .from("merchants")
                    .select("tier")
                    .eq("wallet_address", wallet.toLowerCase())
                    .maybeSingle();

                if (merchantErrC) {
                    console.error(`[execute-tx] Failed to query merchant for view key commit: ${merchantErrC.message}`);
                }
                if (!merchantDataC || merchantDataC.tier === "FREE") {
                    return NextResponse.json({ error: "Forbidden: Premium merchant tier required for view key registration." }, { status: 403 });
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

                /* Gate reveal on premium too. Commit can be made directly on-chain (outside this
                   sponsored endpoint), so a FREE merchant could otherwise complete the premium-only
                   view-key registration at SubScript's expense through this reveal alone. */
                const { data: merchantDataR, error: merchantErrR } = await supabase
                    .from("merchants")
                    .select("tier")
                    .eq("wallet_address", wallet.toLowerCase())
                    .maybeSingle();
                if (merchantErrR) {
                    console.error(`[execute-tx] Failed to query merchant for view key reveal: ${merchantErrR.message}`);
                }
                if (!merchantDataR || merchantDataR.tier === "FREE") {
                    return NextResponse.json({ error: "Forbidden: Premium merchant tier required for view key registration." }, { status: 403 });
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

            /* Sponsorship is a precondition for user-initiated execution: if it cannot be
               confirmed, abort before custody submits anything so the no-funds-touched guarantee
               remains true. Custody is detected server-side — Circle SCA wallets resolve through
               Gas Station with no sponsor transfer; only legacy EOA wallets receive a bounded,
               durably recorded top-up. */
            await requireSponsoredGas({
                wallet: wallet.toLowerCase(),
                action: "execute_tx",
                requestKey: `execute-tx:${requestId}:${action}:${wallet.toLowerCase()}`,
            });

            /* Custody routing: execute through Circle's contract-execution API (Gas Station pays gas). */
            const custody = await getWalletCustody(wallet.toLowerCase());

            const { txHash } = await custody.executeContract({
                contractAddress,
                abi: contractAbi,
                functionName,
                args: finalArgs,
                /* Domain key where the op is terminal/idempotent; otherwise request-scoped
                   (client can reuse x-request-id to make a retry dedupe). */
                idempotencyKey: durableIdempotencyKey ?? deterministicIdempotencyKey(`req:${requestId}:${action}`),
            });
            console.log(`[execute-tx] executed ${functionName} via ${custody.kind} custody: ${txHash}`);

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
