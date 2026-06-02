export async function lockPaymentSession(
    supabase: any,
    sessionId: string,
    txHash: string
) {
    /* Atomically update the session status to PROCESSING and set tx_hash */
    /* Only works if the session is currently PENDING and has no tx_hash yet */
    return supabase
        .from("payment_sessions")
        .update({
            tx_hash: txHash,
            status: "PROCESSING",
            updated_at: new Date().toISOString()
        })
        .eq("session_id", sessionId)
        .eq("status", "PENDING")
        .is("tx_hash", null)
        .select()
        .maybeSingle();
}
