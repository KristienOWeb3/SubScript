import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Simple in-memory rate limiting map (IP -> timestamp array)
const ipRequestHistory = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // Max 5 submissions per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const history = ipRequestHistory.get(ip) || [];
  
  // Filter out requests older than the window
  const recentHistory = history.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentHistory.length >= RATE_LIMIT_MAX) {
    return true;
  }
  
  recentHistory.push(now);
  ipRequestHistory.set(ip, recentHistory);
  return false;
}

// Regex for strict email validation
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Allowed values for validation
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
    // 1. Get client IP and check rate limiting
    const ipHeader = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown-ip";
    const ip = ipHeader.split(",")[0]?.trim() || "unknown-ip";
    if (ip !== "unknown-ip" && isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // 2. Parse request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid submission payload." }, { status: 400 });
    }

    const { email, userType, companyName, useCase, monthlyVolume, honeypot } = body;
    const normalizedUserType = typeof userType === "string" ? userType.trim().toLowerCase() : "";

    // 3. Honeypot check (Spam Protection)
    if (honeypot) {
      console.warn("Honeypot triggered, ignoring spam submission.");
      return NextResponse.json({ success: true, message: "Spot secured on priority list." });
    }

    // 4. Validate userType
    if (!normalizedUserType || !ALLOWED_USER_TYPES.includes(normalizedUserType)) {
      return NextResponse.json({ error: "Invalid user type." }, { status: 400 });
    }

    // 5. Email validation (required for both paths)
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

    // 6. Check for duplicate email
    const existing = await prisma.waitlistLead.findUnique({
      where: { email: trimmedEmail }
    });

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

    // 7. Branch logic based on userType
    if (normalizedUserType === "user") {
      // ── User path: only email required ──
      await prisma.waitlistLead.create({
        data: {
          email: trimmedEmail,
          userType: "user",
        }
      });

      return NextResponse.json(
        { success: true, message: "You're on the list. We'll notify you when SubScript launches." },
        { status: 200 }
      );
    }

    // ── Enterprise path: all fields required ──
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

    await prisma.waitlistLead.create({
      data: {
        email: trimmedEmail,
        userType: "enterprise",
        companyName: trimmedCompany,
        useCase: trimmedUseCase,
        monthlyVolume: trimmedVolume,
      }
    });

    return NextResponse.json(
      { success: true, message: "Spot secured on priority list." },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Waitlist API Error:", error);
    // Handle unique constraint code from database just in case
    if (error?.code === "P2002") {
      return NextResponse.json(
        {
          success: true,
          isAlreadyRegistered: true,
          message: "You're already on the priority list. We'll keep you posted.",
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
