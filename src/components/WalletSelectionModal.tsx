"use client";

import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, Loader2, CheckCircle2, ChevronRight, ExternalLink } from "lucide-react";
import type { Connector } from "wagmi";
import { WalletIcon } from "@/components/auth/WalletIcons";

interface WalletSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectors: readonly Connector[];
  onSelectConnector: (connector: Connector) => void;
  connectingConnectorId?: string | null;
  activeConnectorId?: string | null;
  isConnected?: boolean;
}

export function WalletSelectionModal({
  isOpen,
  onClose,
  connectors,
  onSelectConnector,
  connectingConnectorId,
  activeConnectorId,
  isConnected = false,
}: WalletSelectionModalProps) {
  // Deduplicate discovered wallet extensions and filter out redundant generic injected if specific EIP-6963 exist
  const availableConnectors = useMemo(() => {
    const specific = connectors.filter((c) => c.id !== "injected");
    const list = specific.length > 0 ? specific : connectors;
    const seen = new Set<string>();
    return list.filter((c) => {
      const key = (c.name || c.id).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connectors]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        />

        {/* Modal Dialog */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-modal-title"
          className="relative w-full max-w-sm rounded-3xl bg-[#FFFFF0] border border-black/15 p-6 shadow-2xl z-10 space-y-4"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="wallet-modal-title" className="text-base font-bold text-[#111827]">
                Select a Wallet
              </h2>
              <p className="text-xs text-black/60 mt-0.5">
                {availableConnectors.length > 1
                  ? "Choose which installed wallet extension to connect"
                  : "Connect your browser wallet extension"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-black/5 text-black/50 hover:text-black transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Connector List */}
          <div className="space-y-2 pt-1">
            {availableConnectors.length > 0 ? (
              availableConnectors.map((connector) => {
                const isCurrent = isConnected && activeConnectorId === connector.id;
                const isPending = connectingConnectorId === connector.id;
                const isMetaMask = connector.name.toLowerCase().includes("metamask") || connector.id.includes("metamask");

                return (
                  <button
                    key={connector.uid || connector.id}
                    type="button"
                    onClick={() => onSelectConnector(connector)}
                    disabled={Boolean(connectingConnectorId)}
                    className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all ${
                      isCurrent
                        ? "border-[#2775CA] bg-[#2775CA]/5 shadow-xs"
                        : "border-black/10 bg-white hover:border-[#2775CA]/50 hover:bg-white hover:shadow-xs active:scale-[0.99]"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl border border-black/10 bg-[#FFFFF0] flex items-center justify-center shrink-0 overflow-hidden p-1 shadow-xs">
                        <WalletIcon
                          name={connector.name}
                          id={connector.id}
                          iconUrl={connector.icon}
                          className="w-6 h-6"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#111827] truncate">
                            {connector.name}
                          </span>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#2775CA] bg-[#2775CA]/10 px-1.5 py-0.5 rounded-md">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2775CA] animate-pulse" />
                              Connected
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-black/50 block truncate">
                          Installed extension
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center">
                      {isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#2775CA]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-black/30 group-hover:text-black/60 transition-colors" />
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-center space-y-2">
                <p className="text-xs font-semibold text-amber-900">
                  No browser wallets detected
                </p>
                <p className="text-[11px] text-amber-900/80 leading-relaxed">
                  Install a Web3 browser extension like MetaMask or Rabby, then refresh the page.
                </p>
                <div className="flex items-center justify-center gap-4 pt-1">
                  <a
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-[#2775CA] hover:underline inline-flex items-center gap-1"
                  >
                    Get MetaMask <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href="https://rabby.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-[#2775CA] hover:underline inline-flex items-center gap-1"
                  >
                    Get Rabby <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Other Popular Wallets (Install links) */}
          <div className="pt-2 border-t border-black/10 space-y-2">
            <span className="text-[10px] font-bold text-black/50 uppercase tracking-wider block">
              More Supported Wallets
            </span>
            <div className="grid grid-cols-4 gap-2">
              {[
                { name: "MetaMask", id: "metamask", url: "https://metamask.io/download/" },
                { name: "Rabby", id: "rabby", url: "https://rabby.io/" },
                { name: "Phantom", id: "phantom", url: "https://phantom.app/" },
                { name: "OKX", id: "okx", url: "https://www.okx.com/web3" },
              ].map((wallet) => (
                <a
                  key={wallet.id}
                  href={wallet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-xl border border-black/10 bg-white hover:bg-black/5 flex flex-col items-center justify-center gap-1 group transition-all"
                  title={`Install ${wallet.name}`}
                >
                  <div className="w-6 h-6 flex items-center justify-center transition-transform group-hover:scale-110">
                    <WalletIcon name={wallet.name} id={wallet.id} className="w-5 h-5" />
                  </div>
                  <span className="text-[9px] font-medium text-black/70 truncate group-hover:text-black">
                    {wallet.name}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Footer note */}
          <p className="text-[10px] text-black/45 text-center leading-relaxed">
            By connecting an external wallet, you can sign into SubScript securely with zero password or seed phrase exposure.
          </p>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default WalletSelectionModal;
