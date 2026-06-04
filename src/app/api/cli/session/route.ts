import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Helper to hash token with SHA-256
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// GET: Validate and atomically consume onboarding token
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Database service client is not configured." },
      { status: 500 }
    );
  }
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Session token parameter is required" }, { status: 400 });
  }

  const tokenHash = hashToken(token);
  const nowStr = new Date().toISOString();

  try {
    // Atomic update to mark used = true and prevent race conditions (Addition 3)
    const { data: sessions, error } = await supabaseAdmin
      .from("cli_sessions")
      .update({ used: true })
      .eq("token_hash", tokenHash)
      .eq("used", false)
      .gt("expires_at", nowStr)
      .select();

    if (error) {
      return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json(
        { error: "Invalid, expired, or already used session token" },
        { status: 400 }
      );
    }

    const session = sessions[0];

    // Trigger async cleanup of expired sessions (Addition 2)
    (async () => {
      try {
        await supabaseAdmin
          .from("cli_sessions")
          .delete()
          .lt("expires_at", nowStr);
      } catch (err: any) {
        console.error("CLI session cleanup error:", err);
      }
    })();

    return NextResponse.json({
      merchantAddress: session.merchant_address,
      tier: session.tier,
      mode: session.mode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

// POST: Generate onboarding session token from merchant dashboard
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Database service client is not configured." },
      { status: 500 }
    );
  }
  try {
    const body = await request.json();
    const { merchantAddress, mode } = body;

    if (!merchantAddress || !mode) {
      return NextResponse.json(
        { error: "Missing required parameters: merchantAddress, mode" },
        { status: 400 }
      );
    }

    if (mode !== "standard" && mode !== "zk-routed") {
      return NextResponse.json(
        { error: "Invalid mode. Must be 'standard' or 'zk-routed'" },
        { status: 400 }
      );
    }

    // Verify merchant and fetch tier
    const { data: merchants, error: merchantErr } = await supabaseAdmin
      .from("merchants")
      .select("wallet_address, tier")
      .eq("wallet_address", merchantAddress)
      .maybeSingle();

    if (merchantErr) {
      return NextResponse.json({ error: `Database error: ${merchantErr.message}` }, { status: 500 });
    }

    if (!merchants) {
      return NextResponse.json({ error: "Merchant account does not exist" }, { status: 404 });
    }

    const tier = merchants.tier;

    // Enforce tier requirements
    if (mode === "zk-routed" && tier < 1) {
      return NextResponse.json(
        { error: "ZK-routed mode requires Tier 1 Premium merchant tier" },
        { status: 403 }
      );
    }

    // Generate raw secure token
    const rawToken = "sub_cli_" + crypto.randomBytes(24).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes (Phase 2)

    // Insert session hash with algorithm metadata (Addition 1)
    const { error: insertErr } = await supabaseAdmin
      .from("cli_sessions")
      .insert({
        token_hash: tokenHash,
        hash_version: "sha256",
        merchant_address: merchantAddress,
        tier: tier,
        mode: mode,
        expires_at: expiresAt,
        used: false,
      });

    if (insertErr) {
      return NextResponse.json(
        { error: `Failed to store session: ${insertErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      token: rawToken,
      expiresAt: expiresAt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
