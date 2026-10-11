import { getSponsorWalletStatus, type SponsorWalletStatus } from "@/lib/sponsor/gas";

// Sponsor health is optional telemetry. A stalled RPC must not hold up core stats.
export async function getAdminSponsorStatus(): Promise<SponsorWalletStatus> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      getSponsorWalletStatus(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Sponsor health timed out")), 3_000);
      }),
    ]);
  } catch {
    return {
      configured: Boolean(process.env.SPONSOR_PRIVATE_KEY),
      address: null,
      balanceUsdc: null,
      topupUsdc: process.env.SPONSOR_GAS_TOPUP_USDC || "0.10",
      estimatedTopupsRemaining: null,
      underfunded: false,
      // Unknown must not be presented as safe to sponsor.
      emergencyStop: true,
      error: "Sponsor health is temporarily unavailable. Refresh to retry.",
    };
  } finally {
    clearTimeout(timer!);
  }
}
