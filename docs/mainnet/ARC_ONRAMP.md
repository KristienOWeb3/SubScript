# Arc Onramp Kit

The desktop and mobile Deposit modal offers **Buy USDC**, then **Open Arc Onramp**. The second click launches the popup synchronously so session minting does not consume the browser's popup gesture. Each launch consumes its prepared session; closing, failing, or completing the widget requires a fresh session for another purchase.

`POST /api/user/onramp/session` requires a same-origin browser request, an authenticated wallet, and Tier 1 email verification. The server derives the identity and destination from the session, passes `destinationChain: "Arc"`, and scopes the hosted widget to USDC on Arc. The SDK's asset selection is a display filter in the launch URL, not server-side financial authorization; do not use it to enforce ledger credits. Client-supplied identity, chain, and asset selections are ignored. Existing API rate limits apply. Every response uses `Cache-Control: no-store`; API credentials stay server-side and errors omit upstream credential context.

## Configuration

| Variable | Value |
|---|---|
| `ONRAMP_ENABLED` | `true` to activate; absent or `false` disables session minting |
| `ONRAMP_API_KEY` | Circle Onramp API credential, exactly as issued; never use a `NEXT_PUBLIC_` variable |
| `ONRAMP_ENVIRONMENT` | `sandbox` by default; set `production` explicitly for mainnet |
| `ONRAMP_REFERRER_DOMAIN` | Optional exact bare hostname registered with Circle for iframe hosting |

Sandbox uses `https://api-test.circle.com` and `https://onramp-sandbox.arc.io`. Production uses `https://api.circle.com` and `https://onramp.arc.io`. Production requires `NEXT_PUBLIC_ENVIRONMENT=mainnet`; mismatches fail closed. Use a Circle key issued for the selected environment.

Popups are the default. Users can retry after allowing popups. PWA/in-app browsers can fall back to an iframe only when a trusted hostname is configured and registered with Circle; otherwise they are directed to a regular browser. The CSP permits both official widget origins. Provider fees, country availability, payment methods, and identity checks appear inside the hosted widget.

## Settlement and launch checks

Browser events only refresh the UI. They never credit balances or create financial records. The existing Arc deposit indexer and confirmed on-chain balance/history remain authoritative even if the popup closes before settlement. This integration does not store provider orders or reconcile refunds. Register Circle's authenticated server-side onramp webhooks before relying on provider order status for production support or reconciliation.

Before activation, exercise sandbox purchase, cancellation, expired session, blocked popup, and a deposit that settles after the browser closes. Verify funds arrive at the signed-in wallet and appear exactly once in history. Verify iframe origin registration on each configured host if enabling fallback. A live purchase and provider-webhook delivery require deployment credentials and have not been verified locally.

Local verification: eight session/configuration/SDK tests and two Chromium component tests (390px/1280px) pass. Browser tests use a mocked provider and cover session retry, blocked popups, launch, teardown, and refresh. The shared local dashboard stayed on its loading screen, so dashboard placement and provider funding remain unverified.

```powershell
node --test --test-isolation=none src/lib/onramp/__tests__/session.test.mjs
npm exec playwright -- test tests/onramp.spec.ts --workers=1
```

References: [SDK package](https://www.npmjs.com/package/@circle-fin/onramp-kit), [Circle sample](https://github.com/circlefin/onramp-kit-demo), [Arc Onramp docs](https://docs.arc.io/app-kit/onramp).
