export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_MAINNET_CHAIN_ID = 5042001 as const;

export const MERCHANT_ADDRESS = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10" as const;
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
export const ARC_MESSAGE_TRANSMITTER_ADDRESS = envAddress(process.env.NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER_ADDRESS || process.env.ARC_MESSAGE_TRANSMITTER_ADDRESS, "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275");

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

export interface CCTPChainInfo {
  /* TokenMessengerV2 — the contract depositForBurn is called on. */
  tokenMessenger: `0x${string}`;
  /* MessageTransmitterV2 — the contract receiveMessage is called on. These are two different
     contracts and they are not interchangeable; relaying a mint to the TokenMessenger reverts. */
  messageTransmitter: `0x${string}`;
  usdc: `0x${string}`;
  name: string;
  domain: number;
  /* Protocol bridge fee, in basis points. 100 = 1.0% (Ethereum L1 ERC-20), 50 = 0.5% (everything
     else). Read this rather than hardcoding a percentage anywhere; see lib/cctp/feeEngine. */
  feeBps: number;
  nativeTokenSymbol: string;
  /* Ethereum L1. Carries the 1% tier and a slower finality window than the L2s. */
  isL1?: boolean;
  allowDeposits?: boolean;
  allowWithdrawals?: boolean;
  /* Public RPC used when no RPC_URL_<chainId> env override is set. Read-only calls only. */
  defaultRpc: string;
}

/* CCTP V2 addresses are deterministic: one TokenMessengerV2 and one MessageTransmitterV2 per
   environment, identical on every EVM chain. Verified on-chain 2026-08-28 by calling
   localMessageTransmitter() and feeRecipient() (both V2-only) against Ethereum, Base, Polygon and
   Sepolia — see the probe in the PR discussion.

   These MUST be the V2 contracts. Arc is V2-only (its transmitter is MessageTransmitterV2), so a
   burn routed through a V1 TokenMessenger emits a V1 message Arc will never receive, and the funds
   are unrecoverable. The V1 addresses look plausible and are widely copy-pasted from older docs:
   0xBd3fa81B… (Ethereum), 0x1682Ae63… (Base), 0x19330d10… (Arbitrum), 0x2B406951… (OP),
   0x9daF8c91… (Polygon), 0x9f3B8679… (all testnets). Every one of those is V1. Do not "fix" the
   values below back to them. A V1 address answers localMessageTransmitter() with a V1 transmitter
   and has no feeRecipient(); that call is how you tell them apart. */
const CCTP_V2_TOKEN_MESSENGER = (isProd
  ? "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"
  : "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA") as `0x${string}`;
const CCTP_V2_MESSAGE_TRANSMITTER = (isProd
  ? "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"
  : "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275") as `0x${string}`;

