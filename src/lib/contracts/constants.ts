export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29" as const;
export const STANDARD_CONTRACT_ADDRESS = "0x3c7f095575C66eF21D501D63E265A51240849924" as const;
export const USDC_NATIVE_GAS_ADDRESS = "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc" as const;
export const MERCHANT_ADDRESS = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295" as const;
export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;

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
