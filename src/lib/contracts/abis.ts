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
] as const;

export const SUBSCRIPT_ROUTER_ABI = [
    {
        type: "function",
        name: "depositAndCommit",
        stateMutability: "nonpayable",
        inputs: [
            { name: "commitment", type: "bytes32" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "verifyAndActivate",
        stateMutability: "nonpayable",
        inputs: [
            { name: "proof", type: "bytes32[]" },
            { name: "nullifierHash", type: "bytes32" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "period", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "withdraw",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
    },
    {
        type: "function",
        name: "withdrawWithProof",
        stateMutability: "nonpayable",
        inputs: [
            { name: "proof", type: "bytes32[]" },
            { name: "nullifierHash", type: "bytes32" },
            { name: "merchant", type: "address" },
            { name: "target", type: "address" },
        ],
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
        name: "Deposit",
        inputs: [
            { name: "commitment", type: "bytes32", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "SubscriptionActivated",
        inputs: [
            { name: "nullifierHash", type: "bytes32", indexed: true },
            { name: "merchant", type: "address", indexed: true },
            { name: "amount", type: "uint256", indexed: false },
            { name: "period", type: "uint256", indexed: false },
        ],
        anonymous: false,
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
        name: "cancelSubscription",
        stateMutability: "nonpayable",
        inputs: [{ name: "_subId", type: "uint256" }],
        outputs: [],
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
