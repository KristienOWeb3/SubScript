import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sanitizeInput } from "@/utils/security";

const ipRequestHistory = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const history = ipRequestHistory.get(ip) || [];
  
  const recentHistory = history.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentHistory.length >= RATE_LIMIT_MAX) {
    return true;
  }
  
  recentHistory.push(now);
  ipRequestHistory.set(ip, recentHistory);
  return false;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const ALLOWED_USE_CASES = [
  "AI Agents/Tooling",
  "Global SaaS",
  "API Provider",
  "Web3 Infrastructure"
];

const ALLOWED_MONTHLY_VOLUMES = [
  "< $10k",
  "$10k - $50k",
  "$50k+"
];

const ALLOWED_USER_TYPES = ["user", "enterprise"];

export async function POST(request: Request) {
    try {
        const ipHeader = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown-ip";
        const ip = ipHeader.split(",")[0]?.trim() || "unknown-ip";
        if (ip !== "unknown-ip" && isRateLimited(ip)) {
            return NextResponse.json(
                { error: "Too many requests. Please try again later." },
                { status: 429 }
            );
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Supabase URL or Service Role Key is missing on the server.");
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid submission payload." }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { email, wallet, walletAddress, userType, companyName, useCase, monthlyVolume, honeypot } = sanitizedBody;

        if (honeypot) {
            console.warn("Honeypot triggered, ignoring spam submission.");
            return NextResponse.json({ success: true, message: "Spot secured on priority list." });
        }

        const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
        const walletVal = typeof wallet === "string" ? wallet.trim() : (typeof walletAddress === "string" ? walletAddress.trim() : "");

        if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
            return NextResponse.json({ error: "Invalid email or wallet format." }, { status: 400 });
        }

        if (walletVal && !EVM_ADDRESS_REGEX.test(walletVal)) {
            return NextResponse.json({ error: "Invalid email or wallet format." }, { status: 400 });
        }

        const normalizedUserType = typeof userType === "string" ? userType.trim().toLowerCase() : "";
        if (!normalizedUserType || !ALLOWED_USER_TYPES.includes(normalizedUserType)) {
            return NextResponse.json({ error: "Invalid user type." }, { status: 400 });
        }

        const insertPayload: Record<string, any> = {
            email: trimmedEmail
        };

        if (walletVal && walletVal.trim() !== "") {
            insertPayload.wallet_address = walletVal.toLowerCase();
        } else {
            /* Explicitly send null or omit to prevent Postgres type-casting crashes */
            insertPayload.wallet_address = null;
        }

        try {
            console.log("Sanitized waitlist payload for Supabase:", JSON.stringify(insertPayload));
            const { error: insertError } = await supabase
                .from("waitlist_leads")
                .insert(insertPayload);

            if (insertError) {
                console.error("Supabase waitlist insert error:", insertError);
                return NextResponse.json(
                    { error: insertError.message || "Unknown DB Error", details: insertError },
                    { status: 500 }
                );
            }
        } catch (dbError: any) {
            console.error("Supabase waitlist insert exception:", dbError);
            return NextResponse.json(
                { error: dbError?.message || "Unknown DB Error", details: dbError },
                { status: 500 }
            );
        }

        const successMessage = normalizedUserType === "user"
            ? "You're on the list. We'll notify you when SubScript launches."
            : "Spot secured on priority list.";

        return NextResponse.json(
            { success: true, message: successMessage },
            { status: 200 }
        );

    } catch (error: any) {
        console.error("Waitlist API Error:", error);
        return NextResponse.json(
            { error: error?.message || "Unknown DB Error", details: error },
            { status: 500 }
        );
    }
}
