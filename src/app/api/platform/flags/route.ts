import { NextResponse } from "next/server";
import { getPlatformFlags } from "@/lib/platform/flags";

/* Public, unauthenticated view of the runtime flags the CLIENT needs to render correctly.
 *
 * Deliberately narrow: only the two booleans that decide whether a button is shown. Nothing
 * here is a security boundary — the server enforces each pause independently (the Google
 * config route 503s, and external-wallet auth is refused server-side), so this endpoint
 * exists purely to avoid rendering controls that would fail when clicked.
 *
 * Cached at the edge for 30s: this is polled on every sign-in page load, and a pause taking
 * up to half a minute to hide a button is fine given the server already refuses the action.
 */
export async function GET() {
    const flags = await getPlatformFlags();
    return NextResponse.json(
        {
            googleSigninEnabled:
                flags.googleSigninEnabled && process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED === "true",
            externalWalletEnabled: flags.externalWalletEnabled,
        },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
}
