"use client";

import React from "react";
import { Wallet } from "lucide-react";
import { MetaMaskIcon, MetaMaskColorSpinner } from "@/components/auth/QuickAuthButtons";

export { MetaMaskIcon, MetaMaskColorSpinner };

export function RabbyIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#8697FF" />
      <path
        d="M26 44C26 35 32 28 41 28C47.5 28 50 34 50 34C50 34 52.5 28 59 28C68 28 74 35 74 44C74 58.5 64.5 73.5 50 73.5C35.5 73.5 26 58.5 26 44Z"
        fill="#FFFFFF"
      />
      <circle cx="41" cy="46" r="4" fill="#8697FF" />
      <circle cx="59" cy="46" r="4" fill="#8697FF" />
      <path d="M47 54C48.5 55.5 51.5 55.5 53 54" stroke="#8697FF" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function PhantomIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#AB9FF2" />
      {/* Phantom Ghost */}
      <path
        d="M30 52C30 35 41 24 50 24C59 24 70 35 70 52C70 69 64 76 58 76C54 76 52 71 50 71C48 71 46 76 42 76C36 76 30 69 30 52Z"
        fill="#FFFFFF"
      />
      <circle cx="43" cy="48" r="3.5" fill="#AB9FF2" />
      <circle cx="57" cy="48" r="3.5" fill="#AB9FF2" />
    </svg>
  );
}

export function OkxIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#000000" />
      {/* 5 OKX iconic squares */}
      <rect x="22" y="22" width="18" height="18" rx="3.5" fill="#FFFFFF" />
      <rect x="60" y="22" width="18" height="18" rx="3.5" fill="#FFFFFF" />
      <rect x="41" y="41" width="18" height="18" rx="3.5" fill="#FFFFFF" />
      <rect x="22" y="60" width="18" height="18" rx="3.5" fill="#FFFFFF" />
      <rect x="60" y="60" width="18" height="18" rx="3.5" fill="#FFFFFF" />
    </svg>
  );
}

export function CoinbaseIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#0052FF" />
      <rect x="28" y="28" width="44" height="44" rx="10" fill="#FFFFFF" />
      <rect x="42" y="42" width="16" height="16" rx="4" fill="#0052FF" />
    </svg>
  );
}

export function RainbowIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#174291" />
      <path d="M22 70C22 43.5 43.5 22 70 22" stroke="#FF4242" strokeWidth="7" strokeLinecap="round"/>
      <path d="M30 70C30 48 48 30 70 30" stroke="#FFA726" strokeWidth="7" strokeLinecap="round"/>
      <path d="M38 70C38 52.5 52.5 38 70 38" stroke="#FDD835" strokeWidth="7" strokeLinecap="round"/>
      <path d="M46 70C46 57 57 46 70 46" stroke="#4CAF50" strokeWidth="7" strokeLinecap="round"/>
      <path d="M54 70C54 61.2 61.2 54 70 54" stroke="#29B6F6" strokeWidth="7" strokeLinecap="round"/>
    </svg>
  );
}

export function BraveIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#FB542B" />
      <path d="M34 32L50 24L66 32L62 52L50 76L38 52L34 32Z" fill="#FFFFFF" />
      <path d="M50 36L42 50L50 64L58 50L50 36Z" fill="#FB542B" />
    </svg>
  );
}

/**
 * Helper to render the appropriate wallet icon given name/id/iconUrl
 */
export function WalletIcon({
  name = "",
  id = "",
  iconUrl,
  className = "w-5 h-5",
}: {
  name?: string;
  id?: string;
  iconUrl?: string;
  className?: string;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={`${className} object-contain rounded-md`}
        onError={(e) => {
          // If the iconUrl fails to load, let the SVG matchers handle it
          (e.target as HTMLElement).style.display = "none";
        }}
      />
    );
  }

  const normalized = (name + " " + id).toLowerCase();

  if (normalized.includes("metamask")) {
    return <MetaMaskIcon className={className} />;
  }
  if (normalized.includes("rabby")) {
    return <RabbyIcon className={className} />;
  }
  if (normalized.includes("phantom")) {
    return <PhantomIcon className={className} />;
  }
  if (normalized.includes("okx")) {
    return <OkxIcon className={className} />;
  }
  if (normalized.includes("coinbase")) {
    return <CoinbaseIcon className={className} />;
  }
  if (normalized.includes("rainbow")) {
    return <RainbowIcon className={className} />;
  }
  if (normalized.includes("brave")) {
    return <BraveIcon className={className} />;
  }

  return <Wallet className={`${className} text-[#2775CA]`} />;
}
