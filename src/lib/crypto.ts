import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
// Derive a 32-byte key from our WALLET_ENCRYPTION_KEY environment variable or a secure fallback
const ENCRYPTION_KEY = crypto.scryptSync(
    process.env.WALLET_ENCRYPTION_KEY || "subscript_secure_wallet_encryption_secret_key_2026",
    "salt",
    32
);

export function encryptPrivateKey(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptPrivateKey(encryptedText: string): string {
    const [ivHex, encryptedHex] = encryptedText.split(":");
    if (!ivHex || !encryptedHex) {
        throw new Error("Invalid encrypted format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
