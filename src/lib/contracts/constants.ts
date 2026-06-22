export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042001 as const;

export const isProd = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";

/* The active network is selected by NEXT_PUBLIC_ENVIRONMENT (testnet by default), so switching to
   mainnet is a configuration change, not a code change. */
export const ACTIVE_CHAIN_ID = isProd ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;

type Addr = `0x${string}`;

/* Deployment-specific contract addresses.
   - testnet: use the documented testnet deployment unless an env override is provided.
   - mainnet: REQUIRE an explicit env value. We deliberately do NOT fall back to the testnet address
     on mainnet — a missing value yields "" so ethers/viem throws loudly instead of silently routing
     real USDC to a testnet contract. */
function deployAddr(envValue: string | undefined, testnetDefault: Addr): Addr {
  const v = envValue?.trim();
  if (isProd) return (v || "") as Addr;
  return (v || testnetDefault) as Addr;
}

/* Network-agnostic addresses (e.g. the Arc native USDC precompile) default on both networks but can
   still be overridden by env. */
function fixedAddr(envValue: string | undefined, defaultBoth: Addr): Addr {
  const v = envValue?.trim();
  return (v || defaultBoth) as Addr;
}

export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;
export const PREMIUM_PLAN_ID = "premium-monthly" as const;
export const PREMIUM_PLAN_PRICE_USDC = "10" as const;

export const MERCHANT_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_PLATFORM_MERCHANT_ADDRESS, "0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295");
export const SUBSCRIPT_ROUTER_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_ROUTER_ADDRESS, "0x6946B7746c2968B195BD15319D25F67E587CAe3C");
export const STANDARD_CONTRACT_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_STANDARD_ADDRESS, "0x38594705B7feE26B5E05a04069695A907b725b9f");
export const CONFIDENTIAL_CONTRACT_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_CONFIDENTIAL_ADDRESS, "0x78E91a54B42A0dCd5Ac6153096B72b9a7A2Fbc1e");
export const PREMIUM_PAYMENT_RECIPIENT_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_PREMIUM_RECIPIENT_ADDRESS, "0x725D56151CeaC9eAd625241D13b8307B22EDDb10");
export const ARC_MEMO_CONTRACT_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_MEMO_ADDRESS, "0x5294E9927c3306DcBaDb03fe70b92e01cCede505");
export const ARC_MESSAGE_TRANSMITTER_ADDRESS = deployAddr(process.env.NEXT_PUBLIC_MESSAGE_TRANSMITTER_ADDRESS, "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275");

/* Native USDC gas token address is the same Arc precompile on both networks. */
export const USDC_NATIVE_GAS_ADDRESS = fixedAddr(process.env.NEXT_PUBLIC_USDC_ADDRESS, "0x3600000000000000000000000000000000000000");

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

