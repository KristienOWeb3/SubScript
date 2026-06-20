import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
    const secret = process.env.WALLET_ENCRYPTION_KEY;
    if (!secret) {
        throw new Error("WALLET_ENCRYPTION_KEY must be configured before creating or accessing server-managed wallets");
    }
    return crypto.scryptSync(secret, "subscript:wallet:v2", 32);
}

export function encryptPrivateKey(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `v2:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
}

export function decryptPrivateKey(encryptedText: string): string {
    const [version, ivHex, authTagHex, encryptedHex] = encryptedText.split(":");
    if (version !== "v2" || !ivHex || !authTagHex || !encryptedHex) {
        throw new Error("Invalid encrypted format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
