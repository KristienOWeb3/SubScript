import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid submission payload." }, { status: 400 });
    }

    const { email, userType, companyName, useCase, monthlyVolume, honeypot } = body;
    const normalizedUserType = typeof userType === "string" ? userType.trim().toLowerCase() : "";

    if (honeypot) {
      console.warn("Honeypot triggered, ignoring spam submission.");
      return NextResponse.json({ success: true, message: "Spot secured on priority list." });
    }

    if (!normalizedUserType || !ALLOWED_USER_TYPES.includes(normalizedUserType)) {
      return NextResponse.json({ error: "Invalid user type." }, { status: 400 });
    }

    if (!email || typeof email !== "string" || email.trim() === "") {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    if (trimmedEmail.length > 255) {
      return NextResponse.json({ error: "Email is too long." }, { status: 400 });
    }

    const supabase = getSupabase();

    const { data: existing, error: checkError } = await supabase
      .from("waitlist_leads")
      .select("email")
      .eq("email", trimmedEmail)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          success: true,
          isAlreadyRegistered: true,
          message: "You're already on the priority list. We'll keep you posted.",
        },
        { status: 200 }
      );
    }

    if (normalizedUserType === "user") {
      const { error: insertError } = await supabase
        .from("waitlist_leads")
        .insert({
          email: trimmedEmail,
          user_type: "user",
        });

      if (insertError) {
        if (insertError.code === "23505") {
          return NextResponse.json(
            {
              success: true,
              isAlreadyRegistered: true,
              message: "You're already on the priority list. We'll keep you posted.",
            },
            { status: 200 }
          );
        }
        throw insertError;
      }

      return NextResponse.json(
        { success: true, message: "You're on the list. We'll notify you when SubScript launches." },
        { status: 200 }
      );
    }

    if (!companyName || typeof companyName !== "string" || companyName.trim() === "") {
      return NextResponse.json({ error: "Company name is required." }, { status: 400 });
    }
    if (!useCase || typeof useCase !== "string" || useCase.trim() === "") {
      return NextResponse.json({ error: "Use case is required." }, { status: 400 });
    }
    if (!monthlyVolume || typeof monthlyVolume !== "string" || monthlyVolume.trim() === "") {
      return NextResponse.json({ error: "Monthly volume is required." }, { status: 400 });
    }

    const trimmedCompany = companyName.trim();
    const trimmedUseCase = useCase.trim();
    const trimmedVolume = monthlyVolume.trim();

    if (trimmedCompany.length > 255) {
      return NextResponse.json({ error: "Company name is too long." }, { status: 400 });
    }
    if (!ALLOWED_USE_CASES.includes(trimmedUseCase)) {
      return NextResponse.json({ error: "Invalid use case selected." }, { status: 400 });
    }
    if (!ALLOWED_MONTHLY_VOLUMES.includes(trimmedVolume)) {
      return NextResponse.json({ error: "Invalid monthly volume selected." }, { status: 400 });
    }

    const { error: insertError } = await supabase
      .from("waitlist_leads")
      .insert({
        email: trimmedEmail,
        user_type: "enterprise",
        company_name: trimmedCompany,
        use_case: trimmedUseCase,
        monthly_volume: trimmedVolume,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          {
            success: true,
            isAlreadyRegistered: true,
            message: "You're already on the priority list. We'll keep you posted.",
          },
          { status: 200 }
        );
      }
      throw insertError;
    }

    return NextResponse.json(
      { success: true, message: "Spot secured on priority list." },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Waitlist API Error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
