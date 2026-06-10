import { ethers } from "ethers";

/**
 * Normalizes an EVM address string.
 */
export function normalizeAddress(address: string): string {
    if (!address || typeof address !== "string") {
        throw new Error("Invalid address format");
    }
    const trimmed = address.trim();
    if (!ethers.isAddress(trimmed)) {
        throw new Error(`Invalid EVM address: ${address}`);
    }
    return trimmed.toLowerCase();
}

/**
 * Converts a hex address string to a raw Buffer for bytea columns in Prisma.
 */
export function addressToBuffer(address: string): Buffer {
    const normalized = normalizeAddress(address);
    return Buffer.from(normalized.substring(2), "hex");
}

/**
 * Converts a raw binary Buffer or Uint8Array back to a standard checksummed hex address string.
 */
export function bufferToAddress(buffer: Buffer | Uint8Array): string {
    if (!buffer) return "";
    const hex = Buffer.from(buffer).toString("hex");
    return ethers.getAddress("0x" + hex);
}
