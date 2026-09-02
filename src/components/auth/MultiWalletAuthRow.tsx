"use client";

import React, { useMemo } from "react";
import type { Connector } from "wagmi";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import {
  MetaMaskIcon,
  RabbyIcon,
  PhantomIcon,
  OkxIcon,
  TrustWalletIcon,
  CoinbaseIcon,
  RainbowIcon,
  BraveIcon,
  WalletIcon,
  MetaMaskColorSpinner,
} from "@/components/auth/WalletIcons";
import { Loader2 } from "lucide-react";

interface MultiWalletAuthRowProps {
  googleAvailable?: boolean;
  externalWalletEnabled?: boolean;
  onGoogleSuccess: (data: any) => void;
  connectors: readonly Connector[];
  onSelectConnector: (connector: Connector) => void;
  onNoWalletDetected: (message: string) => void;
  onOpenModal?: () => void;
  isConnecting?: boolean;
  siweLoading?: boolean;
  connectingConnectorId?: string | null;
  disabled?: boolean;
}

export function MultiWalletAuthRow({
  googleAvailable = true,
  externalWalletEnabled = true,
  onGoogleSuccess,
  connectors,
  onSelectConnector,
  onNoWalletDetected,
  onOpenModal,
  isConnecting = false,
  siweLoading = false,
  connectingConnectorId = null,
  disabled = false,
}: MultiWalletAuthRowProps) {
  // Check which wallets are actually detected in the user's browser
  const detectedConnectors = useMemo(() => {
    // 1. Check for specific EIP-6963 announced providers (MetaMask, Rabby, Phantom, OKX, Trust, etc.)
    const specific = connectors.filter((c) => c.id !== "injected");
    if (specific.length > 0) {
      const seen = new Set<string>();
      return specific.filter((c) => {
        const key = (c.name || c.id).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // 2. If no EIP-6963 providers, check if legacy window.ethereum exists
    if (typeof window !== "undefined" && Boolean((window as any).ethereum)) {
      const injected = connectors.find((c) => c.id === "injected") || connectors[0];
      return injected ? [injected] : [];
    }

    // 3. No wallet extension detected
    return [];
  }, [connectors]);

  const isBusy = isConnecting || siweLoading;

  // Helper to render the specific official icon for a connector
  const renderConnectorIcon = (c: Connector) => {
    const lower = (c.name + " " + c.id).toLowerCase();
    if (lower.includes("metamask")) return <MetaMaskIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("rabby")) return <RabbyIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("phantom")) return <PhantomIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("okx") || lower.includes("okex")) return <OkxIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("trust")) return <TrustWalletIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("coinbase")) return <CoinbaseIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("rainbow")) return <RainbowIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;
    if (lower.includes("brave")) return <BraveIcon className="w-5 h-5 transition-transform group-hover:scale-110" />;

    return <WalletIcon name={c.name} id={c.id} iconUrl={c.icon} className="w-5 h-5 transition-transform group-hover:scale-110" />;
  };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap">
      {/* Google Sign-in */}
      {googleAvailable && (
        <div className="shrink-0">
          <CircleGoogleWalletButton onSuccess={onGoogleSuccess} variant="icon" disabled={disabled} />
        </div>
      )}

      {externalWalletEnabled && (
        <>
          {detectedConnectors.length === 0 ? (
            /* NO wallet detected: ONLY show MetaMask icon button.
               When clicked, explicitly display error that no wallet is detected. */
            <button
              type="button"
              onClick={() =>
                onNoWalletDetected("No Web3 wallet detected. Please install a browser extension like MetaMask, Rabby, or OKX to continue.")
              }
              disabled={disabled || isBusy}
              title="MetaMask (No wallet detected)"
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
            >
              <MetaMaskIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
            </button>
          ) : (
            /* One or more wallets DETECTED: show each detected wallet with its official logo */
            detectedConnectors.map((connector) => {
              const isCurrentConnecting = isBusy && connectingConnectorId === connector.id;
              const isMetaMask = (connector.name + " " + connector.id).toLowerCase().includes("metamask");

              return (
                <button
                  key={connector.uid || connector.id}
                  type="button"
                  onClick={() => onSelectConnector(connector)}
                  disabled={disabled || isBusy}
                  title={`Connect ${connector.name}`}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
                >
                  {isCurrentConnecting ? (
                    isMetaMask ? (
                      <MetaMaskColorSpinner className="w-4 h-4" />
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-[#2775CA]" />
                    )
                  ) : (
                    renderConnectorIcon(connector)
                  )}
                  {/* Subtle detected dot */}
                  <span
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#FFFFF0]"
                    title="Installed"
                  />
                </button>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
