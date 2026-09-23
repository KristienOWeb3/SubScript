/* Unit tests for the central gas-payer classifier. It is pure and fed server-resolved facts, so
   these assert the full decision matrix and that no client-controlled field can turn a peer payment
   into a sponsored one. */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyGasPayer } from "../policy.ts";

test("USER paying an ENTERPRISE merchant checkout is sponsored", () => {
    const d = classifyGasPayer({ kind: "payment_link_pay", linkId: "l1", settlesToUser: false, merchantIsEnterprise: true });
    assert.equal(d.class, "SPONSORED_MERCHANT_COMMERCE");
    assert.equal(d.gasPayer, "platform");
    assert.equal(d.sponsored, true);
});

test("a user-generated peer link is user-paid even though it reuses checkout UI", () => {
    const d = classifyGasPayer({ kind: "payment_link_pay", linkId: "l2", settlesToUser: true, merchantIsEnterprise: false });
    assert.equal(d.class, "USER_PAID_PEER_TRANSACTION");
    assert.equal(d.gasPayer, "wallet");
    assert.equal(d.sponsored, false);
});

test("a peer link cannot be flipped to sponsored by a spoofed enterprise flag", () => {
    /* settlesToUser is derived from the immutable DB link_kind, not the client. Even if every other
       fact claims enterprise, a peer settlement stays user-paid. */
    const d = classifyGasPayer({ kind: "payment_link_pay", linkId: "l3", settlesToUser: true, merchantIsEnterprise: true });
    assert.equal(d.class, "USER_PAID_PEER_TRANSACTION");
    assert.equal(d.sponsored, false);
});

test("a merchant link whose merchant role is unconfirmed fails closed", () => {
    const d = classifyGasPayer({ kind: "payment_link_pay", linkId: "l4", settlesToUser: false, merchantIsEnterprise: false });
    assert.equal(d.class, "DENIED_UNCLASSIFIED");
    assert.equal(d.sponsored, false);
});

test("wallet_send is always a user-paid peer transaction", () => {
    const d = classifyGasPayer({ kind: "wallet_send" });
    assert.equal(d.class, "USER_PAID_PEER_TRANSACTION");
    assert.equal(d.sponsored, false);
});

test("execute_action transferUsdc is user-paid; approveUsdc/cancelSubscription are commerce", () => {
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "transferUsdc" }).sponsored, false);
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "transferUsdc" }).class, "USER_PAID_PEER_TRANSACTION");
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "approveUsdc" }).sponsored, true);
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "cancelSubscription" }).sponsored, true);
});

test("execute_action withdraw / merchant config are user-paid (merchant bears own gas)", () => {
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "withdraw" }).class, "USER_PAID_WITHDRAWAL");
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "configurePayoutDestination" }).sponsored, false);
    assert.equal(classifyGasPayer({ kind: "execute_action", action: "registerViewKey" }).sponsored, false);
});

test("an unknown execute action fails closed", () => {
    const d = classifyGasPayer({ kind: "execute_action", action: "selfDestruct" });
    assert.equal(d.class, "DENIED_UNCLASSIFIED");
    assert.equal(d.sponsored, false);
});

test("vault commit/auto_topup to an enterprise merchant are sponsored; withdraw/reclaim are user-paid", () => {
    assert.equal(classifyGasPayer({ kind: "vault", op: "commit", merchantIsEnterprise: true }).sponsored, true);
    assert.equal(classifyGasPayer({ kind: "vault", op: "auto_topup", merchantIsEnterprise: true }).sponsored, true);
    assert.equal(classifyGasPayer({ kind: "vault", op: "withdraw", merchantIsEnterprise: true }).class, "USER_PAID_WITHDRAWAL");
    assert.equal(classifyGasPayer({ kind: "vault", op: "reclaim", merchantIsEnterprise: true }).class, "USER_PAID_WITHDRAWAL");
});

test("vault commit with unconfirmed merchant fails closed", () => {
    assert.equal(classifyGasPayer({ kind: "vault", op: "commit", merchantIsEnterprise: false }).class, "DENIED_UNCLASSIFIED");
});

test("subscription lifecycle to an enterprise merchant is sponsored across ops", () => {
    for (const op of ["subscribe", "change", "cancel", "resume", "upgrade"]) {
        assert.equal(classifyGasPayer({ kind: "subscription", op, merchantIsEnterprise: true }).sponsored, true, op);
    }
    assert.equal(classifyGasPayer({ kind: "subscription", op: "subscribe", merchantIsEnterprise: false }).class, "DENIED_UNCLASSIFIED");
});

test("cross-chain withdrawal and merchant payout are user-paid; keeper is platform-operational", () => {
    assert.equal(classifyGasPayer({ kind: "cctp_withdrawal" }).class, "USER_PAID_WITHDRAWAL");
    assert.equal(classifyGasPayer({ kind: "merchant_payout", op: "payroll" }).class, "USER_PAID_WITHDRAWAL");
    const keeper = classifyGasPayer({ kind: "keeper", op: "billing_renewal" });
    assert.equal(keeper.class, "PLATFORM_OPERATIONAL");
    assert.equal(keeper.sponsored, true);
});
