"use client";

import React from "react";
import { Wallet } from "lucide-react";
import { MetaMaskIcon, MetaMaskColorSpinner } from "@/components/auth/QuickAuthButtons";

export { MetaMaskIcon, MetaMaskColorSpinner };

/**
 * Official Rabby SVG from Rabby wallet.svg
 */
export function RabbyIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M438.47 279.097C452.952 246.637 381.359 155.948 312.964 118.165C269.853 88.895 224.93 92.9162 215.832 105.768C195.865 133.972 281.948 157.871 339.518 185.759C327.143 191.152 315.481 200.83 308.623 213.207C287.16 189.697 240.052 169.451 184.777 185.759C147.528 196.749 116.571 222.658 104.606 261.791C101.699 260.495 98.4799 259.774 95.0934 259.774C82.1436 259.774 71.6456 270.308 71.6456 283.301C71.6456 296.295 82.1436 306.828 95.0934 306.828C97.4937 306.828 104.999 305.213 104.999 305.213L224.93 306.085C176.967 382.43 139.063 393.59 139.063 406.817C139.063 420.043 175.331 416.459 188.948 411.529C254.138 387.928 324.155 314.373 336.17 293.199C386.625 299.515 429.028 300.262 438.47 279.097Z"
        fill="url(#rabby_paint0_linear)"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M339.513 185.763C339.516 185.764 339.519 185.766 339.522 185.767C342.191 184.712 341.759 180.758 341.026 177.652C339.342 170.515 310.284 141.724 282.997 128.829C245.815 111.257 218.435 112.163 214.39 120.262C221.964 135.837 257.077 150.461 293.748 165.733C309.394 172.249 325.323 178.883 339.519 185.76C339.517 185.761 339.515 185.762 339.513 185.763Z"
        fill="url(#rabby_paint1_linear)"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M292.329 342.523C284.809 339.64 276.315 336.994 266.658 334.594C276.955 316.108 279.115 288.74 269.391 271.437C255.743 247.153 238.612 234.228 198.802 234.228C176.907 234.228 117.955 241.628 116.909 291.006C116.799 296.187 116.906 300.935 117.28 305.301L224.93 306.084C210.417 329.185 196.825 346.318 184.926 359.345C199.213 363.019 211.003 366.103 221.828 368.934C232.098 371.62 241.499 374.079 251.339 376.598C266.182 365.748 280.135 353.917 292.329 342.523Z"
        fill="url(#rabby_paint2_linear)"
      />
      <path
        d="M103.169 300.228C107.567 337.737 128.813 352.437 172.227 356.788C215.641 361.138 240.544 358.22 273.698 361.246C301.389 363.774 326.113 377.932 335.285 373.04C343.539 368.636 338.921 352.728 327.876 342.521C313.558 329.291 293.742 320.093 258.875 316.828C265.824 297.739 263.877 270.973 253.085 256.411C237.481 235.355 208.68 225.836 172.227 229.995C134.143 234.34 97.6504 253.153 103.169 300.228Z"
        fill="url(#rabby_paint3_linear)"
      />
      <defs>
        <linearGradient id="rabby_paint0_linear" x1="180.439" y1="250.352" x2="435.479" y2="322.433" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8697FF" />
          <stop offset="1" stopColor="#ABB7FF" />
        </linearGradient>
        <linearGradient id="rabby_paint1_linear" x1="392.428" y1="245.489" x2="207.876" y2="61.1077" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8697FF" />
          <stop offset="1" stopColor="#5156D8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="rabby_paint2_linear" x1="297.446" y1="348.967" x2="120.465" y2="247.558" gradientUnits="userSpaceOnUse">
          <stop stopColor="#465EED" />
          <stop offset="1" stopColor="#8697FF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="rabby_paint3_linear" x1="195.658" y1="248.443" x2="315.581" y2="400.306" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8898FF" />
          <stop offset="0.983895" stopColor="#6277F1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Official Phantom SVG
 */
export function PhantomIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none">
      <g clipPath="url(#phantom__a)">
        <path fill="#AB9FF2" d="M24 0H0v24h24z" />
        <path fill="#fff" d="M5.893 18.4c2.042 0 3.576-1.706 4.492-3.054a2.5 2.5 0 0 0-.173.883c0 .787.47 1.348 1.398 1.348 1.275 0 2.636-1.074 3.341-2.23q-.075.25-.074.464c0 .55.322.895.978.895 2.066 0 4.145-3.52 4.145-6.597C20 7.711 18.738 5.6 15.57 5.6 10.002 5.6 4 12.137 4 16.36c0 1.658.928 2.04 1.893 2.04m7.759-8.553c0-.597.347-1.014.854-1.014.495 0 .841.417.841 1.014 0 .596-.346 1.026-.841 1.026-.508 0-.854-.43-.854-1.026m2.648 0c0-.597.347-1.014.854-1.014.495 0 .841.417.841 1.014 0 .596-.346 1.026-.841 1.026-.507 0-.854-.43-.854-1.026" />
      </g>
      <defs>
        <clipPath id="phantom__a">
          <path fill="#fff" d="M0 0h24v24H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * Official OKX SVG
 */
export function OkxIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none">
      <path fill="#000" d="M3 3h6v6H3zm12 6H9v6H3v6h6v-6h6v6h6v-6h-6zm0 0V3h6v6z" />
    </svg>
  );
}

/**
 * Official Trust Wallet SVG
 */
export function TrustWalletIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none">
      <path fill="#0500FF" d="M3.9 5.6 12 3v18c-5.786-2.4-8.1-7-8.1-9.6z" />
      <path fill="url(#trust__a)" d="M20.1 5.6 12 3v18c5.786-2.4 8.1-7 8.1-9.6z" />
      <defs>
        <linearGradient id="trust__a" x1="17.948" x2="11.967" y1="1.74" y2="20.797" gradientUnits="userSpaceOnUse">
          <stop offset=".02" stopColor="#00F" />
          <stop offset=".08" stopColor="#0094FF" />
          <stop offset=".16" stopColor="#48FF91" />
          <stop offset=".42" stopColor="#0094FF" />
          <stop offset=".68" stopColor="#0038FF" />
          <stop offset=".9" stopColor="#0500FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Official Coinbase Wallet SVG
 */
export function CoinbaseIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#0052FF" />
      <rect x="28" y="28" width="44" height="44" rx="10" fill="#FFFFFF" />
      <rect x="42" y="42" width="16" height="16" rx="4" fill="#0052FF" />
    </svg>
  );
}

/**
 * Official Rainbow Wallet SVG
 */
export function RainbowIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="22" fill="#174291" />
      <path d="M22 70C22 43.5 43.5 22 70 22" stroke="#FF4242" strokeWidth="7" strokeLinecap="round" />
      <path d="M30 70C30 48 48 30 70 30" stroke="#FFA726" strokeWidth="7" strokeLinecap="round" />
      <path d="M38 70C38 52.5 52.5 38 70 38" stroke="#FDD835" strokeWidth="7" strokeLinecap="round" />
      <path d="M46 70C46 57 57 46 70 46" stroke="#4CAF50" strokeWidth="7" strokeLinecap="round" />
      <path d="M54 70C54 61.2 61.2 54 70 54" stroke="#29B6F6" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Official Brave Wallet SVG
 */
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
  if (normalized.includes("trust")) {
    return <TrustWalletIcon className={className} />;
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

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={`${className} object-contain rounded-md`}
        onError={(e) => {
          (e.target as HTMLElement).style.display = "none";
        }}
      />
    );
  }

  return <Wallet className={`${className} text-[#2775CA]`} />;
}
