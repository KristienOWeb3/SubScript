export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042001 as const;

export const MERCHANT_ADDRESS = "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295" as const;
export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;

/* Shared signup-free sandbox merchant behind the published sk_test_demo_* key
   (seeded by scripts/seed-demo-key.mjs). Test-mode keys are always sandboxed;
   this address additionally gets an aggressive rate limit. */
export const DEMO_MERCHANT_ADDRESS = "0xdeb0000000000000000000000000000000000001" as const;

export const isProd = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";

/* Network-critical addresses are env-overridable so the mainnet cutover is a config change, not a
   code edit. Defaults below are the current Arc *testnet* deployment; set the NEXT_PUBLIC_* vars to
   your mainnet contract addresses (together with NEXT_PUBLIC_ENVIRONMENT=mainnet and the mainnet
   RPC_URL / NEXT_PUBLIC_ARC_RPC_PRIMARY) to go live. A malformed override is ignored in favour of
   the default. */
const envAddress = (value: string | undefined, fallback: string): `0x${string}` =>
  (value && /^0x[a-fA-F0-9]{40}$/.test(value.trim()) ? value.trim() : fallback) as `0x${string}`;

export const SUBSCRIPT_ROUTER_ADDRESS = envAddress(process.env.NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS, "0x6946B7746c2968B195BD15319D25F67E587CAe3C");
export const STANDARD_CONTRACT_ADDRESS = envAddress(process.env.NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS, "0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2");
export const CONFIDENTIAL_CONTRACT_ADDRESS = envAddress(process.env.NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS, "0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2");
export const PREMIUM_PAYMENT_RECIPIENT_ADDRESS = envAddress(process.env.NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS, "0x725D56151CeaC9eAd625241D13b8307B22EDDb10");
export const PREMIUM_PLAN_ID = "premium-monthly" as const;
export const PREMIUM_PLAN_PRICE_USDC = "10" as const;

export const USDC_NATIVE_GAS_ADDRESS = envAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS, "0x3600000000000000000000000000000000000000");

/* SubScriptVault escrow proxy (commit/draw/owed vault economics). Env-overridable. */
export const SUBSCRIPT_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS
  || "0x853581e119dDED32DB886a4533A11789cF60bBFc") as `0x${string}`;
export const SUBSCRIPT_VAULT_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID
  || (isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID),
);

export const ARC_MEMO_CONTRACT_ADDRESS = envAddress(process.env.NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS, "0x5294E9927c3306DcBaDb03fe70b92e01cCede505");
export const ARC_MESSAGE_TRANSMITTER_ADDRESS = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;

export const ARC_TESTNET = {
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    /* 18 at the RPC/EVM level (verified: eth_getBalance returns 80e18 for an 80-USDC
       wallet). The 6-decimal representation belongs to the ERC-20 USDC interface only. */
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://testnet.arcscan.app",
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
    /* 18 at the RPC/EVM level — see ARC_TESTNET note. */
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://arcscan.app",
    },
  },
} as const;

/* CCTP Configuration mapping chainId -> { tokenMessenger, usdc, name, domain } */
export const CCTP_CONFIG: Record<number, { tokenMessenger: `0x${string}`; usdc: `0x${string}`; name: string; domain: number }> = isProd
  ? {
      1: {
        tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
        usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        name: "Ethereum Mainnet",
        domain: 0,
      },
    }
  : {
      11155111: {
        tokenMessenger: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
        usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        name: "Ethereum Sepolia",
        domain: 7,
      },
    };

/* Arc CCTP Domain ID: 26 for Arc Testnet / TBD_MAINNET_DOMAIN (using 26) for Arc Mainnet */
export const ARC_CCTP_DOMAIN_ID = 26 as const;