/* CCTP Configuration mapping chainId -> CCTPChainInfo */
export const CCTP_CONFIG: Record<number, CCTPChainInfo> = isProd
  ? {
      1: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        name: "Ethereum",
        domain: 0,
        feeBps: 100,
        nativeTokenSymbol: "ETH",
        isL1: true,
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://ethereum-rpc.publicnode.com",
      },
      43114: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        name: "Avalanche",
        domain: 1,
        feeBps: 50,
        nativeTokenSymbol: "AVAX",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://api.avax.network/ext/bc/C/rpc",
      },
      10: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        name: "OP Mainnet",
        domain: 2,
        feeBps: 50,
        nativeTokenSymbol: "ETH",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://optimism-rpc.publicnode.com",
      },
      137: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        name: "Polygon",
        domain: 7,
        feeBps: 50,
        nativeTokenSymbol: "POL",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://polygon-bor-rpc.publicnode.com",
      },
      8453: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        name: "Base",
        domain: 6,
        feeBps: 50,
        nativeTokenSymbol: "ETH",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://base-rpc.publicnode.com",
      },
      42161: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        name: "Arbitrum One",
        domain: 3,
        feeBps: 50,
        nativeTokenSymbol: "ETH",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://arbitrum-one-rpc.publicnode.com",
      },
    }
  : {
      11155111: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        name: "Ethereum Sepolia",
        domain: 0,
        feeBps: 100,
        nativeTokenSymbol: "ETH",
        isL1: true,
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://rpc.sepolia.org",
      },
      43113: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
        name: "Avalanche Fuji",
        domain: 1,
        feeBps: 50,
        nativeTokenSymbol: "AVAX",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://api.avax-test.network/ext/bc/C/rpc",
      },
      84532: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        name: "Base Sepolia",
        domain: 6,
        feeBps: 50,
        nativeTokenSymbol: "ETH",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://sepolia.base.org",
      },
      421614: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        name: "Arbitrum Sepolia",
        domain: 3,
        feeBps: 50,
        nativeTokenSymbol: "ETH",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://sepolia-rollup.arbitrum.io/rpc",
      },
      11155420: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
        name: "OP Sepolia",
        domain: 2,
        feeBps: 50,
        nativeTokenSymbol: "ETH",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://sepolia.optimism.io",
      },
      80002: {
        tokenMessenger: CCTP_V2_TOKEN_MESSENGER,
        messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
        usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
        name: "Polygon Amoy",
        domain: 7,
        feeBps: 50,
        nativeTokenSymbol: "POL",
        allowDeposits: true,
        allowWithdrawals: true,
        defaultRpc: "https://polygon-amoy-bor-rpc.publicnode.com",
      },
    };

/* Solana, CCTP domain 5.

   allowWithdrawals is false and stays false until a Solana relayer exists. Receiving a CCTP
   transfer on Solana needs a signed Solana transaction against the MessageTransmitter program, and
   nothing in this codebase can produce one. Flipping this to true without that relayer burns the
   user's USDC on Arc with no way to mint the other side. */
export const SOLANA_CCTP_CONFIG = {
  domain: 5,
  name: "Solana",
  feeBps: 50,
  nativeTokenSymbol: "SOL",
  allowDeposits: false,
  allowWithdrawals: false,
  /* Program ids are identical on devnet and mainnet-beta; Solana programs are deployed to the same
     address on both. usdcMint does differ. */
  tokenMessengerMinterProgramId: "CCTPiPYPc6AsJuwueEnWgSgucK3vANSubU4pMukbTWYp",
  messageTransmitterProgramId: "CCTPmbSD7gX1bxKPAmg37pM4C62c8hVvskdY5t9zG9L",
  usdcMint: isProd ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

/* Arc CCTP Domain ID: 26 for Arc Testnet / Arc Mainnet */
export const ARC_CCTP_DOMAIN_ID = 26 as const;

/* Arc's own TokenMessengerV2, used for outbound burns when withdrawing off Arc. Env-overridable for
   the same reason as the other Arc addresses: the mainnet cutover should be config, not a code
   edit. Defaults to the deterministic V2 address for the active environment. */
export const ARC_TOKEN_MESSENGER_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER_ADDRESS || process.env.ARC_TOKEN_MESSENGER_ADDRESS,
  CCTP_V2_TOKEN_MESSENGER,
);

/* Where the protocol bridge fee lands. The fee is a plain USDC transfer taken before the burn, so
   this is an ordinary address and the same one works on every EVM chain. Falls back to the merchant
   treasury so a missing env var can never send fees to the zero address. */
export const BRIDGE_FEE_TREASURY_ADDRESS = envAddress(
  process.env.NEXT_PUBLIC_BRIDGE_FEE_TREASURY_ADDRESS || process.env.BRIDGE_FEE_TREASURY_ADDRESS,
  MERCHANT_ADDRESS,
);

/* Circle's attestation service. Sandbox and production are separate deployments with separate
   message stores; querying the wrong one returns 404 for every transfer forever. */
export const CCTP_IRIS_BASE_URL = isProd
  ? "https://iris-api.circle.com"
  : "https://iris-api-sandbox.circle.com";


