"use client";

import React from "react";
import { Loader2, AlertCircle } from "@/components/icons";
import CircleGoogleWalletButton from "@/components/CircleGoogleWalletButton";

interface QuickAuthButtonsProps {
  onGoogleSuccess?: (data: {
    success: boolean;
    wallet: string;
    email?: string | null;
    provider?: string;
    role?: string | null;
  }) => void;
  onMetaMaskClick: () => void;
  isMetaMaskLoading?: boolean;
  disabled?: boolean;
  error?: string | null;
  googleAvailable?: boolean;
  externalWalletEnabled?: boolean;
}

export function MetaMaskIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 318.6 318.6" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="#e2761b" stroke="#e2761b" strokeLinecap="round" strokeLinejoin="round" d="m274.1 35.5-99.5 73.9L193 65.8z"/>
      <path fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" d="m44.4 35.5 98.7 74.6-17.5-44.3zm193.9 171.3-26.5 40.6 56.7 15.6 16.3-55.3zm-204.4.9L50.1 263l56.7-15.6-26.5-40.6z"/>
      <path fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" d="m103.6 138.2-15.8 23.9 56.3 2.5-2-60.5zm111.3 0-39-34.8-1.3 61.2 56.2-2.5zM106.8 247.4l33.8-16.5-29.2-22.8zm71.1-16.5 33.9 16.5-4.7-39.3z"/>
      <path fill="#d7c1b3" stroke="#d7c1b3" strokeLinecap="round" strokeLinejoin="round" d="m211.8 247.4-33.9-16.5 2.7 22.1-.3 9.3zm-105 0 31.5 14.9-.2-9.3 2.5-22.1z"/>
      <path fill="#233447" stroke="#233447" strokeLinecap="round" strokeLinejoin="round" d="m138.8 193.5-28.2-8.3 19.9-9.1zm40.9 0 8.3-17.4 20 9.1z"/>
      <path fill="#cd6116" stroke="#cd6116" strokeLinecap="round" strokeLinejoin="round" d="m106.8 247.4 4.8-40.6-31.3.9zM207 206.8l4.8 40.6 26.5-39.7zm23.8-44.7-56.2 2.5 5.2 28.9 8.3-17.4 20 9.1zm-120.2 23.1 20-9.1 8.2 17.4 5.3-28.9-56.3-2.5z"/>
      <path fill="#e4751f" stroke="#e4751f" strokeLinecap="round" strokeLinejoin="round" d="m87.8 162.1 23.6 46-.8-22.9zm120.3 23.1-1 22.9 23.7-46zm-64-20.6-5.3 28.9 6.6 34.1 1.5-44.9zm30.5 0-2.7 18 1.2 45 6.7-34.1z"/>
      <path fill="#f6851b" stroke="#f6851b" strokeLinecap="round" strokeLinejoin="round" d="m179.8 193.5-6.7 34.1 4.8 3.3 29.2-22.8 1-22.9zm-69.2-8.3.8 22.9 29.2 22.8 4.8-3.3-6.6-34.1z"/>
      <path fill="#c0ad9e" stroke="#c0ad9e" strokeLinecap="round" strokeLinejoin="round" d="m180.3 262.3.3-9.3-2.5-2.2h-37.7l-2.3 2.2.2 9.3-31.5-14.9 11 9 22.3 15.5h38.3l22.4-15.5 11-9z"/>
      <path fill="#161616" stroke="#161616" strokeLinecap="round" strokeLinejoin="round" d="m177.9 230.9-4.8-3.3h-27.7l-4.8 3.3-2.5 22.1 2.3-2.2h37.7l2.5 2.2z"/>
      <path fill="#763d16" stroke="#763d16" strokeLinecap="round" strokeLinejoin="round" d="m278.3 114.2 8.5-40.8-12.7-37.9-96.2 71.4 37 31.3 52.3 15.3 11.6-13.5-5-3.6 8-7.3-6.2-4.8 8-6.1zM31.8 73.4l8.5 40.8-5.4 4 8 6.1-6.1 4.8 8 7.3-5 3.6 11.5 13.5 52.3-15.3 37-31.3-96.2-71.4z"/>
      <path fill="#f6851b" stroke="#f6851b" strokeLinecap="round" strokeLinejoin="round" d="m267.2 153.5-52.3-15.3 15.9 23.9-23.7 46 31.2-.4h46.5zm-163.6-15.3-52.3 15.3-17.4 54.2h46.4l31.1.4-23.6-46zm71 26.4 3.3-57.7 15.2-41.1h-67.5l15 41.1 3.5 57.7 1.2 18.2.1 44.8h27.7l.2-44.8z"/>
    </svg>
  );
}

export function MetaMaskColorSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="#FED7AA" strokeWidth="2.5" strokeOpacity="0.4" />
      <path
        d="M12 3a9 9 0 0 1 6.36 2.64"
        stroke="#E2761B"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M18.36 5.64A9 9 0 0 1 21 12"
        stroke="#F6851B"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M21 12a9 9 0 0 1-2.64 6.36"
        stroke="#CD6116"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M18.36 18.36A9 9 0 0 1 12 21"
        stroke="#E4761B"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function QuickAuthButtons({
  onGoogleSuccess,
  onMetaMaskClick,
  isMetaMaskLoading = false,
  disabled = false,
  error = null,
  googleAvailable = true,
  externalWalletEnabled = true,
}: QuickAuthButtonsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-3">
        {googleAvailable && (
          <div className="shrink-0">
            <CircleGoogleWalletButton onSuccess={onGoogleSuccess} variant="icon" />
          </div>
        )}

        {externalWalletEnabled && (
          <button
            type="button"
            onClick={onMetaMaskClick}
            disabled={disabled || isMetaMaskLoading}
            title="Connect MetaMask / Browser Wallet"
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl border border-black/10 bg-[#FFFFF0] hover:bg-black/[0.04] hover:border-black/25 active:scale-95 transition-all flex items-center justify-center shadow-sm disabled:opacity-50 disabled:cursor-not-allowed group relative"
          >
            {isMetaMaskLoading ? (
              <MetaMaskColorSpinner className="w-4 h-4" />
            ) : (
              <MetaMaskIcon className="w-5 h-5 transition-transform group-hover:scale-105" />
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-start gap-2.5 mt-2" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}
    </div>
  );
}
