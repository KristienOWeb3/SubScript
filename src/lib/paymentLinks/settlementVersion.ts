import { createHash } from "node:crypto";

/* Opaque public polling cursor. The checkout only needs to know that a different settlement
   finalized after the page opened; it must not infer success from the link's aggregate PAID flag. */
export function paymentLinkSettlementVersion(
    paidAt: string | Date | null | undefined,
    verifiedTxHash: string | null | undefined,
): string | null {
    if (!paidAt || !verifiedTxHash) return null;
    const parsed = paidAt instanceof Date ? paidAt : new Date(paidAt);
    if (Number.isNaN(parsed.getTime())) return null;
    const timestamp = parsed.toISOString();
    return createHash("sha256")
        .update(`${timestamp}:${verifiedTxHash.toLowerCase()}`)
        .digest("hex");
}
