"use client";

import React from "react";

interface ChainLogoProps {
  chain?: string | number | null;
  className?: string;
  size?: number;
}

export function ChainLogo({ chain, className = "h-5 w-5", size = 20 }: ChainLogoProps) {
  const identifier = String(chain || "").toLowerCase().trim();

  // Ethereum / Sepolia
  if (
    identifier === "1" ||
    identifier === "11155111" ||
    identifier.includes("eth") ||
    identifier.includes("sepolia") ||
    identifier === "0"
  ) {
    return (
      <img
        src="/chains/ethereum.svg"
        alt="Ethereum"
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Base / Base Sepolia
  if (
    identifier === "8453" ||
    identifier === "84532" ||
    identifier.includes("base") ||
    identifier === "6"
  ) {
    return (
      <img
        src="/chains/base.svg"
        alt="Base"
        width={size}
        height={size}
        className={`shrink-0 object-contain rounded-full ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Arbitrum / Arbitrum One / Arbitrum Sepolia
  if (
    identifier === "42161" ||
    identifier === "421614" ||
    identifier.includes("arbitrum") ||
    identifier.includes("arb") ||
    identifier === "3"
  ) {
    return (
      <img
        src="/chains/arbitrum.svg"
        alt="Arbitrum"
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Optimism / OP Mainnet / OP Sepolia
  if (
    identifier === "10" ||
    identifier === "11155420" ||
    identifier.includes("optimism") ||
    identifier.includes("op ") ||
    identifier.includes("op_") ||
    identifier === "op" ||
    identifier === "2"
  ) {
    return (
      <img
        src="/chains/optimism.svg"
        alt="Optimism"
        width={size}
        height={size}
        className={`shrink-0 object-contain rounded-full ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Polygon / Amoy
  if (
    identifier === "137" ||
    identifier === "80002" ||
    identifier.includes("polygon") ||
    identifier.includes("amoy") ||
    identifier.includes("pol") ||
    identifier.includes("matic") ||
    identifier === "7"
  ) {
    return (
      <img
        src="/chains/polygon.svg"
        alt="Polygon"
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Avalanche / Avalanche Fuji
  if (
    identifier === "43114" ||
    identifier === "43113" ||
    identifier.includes("avax") ||
    identifier.includes("avalanche") ||
    identifier.includes("fuji")
  ) {
    return (
      <img
        src="/chains/avalanche.svg"
        alt="Avalanche"
        width={size}
        height={size}
        className={`shrink-0 object-contain rounded-full ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Solana
  if (identifier.includes("sol") || identifier === "5") {
    return (
      <img
        src="/chains/solana.svg"
        alt="Solana"
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // USDC
  if (identifier === "usdc") {
    return (
      <img
        src="/chains/usdc.svg"
        alt="USDC"
        width={size}
        height={size}
        className={`shrink-0 object-contain rounded-full ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // Arc Network (Primary / Default)
  return (
    <img
      src="/chains/arc.svg"
      alt="Arc Network"
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
