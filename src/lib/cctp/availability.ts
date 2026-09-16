import { ARC_CCTP_ENABLED } from "@/lib/contracts/constants";

export const CCTP_UNAVAILABLE_MESSAGE =
  "Cross-chain transfers are not available on Arc Mainnet yet.";

export function assertArcCctpAvailable(): void {
  if (!ARC_CCTP_ENABLED) {
    throw new Error(CCTP_UNAVAILABLE_MESSAGE);
  }
}
