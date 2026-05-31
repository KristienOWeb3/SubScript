export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042001 as const;

export const MERCHANT_ADDRESS = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295" as const;
export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;

const isProd = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENVIRONMENT === "production";

export const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29" as const;
export const STANDARD_CONTRACT_ADDRESS = "0x3c7f095575C66eF21D501D63E265A51240849924" as const;

export const USDC_NATIVE_GAS_ADDRESS = isProd
  ? ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const)
  : ("0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc" as const);

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
