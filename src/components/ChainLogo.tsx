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
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <path d="M16.498 4v8.87l7.497 3.35L16.498 4z" fill="#fff" fillOpacity="0.6" />
        <path d="M16.498 4L9 16.22l7.498-3.35V4z" fill="#fff" />
        <path d="M16.498 21.968v6.027L24 17.616l-7.502 4.352z" fill="#fff" fillOpacity="0.6" />
        <path d="M16.498 27.995v-6.027L9 17.616l7.498 10.38z" fill="#fff" />
        <path d="M16.498 20.573l7.497-4.353-7.497-3.348v7.701z" fill="#fff" fillOpacity="0.2" />
        <path d="M9 16.22l7.498 4.353v-7.701L9 16.22z" fill="#fff" fillOpacity="0.6" />
      </svg>
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
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="16" cy="16" r="16" fill="#0052FF" />
        <circle cx="16" cy="16" r="8" fill="#FFFFFF" />
      </svg>
    );
  }

  // Arbitrum / Arbitrum Sepolia
  if (
    identifier === "42161" ||
    identifier === "421614" ||
    identifier.includes("arbitrum") ||
    identifier.includes("arb") ||
    identifier === "3"
  ) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="16" cy="16" r="16" fill="#28A0F0" />
        <path
          d="M16.02 7L9.5 17.58l3.12 5.09h3.69l-3.32-5.41 3.03-4.93 3.04 4.93-1.63 2.65h3.69l-1.04-1.7 3.42-5.63L16.02 7z"
          fill="#FFFFFF"
        />
        <path
          d="M19.46 22.67l-2.02-3.3-1.42 2.31 0.61 0.99h2.83z"
          fill="#96BEDC"
        />
      </svg>
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
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="16" cy="16" r="16" fill="#FF0420" />
        <path
          d="M13.8 11.2c-2.8 0-4.6 1.9-4.6 4.8 0 2.9 1.8 4.8 4.6 4.8s4.6-1.9 4.6-4.8c0-2.9-1.8-4.8-4.6-4.8zm0 7.3c-1.5 0-2.3-1.1-2.3-2.5 0-1.4.8-2.5 2.3-2.5s2.3 1.1 2.3 2.5c0 1.4-.8 2.5-2.3 2.5zm6.5-7.1h2.2c1.9 0 3.1 1 3.1 2.6 0 1.6-1.2 2.6-3.1 2.6h-2.2v-5.2zm2.1 3.6c.7 0 1.1-.4 1.1-1s-.4-1-1.1-1h-.2v2h.2z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }

  // Polygon / Amoy
  if (
    identifier === "137" ||
    identifier === "80002" ||
    identifier.includes("polygon") ||
    identifier.includes("amoy") ||
    identifier.includes("pol") ||
    identifier === "7"
  ) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="16" cy="16" r="16" fill="#8247E5" />
        <path
          d="M21.13 13.06c-.47-.27-1.05-.27-1.52 0l-2.6 1.5-1.74 1-2.6 1.5c-.47.27-.76.77-.76 1.31v3c0 .54.29 1.04.76 1.31.47.27 1.05.27 1.52 0l2.6-1.5 1.74-1 2.6-1.5c.47-.27.76-.77.76-1.31v-3c0-.54-.29-1.04-.76-1.31zm-6.86 3.96l-1.74 1v-2l1.74-1v2zm3.48-2l-1.74 1-1.74-1 1.74-1 1.74 1zm3.48 2l-1.74 1v-2l1.74-1v2z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }

  // Solana
  if (identifier.includes("sol") || identifier === "5") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="16" cy="16" r="16" fill="#18181B" />
        <path
          d="M9 20.8l2.6-2.6h11.4l-2.6 2.6H9zm0-4.8l2.6-2.6h11.4l-2.6 2.6H9zm2.6-4.8L9 8.6h11.4l2.6 2.6H11.6z"
          fill="url(#sol_grad)"
        />
        <defs>
          <linearGradient id="sol_grad" x1="9" y1="8.6" x2="23" y2="20.8" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00FFA3" />
            <stop offset="1" stopColor="#DC1FFF" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  // Arc Network (Default / Primary)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 rounded-full ${className}`}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M16 6C10.48 6 6 10.48 6 16c0 3.32 1.62 6.27 4.12 8.08l1.45-2.01A7.94 7.94 0 018.5 16C8.5 11.86 11.86 8.5 16 8.5c4.14 0 7.5 3.36 7.5 7.5 0 2.29-1.03 4.34-2.66 5.72l1.54 1.95A9.95 9.95 0 0026 16c0-5.52-4.48-10-10-10z"
        fill="#CCFF00"
      />
      <circle cx="16" cy="16" r="3.5" fill="#FFFFFF" />
    </svg>
  );
}
