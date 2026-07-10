import crypto from "crypto";
import { processPremiumUpgrade } from "./processPremiumUpgrade";

export async function reconcile(supabase: any, limit: number = 300): Promise<{ success: boolean; processedCount: number; results: any[] }> {
    console.log(`[db_updated] Reconciliation worker initiated (Batch limit: ${limit})`);

    /* 0. Operational Circuit Breaker Gate */
    const { data: settings, error: settingsError } = await supabase
        .from("system_settings")
        .select("reconciliation_enabled")
        .eq("id", 1)
        .maybeSingle();

    if (settingsError) {
        console.error(`[db_updated] Failed to query system settings: ${settingsError.message}`);
    }

    if (settings && !settings.reconciliation_enabled) {
        console.error(`[ALERT] Reconciliation worker execution blocked by circuit breaker system flag.`);
        return { success: false, processedCount: 0, results: [] };
    }

    /* 1. Generate unique correlation identifier for this batch run */
    const reconciliationRunId = crypto.randomUUID();

    /* 2. Claim pending/failed sessions with transaction evidence atomically using PLpgSQL */
    const { data: claimedSessions, error } = await supabase
        .rpc("claim_pending_payment_sessions", { batch_size: limit });

    if (error) {
        console.error(`[db_updated] Failed to claim payment sessions: ${error.message}`);
        return { success: false, processedCount: 0, results: [] };
    }

    const remainingLimit = Math.max(0, limit - (claimedSessions?.length || 0));
    let recoverablePermanentSessions: any[] = [];
    if (remainingLimit > 0) {
        const { data: recoverable, error: recoverableError } = await supabase
            .from("payment_sessions")
            .select("*")
            .eq("status", "FAILED_PERMANENTLY")
            .eq("failure_code", "VERIFICATION_FAILED")
            .not("tx_hash", "is", null)
            .or("last_error.ilike.%sender does not match session merchant%,last_error.ilike.%receipt sender does not match session merchant%,last_error.ilike.%transaction sender does not match session owner%,last_error.ilike.%Target is not SubScript contract%")
            .order("updated_at", { ascending: true })
            .limit(remainingLimit);

        if (recoverableError) {
            console.error(`[db_updated] Failed to query recoverable permanent sender mismatches: ${recoverableError.message}`);
        } else {
            recoverablePermanentSessions = recoverable || [];
        }
    }

    const sessions = [
        ...(claimedSessions || []),
        ...recoverablePermanentSessions.filter((session) =>
            !(claimedSessions || []).some((claimed: any) => claimed.session_id === session.session_id)
        )
    ];

    const results: any[] = [];

    if (sessions && sessions.length > 0) {
        console.log(`[db_updated] Claimed ${sessions.length} sessions for verification. Run ID: ${reconciliationRunId}`);
        
        /* Observability queue depth metric log */
        console.log(`[metric] reconciliation_queue_depth: ${sessions.length}`);

        /* Bounded concurrency setup to prevent RPC and Database rate limits */
        const concurrency = 25;
        let activeIndex = 0;

        const processSessionTask = async (session: any, index: number) => {
            /* Correlation tracing logs for incident investigation */
            console.log(`[metric] reconciliation_run: run_id=${reconciliationRunId}, session_id=${session.session_id}, tx_hash=${session.tx_hash}, merchant=${session.merchant_address}`);

            try {
                const res = await processPremiumUpgrade({
                    supabase,
                    txHash: session.tx_hash,
                    sessionId: session.session_id,
                    walletAddress: session.merchant_address,
                    isReconciler: true,
                    requestId: reconciliationRunId
                });

                results[index] = {
                    sessionId: session.session_id,
                    merchantAddress: session.merchant_address,
                    txHash: session.tx_hash,
                    success: res.success,
                    status: res.status,
                    error: res.error || null
                };
            } catch (err: any) {
                console.error(`[db_updated] Error reconciling session ${session.session_id}:`, err);
                
                const newAttempts = (session.processing_attempts || 0) + 1;
                const isPermanent = newAttempts >= 5;

                /* Mark database status as FAILED or FAILED_PERMANENTLY, incrementing attempts */
                await supabase
                    .from("payment_sessions")
                    .update({ 
                        status: isPermanent ? "FAILED_PERMANENTLY" : "FAILED",
                        processing_attempts: newAttempts,
                        last_error: err.message || "Reconciliation worker crash",
                        failure_code: "RECONCILIATION_CRASH",
                        updated_at: new Date().toISOString() 
                    })
                    .eq("session_id", session.session_id);

                /* Metrics & Alerts */
                console.log(`[metric] checkout_sessions_failed: ${session.session_id}, attempts: ${newAttempts}, reason: RECONCILIATION_CRASH`);
                if (isPermanent) {
                    console.error(`[ALERT] FAILED_PERMANENTLY checkout session: ${session.session_id}, reason: RECONCILIATION_CRASH`);
                }

                results[index] = {
                    sessionId: session.session_id,
                    merchantAddress: session.merchant_address,
                    txHash: session.tx_hash,
                    success: false,
                    status: 500,
                    error: err.message || "Unknown error"
                };
            }
        };

        const workers: Promise<void>[] = [];

        const runNext = async (): Promise<void> => {
            while (activeIndex < sessions.length) {
                const index = activeIndex++;
                await processSessionTask(sessions[index], index);
            }
        };

        /* Spawn concurrent workers to drain the queue */
        for (let i = 0; i < Math.min(concurrency, sessions.length); i++) {
            workers.push(runNext());
        }

        await Promise.all(workers);
    } else {
        console.log(`[db_updated] No pending sessions found requiring verification.`);
        console.log(`[metric] reconciliation_queue_depth: 0`);
    }

    const processedCount = sessions ? sessions.length : 0;
    console.log(`[db_updated] Reconciliation worker execution completed. Processed: ${processedCount}`);
    const success = results.every((result) => result.success);

    return {
        success,
        processedCount,
        results
    };
}
