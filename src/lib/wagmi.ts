import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { mainnet, base, sepolia, baseSepolia } from "viem/chains";

/* Arc network is selected by NEXT_PUBLIC_ENVIRONMENT ("mainnet" => Arc mainnet, anything else =>
   testnet), so the client targets the same chain the cutover env vars point the contracts at.
   Defaults to testnet, so current behaviour is unchanged until NEXT_PUBLIC_ENVIRONMENT=mainnet. */
const isArcMainnet = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
const arcChainId = isArcMainnet ? 5042001 : 5042002;
const arcRpcUrl =
    process.env.NEXT_PUBLIC_ARC_RPC_PRIMARY ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL ||
    (isArcMainnet ? "https://rpc.mainnet.arc.network" : "https://rpc.testnet.arc.network");

/* Exported as `arcTestnet` for backward-compatible imports; it is the ACTIVE Arc chain (mainnet or
   testnet) per NEXT_PUBLIC_ENVIRONMENT above. */
export const arcTestnet = defineChain({
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

export const config = createConfig({
    chains: [arcTestnet, mainnet, base, sepolia, baseSepolia],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
        /* Both Arc chain ids map to the active RPC; only the selected one (arcChainId) is used. */
        5042002: http(arcRpcUrl),
        5042001: http(arcRpcUrl),
        1: http(),
        8453: http(),
        11155111: http(),
        84532: http(),
    },
    ssr: true,
});
