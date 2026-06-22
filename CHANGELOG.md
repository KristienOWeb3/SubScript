# SubScript — Implementation Changelog

Build cycle, June 2026. Capabilities implemented or hardened during the pre-launch cycle, recorded
separately from the product docs (`Flawless.md`). Grouped by area.

## Security & trust hardening
- **API secret key hashing** — merchant secret keys are stored only as a SHA-256 hash plus a
  non-sensitive display hint; the plaintext is shown once at creation and never persisted.
  Authentication is hash-first with a zero-downtime rollout (Phase A live; Phase B nulls the legacy
  plaintext after verification).
- **Step-up key export** — exporting an embedded wallet's private key requires a fresh, single-use
  email OTP, closing the gap where a stolen session could exfiltrate a key.
- **Internal billing endpoint auth** — the premium-downgrade sweep now requires the keeper secret,
  and the merchant-tier filter was corrected to the live text schema so delinquent merchants are
  actually reconciled.
- **Constant-time webhook verification** — the internal webhook receiver uses the shared timing-safe
  signature verifier and rejects an unconfigured secret.
- **Durable batch payouts** — the async payout job is registered with the runtime so it can't be
  killed mid-flight, preventing stuck batches and permanently reserved balances.

## Developer experience
- **Zero-dependency REST integration** — integration is a plain REST API (`POST /api/intent`); the
  generated checkout route and button use built-in `fetch`, so a standard hosted checkout adds no
  runtime dependencies. There is no SDK package.
- **Standalone CLI** — `@subscript-protocol/cli` is its own minimal workspace package
  (`npx @subscript-protocol/cli`) with real subcommands: `init`, `add checkout`, `add webhook`,
  `doctor`, `verify`, `update` — instead of bundling the whole web-app dependency tree.
- **Professional docs** — the documentation site adds a CLI quickstart and a structured API reference
  (method-badged endpoints with request/response/query parameter tables).

## Consumer & merchant features
- **Auto-signup on payment** — a payer who completes a payment without an account is automatically
  provisioned a USER account.
- **Pay with logged-in account** — a signed-in user pays a checkout in one tap, with no browser-wallet
  reconnect, reusing the same on-chain verification pipeline.
- **Web Push notifications** — browser Web Push (VAPID) with a service worker and per-device opt-in,
  on a transport-agnostic subscription model (web today; native iOS/Android tokens reuse the same
  send path for a future mobile app).
- **QR scan-to-pay (mobile)** — a live camera QR scanner (mobile only) autofills a recipient from a
  scanned address or routes a scanned hosted payment link straight to checkout.
- **In-chat payment requests** — requests raised inside a DM are delivered into that conversation
  thread rather than as a bare link to copy.
- **Fiat on-ramp guidance** — where a native on-ramp is unavailable, a geo-aware flow guides the user
  to buy USDC at a reputable third-party on-ramp and send it to their address, relying on Circle's
  CCTP to settle to Arc from another chain (instructional only, no custody).
- **Merchant multisig (Safe)** — a merchant can designate a Gnosis Safe they own as the payout
  destination, verified on-chain (Safe ownership + threshold) with no custom contracts.

## Privacy
- **Confidential-by-default (Phase 0)** — baseline transaction confidentiality (enabling shielding +
  registering a view key) is free for every merchant; Privacy Premium is retained for advanced
  controls. Shielded payouts fail closed — a confidential merchant without a registered view key is
  blocked rather than silently downgraded to a public transaction. Confidential routing for the
  regular withdraw and inbound checkout paths is planned contract-level work.

## Launch readiness
- **Config-only mainnet cutover** — the active chain and contract addresses are environment-driven;
  going live is a configuration change, with mainnet addresses required and fail-loud (never a silent
  fallback to testnet). Live API keys (`sk_live_`) are issued on mainnet.
- **Landing page** — the home page is a launch landing (hero CTAs, feature grid, how-it-works,
  audiences, final CTA) instead of a waitlist form.

## Platform polish
- Square app icons + web manifest so mobile launchers/app-switcher show the SubScript logo instead of
  a generated letter tile.
- Document-level camera permission corrected so the in-app QR scanner can access the camera.
- Dashboard skeleton loaders use a shimmer sweep; the in-DM view hides the bottom navigation bar for a
  full-height chat.
- Repository cleanup: removed duplicate fonts/mockups, untracked build artifacts.
