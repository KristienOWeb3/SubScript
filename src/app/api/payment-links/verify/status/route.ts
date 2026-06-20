import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const txHash = searchParams.get("txHash")?.toLowerCase();

    if (!txHash) {
        return NextResponse.json({ error: "Missing txHash query parameter" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ error: "Server Configuration Error" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let active = true;

            const sendEvent = (event: string, data: any) => {
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                } catch {
                    active = false;
                }
            };

            /* Loop for streaming updates every 1.5 seconds */
            let attempts = 0;
            const maxAttempts = 60;

            while (active && attempts < maxAttempts) {
                attempts++;
                try {
                    const { data: tv, error } = await supabase
                        .from("transaction_verifications")
                        .select("*")
                        .eq("tx_hash", txHash)
                        .maybeSingle();

                    if (error) throw error;

                    if (tv) {
                        sendEvent("status", {
                            status: tv.status,
                            confirmations: tv.confirmations,
                            errorMessage: tv.error_message,
                            message: `Status: ${tv.status} (${tv.confirmations} confirmations)`
                        });

                        if (tv.status === "CONFIRMED" || tv.status === "FAILED") {
                            active = false;
                            break;
                        }
                    } else {
                        sendEvent("status", {
                            status: "SUBMITTED",
                            confirmations: 0,
                            message: "Submitted to network..."
                        });
                    }
                } catch (err: any) {
                    sendEvent("error", { message: err.message || "Error reading verification status" });
                    active = false;
                    break;
                }
                await new Promise((res) => setTimeout(res, 1500));
            }
            try {
                controller.close();
            } catch {
                /* ignore closed connection */
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive"
        }
    });
}
