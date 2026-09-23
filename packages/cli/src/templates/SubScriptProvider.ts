export interface ProviderTemplateOptions {
  cliVersion: string;
  templateVersion: string;
  requestId: string;
  generationTimestamp: string;
}

export function generateProviderTemplate(opts: ProviderTemplateOptions): string {
  return `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */

"use client";

import React from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { subscriptConfig } from "./subscript.config";

export const arcChain = defineChain({
  id: subscriptConfig.chainId,
  name: subscriptConfig.networkName,
  nativeCurrency: {
    name: subscriptConfig.nativeCurrency.name,
    symbol: subscriptConfig.nativeCurrency.symbol,
    decimals: subscriptConfig.nativeCurrency.decimals,
  },
  rpcUrls: {
    default: {
      http: [subscriptConfig.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: subscriptConfig.explorerUrl,
    },
  },
});

export const config = createConfig({
  chains: [arcChain],
  connectors: [injected()],
  transports: {
    [subscriptConfig.chainId]: http(subscriptConfig.rpcUrl),
  },
  ssr: true,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

export function SubScriptProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
`;
}
