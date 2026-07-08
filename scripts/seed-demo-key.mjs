#!/usr/bin/env node

/*
 * Seed the signup-free demo API key.
 *
 * Creates (idempotently) a shared sandbox merchant and a well-known test-mode API key that
 * is published in the docs, so a developer can make their first API call in under a minute
 * without creating an account. Demo-key requests are test-mode, therefore always sandbox —
 * no on-chain settlement — and the intent route additionally rate-limits the demo merchant.
 *
 * Usage: node --env-file=.env.local scripts/seed-demo-key.mjs
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const DEMO_MERCHANT_ADDRESS = "0xdeb0000000000000000000000000000000000001";
const DEMO_SECRET_KEY = "sk_test_demo_subscript_sandbox_2026";
const DEMO_PUBLISHABLE_KEY = "pk_test_demo_subscript_sandbox_2026";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

const hash = crypto.createHash("sha256").update(DEMO_SECRET_KEY).digest("hex");
const hint = `${DEMO_SECRET_KEY.slice(0, 8)}...${DEMO_SECRET_KEY.slice(-4)}`;

const { error: mErr } = await supabase
    .from("merchants")
    .upsert({ wallet_address: DEMO_MERCHANT_ADDRESS, tier: "FREE", updated_at: new Date().toISOString() }, { onConflict: "wallet_address" });
if (mErr) { console.error("merchant upsert failed:", mErr.message); process.exit(1); }

const { data: existing } = await supabase
    .from("api_keys")
    .select("id, revoked")
    .eq("secret_key_hash", hash)
    .maybeSingle();

if (existing) {
    if (existing.revoked) {
        await supabase.from("api_keys").update({ revoked: false }).eq("id", existing.id);
        console.log("Demo key existed but was revoked — re-enabled.");
    } else {
        console.log("Demo key already seeded — nothing to do.");
    }
} else {
    const { error: kErr } = await supabase.from("api_keys").insert({
        wallet_address: DEMO_MERCHANT_ADDRESS,
        publishable_key: DEMO_PUBLISHABLE_KEY,
        secret_key_hash: hash,
        secret_key_hint: hint,
        revoked: false,
    });
    if (kErr) { console.error("api key insert failed:", kErr.message); process.exit(1); }
    console.log("Demo merchant + demo key seeded.");
}
console.log(`Demo merchant: ${DEMO_MERCHANT_ADDRESS}`);
console.log(`Demo secret key (publish in docs): ${DEMO_SECRET_KEY}`);
