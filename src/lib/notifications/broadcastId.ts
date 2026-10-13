import { createHash } from "node:crypto";

/** Both fan-out and lazy bell delivery use the same primary key, including concurrent writes. */
export function broadcastNotificationId(wallet: string, audience: "USER" | "MERCHANT", broadcastId: string) {
    const bytes = createHash("sha256").update(`broadcast:${wallet.toLowerCase()}:${audience}:${broadcastId}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
