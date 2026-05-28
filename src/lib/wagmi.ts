import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

export const arcTestnet = defineChain({
    id: 5042002,
    name: "Arc Testnet",
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
});

export const config = createConfig({
    chains: [arcTestnet],
    connectors: [injected()],
    transports: {
        [5042002]: http(),
    },
    ssr: true,
});
