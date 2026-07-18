import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checkout = readFileSync(
    new URL("../../../../src/app/pay/[id]/PublicPayClient.tsx", import.meta.url),
    "utf8",
);

test("CCTP checkout remains hard-disabled", () => {
    assert.match(checkout, /const CCTP_CHECKOUT_ENABLED = false;/);
    assert.match(checkout, /const cctpCheckoutEnabled = CCTP_CHECKOUT_ENABLED;/);
    assert.match(checkout, /const isCctpMode = cctpCheckoutEnabled &&/);
    assert.match(checkout, /const isCctpChain = cctpCheckoutEnabled &&/);
});

test("a broadcast payment is persisted and restored for the same checkout attempt", () => {
    assert.match(checkout, /type PendingCheckoutVerification = \{[\s\S]*attemptId: string;[\s\S]*phase: "broadcast" \| "confirmed";/);
    assert.match(checkout, /sessionStorage\.setItem\(`subscript_pending_verification:\$\{id\}`/);
    assert.match(checkout, /paymentBroadcastRef\.current = true;[\s\S]*sessionStorage\.setItem/);
    assert.match(checkout, /parsed\.attemptId !== clientIntentId/);
    assert.match(checkout, /finally \{\s*setPendingVerificationHydrated\(true\);/);
    assert.match(checkout, /disabled=\{!pendingVerificationHydrated \|\| Boolean\(pendingVerification\)/);
    assert.match(checkout, /if \(parsed\.source === "wallet"\) setTxHash\(parsed\.txHash\);/);
    assert.equal((checkout.match(/phase: "broadcast",/g) || []).length, 2);
    assert.match(checkout, /source: "embedded",\s*phase: "confirmed",/);
});

test("verification failures retain the submission guard and expose retry-only UI", () => {
    const verificationFlow = checkout.slice(
        checkout.indexOf("const startVerification = useCallback"),
        checkout.indexOf("const beginPaymentReview"),
    );

    /* The only unlock in this post-broadcast section is authoritative CONFIRMED settlement.
       FAILED, named SSE errors, transport errors, and verification-init errors stay locked. */
    assert.equal((verificationFlow.match(/paymentSubmissionGuardRef\.current = false;/g) || []).length, 2);
    assert.match(verificationFlow, /data\.status === "CONFIRMED"[\s\S]*clearPendingVerification\(\);[\s\S]*paymentSubmissionGuardRef\.current = false;/);
    assert.match(verificationFlow, /data\.status === "FAILED"[\s\S]*paymentSubmissionGuardRef\.current = true;/);
    assert.match(verificationFlow, /eventSource\.onerror[\s\S]*paymentSubmissionGuardRef\.current = true;/);
    assert.match(checkout, /Payment already submitted/);
    assert.match(checkout, /Continue verification/);
    assert.match(checkout, /if \(pendingVerification\) \{[\s\S]*This payment was already submitted/);
    assert.match(checkout, /if \(!paymentBroadcastRef\.current\) paymentSubmissionGuardRef\.current = false;/);
    assert.doesNotMatch(checkout, /if \(!pendingVerification\) paymentSubmissionGuardRef\.current = false;/);
});

test("pending verification is cleared only by settlement or a known on-chain revert", () => {
    assert.match(checkout, /txReceipt\.status !== "success"[\s\S]*clearPendingVerification\(\);/);
    assert.match(checkout, /Payment confirmed and settled successfully![\s\S]*clearPendingVerification/);
    assert.match(checkout, /sessionStorage\.removeItem\(`subscript_pending_verification:\$\{id\}`\)/);
});
