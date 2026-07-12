import { createHash } from "node:crypto";

/* Opaque public polling cursor. The checkout only needs to know that a different settlement
   finalized after the page opened; it must not infer success from the link's aggregate PAID flag. */
export function paymentLinkSettlementVersion(
    paidAt: string | Date | null | undefined,
    verifiedTxHash: string | null | undefined,
): string | null {
    if (!paidAt || !verifiedTxHash) return null;
    const timestamp = paidAt instanceof Date ? paidAt.toISOString() : new Date(paidAt).toISOString();
    return createHash("sha256")
        .update(`${timestamp}:${verifiedTxHash.toLowerCase()}`)
        .digest("hex");
}
