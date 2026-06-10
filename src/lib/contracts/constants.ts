export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042001 as const;

export const MERCHANT_ADDRESS = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295" as const;
export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;

const isProd = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENVIRONMENT === "production";

export const SUBSCRIPT_ROUTER_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C" as const;
export const STANDARD_CONTRACT_ADDRESS = "0x38594705B7feE26B5E05a04069695A907b725b9f" as const;
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

/* CCTP Configuration mapping chainId -> { tokenMessenger, usdc, name } */
export const CCTP_CONFIG: Record<number, { tokenMessenger: `0x${string}`; usdc: `0x${string}`; name: string }> = {
  1: {
    tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    name: "Ethereum Mainnet",
  },
  8453: {
    tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "Base Mainnet",
  },
  11155111: {
    tokenMessenger: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    name: "Ethereum Sepolia",
  },
  84532: {
    tokenMessenger: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "Base Sepolia",
  },
} as const;

export const ARC_CCTP_DOMAIN_ID = 26 as const;
