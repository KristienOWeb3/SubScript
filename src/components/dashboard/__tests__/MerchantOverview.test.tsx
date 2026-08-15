import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MerchantOverview from "../MerchantOverview";

test("merchant overview renders the wireframe sections and actions", () => {
    const html = renderToStaticMarkup(React.createElement(MerchantOverview, {
        walletBalance: 1200,
        vaultBalance: 340,
        projected30DaySettlement: 2500,
        ledgers: [{
            id: "sub-1",
            rawId: "1",
            displayAddress: "customer.sub",
            shortSubAddress: "0x1234...5678",
            limit: "25.00 USDC / month",
            nextBilling: "9/15/2026",
            active: true,
            billingStatus: "ACTIVE",
            cancelAtPeriodEnd: false,
            downgradeFailures: 0,
        }],
        balanceVisible: true,
        isRefreshingBalances: false,
        isLoadingContract: false,
        onToggleBalance: () => {},
        onRefresh: () => {},
        onSend: () => {},
        onReceive: () => {},
        onWithdraw: () => {},
        onViewPlans: () => {},
    }));

    for (const label of [
        "Earnings",
        "Ready to Withdraw",
        "30 Days Projection",
        "Transactions Overview",
        "Plans Overview",
        "Active Subscriptions and Customers",
        "Send",
        "Receive",
        "Withdraw",
    ]) assert.match(html, new RegExp(label));
    assert.match(html, /customer\.sub/);
});