import { ethers } from "ethers";
import { STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { ARC_TESTNET_CHAIN_ID, TREASURY_ADDRESS, PREMIUM_PRICE } from "./constants";

const SUBSCRIPT_INTERFACE = new ethers.Interface([
    "function createSubscription(address _merchant, uint256 _amount, uint256 _period) external returns (uint256 subId)",
    "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)"
]);

const PREMIUM_PERIOD_SECONDS = 2592000; /* 30 days */

const normalizeAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const findSubscriptionCreatedLog = (
    receipt: any,
    subscriber: string,
    merchant: string,
    amount: bigint,
    period: bigint
): { subscriber: string; subId: string } | null => {
    for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== normalizeAddress(STANDARD_CONTRACT_ADDRESS)) continue;
        try {
            const parsed = SUBSCRIPT_INTERFACE.parseLog(log);
            if (
                parsed?.name === "SubscriptionCreated" &&
                normalizeAddress(parsed.args.subscriber) === normalizeAddress(subscriber) &&
                normalizeAddress(parsed.args.merchant) === normalizeAddress(merchant) &&
                BigInt(parsed.args.amount) === amount &&
                BigInt(parsed.args.period) === period
            ) {
                return {
                    subscriber: normalizeAddress(parsed.args.subscriber),
                    subId: parsed.args.subId.toString()
                };
            }
        } catch {
            /* Ignore log parsing errors */
        }
    }
    return null;
};

export async function verifyTransaction(
    tx: any,
    receipt: any,
    session: any,
    provider: any,
    options: { allowAgedBlock?: boolean } = {}
): Promise<{ valid: boolean; error?: string; subscriber?: string; subId?: string }> {
    /* 1. Verify chain ID */
    if (Number(tx.chainId) !== ARC_TESTNET_CHAIN_ID) {
        console.error(`[tx_invalid_chain] Expected ${ARC_TESTNET_CHAIN_ID}, got ${tx.chainId}`);
        return { valid: false, error: `Invalid chain ID: ${tx.chainId}` };
    }

    /* 2. Verify receipt status is successful */
    if (receipt.status !== 1) {
        console.error(`[tx_failed_verification] Transaction reverted on-chain`);
        return { valid: false, error: "Transaction reverted on-chain" };
    }

    /* 3. Determine submission shape. Browser wallets call the SubScript contract directly, so
       tx.to is the contract and the calldata is createSubscription. Custody embedded wallets
       (Circle MPC) are ERC-4337 smart accounts: the outer transaction targets the EntryPoint
       via a bundler and the createSubscription happens as an internal call, so tx.to is NOT
       the SubScript contract. For those, the SubscriptionCreated event in step 4 — which can
       only be emitted by the canonical contract address — is the payment authority instead. */
    const isDirectContractCall =
        !!tx.to &&
        !!receipt.to &&
        normalizeAddress(tx.to) === normalizeAddress(STANDARD_CONTRACT_ADDRESS) &&
        normalizeAddress(receipt.to) === normalizeAddress(STANDARD_CONTRACT_ADDRESS);

    if (isDirectContractCall) {
        /* Defense-in-depth for the direct path: the calldata itself must be the expected
           createSubscription(TREASURY_ADDRESS, 10 USDC, 30 days) call. */
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
            BigInt(parsedTx.args[2]) !== BigInt(PREMIUM_PERIOD_SECONDS)
        ) {
            console.error(`[tx_failed_verification] Calldata is not createSubscription to SubScript Treasury address of 10 USDC for 30 days`);
            return { valid: false, error: "Calldata is not createSubscription to SubScript Treasury address of 10 USDC for 30 days" };
        }
    }

    /* 4. Verify the SubscriptionCreated log in the receipt. This is authoritative for BOTH
       submission shapes: receipt logs cannot be forged, and the matcher pins the emitting
       address to the canonical SubScript contract and requires the exact premium terms
       (merchant = treasury, amount = 10 USDC, period = 30 days). The event's subscriber is
       the contract-level payer, which is what premium activation is granted to — for custody
       wallets tx.from is a bundler/execution account, never the merchant wallet. */
    const subscriptionLog = findSubscriptionCreatedLog(
        receipt,
        session.merchant_address,
        TREASURY_ADDRESS,
        BigInt(PREMIUM_PRICE),
        BigInt(PREMIUM_PERIOD_SECONDS)
    );
    if (!subscriptionLog) {
        console.error(`[tx_failed_verification] SubscriptionCreated event log not found in receipt`);
        return { valid: false, error: "SubscriptionCreated event log not found in receipt" };
    }

    /* 5. Verify transaction block timestamp is within the last 24 hours */
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block) {
        console.error(`[tx_failed_verification] Block metadata could not be retrieved`);
        return { valid: false, error: "Block metadata could not be retrieved" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    /* Reject blocks older than 24h; also reject blocks dated meaningfully in the future
       (allow a small clock-skew tolerance) rather than accepting them via abs().
       Recovery and reconciliation runs skip the age bound: those sessions were paid but
       stalled (verifier false-negative, RPC outage), and can legitimately be reprocessed
       days later. Replay stays impossible regardless — the caller enforces block timestamp
       <= session expiry and the tx hash is globally single-use via webhook_events. */
    if (!options.allowAgedBlock && nowSec - block.timestamp > 86400) {
        console.error(`[tx_failed_verification] Transaction block is older than 24 hours`);
        return { valid: false, error: "Transaction block is older than 24 hours" };
    }
    if (block.timestamp - nowSec > 300) {
        console.error(`[tx_failed_verification] Transaction block timestamp is in the future`);
        return { valid: false, error: "Transaction block timestamp is in the future" };
    }

    return { valid: true, subscriber: subscriptionLog.subscriber, subId: subscriptionLog.subId };
}
