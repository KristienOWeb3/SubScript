export function generateCheckoutButtonTemplate(opts) {
    return `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */

"use client";

import React, { useState } from "react";

interface CheckoutButtonProps {
  amountUsdc: string;
  title: string;
  description?: string;
  externalReference?: string;
  idempotencyKey?: string;
  className?: string;
  onCreated?: (intent: { intentId: string; checkoutUrl: string; receiptToken?: string }) => void;
}

export function SubScriptCheckoutButton({
  amountUsdc,
  title,
  description,
  externalReference,
  idempotencyKey,
  className,
  onCreated
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleCheckout() {
    setLoading(true);
    setErrorMsg("");

    try {
      const response = await fetch("/api/subscript/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsdc,
          title,
          description,
          externalReference,
          idempotencyKey
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to create SubScript checkout");
      }
      if (!payload.checkoutUrl) {
        throw new Error("SubScript checkout response did not include a checkoutUrl");
      }

      const intent = {
        intentId: payload.intentId,
        checkoutUrl: payload.checkoutUrl,
        receiptToken: payload.receiptToken
      };
      onCreated?.(intent);
      window.location.assign(intent.checkoutUrl);
    } catch (err: any) {
      setErrorMsg(err.message || "Checkout failed");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleCheckout}
        disabled={loading}
        className={
          className ||
          "rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {loading ? "Opening SubScript..." : "Pay with SubScript"}
      </button>
      {errorMsg ? <p className="mt-2 text-sm text-red-600">{errorMsg}</p> : null}
    </div>
  );
}
`;
}
