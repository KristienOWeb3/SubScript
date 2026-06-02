export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042001 as const;

export const MERCHANT_ADDRESS = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295" as const;
export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;

const isProd = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENVIRONMENT === "production";

export const SUBSCRIPT_ROUTER_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C" as const;
export const STANDARD_CONTRACT_ADDRESS = "0x3c7f095575C66eF21D501D63E265A51240849924" as const;
export const PREMIUM_PAYMENT_RECIPIENT_ADDRESS = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10" as const;
export const PREMIUM_PLAN_ID = "premium-monthly" as const;
export const PREMIUM_PLAN_PRICE_USDC = "10" as const;

export const USDC_NATIVE_GAS_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

export const ARC_TESTNET = {
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.network",
    },
  },
} as const;

export const ARC_MAINNET = {
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc Mainnet",
  network: "arc-mainnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.network",
    },
  },
} as const;
