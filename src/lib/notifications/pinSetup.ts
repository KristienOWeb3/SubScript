import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { pgMaybeOne } from "@/lib/serverPg";
import { transactionPinRequiredForWallet } from "@/lib/auth/transactionPinEligibility";

export function pinSetupNotificationId(wallet: string, audience: "USER" | "MERCHANT") {
    const bytes = createHash("sha256").update(`pin-setup:${wallet.toLowerCase()}:${audience}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable identity makes concurrent bell loads and dismissed onboarding notices idempotent. */
export async function ensurePinSetupNotification(wallet: string, audience: "USER" | "MERCHANT") {
    const recipientAddress = wallet.toLowerCase();
    const id = pinSetupNotificationId(recipientAddress, audience);
    const required = await transactionPinRequiredForWallet(recipientAddress);
    const configured = required && Boolean(await pgMaybeOne(
        "select wallet_address from transaction_pin_credentials where wallet_address=$1 limit 1", [recipientAddress],
    ));
    if (!required || configured) {
        await prisma.accountNotification.updateMany({ where: { id, recipientAddress, audience, source: { not: "DISMISSED" } }, data: { source: "DISMISSED" } });
        return;
    }
    await prisma.accountNotification.upsert({
        where: { id }, update: {},
        create: {
            id, recipientAddress, audience, source: "SYSTEM",
            title: "Set up your transaction PIN",
            body: "Before your first send, set up a six-digit PIN to protect payments from your SubScript wallet. Your PIN is required to send money and approve spending changes.",
            url: "/dashboard/transaction-pin",
        },
    });
}
