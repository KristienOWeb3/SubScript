import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { executeWithRpcFallback } from "@/lib/payments/rpc";

const SBT_ABI = [
    "function mint(address to, uint256 subscriptionId) external returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const SBT_INTERFACE = new ethers.Interface(SBT_ABI);

export async function GET(request: Request) {
    try {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* Verify circuit breaker */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("sbt_minting_enabled")
            .maybeSingle();

        if (settings && settings.sbt_minting_enabled === false) {
            return NextResponse.json({ message: "SBT minting cron is disabled by system settings" }, { status: 200 });
        }

        const workerId = `worker-sbt-mint:${Math.random().toString(36).substring(2, 9)}`;

        /* Claim pending/failed jobs using atomic SKIP LOCKED RPC function */
        const { data: jobs, error: claimError } = await supabase.rpc("claim_pending_sbt_mint_jobs", {
            batch_size: 10,
            p_worker_id: workerId
        });

        if (claimError) {
            console.error("Error claiming SBT mint jobs:", claimError.message);
            return NextResponse.json({ error: claimError.message }, { status: 500 });
        }

        if (!jobs || jobs.length === 0) {
            return NextResponse.json({ message: "No pending SBT mint jobs found" }, { status: 200 });
        }

        const adminPrivateKey = process.env.PRIVATE_KEY;
        const sbtContractAddress = process.env.SBT_CONTRACT_ADDRESS || process.env.NEXT_PUBLIC_SBT_CONTRACT_ADDRESS;

        if (!adminPrivateKey || !sbtContractAddress) {
            /* Release claimed jobs back to PENDING */
            const jobIds = jobs.map((j: any) => j.id);
            await supabase
                .from("sbt_mint_jobs")
                .update({ status: "PENDING", locked_at: null, locked_by: null })
                .in("id", jobIds);

            return NextResponse.json({ error: "Server Configuration Error: PRIVATE_KEY or SBT_CONTRACT_ADDRESS missing" }, { status: 500 });
        }

        const results = [];

        for (const job of jobs) {
            try {
                /* Execute mint call via fallback RPC */
                const mintResult = await executeWithRpcFallback(async (provider) => {
                    const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
                    const contract = new ethers.Contract(sbtContractAddress, SBT_ABI, adminWallet);
                    
                    /* Static call validation */
                    await contract.mint.staticCall(job.recipient_address, job.subscription_id);

                    const tx = await contract.mint(job.recipient_address, job.subscription_id);
                    const receipt = await tx.wait();

                    if (receipt.status !== 1) {
                        throw new Error("On-chain transaction reverted");
                    }

                    /* Extract tokenId from Transfer event logs */
                    let tokenId: bigint | null = null;
                    for (const log of receipt.logs) {
                        if (log.address.toLowerCase() !== sbtContractAddress.toLowerCase()) continue;
                        try {
                            const parsed = SBT_INTERFACE.parseLog({
                                topics: log.topics,
                                data: log.data
                            });
                            if (parsed && parsed.name === "Transfer") {
                                tokenId = BigInt(parsed.args.tokenId);
                                break;
                            }
                        } catch {
                            /* ignore parsing errors on unrelated logs */
                        }
                    }

                    if (tokenId === null) {
                        throw new Error("SBT Transfer event log not found in transaction receipt");
                    }

                    return { tokenId, txHash: tx.hash };
                });

                const tokenIdStr = mintResult.result.tokenId.toString();
                const txHash = mintResult.result.txHash;

                /* Update job record to COMPLETED */
                await supabase
                    .from("sbt_mint_jobs")
                    .update({
                        status: "COMPLETED",
                        locked_at: null,
                        locked_by: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", job.id);

                /* Update sbt_token_id on subscriptions table */
                await supabase
                    .from("subscriptions")
                    .update({
                        sbt_token_id: tokenIdStr,
                        updated_at: new Date().toISOString()
                    })
                    .eq("subscription_id", job.subscription_id);

                /* Log audit event */
                await supabase
                    .from("audit_events")
                    .insert({
                        actor: "SYSTEM_CRON_WORKER",
                        action: "SBT_MINT_COMPLETED",
                        resource_type: "SUBSCRIPTION",
                        resource_id: job.subscription_id.toString(),
                        metadata: {
                            job_id: job.id,
                            token_id: tokenIdStr,
                            recipient: job.recipient_address,
                            tx_hash: txHash
                        }
                    });

                results.push({ jobId: job.id, success: true, tokenId: tokenIdStr, txHash });

            } catch (jobError: any) {
                console.error(`SBT mint job ${job.id} failed:`, jobError.message || jobError);

                const status = job.attempts >= 5 ? "FAILED" : "PENDING";
                await supabase
                    .from("sbt_mint_jobs")
                    .update({
                        status,
                        last_error: jobError.message || String(jobError),
                        locked_at: null,
                        locked_by: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", job.id);

                results.push({ jobId: job.id, success: false, error: jobError.message || String(jobError) });
            }
        }

        return NextResponse.json({ results }, { status: 200 });

    } catch (error: any) {
        console.error("Cron sbt-mint error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
