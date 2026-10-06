import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateHistory } from "../history.ts";
import { sentToLabel } from "../../transactionLabels.ts";

const address = "0x725d56151ceac9ead625241d13b8307b22eddb10";
const hash = `0x${"ab".repeat(32)}`;
const transfer = { id: "optimistic-send", txHash: hash, incoming: false, counterpartyAddress: address, amountUsdc: 0.01 };

test("one transfer has one row while optimistic, DM and indexer records overlap", () => {
    const confirmed = { ...transfer, id: "dm-1", txHash: hash.toUpperCase(), counterpartyAddress: address.toUpperCase() };
    assert.deepEqual(deduplicateHistory([transfer, confirmed, { ...transfer, id: "dep-1" }]), [confirmed]);
    assert.deepEqual(deduplicateHistory([confirmed, transfer]), [confirmed]);
});

test("repeated actual sends and distinct batch recipients remain visible", () => {
    const rows = [transfer, { ...transfer, id: "second", txHash: `0x${"cd".repeat(32)}` },
        { ...transfer, id: "batch-recipient", counterpartyAddress: `0x${"11".repeat(20)}` },
        { ...transfer, id: "incoming", incoming: true }, { ...transfer, id: "batch-amount", amountUsdc: 2 }];
    assert.equal(deduplicateHistory(rows).length, rows.length);
});

test("hashless pending sends stay separate and duplicate IDs are removed", () => {
    const rows = [{ ...transfer, txHash: null }, { ...transfer, txHash: null, id: "pending-2" }];
    assert.deepEqual(deduplicateHistory([...rows, rows[0]]), rows);
});

test("case-sensitive destination addresses are preserved", () => {
    assert.equal(deduplicateHistory([
        { ...transfer, counterpartyAddress: "AbCd" },
        { ...transfer, id: "other-recipient", counterpartyAddress: "abcd" },
    ]).length, 2);
});

test("external wallet and alias sends have consistent directional labels", () => {
    assert.equal(sentToLabel(address, address), "Sent to 0x725d...db10");
    assert.equal(sentToLabel("0x725d...db10", address), "Sent to 0x725d...db10");
    assert.equal(sentToLabel("kristienoweb3.sub", address), "Sent to @kristienoweb3.sub");
    assert.equal(sentToLabel("@kristienoweb3.sub", address), "Sent to @kristienoweb3.sub");
    assert.equal(sentToLabel("Recipient", address), "Sent to 0x725d...db10");
    assert.equal(sentToLabel(), "Sent USDC");
});
