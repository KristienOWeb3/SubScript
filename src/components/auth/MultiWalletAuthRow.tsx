"use client";

import React, { useMemo } from "react";
import type { Connector } from "wagmi";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";
import {
  MetaMaskIcon,
  RabbyIcon,
  PhantomIcon,
  OkxIcon,
  WalletIcon,
  MetaMaskColorSpinner,
} from "@/components/auth/WalletIcons";
import { Wallet, Loader2 } from "lucide-react";

interface MultiWalletAuthRowProps {
  googleAvailable?: boolean;
  externalWalletEnabled?: boolean;
  onGoogleSuccess: (data: any) => void;
  connectors: readonly Connector[];
  onSelectConnector: (connector: Connector) => void;
  onOpenModal: () => void;
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
  onOpenModal,
  isConnecting = false,
  siweLoading = false,
  connectingConnectorId = null,
  disabled = false,
}: MultiWalletAuthRowProps) {
  // Find connectors matching known wallets
  const walletMap = useMemo(() => {
    const map = new Map<string, Connector>();
    for (const c of connectors) {
      const lower = (c.name + " " + c.id).toLowerCase();
      if (lower.includes("metamask") && !map.has("metamask")) map.set("metamask", c);
      else if (lower.includes("rabby") && !map.has("rabby")) map.set("rabby", c);
      else if (lower.includes("phantom") && !map.has("phantom")) map.set("phantom", c);
      else if (lower.includes("okx") && !map.has("okx")) map.set("okx", c);
      else if (lower.includes("coinbase") && !map.has("coinbase")) map.set("coinbase", c);
    }
    return map;
  }, [connectors]);

  // Check if any specific connector is in progress
  const isBusy = isConnecting || siweLoading;

  const handleWalletClick = (walletKey: string) => {
    const connector = walletMap.get(walletKey);
    if (connector) {
      onSelectConnector(connector);
    } else {
      // If specific wallet is not directly matched, open modal to let user choose or see install instructions
      onOpenModal();
    }
  };

  const metamaskConnector = walletMap.get("metamask");
  const rabbyConnector = walletMap.get("rabby");
  const phantomConnector = walletMap.get("phantom");
  const okxConnector = walletMap.get("okx");

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap">
      {/* Google Sign-in */}
      {googleAvailable && (
        <div className="shrink-0">
          <CircleGoogleWalletButton onSuccess={onGoogleSuccess} variant="icon" />
        </div>
      )}

      {externalWalletEnabled && (
        <>
          {/* MetaMask Button */}
          <button
            type="button"
            onClick={() => handleWalletClick("metamask")}
            disabled={disabled || isBusy}
            title={metamaskConnector ? "Connect MetaMask" : "MetaMask (Click to choose or install)"}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
          >
            {isBusy && connectingConnectorId && metamaskConnector?.id === connectingConnectorId ? (
              <MetaMaskColorSpinner className="w-4 h-4" />
            ) : (
              <MetaMaskIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
            )}
            {metamaskConnector && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#FFFFF0]" title="Installed" />
            )}
          </button>

          {/* Rabby Button */}
          <button
            type="button"
            onClick={() => handleWalletClick("rabby")}
            disabled={disabled || isBusy}
            title={rabbyConnector ? "Connect Rabby Wallet" : "Rabby Wallet (Click to choose or install)"}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
          >
            {isBusy && connectingConnectorId && rabbyConnector?.id === connectingConnectorId ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#8697FF]" />
            ) : (
              <RabbyIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
            )}
            {rabbyConnector && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#FFFFF0]" title="Installed" />
            )}
          </button>

          {/* Phantom Button */}
          <button
            type="button"
            onClick={() => handleWalletClick("phantom")}
            disabled={disabled || isBusy}
            title={phantomConnector ? "Connect Phantom" : "Phantom (Click to choose or install)"}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
          >
            {isBusy && connectingConnectorId && phantomConnector?.id === connectingConnectorId ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#AB9FF2]" />
            ) : (
              <PhantomIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
            )}
            {phantomConnector && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#FFFFF0]" title="Installed" />
            )}
          </button>

          {/* OKX Button */}
          <button
            type="button"
            onClick={() => handleWalletClick("okx")}
            disabled={disabled || isBusy}
            title={okxConnector ? "Connect OKX Wallet" : "OKX Wallet (Click to choose or install)"}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
          >
            {isBusy && connectingConnectorId && okxConnector?.id === connectingConnectorId ? (
              <Loader2 className="w-4 h-4 animate-spin text-black" />
            ) : (
              <OkxIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
            )}
            {okxConnector && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#FFFFF0]" title="Installed" />
            )}
          </button>

          {/* More / All Wallets Button */}
          <button
            type="button"
            onClick={onOpenModal}
            disabled={disabled || isBusy}
            title="Choose from all installed wallets"
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group relative"
          >
            <Wallet className="w-4 h-4 text-black/70 group-hover:text-[#2775CA] transition-colors" />
          </button>
        </>
      )}
    </div>
  );
}

export default MultiWalletAuthRow;
