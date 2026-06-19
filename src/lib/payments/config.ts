/* Protocol Configuration Registry */

import {
    ARC_TESTNET_CHAIN_ID,
    SUBSCRIPT_ROUTER_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS
} from "@/lib/contracts/constants";

export const ProtocolConfig = {
    /* Batch Payout Constraints */
    MAX_BATCH_RECIPIENTS: 1000,
    MAX_BATCH_AMOUNT: BigInt(1000000) * BigInt(1000000), /* 1,000,000 USDC in micro-USDC (6 decimals) */
    MAX_SINGLE_RECIPIENT_AMOUNT: BigInt(100000) * BigInt(1000000), /* 100,000 USDC in micro-USDC */

    /* Hosted Payment Links Quotas */
    MAX_PAYMENT_LINKS_TIER0: 100,
    MAX_PAYMENT_LINKS_TIER1: 10000,

    /* Blockchain Settlement & Verification */
    MIN_CONFIRMATIONS: 3,
    USDC_ADDRESS: USDC_NATIVE_GAS_ADDRESS,
    ROUTER_ADDRESS: SUBSCRIPT_ROUTER_ADDRESS,
    CHAIN_ID: ARC_TESTNET_CHAIN_ID,

    /* Idempotency Constraints */
    IDEMPOTENCY_TTL: 86400, /* 24 hours in seconds */

    /* Webhook Constraints */
    WEBHOOK_MAX_RETRIES: 5
};
