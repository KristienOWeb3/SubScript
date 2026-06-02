import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { processPremiumUpgrade } from "@/lib/payments/processPremiumUpgrade";

type PremiumUpgradeBody = {
    txHash?: string;
    sessionId?: string;
};

const isTxHash = (value: unknown): value is string =>
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

const isUUID = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

const parseBody = async (request: Request): Promise<PremiumUpgradeBody | null> => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet first." }, { status: 401 });
        }

        const body = await parseBody(request);
        if (!body) {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const { txHash, sessionId } = body;
        if (!txHash || !isTxHash(txHash)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid premium transaction hash" }, { status: 400 });
        }

        if (!sessionId || !isUUID(sessionId)) {
            return NextResponse.json({ error: "Bad Request: Missing or invalid sessionId" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const result = await processPremiumUpgrade({
            supabase,
            txHash,
            sessionId,
            walletAddress
        });

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }

        return NextResponse.json({
            success: true,
            tier: result.tier,
            txHash,
            upgradeTxHash: result.upgradeTxHash,
            message: result.message
        }, { status: 200 });

    } catch (error: any) {
        console.error("Premium upgrade error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
