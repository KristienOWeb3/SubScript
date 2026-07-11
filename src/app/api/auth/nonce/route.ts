import { NextResponse } from "next/server";
import crypto from "crypto";
import { setSiweNonceCookie } from "@/lib/authCookies";
import { pgQuery } from "@/lib/serverPg";

/* Nonces are short-lived: long enough for a wallet prompt, short enough that a captured
   signature has a tight replay window even before single-use consumption kills it. */
const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
    try {
        const nonce = crypto.randomBytes(16).toString("hex");

        /* The nonce is a server-side single-use record, not just a cookie echo: verify-signature
           atomically consumes this row, so a signature can be redeemed for a session exactly once.
           Fail closed — without the record the login cannot complete anyway. */
        await pgQuery(
            "insert into siwe_nonces (nonce, expires_at) values ($1, $2)",
            [nonce, new Date(Date.now() + SIWE_NONCE_TTL_MS).toISOString()]
        );

        /* Opportunistic cleanup so abandoned sign-in attempts don't accumulate. Best-effort. */
        await pgQuery("delete from siwe_nonces where expires_at < now()").catch(() => {});

        const response = NextResponse.json({ nonce });

        setSiweNonceCookie(response, request, nonce);

        return response;
    } catch (error) {
        console.error("Nonce generation error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
