# Bank-transfer USDC funding

## Product decision

SubScript's fiat funding rail is bank-transfer-first. A card-based onramp recreates the same access problem SubScript is meant to remove, so the customer flow does not offer a card provider or card authorization fallback.

The intended production flow is:

1. The authenticated user requests an NGN quote.
2. SubScript binds the intent to that session's wallet address.
3. A licensed provider returns one-time bank-transfer instructions.
4. The provider verifies the sender, receives NGN, converts it, and emits a signed event.
5. USDC is delivered to the bound wallet on Arc.
6. SubScript independently verifies the chain, token, recipient, amount, transaction success, and finality before marking the intent complete.

Settlement gas is a platform/provider operating cost. It is accounted separately and is not deducted from the quoted USDC principal.

## What is implemented now

Bank-transfer funding is not exposed in the product. The funding API returns
`503 FIAT_ONRAMP_UNAVAILABLE` until Arc mainnet is live and a licensed provider
is integrated. The repository does not issue bank details or simulate deposits.

## Why production needs a regulated partner

Exchanging fiat for virtual assets, transferring virtual assets for another person, or safeguarding them falls inside Nigeria's VASP perimeter. CBN guidance allows designated banking and settlement relationships for SEC-licensed VASPs; it does not make an ordinary product account a lawful crypto collection rail.

SubScript should therefore launch as the orchestration and payment experience on top of a licensed VASP/bank partner. Building the regulated exchange, custody, banking, compliance, refund, and dispute operation in-house is a different company-sized scope.

Quidax is one example of the product pattern: its public documentation lists NGN bank transfer and USDC, and Nigeria's SEC directory lists Quidax as an ARIP participant. Its public ramp network list does not currently include Arc, so an integration would still require either direct Arc support or a verified mainnet USDC-to-Arc CCTP route.

## Production activation gates

Do not enable real bank details until all of the following are true:

- Arc mainnet is officially live and its chain, RPC, explorer, USDC, and CCTP configuration are verified.
- A licensed provider agreement assigns KYC/AML, sanctions, sender-name matching, limits, pricing, refunds, disputes, and record retention.
- Provider webhooks use raw-body signature verification, replay windows, and unique event IDs.
- A recovery poller reconciles missed or out-of-order events.
- Completion requires independent onchain receipt verification.
- Treasury/provider gas reserves and sponsorship failures are monitored.
- The product displays rate, fee breakdown, exact net USDC, quote expiry, and transfer expiry before showing bank instructions.

There is no configuration switch that enables fiat funding without a licensed
live adapter.

## Primary references

- [CBN guidelines for bank accounts operated for VASPs](https://www.cbn.gov.ng/Out/2024/FPRD/GUIDELINES%20ON%20OPERATIONS%20OF%20BANK%20ACCOUNTS%20FOR%20VIRTUAL%20Asset%20Providers.pdf)
- [Nigeria SEC digital-asset and VASP rules](https://home.sec.gov.ng/documents/8/Rules-on-Issuance-Offering-and-Custody-of-Digital-Assets.pdf)
- [Nigeria SEC registered FinTech operators](https://home.sec.gov.ng/fintech-and-innovation-hub-finport/registered-fintech-operators/)
- [Quidax Ramp supported fiat channels](https://docs.quidax.io/docs/supported-fiat-currency)
- [Quidax Ramp supported crypto networks](https://docs.quidax.io/docs/supported-crypto-assets)
- [Arc testnet/mainnet readiness notice](https://community.arc.io/public/blogs/transaction-memos-and-batch-transactions-activate-on-arc-testnet-2026-06-13)
