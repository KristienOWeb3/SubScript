"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EthereumProvider = {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on?: (event: string, handler: (...args: any[]) => void) => void;
    removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

declare global {
    interface Window {
        ethereum?: any;
    }
}

export const WALLET_PLACEHOLDER = "0xYOUR_CONNECTED_WALLET_ADDRESS";

function normalizeAddress(value: unknown) {
    return typeof value === "string" && value.startsWith("0x") ? value : "";
}

export function formatWalletAddress(address: string) {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function useBrowserWallet() {
    const [address, setAddress] = useState("");
    const [hasProvider, setHasProvider] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState("");

    const readAccounts = useCallback(async (requestConnection = false) => {
        const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
        setHasProvider(Boolean(ethereum));

        if (!ethereum) {
            setAddress("");
            return "";
        }

        const method = requestConnection ? "eth_requestAccounts" : "eth_accounts";
        const accounts = await ethereum.request({ method });
        const nextAddress = Array.isArray(accounts) ? normalizeAddress(accounts[0]) : "";
        setAddress(nextAddress);
        return nextAddress;
    }, []);

    const connect = useCallback(async () => {
        setIsConnecting(true);
        setError("");

        try {
            return await readAccounts(true);
        } catch (err: any) {
            const message = err?.code === 4001
                ? "Wallet connection was cancelled."
                : "Unable to connect wallet. Check your browser wallet and try again.";
            setError(message);
            return "";
        } finally {
            setIsConnecting(false);
        }
    }, [readAccounts]);

    useEffect(() => {
        readAccounts().catch(() => {
            setAddress("");
        });

        const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
        if (!ethereum?.on) return;

        const handleAccountsChanged = (accounts: unknown) => {
            const nextAddress = Array.isArray(accounts) ? normalizeAddress(accounts[0]) : "";
            setAddress(nextAddress);
        };

        ethereum.on("accountsChanged", handleAccountsChanged);
        return () => {
            ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
        };
    }, [readAccounts]);

    return useMemo(() => ({
        address,
        shortAddress: formatWalletAddress(address),
        hasProvider,
        isConnected: Boolean(address),
        isConnecting,
        error,
        connect,
        refresh: () => readAccounts(false),
    }), [address, connect, error, hasProvider, isConnecting, readAccounts]);
}
