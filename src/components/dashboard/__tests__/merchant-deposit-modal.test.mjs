import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const receiveModalPath = path.resolve("src/components/dashboard/MerchantReceiveModal.tsx");
const overviewPath = path.resolve("src/components/dashboard/MerchantOverview.tsx");
const dashboardPagePath = path.resolve("src/app/dashboard/page.tsx");

test("MerchantReceiveModal does not contain outdated network specs block or solana", () => {
    const modalContent = fs.readFileSync(receiveModalPath, "utf-8");

    // Modal title is Deposit USDC
    assert.match(modalContent, /Deposit USDC/);

    // No 3-column specs grid block
    assert.doesNotMatch(modalContent, /Chain ID/);
    assert.doesNotMatch(modalContent, /5042/);
    assert.doesNotMatch(modalContent, /Native USDC/);

    // No scan copy
    assert.doesNotMatch(modalContent, /Scan with any Arc Mainnet compatible wallet/);

    // Humanized warning: no "solana", no "Mainnet (Chain ID 5042)"
    assert.doesNotMatch(modalContent, /solana/i);
    assert.doesNotMatch(modalContent, /Mainnet \(Chain ID 5042\)/);

    // Responsive constraint applied to modal container
    assert.match(modalContent, /max-h-\[calc\(100vh-2rem\)\]/);
    assert.match(modalContent, /overflow-y-auto/);
    assert.match(modalContent, /overscroll-contain/);

    // Humanized exact warning banner
    assert.match(
        modalContent,
        /Send only USDC on Arc to this address\. Unsupported tokens or deposits from networks like Ethereum will be lost\./
    );
});

test("MerchantOverview deposit button is named Deposit", () => {
    const overviewContent = fs.readFileSync(overviewPath, "utf-8");

    // Button label is "Deposit"
    assert.match(overviewContent, />\s*Deposit\s*<\/button>/);

    // Does NOT contain "Receive Arc USDC"
    assert.doesNotMatch(overviewContent, /Receive Arc USDC/);
});

test("CLI integration command uses @subscriptonarc/cli init", () => {
    const pageContent = fs.readFileSync(dashboardPagePath, "utf-8");

    // Must use npx @subscriptonarc/cli init
    assert.match(pageContent, /npx @subscriptonarc\/cli init/);

    // Must NOT contain @subscriptonarc/create
    assert.doesNotMatch(pageContent, /@subscriptonarc\/create/);
});
