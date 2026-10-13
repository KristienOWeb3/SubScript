import test from "node:test";
import assert from "node:assert/strict";
import { arcReceiptEvent } from "../receiptEvent.ts";
import { buildDepositReceivedEmail, buildDepositInitiatedEmail, sendPaymentReceiptEmail } from "../transactional.ts";
import { sendSettlementReceipts, sendBatchPayoutReceipts } from "../settlementReceipts.ts";
import { enqueueDirectDepositEmails } from "../recovery.ts";

const txHash = `0x${"a1".repeat(32)}`;
const expected = { chainId: 5042, txHash };

test("confirmation event normalizes hashes and keeps chains separate", () => {
    assert.deepEqual(arcReceiptEvent(` ${txHash.toUpperCase()} `, 5042), expected);
    assert.notDeepEqual(arcReceiptEvent(txHash, 5042002), expected);
    assert.equal(arcReceiptEvent(null), undefined);
    assert.equal(arcReceiptEvent("bridge-transfer-id"), undefined);
    assert.throws(() => arcReceiptEvent(txHash, -1), /INVALID_RECEIPT_CHAIN/);
});

test("deposit confirmation identity is independent of origin labels and rendering dates", () => {
    const base = { recipientEmail: "person@example.com", amountUsdc: "1.00", txHash, chainId: 5042 };
    for (const originChainName of ["Arc Network", "Arc Network (5042)", "Ethereum", "Base"]) {
        const email = buildDepositReceivedEmail({ ...base, originChainName, receivedAt: new Date("2026-10-13") });
        assert.deepEqual(email.receiptEvent, expected);
    }
    assert.equal(buildDepositInitiatedEmail({ ...base, originChainName: "Base" }).receiptEvent, undefined,
        "bridge initiation is a distinct lifecycle event");
});

test("all settlement producers and the direct scanner persist the same confirmation event", async () => {
    const previous = globalThis.__subscriptPgPool;
    const messages = [];
    const query = async (sql, params = []) => {
        if (sql.includes("insert into email_outbox")) {
            messages.push(JSON.parse(params[3]));
            return { rows: [{ id: String(messages.length) }] };
        }
        if (sql.includes("select coalesce")) return { rows: [{ email: `${params[0]}@example.com`, email_enabled: true }] };
        if (sql.includes("insert into email_deposit_scan_state")) return { rows: [] };
        if (sql.includes("select activated_at")) return { rows: [{ activated_at: "2026-10-01" }] };
        throw new Error(`Unexpected query: ${sql}`);
    };
    globalThis.__subscriptPgPool = { connect: async () => ({ query, release() {} }) };
    try {
        for (const kind of ["wallet_transfer", "payroll_payout", "vault_claim", "vault_withdraw", "router_withdraw", "subscription_renewal"]) {
            await sendSettlementReceipts({ kind, amountUsdc: 1_000_000n, txHash, chainId: 5042,
                payerAddress: "sender", payeeAddress: "receiver", settlementRef: `${kind}:stable-ref` });
        }
        await sendBatchPayoutReceipts({ kind: "payroll_payout", txHash, chainId: 5042,
            recipients: [{ address: "employee", amountUsdc: 1_000_000n }] });
        await sendPaymentReceiptEmail({ amountUsdc: 1_000_000n, txHash, chainId: 5042,
            merchantAddress: "merchant", payerAddress: "payer", recipient: "receiver@example.com",
            recipientKind: "merchant", receiptId: "receipt-1", receiptUrl: "https://example.com/receipt-1" });
        const deposit = { incoming: true, toAddress: "receiver", timestamp: Date.parse("2026-10-13"),
            txHash, chainId: 5042, amountFormatted: "1.00" };
        assert.equal(await enqueueDirectDepositEmails("receiver", [deposit]), 1);
        // A mint marker alone cannot prove our bridge owns the receipt (external onramps mint too).
        assert.equal(await enqueueDirectDepositEmails("receiver", [{ ...deposit, isCctp: true }]), 1);
        assert.equal(messages.length, 16);
        for (const message of messages) assert.deepEqual(message.receiptEvent, expected);
        assert.equal(messages.filter(m => m.to === "sender@example.com").length, 6,
            "the sender still gets their own receipt");
        for (const message of messages.filter(m => m.to !== "sender@example.com")) {
            assert.match(message.html, /arc-3d-banner-v4\.png/, "every incoming producer must use the banner receipt");
            assert.match(message.html, /#fffff0/i, "the receipt must match the ivory dashboard");
            assert.match(message.html, /#d4e3e8/i, "the receipt must use dashboard blue cards");
        }
        assert.match(messages.find(m => m.html.includes("https://example.com/receipt-1")).html, /View receipt/,
            "payment-link receipts keep their private receipt CTA");
        assert.equal(await enqueueDirectDepositEmails("receiver", [{ ...deposit, incoming: false }]), 0);
        assert.equal(await enqueueDirectDepositEmails("receiver", [{ ...deposit, timestamp: 0 }]), 0);
    } finally {
        globalThis.__subscriptPgPool = previous;
    }
});
