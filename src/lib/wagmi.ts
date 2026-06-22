import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { mainnet, base, sepolia, baseSepolia } from "viem/chains";
import { ACTIVE_CHAIN_ID, ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID, isProd } from "@/lib/contracts/constants";

const arcRpcUrl =
    process.env.NEXT_PUBLIC_ARC_RPC_PRIMARY ||
    process.env.NEXT_PUBLIC_ARC_RPC_URL ||
    (isProd ? "https://rpc.mainnet.arc.network" : "https://rpc.testnet.arc.network");

/* The active Arc chain (testnet by default, mainnet when NEXT_PUBLIC_ENVIRONMENT=mainnet). Kept under
   the `arcTestnet` export name for backward compatibility with existing imports. */
export const arcTestnet = defineChain({
    id: ACTIVE_CHAIN_ID,
    name: isProd ? "Arc Mainnet" : "Arc Testnet",
    nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        decimals: 6,
    },
    rpcUrls: {
        default: {
            http: [arcRpcUrl],
        },
    },
    blockExplorers: {
        default: {
            name: "Arc Explorer",
            url: "https://explorer.arc.network",
        },
    },
});

export const config = createConfig({
    chains: [arcTestnet, mainnet, base, sepolia, baseSepolia],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
        [ARC_TESTNET_CHAIN_ID]: http(arcRpcUrl),
        [ARC_MAINNET_CHAIN_ID]: http(arcRpcUrl),
        [1]: http(),
        [8453]: http(),
        [11155111]: http(),
        [84532]: http(),
    },
    ssr: true,
});
