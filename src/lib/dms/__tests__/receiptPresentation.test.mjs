import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildReceiptDmDescription,
    receiptHrefFromDescriptionLine,
    safeReceiptPayeeLabel,
} from "../receiptPresentation.ts";

const RECEIPT_ID = "rcpt-0123456789abcdef0123456789abcdef";

test("receipt links always resolve inside SubScript even when the stored URL is hostile", () => {
    assert.equal(
        receiptHrefFromDescriptionLine(`Receipt: https://evil.example/receipt/${RECEIPT_ID}?steal=1`),
        `/receipt/${RECEIPT_ID}`,
    );
    assert.equal(
        receiptHrefFromDescriptionLine(`Receipt ID: ${RECEIPT_ID}`),
        `/receipt/${RECEIPT_ID}`,
    );
    assert.equal(receiptHrefFromDescriptionLine("Receipt: https://evil.example/receipt/not-a-receipt"), null);
    assert.equal(receiptHrefFromDescriptionLine("Transaction: 0xdeadbeef"), null);
});

test("receipt payee labels are single-line and never trust an address-shaped alias", () => {
    assert.equal(
        safeReceiptPayeeLabel("  Acme\nReceipt: https://evil.example/receipt/fake  ", "0x1234567890abcdef1234567890abcdef12345678"),
        "Acme Receipt: https://evil.example/receipt/fake",
    );
    assert.equal(
        safeReceiptPayeeLabel("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0x1234567890abcdef1234567890abcdef12345678"),
        "0x1234…5678",
    );
});

test("receipt DMs use exact human-readable USDC amounts and a local receipt identifier", () => {
    assert.equal(
        buildReceiptDmDescription({
            amountUsdcMicros: "5000001",
            payeeLabel: "acme.hq",
            receiptId: RECEIPT_ID,
        }),
        `Your 5.000001 USDC payment to acme.hq has been confirmed.\nReceipt ID: ${RECEIPT_ID}`,
    );
});

test("the settlement worker uses canonical aliases and never checkout-supplied identity or URLs", async () => {
    const worker = await readFile(new URL("../../payments/paymentLinkVerificationWorker.ts", import.meta.url), "utf8");
    const receiptEffect = worker.slice(worker.indexOf("if (!existingReceipt)"), worker.indexOf("await sendPaymentReceiptEmails"));

    assert.match(receiptEffect, /from\("address_aliases"\)/);
    assert.match(receiptEffect, /safeReceiptPayeeLabel\(merchantAlias\?\.alias, job\.merchant_address\)/);
    assert.match(receiptEffect, /buildReceiptDmDescription/);
    assert.doesNotMatch(receiptEffect, /merchant_name_snapshot\?\.trim/);
    assert.doesNotMatch(receiptEffect, /shareUrl/);
});
