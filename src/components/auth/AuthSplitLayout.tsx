"use client";

import React from "react";
import Link from "next/link";
import WorldMapVisual from "./WorldMapVisual";

export interface TabItem {
  id: string;
  label: string;
}

interface AuthSplitLayoutProps {
  children: React.ReactNode;
  activeTab?: "signin" | "signup";
  tabs?: TabItem[];
  activeTabId?: string;
  onTabChange?: (tab: "signin" | "signup") => void;
  onSelectTab?: (id: string) => void;
  title?: string;
  subtitle?: string;
  leftHeadline?: React.ReactNode;
  leftSubtitle?: string;
  hideTabs?: boolean;
}

export default function AuthSplitLayout({
  children,
  activeTab,
  tabs,
  activeTabId,
  onTabChange,
  onSelectTab,
  title,
  subtitle,
  leftHeadline,
  leftSubtitle,
  hideTabs = false,
}: AuthSplitLayoutProps) {
  const displayTitle = title || (activeTab === "signin" ? "Welcome back" : "Create your account");
  const displaySubtitle =
    subtitle ||
    (activeTab === "signin"
      ? "Sign in to your SubScript account."
      : "Get started with programmable USDC payments.");

  return (
    <div className="min-h-screen w-full flex bg-[#FFFFF0] text-[#111827] font-sans selection:bg-[#2775CA]/20 selection:text-black">
      {/* Left Pane: SubScript Brand Showcase (50% width on desktop, light platform blue) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-6 lg:p-8 xl:p-10 bg-gradient-to-br from-[#2775CA] via-[#236EC2] to-[#1E60B5] text-white relative overflow-hidden lg:max-h-screen">
        {/* Top: Logo & Name */}
        <div className="relative z-10 shrink-0">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <img
              src="/logo-transparent.png"
              alt="SubScript Logo"
              className="w-8 h-8 object-contain brightness-0 invert group-hover:scale-105 transition-transform"
            />
            <span className="text-lg font-black tracking-tight text-white">
              SubScript
            </span>
          </Link>
        </div>

        {/* Center: Hero Messaging & Dotted World Map Visual */}
        <div className="relative z-10 space-y-4 my-auto py-2">
          <div className="space-y-2 max-w-lg xl:max-w-xl">
            {leftHeadline ? (
              leftHeadline
            ) : (
              <h1 className="text-2xl xl:text-3xl font-black tracking-tight text-white leading-tight">
                Cross-border payments and checkout <br />
                <span className="text-white/95">for your business</span>
              </h1>
            )}
            <p className="text-xs xl:text-sm text-white/85 leading-relaxed font-normal">
              {leftSubtitle ||
                "Accept USDC from customers worldwide. Every payment settles right away."}
            </p>
          </div>

          {/* Dotted Global World Settlement Map Graphic - Borderless & Organic */}
          <div className="w-full max-w-xl xl:max-w-2xl pt-3 pb-1 overflow-hidden flex items-center justify-center">
            <WorldMapVisual className="w-full h-auto" />
          </div>
        </div>
      </div>

      {/* Right Pane: Slim, Compact Auth Container (50% width on desktop) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-4 sm:p-6 lg:p-8 bg-[#FFFFF0] relative lg:max-h-screen overflow-y-auto">
        {/* Center: Auth Box (compact spacing so everything is visible at once) */}
        <div className="w-full max-w-[340px] sm:max-w-[360px] mx-auto my-auto space-y-3.5 py-2">

          {/* Header titles */}
          <div className="text-center space-y-1">
            <h2 className="text-xl sm:text-2xl font-black text-[#111827] tracking-tight">
              {displayTitle}
            </h2>
            <p className="text-xs text-black/60">
              {displaySubtitle}
            </p>
          </div>

          {/* Tab Navigation: Custom Tabs or Default Sign in | Create account */}
          {!hideTabs && (
            tabs ? (
              <div className="flex items-center border-b border-black/10">
                {tabs.map((tab) => {
                  const isActive = activeTabId === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onSelectTab?.(tab.id)}
                      className={`flex-1 pb-2.5 text-xs sm:text-sm font-bold text-center transition-all relative ${
                        isActive
                          ? "text-[#2775CA]"
                          : "text-black/40 hover:text-black/70"
                      }`}
                    >
                      {tab.label}
                      {isActive && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2775CA] rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center border-b border-black/10">
                <button
                  type="button"
                  onClick={() => onTabChange?.("signin")}
                  className={`flex-1 pb-2.5 text-xs sm:text-sm font-bold text-center transition-all relative ${
                    activeTab === "signin"
                      ? "text-[#2775CA]"
                      : "text-black/40 hover:text-black/70"
                  }`}
                >
                  Sign in
                  {activeTab === "signin" && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2775CA] rounded-full" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onTabChange?.("signup")}
                  className={`flex-1 pb-2.5 text-xs sm:text-sm font-bold text-center transition-all relative ${
                    activeTab === "signup"
                      ? "text-[#2775CA]"
                      : "text-black/40 hover:text-black/70"
                  }`}
                >
                  Create account
                  {activeTab === "signup" && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2775CA] rounded-full" />
                  )}
                </button>
              </div>
            )
          )}

          {/* Form Content */}
          <div className="pt-1">
            {children}
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="mt-4 pt-3 border-t border-black/5 flex flex-col sm:flex-row items-center justify-between text-[10px] text-black/40 gap-1.5 font-sans shrink-0">
          <span>© 2026 SubScript</span>
          <div className="flex items-center gap-3">
            <Link href="/privacy" className="hover:text-black/70 transition-colors">
              Privacy
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-black/70 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
