import test from "node:test";
import assert from "node:assert/strict";

import {
    buildDepositReceivedEmail,
    buildWithdrawalCompletedEmail,
} from "../transactional.ts";
import { renderEmailLayout } from "../core.ts";

test("renderEmailLayout supports dark theme with centered logo and dark card", () => {
    const html = renderEmailLayout({
        previewText: "Deposit confirmed: 250 USDC",
        heading: "Deposit Receipt",
        bodyHtml: "<p>Funds deposited</p>",
        theme: "dark",
        cta: { label: "View Dashboard", url: "https://subscriptonarc.com/dashboard/user" },
    });

    assert.ok(html.includes("background:#12141a"), "should have dark card background");
    assert.ok(html.includes("border:1px solid #232732"), "should have subtle dark border");
    assert.ok(html.includes("Sub<span style=\"color:#00a892\">Script</span>"), "should have styled SubScript logo");
    assert.ok(html.includes("View Dashboard"), "should have CTA button");
});

test("buildDepositReceivedEmail generates Spenda-style receipt with 3D banner, completed pill, and explorer link", () => {
    const mail = buildDepositReceivedEmail({
        recipientEmail: "tester@example.com",
        recipientName: "Okechukwu",
        amountUsdc: "260000000", // 260 USDC in micros
        originChainName: "Ethereum",
        txHash: "0x58c5aa18cd41fb9b52a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
    });

    assert.equal(mail.to, "tester@example.com");
    assert.equal(mail.subject, "Deposit confirmed: 260 USDC on Ethereum");
    assert.ok(mail.text.includes("Quantity: 260 USDC"));
    assert.ok(mail.text.includes("Ethereum"));
    assert.ok(!mail.text.includes("Reference:"), "should not have synthetic reference ID in text");
    assert.ok(!mail.html.includes("Reference ID"), "should not have Reference ID row in html");

    assert.ok(mail.html.includes("Completed"), "should have Completed pill");
    assert.ok(mail.html.includes("eth-3d-banner-v4.png"), "should have 3D Ethereum banner graphic");
    assert.ok(mail.html.includes("etherscan.io/tx/0x58c5aa18"), "should link to Etherscan");
    assert.ok(mail.html.includes("260 USDC"), "should format micro amount");
    assert.ok(mail.idempotencyKey.includes("0x58c5aa18"), "should have deterministic idempotency key");
});

test("buildWithdrawalCompletedEmail generates Spenda-style receipt with destination address and network", () => {
    const mail = buildWithdrawalCompletedEmail({
        recipientEmail: "tester@example.com",
        recipientName: "Okechukwu",
        amountUsdc: "24600000", // 24.6 USDC in micros
        destinationChainName: "Solana",
        destinationAddress: "8034936116solanaAddressXYZ",
        feeUsdc: "$0.02",
        txHash: "5KtPn8Gz3abcdef",
    });

    assert.equal(mail.to, "tester@example.com");
    assert.equal(mail.subject, "Withdrawal delivered: 24.6 USDC to Solana");
    assert.ok(mail.text.includes("24.6 USDC"));
    assert.ok(mail.text.includes("Solana"));
    assert.ok(!mail.text.includes("Reference:"), "should not have synthetic reference ID in text");
    assert.ok(!mail.html.includes("Reference ID"), "should not have Reference ID row in html");

    assert.ok(mail.html.includes("Completed"), "should have Completed pill");
    assert.ok(mail.html.includes("solana-3d-banner-v4.png"), "should have 3D Solana banner graphic");
    assert.ok(mail.html.includes("solscan.io/tx/5KtPn8Gz3abcdef"), "should link to Solscan");
    assert.ok(mail.html.includes("$0.02"), "should show fee");
});


