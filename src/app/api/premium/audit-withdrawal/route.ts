import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";
import { executeWithRpcFallback } from "@/lib/payments/rpc";

export async function POST(request: Request) {
    try {
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

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Server Configuration Error: Supabase client not initialized." }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Determine current status by querying the chain state if a txHash is provided */
        let status = "PENDING";
        let errorMessage: string | null = null;
        let completedAt: string | null = null;

        if (txHash) {
            try {
                const receipt = await executeWithRpcFallback(async (provider) => {
                    return await provider.getTransactionReceipt(txHash);
                });

                if (receipt) {
                    if (receipt.status === 1) {
                        /* Confirm target of the call is the subscript router proxy */
                        const targetContract = receipt.to ? receipt.to.toLowerCase() : "";
                        if (targetContract === SUBSCRIPT_ROUTER_ADDRESS.toLowerCase()) {
                            status = "SUCCESS";
                            completedAt = new Date().toISOString();
                            console.log(`[metric] withdrawals_successful: ${merchantAddress}, amount: ${amount}`);
                        } else {
                            status = "FAILED_PERMANENTLY_VERIFICATION";
                            errorMessage = `Target contract mismatch. Expected ${SUBSCRIPT_ROUTER_ADDRESS}, got ${receipt.to}`;
                            console.log(`[metric] withdrawals_failed: ${merchantAddress}, reason: target_mismatch`);
                        }
                    } else {
                        status = "FAILED_PERMANENTLY_CONTRACT";
                        errorMessage = "EVM transaction reverted on-chain.";
                        console.log(`[metric] withdrawals_failed: ${merchantAddress}, reason: tx_reverted`);
                    }
                }
            } catch (rpcErr: any) {
                console.warn(`RPC lookup failed during withdrawal audit: ${rpcErr.message}`);
                /* Leave as PENDING to allow reconciliation or background workers to verify */
            }
        }

        /* Upsert the withdrawal audit log to prevent duplicates via unique nullifier_hash constraint */
        const { error: dbError } = await supabase
            .from("private_withdrawals")
            .upsert({
                merchant_address: merchantAddress.toLowerCase(),
                destination_address: destinationAddress.toLowerCase(),
                amount: Number(amount),
                commitment_hash: commitmentHash,
                nullifier_hash: nullifierHash,
                withdrawal_tx_hash: txHash ? txHash.toLowerCase() : null,
                status,
                error_message: errorMessage,
                completed_at: completedAt,
                proof_type: proofType,
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
