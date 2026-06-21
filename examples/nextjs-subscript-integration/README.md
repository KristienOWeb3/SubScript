# Next.js Merchant Integration Example

This is the minimal shape a merchant app needs for SubScript checkout:

1. A server route that creates a Checkout Intent.
2. A client button that calls the server route and redirects to hosted checkout.
3. A webhook route that verifies `x-subscript-signature` before unlocking access.

Required merchant environment variables:

```bash
SUBSCRIPT_SECRET_KEY=sk_test_or_live_...
SUBSCRIPT_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=https://your-app.example
```

Use test keys and `sandbox: true` while integrating.

## Flow

- User clicks `Pay with SubScript`.
- Merchant server calls `POST https://subscriptonarc.com/api/intent`.
- Merchant stores `intent.id` beside its own user/order record.
- User is redirected to `intent.checkoutUrl`.
- The hosted checkout uses direct Arc USDC settlement and binds price + merchant + `receiptToken` in the on-chain `DepositWithMemo` event.
- SubScript sends `payment.success` to the merchant webhook.
- Merchant verifies HMAC and unlocks the user by `data.intent_id`.

Hosted payment-link CCTP checkout is intentionally disabled until SubScript can verify Arc-side mint and memo settlement as one bound proof.

The smoke script in the main repo can validate the signing contract:

```bash
npm run integration:smoke
```
