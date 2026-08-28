import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import {
    mainnet,
    base,
    sepolia,
    baseSepolia,
    arbitrum,
    arbitrumSepolia,
    optimism,
    polygon,
} from "viem/chains";
import { arcHttp } from "@/lib/arc/transport";

/* Arc network is selected by NEXT_PUBLIC_ENVIRONMENT ("mainnet" => Arc mainnet, anything else =>
   testnet), so the client targets the same chain the cutover env vars point the contracts at.
   Defaults to testnet, so current behaviour is unchanged until NEXT_PUBLIC_ENVIRONMENT=mainnet. */
const isArcMainnet = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
const arcChainId = isArcMainnet ? 5042001 : 5042002;
const arcRpcUrl =
    process.env.NEXT_PUBLIC_ARC_RPC_PRIMARY ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL ||
    (isArcMainnet ? "https://rpc.mainnet.arc.network" : "https://rpc.testnet.arc.network");

/* The ACTIVE Arc chain (mainnet or testnet) per NEXT_PUBLIC_ENVIRONMENT above. */
export const activeArcChain = defineChain({
    id: arcChainId,
    name: isArcMainnet ? "Arc" : "Arc Testnet",
    nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        /* Native USDC is 18 decimals at the RPC/EVM level (eth_getBalance for an 80-USDC
           wallet returns 80e18; gas prices are gwei-scale). Only the ERC-20 USDC interface
           uses 6 decimals. Declaring 6 here made wallets and native-balance formatting
           misread amounts by 1e12. */
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: [arcRpcUrl],
        },
    },
    blockExplorers: {
        default: {
            name: "Arc Explorer",
            url: isArcMainnet ? "https://arcscan.app" : "https://testnet.arcscan.app",
        },
    },
});

/** @deprecated The name lied — this was always the ACTIVE Arc chain. Import activeArcChain. */
export const arcTestnet = activeArcChain;

/* Shared with every other Arc caller — see lib/arc/transport for why a bare http() loses reads. */
const arcTransport = arcHttp(arcRpcUrl);

/* Every chain CCTP_CONFIG can name has to be listed here, on both networks. A chain missing from
   this list cannot be read from with useReadContract and cannot be switched to with switchChain, so
   a deposit from it fails at the wallet prompt with nothing useful to show the user. Mainnet and
   testnet chains are both included because NEXT_PUBLIC_ENVIRONMENT decides which set CCTP_CONFIG
   exposes, and the wagmi config is built once at import time. */
export const config = createConfig({
    chains: [
        activeArcChain,
        mainnet,
        optimism,
        polygon,
        base,
        arbitrum,
        sepolia,
        baseSepolia,
        arbitrumSepolia,
    ],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
        /* Both Arc chain ids map to the active RPC; only the selected one (arcChainId) is used. */
        5042002: arcTransport,
        5042001: arcTransport,
        1: http(),
        10: http(),
        137: http(),
        8453: http(),
        42161: http(),
        11155111: http(),
        84532: http(),
        421614: http(),
    },
    ssr: true,
});
