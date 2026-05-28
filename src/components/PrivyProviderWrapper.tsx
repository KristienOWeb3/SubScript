"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";

/*
 * Privy Authentication Provider is intentionally bypassed in this build.
 * This resolves Privy dependencies compilation issues and locks.
 *
 * To securely reactivate Privy in the future, follow these steps:
 *
 * 1. Reinstate Privy imports and wrap the providers tree:
 *    import { PrivyProvider } from "@privy-io/react-auth";
 *
 * 2. Configure the following environment variables in your server hosting
 *    and local developer environment (.env and .env.local):
 *
 *    # Flag to reactivate Privy gates in wrapper and routers:
 *    NEXT_PUBLIC_PRIVY_ENABLED=true
 *
 *    # Your custom Privy Project App ID (from dashboard.privy.io):
 *    NEXT_PUBLIC_PRIVY_APP_ID="insert-your-privy-app-id-here"
 *
 *    # Privy App Secret (keep this server-side only, never prefix with NEXT_PUBLIC_):
 *    PRIVY_APP_SECRET="insert-your-privy-app-secret-here"
 *
 * 3. Uncomment/restore the <PrivyProvider> component wrapping within the provider tree below.
 */

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: false,
        },
    },
});

export default function PrivyProviderWrapper({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProvider>
    );
}
