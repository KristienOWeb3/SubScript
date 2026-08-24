import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Support Ticket Creation Rate Limiter (2/Day)", () => {
    const MAX_TICKETS_PER_24_HOURS = 2;
    const TICKET_CREATION_WINDOW_MS = 24 * 60 * 60 * 1000;

    function checkRateLimit(wallet, existingTicketCountIn24h, hasActiveTicket) {
        if (hasActiveTicket) {
            return {
                allowed: false,
                reason: "You already have an active support ticket in progress.",
            };
        }

        if (existingTicketCountIn24h >= MAX_TICKETS_PER_24_HOURS) {
            return {
                allowed: false,
                reason: "You have reached the maximum limit of 2 support tickets per 24 hours. Please wait before opening another ticket.",
            };
        }

        return { allowed: true };
    }

    test("allows first ticket when no active tickets exist", () => {
        const result = checkRateLimit("0x123", 0, false);
        assert.equal(result.allowed, true);
    });

    test("allows second ticket when previous ticket was resolved", () => {
        const result = checkRateLimit("0x123", 1, false);
        assert.equal(result.allowed, true);
    });

    test("blocks third ticket within 24 hours (rate limit of 2 max a day)", () => {
        const result = checkRateLimit("0x123", 2, false);
        assert.equal(result.allowed, false);
        assert.match(result.reason, /maximum limit of 2 support tickets per 24 hours/);
    });

    test("blocks ticket if an active ticket is already in progress", () => {
        const result = checkRateLimit("0x123", 0, true);
        assert.equal(result.allowed, false);
        assert.match(result.reason, /active support ticket in progress/);
    });
});
