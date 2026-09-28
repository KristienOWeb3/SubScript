import test from "node:test";
import assert from "node:assert/strict";
import { formatTransactionDateTime, formatTransactionSubtitle } from "../format.ts";

test("formatTransactionDateTime formats date as DD/MM/YYYY, HH:mm:ss", () => {
    // 2026-09-21T13:36:03.000Z
    const d = new Date(Date.UTC(2026, 8, 21, 13, 36, 3));
    const formatted = formatTransactionDateTime(d);
    // In local timezone, it should match DD/MM/YYYY, HH:mm:ss structure
    assert.match(formatted, /^\d{2}\/\d{2}\/2026, \d{2}:\d{2}:\d{2}$/);
});

test("formatTransactionSubtitle formats default send on Arc", () => {
    const timestamp = new Date("2026-09-21T13:36:03").getTime();
    const result = formatTransactionSubtitle({
        isCctp: false,
        incoming: false,
        timestamp,
    });
    assert.ok(result.startsWith("USDC Transfer • "));
    assert.ok(!result.includes("Arc Network"));
    assert.ok(!result.includes("Arc network fee"));
    assert.match(result, /^USDC Transfer • \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/);
});

test("formatTransactionSubtitle formats CCTP outbound send with destination chain", () => {
    const timestamp = new Date("2026-09-21T13:36:03").getTime();
    const result = formatTransactionSubtitle({
        isCctp: true,
        incoming: false,
        destName: "Base",
        timestamp,
    });
    assert.ok(result.startsWith("USDC Transfer (Base) • "));
    assert.match(result, /^USDC Transfer \(Base\) • \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/);
});

test("formatTransactionSubtitle formats default deposit on Arc", () => {
    const timestamp = new Date("2026-09-21T13:36:03").getTime();
    const result = formatTransactionSubtitle({
        isCctp: false,
        incoming: true,
        timestamp,
    });
    assert.ok(result.startsWith("USDC Deposit • "));
    assert.ok(!result.includes("Arc Network"));
    assert.match(result, /^USDC Deposit • \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/);
});

test("formatTransactionSubtitle formats CCTP inbound deposit with receival network and routed time", () => {
    const createdTimestamp = new Date("2026-09-21T12:00:00").getTime();
    const routedTimestamp = new Date("2026-09-21T12:55:48").getTime();
    const result = formatTransactionSubtitle({
        isCctp: true,
        incoming: true,
        originName: "Ethereum",
        timestamp: createdTimestamp,
        routedAt: routedTimestamp,
    });
    const expectedRoutedDate = formatTransactionDateTime(routedTimestamp);
    assert.equal(result, `USDC Deposit • Ethereum • ${expectedRoutedDate}`);
});
