import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import {
    generateReceiptId,
    isReceiptId,
    buildConfidentialMemoPayload,
    parseConfidentialMemoPayload,
    getPlatformMasterViewingKey,
} from "../memo.ts";

describe("Arc Confidential Receipts & Viewing Keys", () => {
    it("generates and validates receipt IDs correctly", () => {
        const id = generateReceiptId("Test Invoice");
        assert.equal(isReceiptId(id), true);
        assert.equal(id.startsWith("rcpt-"), true);
        assert.equal(id.length, 37); // rcpt- + 32 hex chars
    });

    it("builds standard memo payload when not shielded", () => {
        const receiptId = generateReceiptId("Test");
        const payload = buildConfidentialMemoPayload({
            receiptId,
            isShielded: false,
        });
        assert.equal(payload, receiptId);
    });

    it("builds confidential memo payload when shielded with view key ref", () => {
        const receiptId = generateReceiptId("Shielded Test");
        const viewKeyHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        const payload = buildConfidentialMemoPayload({
            receiptId,
            merchantViewKeyHash: viewKeyHash,
            isShielded: true,
        });
        assert.equal(payload.startsWith("arc-shielded:"), true);
        assert.equal(payload.includes(receiptId), true);
        assert.equal(payload.includes(":vk-0x12345678"), true);
    });

    it("parses confidential memo payload correctly", () => {
        const receiptId = generateReceiptId("Shielded Parse");
        const viewKeyHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678";
        const payload = buildConfidentialMemoPayload({
            receiptId,
            merchantViewKeyHash: viewKeyHash,
            isShielded: true,
        });

        const parsed = parseConfidentialMemoPayload(payload);
        assert.equal(parsed.isShielded, true);
        assert.equal(parsed.receiptId, receiptId);
        assert.equal(parsed.merchantViewKeyHashRef, "0xabcdef12");
    });

    it("parses raw receiptId string as unshielded", () => {
        const receiptId = generateReceiptId("Raw");
        const parsed = parseConfidentialMemoPayload(receiptId);
        assert.equal(parsed.isShielded, false);
        assert.equal(parsed.receiptId, receiptId);
    });

    it("handles null platform master viewing key by default", () => {
        const key = getPlatformMasterViewingKey();
        assert.equal(key === null || typeof key === "string", true);
    });
});
