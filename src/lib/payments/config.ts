/* Protocol Configuration Registry */

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
    USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
    ROUTER_ADDRESS: "0x6946B7746c2968B195BD15319D25F67E587CAe3C",
    CHAIN_ID: 5042002,

    /* Idempotency Constraints */
    IDEMPOTENCY_TTL: 86400, /* 24 hours in seconds */

    /* Webhook Constraints */
    WEBHOOK_MAX_RETRIES: 5
};
