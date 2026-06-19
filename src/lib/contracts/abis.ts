export const USDC_ERC20_ABI = [
    {
        type: "function",
        name: "decimals",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint8" }],
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "transferFrom",
        stateMutability: "nonpayable",
        inputs: [
            { name: "sender", type: "address" },
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "event",
        name: "Transfer",
        inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "value", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "Approval",
        inputs: [
            { name: "owner", type: "address", indexed: true },
            { name: "spender", type: "address", indexed: true },
            { name: "value", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
] as const;

export const SUBSCRIPT_ROUTER_ABI = [
    {
        type: "function",
        name: "withdraw",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
    },
    {
        type: "function",
        name: "withdrawTo",
        stateMutability: "nonpayable",
        inputs: [{ name: "_recipient", type: "address" }],
        outputs: [],
    },
    {
        type: "event",
        name: "Withdraw",
        inputs: [
            { name: "merchant", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
    {
        type: "function",
        name: "depositForMerchant",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_merchant", type: "address" },
            { name: "_amount", type: "uint256" },
            { name: "_memo", type: "string" },
        ],
        outputs: [],
    },
    {
        type: "event",
        name: "DepositWithMemo",
        inputs: [
            { name: "payer", type: "address", indexed: true },
            { name: "merchant", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
            { name: "memo", type: "string", indexed: false },
        ],
        anonymous: false,
    },
    {
        type: "function",
        name: "configurePayoutDestination",
        stateMutability: "nonpayable",
        inputs: [{ name: "_newDestination", type: "address" }],
        outputs: [],
    },
    {
        type: "function",
        name: "merchantTiers",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint8" }],
    },
    {
        type: "function",
        name: "merchantBalances",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "merchantPayoutDestination",
        stateMutability: "view",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "address" }],
    },
    {
        type: "event",
        name: "MerchantPayoutRerouted",
        inputs: [
            { name: "merchant", type: "address", indexed: true },
            { name: "oldDestination", type: "address", indexed: true },
            { name: "newDestination", type: "address", indexed: true },
        ],
        anonymous: false,
    },
    {
        type: "function",
        name: "setMerchantTier",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_merchant", type: "address" },
            { name: "_tier", type: "uint8" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "executeBatchPayout",
        stateMutability: "nonpayable",
        inputs: [
            { name: "recipients", type: "address[]" },
            { name: "amounts", type: "uint256[]" },
        ],
        outputs: [],
    },
    {
        type: "event",
        name: "BatchPayoutExecuted",
        inputs: [
            { name: "merchant", type: "address", indexed: true },
            { name: "totalAmount", type: "uint256", indexed: false },
            { name: "recipientCount", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
    {
        type: "function",
        name: "rescueERC20",
        stateMutability: "nonpayable",
        inputs: [
            { name: "token", type: "address" },
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "event",
        name: "ERC20Rescued",
        inputs: [
            { name: "token", type: "address", indexed: true },
            { name: "recipient", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
] as const;

export const STANDARD_SUBSCRIPT_ABI = [
    {
        type: "function",
        name: "nextSubscriptionId",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "subscriptions",
        stateMutability: "view",
        inputs: [{ name: "", type: "uint256" }],
        outputs: [
            { name: "subscriber", type: "address" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "period", type: "uint256" },
            { name: "nextPayment", type: "uint256" },
            { name: "isActive", type: "bool" },
            { name: "settlementToken", type: "address" },
            { name: "paymentToken", type: "address" },
        ],
    },
    {
        type: "function",
        name: "createSubscription",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_merchant", type: "address" },
            { name: "_amount", type: "uint256" },
            { name: "_period", type: "uint256" },
        ],
        outputs: [{ name: "subId", type: "uint256" }],
    },
    {
        type: "function",
        name: "createSubscription",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_merchant", type: "address" },
            { name: "_amount", type: "uint256" },
            { name: "_period", type: "uint256" },
            { name: "_settlementToken", type: "address" },
            { name: "_paymentToken", type: "address" },
        ],
        outputs: [{ name: "subId", type: "uint256" }],
    },
    {
        type: "function",
        name: "cancelSubscription",
        stateMutability: "nonpayable",
        inputs: [{ name: "_subId", type: "uint256" }],
        outputs: [],
    },
    {
        type: "function",
        name: "executePayment",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_subId", type: "uint256" },
            { name: "_sequenceId", type: "uint256" }
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "isPaymentDue",
        stateMutability: "view",
        inputs: [
            { name: "_subId", type: "uint256" },
            { name: "_sequenceId", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "isSequenceExecuted",
        stateMutability: "view",
        inputs: [
            { name: "_subId", type: "uint256" },
            { name: "_sequenceId", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "event",
        name: "SubscriptionCreated",
        inputs: [
            { name: "subId", type: "uint256", indexed: true },
            { name: "subscriber", type: "address", indexed: true },
            { name: "merchant", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
            { name: "period", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "PaymentExecuted",
        inputs: [
            { name: "subId", type: "uint256", indexed: true },
            { name: "subscriber", type: "address", indexed: true },
            { name: "merchant", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
            { name: "timestamp", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
] as const;

export const CONFIDENTIAL_CONTRACT_ABI = [
    {
        type: "function",
        name: "registerViewKey",
        stateMutability: "nonpayable",
        inputs: [{ name: "_viewKeyHash", type: "bytes32" }],
        outputs: [],
    },
    {
        type: "function",
        name: "executeBatchPayout",
        stateMutability: "nonpayable",
        inputs: [
            { name: "recipients", type: "address[]" },
            { name: "amounts", type: "uint256[]" },
            { name: "isShielded", type: "bool" },
            { name: "viewKey", type: "bytes32" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "getDecryptedBatchHistory",
        stateMutability: "view",
        inputs: [{ name: "viewKey", type: "bytes32" }],
        outputs: [
            {
                name: "",
                type: "tuple[]",
                components: [
                    { name: "recipients", type: "address[]" },
                    { name: "amounts", type: "uint256[]" },
                    { name: "isShielded", type: "bool" },
                    { name: "timestamp", type: "uint256" },
                ],
            },
        ],
    },
    {
        type: "function",
        name: "viewKeyHashes",
        stateMutability: "view",
        inputs: [{ name: "", type: "bytes32" }],
        outputs: [{ name: "", type: "address" }],
    },
] as const;
