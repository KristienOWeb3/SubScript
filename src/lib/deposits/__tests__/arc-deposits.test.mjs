import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Arc USDC Deposit Filtering Rules", () => {
    const USDC_NATIVE_GAS_ADDRESS = "0x3600000000000000000000000000000000000000";
    const userWallet = "0xafcb6d3e9ebed1a4bf78384689a1fff280132295";

    function filterDeposit(item, targetUser) {
        const itemContract = String(item.contractAddress || "").toLowerCase();
        const itemTo = String(item.to || "").toLowerCase();
        const itemFrom = String(item.from || "").toLowerCase();
        const itemSymbol = String(item.tokenSymbol || "").toUpperCase();
        const itemValueStr = String(item.value || "0");

        if (itemContract !== USDC_NATIVE_GAS_ADDRESS.toLowerCase()) return null;
        if (itemTo !== targetUser.toLowerCase()) return null;
        if (itemFrom === targetUser.toLowerCase()) return null;
        if (BigInt(itemValueStr) <= 0n) return null;
        if (itemSymbol && itemSymbol !== "USDC") return null;

        return {
            txHash: item.hash,
            amountUsdc: itemValueStr,
            from: itemFrom,
            to: itemTo,
        };
    }

    test("accepts valid incoming USDC transfer on Arc Network", () => {
        const validItem = {
            contractAddress: "0x3600000000000000000000000000000000000000",
            to: userWallet,
            from: "0x6946b7746c2968b195bd15319d25f67e587cae3c",
            tokenSymbol: "USDC",
            value: "25000000",
            hash: "0xabcdef123456",
        };
        const result = filterDeposit(validItem, userWallet);
        assert.ok(result);
        assert.equal(result.amountUsdc, "25000000");
        assert.equal(result.from, "0x6946b7746c2968b195bd15319d25f67e587cae3c");
    });

    test("rejects non-USDC token transfers", () => {
        const nonUsdcItem = {
            contractAddress: "0x1111111111111111111111111111111111111111",
            to: userWallet,
            from: "0x6946b7746c2968b195bd15319d25f67e587cae3c",
            tokenSymbol: "SHIB",
            value: "1000000",
            hash: "0x123",
        };
        const result = filterDeposit(nonUsdcItem, userWallet);
        assert.equal(result, null);
    });

    test("rejects outbound transfers sent from user wallet", () => {
        const outboundItem = {
            contractAddress: USDC_NATIVE_GAS_ADDRESS,
            to: "0x6946b7746c2968b195bd15319d25f67e587cae3c",
            from: userWallet,
            tokenSymbol: "USDC",
            value: "1000000",
            hash: "0x456",
        };
        const result = filterDeposit(outboundItem, userWallet);
        assert.equal(result, null);
    });

    test("rejects zero-value transfers", () => {
        const zeroItem = {
            contractAddress: USDC_NATIVE_GAS_ADDRESS,
            to: userWallet,
            from: "0x6946b7746c2968b195bd15319d25f67e587cae3c",
            tokenSymbol: "USDC",
            value: "0",
            hash: "0x789",
        };
        const result = filterDeposit(zeroItem, userWallet);
        assert.equal(result, null);
    });
});
