# Handover Documentation - Current Product Source of Truth

The current product source of truth is `C:\Users\Kristien\Downloads\Flawless.md`, mirrored into `docs/subscript-protocol-features-and-problems-solved.md`.

## Current Direction

SubScript is a programmable stablecoin commerce layer on Arc. It uses a Unified Payment Authorization (UPA) framework for one-time payments, recurring billing, usage-based charging, invoice-like collection, sponsored payments, and AI-native transactions.

## Live Platform Primitives

- Checkout Intents.
- Hosted Arc USDC payment links.
- Receipt tokens and Arc memo receipts.
- Signed merchant webhooks.
- Google wallet onboarding.
- Metered vault usage billing.
- DNS-style aliases.
- Premium/privacy, payroll, retry, reconciliation, and keeper-compatible surfaces.

## Deployment-Scoped Targets

These must stay caveated until implemented and verified in production:

- Encrypted private-key export after Google wallet provisioning.
- Direct fiat-to-USDC onramps.
- Dedicated invoice objects with custom due terms.
- Sponsor relationships for Pay for Me.
- Merchant commitment windows, minimum terms, and grace periods.
- Configurable smart dunning schedules.
- Chainlink Automation as the production execution layer.
- Circle Paymaster/Gas Station sponsorship.
- ArcaneVM production confidentiality.
- Arc quantum-resilience inheritance.

## Messaging Rules

- Do not describe SubScript as only a subscription platform; it is broader programmable USDC commerce.
- Do not use old ZK-gating language for the current product narrative. Use Privacy Premium, ArcaneVM, Arc Privacy Sector, governed visibility, and confidential execution.
- Keep CCTP disabled in hosted checkout messaging until Arc-side memo settlement is verifiable in one bound flow.
- Keep the merchant fee target as 1% and the Privacy Premium baseline target as 10 USDC/month unless pricing constants and product approval say otherwise.

## Verification Commands

```bash
npx tsc --noEmit --pretty false
npm run build
```
