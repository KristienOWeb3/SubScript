import { ethers } from "ethers";
import { ARC_TESTNET_CHAIN_ID, TREASURY_ADDRESS, USDC_ADDRESS, PREMIUM_PRICE } from "./constants";

const STANDARD_CONTRACT_ADDRESS = "0x3c7f095575C66eF21D501D63E265A51240849924";

const SUBSCRIPT_INTERFACE = new ethers.Interface([
    "function createSubscription(address _merchant, uint256 _amount, uint256 _period) external returns (uint256 subId)",
    "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)"
]);

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const findSubscriptionCreatedLog = (
    receipt: any,
    subscriber: string,
    merchant: string,
    amount: bigint
) => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(STANDARD_CONTRACT_ADDRESS)) continue;
        try {
            const parsed = SUBSCRIPT_INTERFACE.parseLog(log);
            if (
                parsed?.name === "SubscriptionCreated" &&
                normalizeAddress(parsed.args.subscriber) === normalizeAddress(subscriber) &&
                normalizeAddress(parsed.args.merchant) === normalizeAddress(merchant) &&
                BigInt(parsed.args.amount) === amount
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

    /* 4. Target contract must be the standard SubScript contract */
    if (!tx.to || !receipt.to || normalizeAddress(tx.to) !== normalizeAddress(STANDARD_CONTRACT_ADDRESS) || normalizeAddress(receipt.to) !== normalizeAddress(STANDARD_CONTRACT_ADDRESS)) {
        console.error(`[tx_failed_verification] Target is not SubScript contract`);
        return { valid: false, error: "Target is not SubScript contract" };
    }

    /* 5. Parse transaction input data to assert it calls createSubscription(TREASURY_ADDRESS, 10 USDC, 30 days) */
    let parsedTx;
    try {
        parsedTx = SUBSCRIPT_INTERFACE.parseTransaction({ data: tx.data, value: tx.value });
    } catch (e) {
        console.error(`[tx_failed_verification] Failed to parse transaction calldata`);
        return { valid: false, error: "Failed to parse transaction calldata" };
    }

    if (
        !parsedTx ||
        parsedTx.name !== "createSubscription" ||
        normalizeAddress(parsedTx.args[0]) !== normalizeAddress(TREASURY_ADDRESS) ||
        BigInt(parsedTx.args[1]) !== BigInt(PREMIUM_PRICE) ||
        BigInt(parsedTx.args[2]) !== BigInt(2592000)
    ) {
        console.error(`[tx_failed_verification] Calldata is not createSubscription to SubScript Treasury address of 10 USDC for 30 days`);
        return { valid: false, error: "Calldata is not createSubscription to SubScript Treasury address of 10 USDC for 30 days" };
    }

    /* 6. Verify SubscriptionCreated log in receipt logs */
    if (!findSubscriptionCreatedLog(receipt, session.merchant_address, TREASURY_ADDRESS, BigInt(PREMIUM_PRICE))) {
        console.error(`[tx_failed_verification] SubscriptionCreated event log not found in receipt`);
        return { valid: false, error: "SubscriptionCreated event log not found in receipt" };
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
