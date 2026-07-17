import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";
import { executeWithRpcFallback } from "@/lib/payments/rpc";
import { getSessionWallet } from "@/lib/auth";

/* Canonical withdrawal events — the ONLY confirmation authority. A successful transaction
   that merely targeted the router proves nothing about who withdrew what to where. */
const ROUTER_WITHDRAWAL_INTERFACE = new ethers.Interface([
    "event Withdraw(address indexed merchant, uint256 amount)",
    "event PayoutDelivered(address indexed merchant, address indexed destination, uint256 netAmount, uint256 fee)",
]);

type DecodedWithdrawal = {
    merchant: string;
    destination: string;
    netAmount: bigint;
    fee: bigint;
    grossAmount: bigint;
};

/** Decode the merchant's withdrawal from receipt logs; null when no canonical event exists. */
function decodeWithdrawalEvents(receipt: { logs?: ReadonlyArray<{ address: string; topics: ReadonlyArray<string>; data: string }> }, merchant: string): DecodedWithdrawal | null {
    let withdrawAmount: bigint | null = null;
    let payout: { destination: string; netAmount: bigint; fee: bigint } | null = null;
    for (const log of receipt.logs ?? []) {
        if (log.address.toLowerCase() !== SUBSCRIPT_ROUTER_ADDRESS.toLowerCase()) continue;
        let parsed;
        try {
            parsed = ROUTER_WITHDRAWAL_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
            continue;
        }
        if (!parsed) continue;
        if (parsed.name === "Withdraw" && String(parsed.args.merchant).toLowerCase() === merchant) {
            withdrawAmount = BigInt(parsed.args.amount);
        }
        if (parsed.name === "PayoutDelivered" && String(parsed.args.merchant).toLowerCase() === merchant) {
            payout = {
                destination: String(parsed.args.destination).toLowerCase(),
                netAmount: BigInt(parsed.args.netAmount),
                fee: BigInt(parsed.args.fee),
            };
        }
    }
    if (withdrawAmount === null || !payout) return null;
    return {
        merchant,
        destination: payout.destination,
        netAmount: payout.netAmount,
        fee: payout.fee,
        grossAmount: payout.netAmount + payout.fee,
    };
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body) {
            return NextResponse.json({ error: "Missing payload body" }, { status: 400 });
        }

        const {
            merchantAddress,
            destinationAddress,
            amount,
            commitmentHash,
            nullifierHash,
            txHash,
            proofType = "commit_reveal"
        } = body;

        if (!merchantAddress || !destinationAddress || !commitmentHash || !nullifierHash) {
            return NextResponse.json({ error: "Required fields missing" }, { status: 400 });
        }
        if (!ethers.isAddress(merchantAddress) || !ethers.isAddress(destinationAddress)) {
            return NextResponse.json({ error: "Invalid merchant or destination address" }, { status: 400 });
        }
        if (merchantAddress.toLowerCase() !== wallet) {
            return NextResponse.json({ error: "Forbidden: merchant does not match the authenticated session" }, { status: 403 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Server Configuration Error: Supabase client not initialized." }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Enforce Server-Side Premium Merchant Verification check */
        const { data: merchantData } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", merchantAddress.toLowerCase())
            .maybeSingle();

        if (!merchantData || merchantData.tier !== "PREMIUM") {
            return NextResponse.json({ error: "Forbidden: Private routing operations require an active premium tier." }, { status: 403 });
        }

        /* Determine current status by querying the chain state if a txHash is provided */
        let status = txHash ? "BROADCASTED" : "PENDING";
        let errorMessage: string | null = null;
        let completedAt: string | null = null;
        let usedRpcEndpoint: string | null = null;
        /* Canonical values from the decoded events; request-body amount/destination are only
           advisory input and are OVERRIDDEN whenever event data exists. */
        let auditedDestination = destinationAddress.toLowerCase();
        let auditedAmount = Number(amount);

        if (txHash) {
            try {
                const { result: receipt, rpcEndpoint } = await executeWithRpcFallback(async (provider) => {
                    return await provider.getTransactionReceipt(txHash);
                });

                usedRpcEndpoint = rpcEndpoint;

                if (receipt) {
                    if (receipt.from?.toLowerCase() !== wallet) {
                        return NextResponse.json(
                            { error: "Forbidden: transaction sender does not match the authenticated merchant" },
                            { status: 403 }
                        );
                    }
                    if (receipt.status === 1) {
                        /* A withdrawal is confirmed ONLY by its canonical events: a Withdraw and
                           a PayoutDelivered for THIS merchant, emitted by the router itself. Any
                           successful transaction that merely targeted the router (or an unrelated
                           call wrapped around it) is rejected. */
                        const decoded = decodeWithdrawalEvents(receipt, wallet);
                        if (decoded) {
                            status = "CONFIRMED";
                            completedAt = new Date().toISOString();
                            auditedDestination = decoded.destination;
                            auditedAmount = Number(decoded.grossAmount);
                            console.log(
                                `[metric] withdrawals_successful: ${merchantAddress}, gross: ${decoded.grossAmount}, net: ${decoded.netAmount}, fee: ${decoded.fee}, destination: ${decoded.destination}`,
                            );
                        } else {
                            status = "FAILED";
                            errorMessage = "Transaction contains no Withdraw/PayoutDelivered event for this merchant — not a withdrawal.";
                            console.log(`[metric] withdrawals_failed: ${merchantAddress}, reason: missing_withdrawal_event`);
                        }
                    } else {
                        status = "FAILED";
                        errorMessage = "EVM transaction reverted on-chain.";
                        console.log(`[metric] withdrawals_failed: ${merchantAddress}, reason: tx_reverted`);
                    }
                }
            } catch (rpcErr: any) {
                console.warn(`RPC lookup failed during withdrawal audit: ${rpcErr.message}`);
                /* Keep as BROADCASTED or PENDING so reconciliation can verify it later */
            }
        }

        /* Upsert the withdrawal audit log with idempotency guarantee */
        const { error: dbError } = await supabase
            .from("private_withdrawals")
            .upsert({
                merchant_address: merchantAddress.toLowerCase(),
                destination_address: auditedDestination,
                amount: auditedAmount,
                commitment_hash: commitmentHash,
                nullifier_hash: nullifierHash,
                withdrawal_tx_hash: txHash ? txHash.toLowerCase() : null,
                status,
                error_message: errorMessage,
                completed_at: completedAt,
                proof_type: proofType,
                rpc_endpoint: usedRpcEndpoint,
                updated_at: new Date().toISOString()
            }, { onConflict: "nullifier_hash" });

        if (dbError) {
            console.error(`[db_updated] Failed to record private withdrawal audit: ${dbError.message}`);
            return NextResponse.json({ error: `Database error logging audit: ${dbError.message}` }, { status: 500 });
        }

        return NextResponse.json({ success: true, status }, { status: 200 });

    } catch (err: any) {
        console.error("Audit withdrawal endpoint error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
