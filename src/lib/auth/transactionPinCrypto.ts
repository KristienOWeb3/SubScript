import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { validTransactionPin } from "./transactionPinFormat";
export { validTransactionPin } from "./transactionPinFormat";

export function canonicalJson(value: unknown): string {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function authorizationDigest(value: unknown) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function derive(pin: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => scrypt(pin, salt, 32,
        { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, result) => error ? reject(error) : resolve(result)));
}

export async function hashTransactionPin(pin: string) {
    if (!validTransactionPin(pin)) throw new Error("Choose a six-digit PIN without a repeated or sequential pattern.");
    const salt = randomBytes(32).toString("hex");
    return { salt, hash: (await derive(pin, salt)).toString("hex") };
}

export async function verifyTransactionPinHash(pin: unknown, salt: string, hash: string) {
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return false;
    const actual = await derive(pin, salt);
    const expected = Buffer.from(hash, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
