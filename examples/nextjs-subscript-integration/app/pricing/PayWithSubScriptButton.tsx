"use client";

import { useState } from "react";
import { PaymentMethodSelector } from "./PaymentMethodSelector";

export function PayWithSubScriptButton({
  mode = "subscription",
  planName = "Pro Plan",
  priceLabel = "2.00 USDC / week",
}: {
  mode?: "subscription" | "commit" | "checkout";
  planName?: string;
  priceLabel?: string;
}) {
  const [showSelector, setShowSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startSubScriptCheckout() {
    setLoading(true);
    setError(null);

    try {
      const endpoint =
        mode === "commit"
          ? "/api/subscript/commit"
          : mode === "subscription"
          ? "/api/subscript/subscriptions"
          : "/api/subscript/checkout";

      const response = await fetch(endpoint, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Checkout failed");
      }
      window.location.href = payload.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!showSelector ? (
        <button
          type="button"
          onClick={() => setShowSelector(true)}
          disabled={loading}
          className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg shadow-emerald-500/20"
        >
          {loading ? "Starting checkout..." : `Subscribe to ${planName}`}
        </button>
      ) : (
        <PaymentMethodSelector
          planName={planName}
          priceLabel={priceLabel}
          onSelectSubScript={startSubScriptCheckout}
        />
      )}
      {error ? <p role="alert" className="text-xs text-red-400 font-mono mt-2">{error}</p> : null}
    </div>
  );
}
