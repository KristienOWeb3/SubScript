/* Boot-time configuration self-check.
 *
 * Surfaces deployment misconfigurations that otherwise stay invisible until a user hits them.
 * The motivating case (a P0): legacy embedded-wallet custody with no funded sponsor wallet, which
 * makes every sponsored user action (subscribe / pay / cancel) fail closed with `sponsor_disabled`.
 *
 * We warn loudly (console.warn → Vercel logs) rather than crash the process: many surfaces (landing,
 * docs, merchant reads) work fine without gas sponsorship, so taking the whole deployment down would
 * be worse than the misconfiguration itself. Runs once at startup from instrumentation.register().
 *
 * Env checks are intentionally inline/light (no ethers/pg/Circle-SDK imports at boot); they mirror
 * shouldProvisionCircleWallet() and isGasSponsorshipEnabled() — keep them in sync if those change.
 * The WALLET_PROVIDER reading is shared with provision.ts via walletProvider.ts so the two can't
 * drift on normalization.
 */
import { isUsableCircleApiKey } from "@/lib/circle/client";
import { isCircleProviderSelected } from "@/lib/custody/walletProvider";

export function checkRuntimeConfig(): string[] {
    const warnings: string[] = [];

    const wantsCircle = isCircleProviderSelected();
    const circleConfigured =
        isUsableCircleApiKey(process.env.CIRCLE_API_KEY) &&
        !!process.env.CIRCLE_ENTITY_SECRET?.trim() &&
        !!process.env.CIRCLE_ARC_WALLET_SET_ID?.trim();
    const sponsorEnabled = !!process.env.SPONSOR_PRIVATE_KEY;

    if (wantsCircle && !circleConfigured) {
        warnings.push(
            "WALLET_PROVIDER=circle but Circle custody is not fully configured " +
            "(need CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ARC_WALLET_SET_ID). New signups will FAIL " +
            "at wallet provisioning until these are set."
        );
    }

    if (!sponsorEnabled) {
        if (!wantsCircle) {
            warnings.push(
                "SPONSOR_PRIVATE_KEY is unset and WALLET_PROVIDER is legacy — sponsored user actions " +
                "(subscribe / pay / cancel) will fail closed with `sponsor_disabled`. Set SPONSOR_PRIVATE_KEY " +
                "to a funded Arc EOA, or move to Circle custody (Gas Station pays gas)."
            );
        } else {
            warnings.push(
                "SPONSOR_PRIVATE_KEY is unset. New Circle wallets are covered by Gas Station, but any " +
                "pre-existing legacy wallets can no longer be sponsored for gas."
            );
        }
    }

    for (const w of warnings) {
        console.warn(`[config-check] ${w}`);
    }
    return warnings;
}
