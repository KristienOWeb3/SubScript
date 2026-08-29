"use client";

import React from "react";

interface ChainLogoProps {
  chain?: string | number | null;
  className?: string;
  size?: number;
}

export function ChainLogo({ chain, className = "h-5 w-5", size = 20 }: ChainLogoProps) {
  const identifier = String(chain || "").toLowerCase().trim();

  // Arc Network (Primary / Default)
  if (
    identifier === "5042002" ||
    identifier === "arc" ||
    identifier.includes("arc") ||
    identifier === ""
  ) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        fill="none"
        viewBox="0 0 24 24"
        className={`shrink-0 ${className}`}
      >
        <path
          fill="url(#arc__a)"
          d="M3.5 20.999c.146-4.407.893-8.519 2.142-11.717C7.223 5.231 9.513 3 12.088 3s4.865 2.231 6.447 6.283c.822 2.107 1.427 4.61 1.786 7.334q.048.366.087.737.015.024.013.041s.21 1.317.256 3.604h-.024c-.313-.256-4-3.153-10.112-2.314.093-1.035.22-2.04.383-3.005l.027-.146a24.5 24.5 0 0 1 6.104.57q-.007-.056-.017-.115c-.33-2.06-.819-3.945-1.448-5.556-1.029-2.635-2.371-4.271-3.502-4.271-1.132 0-2.474 1.636-3.503 4.271q-.375.958-.679 2.034a30 30 0 0 0-.718 3.213A40 40 0 0 0 6.662 21H3.5z"
        />
        <defs>
          <linearGradient
            id="arc__a"
            x1="12.088"
            x2="12.088"
            y1="3"
            y2="21"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#182680" />
            <stop offset="1" stopColor="#842D56" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

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
        viewBox="0 0 784.37 1277.39"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
      >
        <polygon fill="#343434" points="392.07,0 383.5,29.11 383.5,873.74 392.07,882.29 784.13,650.54 " />
        <polygon fill="#8C8C8C" points="392.07,0 0,650.54 392.07,882.29 392.07,472.33 " />
        <polygon fill="#3C3C3B" points="392.07,956.52 387.24,962.41 387.24,1263.28 392.07,1277.38 784.37,724.89 " />
        <polygon fill="#8C8C8C" points="392.07,1277.38 392.07,956.52 0,724.89 " />
        <polygon fill="#141414" points="392.07,882.29 784.13,650.54 392.07,472.33 " />
        <polygon fill="#393939" points="0,650.54 392.07,882.29 392.07,472.33 " />
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
        className={`shrink-0 rounded-lg ${className}`}
      >
        <rect width="32" height="32" rx="8" fill="#0052FF" />
        <circle cx="16" cy="16" r="7.5" fill="#FFFFFF" />
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
        viewBox="0 0 2500 2500"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
      >
        <path
          fill="#213147"
          d="M226,760v980c0,63,33,120,88,152l849,490c54,31,121,31,175,0l849-490c54-31,88-89,88-152V760 c0-63-33-120-88-152l-849-490c-54-31-121-31-175,0L314,608c-54,31-87,89-87,152H226z"
        />
        <path
          fill="#12AAFF"
          d="M1435,1440l-121,332c-3,9-3,19,0,29l208,571l241-139l-289-793C1467,1422,1442,1422,1435,1440z"
        />
        <path
          fill="#12AAFF"
          d="M1678,882c-7-18-32-18-39,0l-121,332c-3,9-3,19,0,29l341,935l241-139L1678,883V882z"
        />
        <path
          fill="#9DCCED"
          d="M1250,155c6,0,12,2,17,5l918,530c11,6,17,18,17,30v1060c0,12-7,24-17,30l-918,530c-5,3-11,5-17,5 s-12-2-17-5l-918-530c-11-6-17-18-17-30V719c0-12,7-24,17-30l918-530c5-3,11-5,17-5l0,0V155z M1250,0c-33,0-65,8-95,25L237,555 c-59,34-95,96-95,164v1060c0,68,36,130,95,164l918,530c29,17,62,25,95,25s65-8,95-25l918-530c59-34,95-96,95-164V719 c0-68-36-130-95-164L1344,25c-29-17-62-25-95-25l0,0H1250z"
        />
        <polygon fill="#213147" points="642,2179 727,1947 897,2088 738,2234" />
        <path
          fill="#FFFFFF"
          d="M1172,644H939c-17,0-33,11-39,27L401,2039l241,139l550-1507c5-14-5-28-19-28L1172,644z"
        />
        <path
          fill="#FFFFFF"
          d="M1580,644h-233c-17,0-33,11-39,27L738,2233l241,139l620-1701c5-14-5-28-19-28V644z"
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
        viewBox="0 0 1037 1037"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 rounded-full ${className}`}
      >
        <circle cx="518.5" cy="518.5" r="518.5" fill="#FF0421" />
        <path
          fill="#FAFAF9"
          d="M761.8,365.3H576.3l-43.7,309.6h88.8l10.5-75h101c91.2,0,136.7-36.6,147-114.9 C890.6,404.3,852.4,365.3,761.8,365.3L761.8,365.3L761.8,365.3z M790,479.6c-3.6,33.3-22.7,47.8-60.9,47.8h-86.9l12.6-89.5h90.9 C780.3,437.8,793.3,449.6,790,479.6L790,479.6z M357.4,358c-120.9,0-184.3,50.8-199.2,159.6c-15.2,111.3,37,164.5,161,164.5 c124,0,184-50.8,198.9-159.6C533.2,411.2,481.4,358,357.4,358L357.4,358z M427.8,517.7c-8.2,61.4-39.1,88.9-103.7,88.9 c-60.6,0-83.4-24.2-75.5-84.1c8.2-61.7,39.7-88.9,103.7-88.9S435.6,458.1,427.8,517.7z"
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
        viewBox="0 0 178 161"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
      >
        <path
          fill="#6C00F6"
          d="M66.8,54.7l-16.7-9.7L0,74.1v58l50.1,29l50.1-29V41.9L128,25.8l27.8,16.1v32.2L128,90.2l-16.7-9.7v25.8 l16.7,9.7l50.1-29V29L128,0L77.9,29v90.2l-27.8,16.1l-27.8-16.1V86.9l27.8-16.1l16.7,9.7V54.7z"
        />
      </svg>
    );
  }

  // Avalanche / Avalanche Fuji
  if (
    identifier === "43114" ||
    identifier === "43113" ||
    identifier.includes("avax") ||
    identifier.includes("avalanche") ||
    identifier.includes("fuji") ||
    identifier === "1"
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
        <circle cx="16" cy="16" r="16" fill="#E84142" />
        <path
          fill="#FFFFFF"
          d="M17.8 7.3c-.8-1.4-2.8-1.4-3.6 0L5.3 22.8c-.8 1.4.2 3.2 1.8 3.2h4.5c.8 0 1.5-.4 1.9-1.1l5.4-9.6 1.8 3.3c.4.7 1.1 1.1 1.9 1.1h4.1c1.6 0 2.6-1.8 1.8-3.2L17.8 7.3z"
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
        viewBox="0 0 397.7 311.7"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
      >
        <path
          fill="url(#sol_grad1)"
          d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5 c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"
        />
        <path
          fill="url(#sol_grad2)"
          d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5 c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"
        />
        <path
          fill="url(#sol_grad3)"
          d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4 c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"
        />
        <defs>
          <linearGradient id="sol_grad1" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00FFA3" />
            <stop offset="100%" stopColor="#DC1FFF" />
          </linearGradient>
          <linearGradient id="sol_grad2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00FFA3" />
            <stop offset="100%" stopColor="#DC1FFF" />
          </linearGradient>
          <linearGradient id="sol_grad3" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00FFA3" />
            <stop offset="100%" stopColor="#DC1FFF" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  // Default Fallback
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
    >
      <circle cx="12" cy="12" r="10" fill="#2775CA" />
      <path d="M12 7v10M7 12h10" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
