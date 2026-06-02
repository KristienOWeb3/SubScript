import { ethers } from "ethers";
import { ARC_TESTNET_CHAIN_ID, ROUTER_ADDRESS, USDC_ADDRESS, PREMIUM_PRICE } from "./constants";

const ERC20_INTERFACE = new ethers.Interface([
    "function transfer(address to, uint256 value) external",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const findTransferLog = (
    receipt: any,
    from: string,
    to: string,
    amount: bigint
) => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(USDC_ADDRESS)) continue;
        try {
            const parsed = ERC20_INTERFACE.parseLog(log);
            if (
                parsed?.name === "Transfer" &&
                normalizeAddress(parsed.args.from) === normalizeAddress(from) &&
                normalizeAddress(parsed.args.to) === normalizeAddress(to) &&
                BigInt(parsed.args.value) === amount
            ) {
                return true;
            }
        } catch {
            /* Ignore log parsing errors */
        }
    }
    return false;
};

export async function verifyTransaction(
    tx: any,
    receipt: any,
    session: any,
    provider: any
): Promise<{ valid: boolean; error?: string }> {
    /* 1. Verify chain ID */
    if (Number(tx.chainId) !== ARC_TESTNET_CHAIN_ID) {
        console.error(`[tx_invalid_chain] Expected ${ARC_TESTNET_CHAIN_ID}, got ${tx.chainId}`);
        return { valid: false, error: `Invalid chain ID: ${tx.chainId}` };
    }

    /* 2. Verify sender address matches session merchant */
    if (normalizeAddress(tx.from) !== normalizeAddress(session.merchant_address)) {
        console.error(`[tx_failed_verification] Transaction sender does not match session merchant`);
        return { valid: false, error: "Transaction sender does not match session merchant" };
    }

    if (normalizeAddress(receipt.from) !== normalizeAddress(session.merchant_address)) {
        console.error(`[tx_failed_verification] Receipt sender does not match session merchant`);
        return { valid: false, error: "Receipt sender does not match session merchant" };
    }

    /* 3. Verify receipt status is successful */
    if (receipt.status !== 1) {
        console.error(`[tx_failed_verification] Transaction reverted on-chain`);
        return { valid: false, error: "Transaction reverted on-chain" };
    }

    /* 4. Target contract must be the USDC contract */
    if (!tx.to || !receipt.to || normalizeAddress(tx.to) !== normalizeAddress(USDC_ADDRESS) || normalizeAddress(receipt.to) !== normalizeAddress(USDC_ADDRESS)) {
        console.error(`[tx_failed_verification] Target is not USDC token contract`);
        return { valid: false, error: "Target is not USDC token contract" };
    }

    /* 5. Parse transaction input data to assert it calls transfer(ROUTER_ADDRESS, 10 USDC) */
    let parsedTx;
    try {
        parsedTx = ERC20_INTERFACE.parseTransaction({ data: tx.data, value: tx.value });
    } catch (e) {
        console.error(`[tx_failed_verification] Failed to parse transaction calldata`);
        return { valid: false, error: "Failed to parse transaction calldata" };
    }

    if (
        !parsedTx ||
        parsedTx.name !== "transfer" ||
        normalizeAddress(parsedTx.args[0]) !== normalizeAddress(ROUTER_ADDRESS) ||
        BigInt(parsedTx.args[1]) !== BigInt(PREMIUM_PRICE)
    ) {
        console.error(`[tx_failed_verification] Calldata is not transfer to SubScript Router Proxy of 10 USDC`);
        return { valid: false, error: "Calldata is not transfer to SubScript Router Proxy of 10 USDC" };
    }

    /* 6. Verify Transfer logs in receipt logs */
    if (!findTransferLog(receipt, session.merchant_address, ROUTER_ADDRESS, BigInt(PREMIUM_PRICE))) {
        console.error(`[tx_failed_verification] Transfer event log not found in receipt`);
        return { valid: false, error: "Transfer event log not found in receipt" };
    }

    /* 7. Verify transaction block timestamp is within the last 24 hours */
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block) {
        console.error(`[tx_failed_verification] Block metadata could not be retrieved`);
        return { valid: false, error: "Block metadata could not be retrieved" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - block.timestamp) > 86400) {
        console.error(`[tx_failed_verification] Transaction block is older than 24 hours`);
        return { valid: false, error: "Transaction block is older than 24 hours" };
    }

    return { valid: true };
}
