# @subscript-protocol/cli

The integration CLI for [SubScript](https://www.subscriptonarc.com) — programmable USDC payments on Arc.
Scaffold a working checkout intent route, a signed webhook receiver, and a checkout button in seconds.

SubScript integrates over a plain REST API — **there is no SDK to install**. The generated server
route and checkout button use the built-in `fetch`, so a standard hosted-checkout integration adds
zero runtime dependencies to your project.

## Quick start

```bash
npx @subscript-protocol/cli
```

The interactive wizard detects your framework (Next.js App/Pages Router, React SPA, Express), then
scaffolds the files you need and writes a `.env.local` with your keys.

## Commands

| Command | What it does |
| --- | --- |
| `npx @subscript-protocol/cli` | Interactive setup wizard (default). |
| `npx @subscript-protocol/cli init --session <token>` | Non-interactive setup using a token from your merchant dashboard. |
| `npx @subscript-protocol/cli add checkout` | Scaffold the checkout intent server route + button. |
| `npx @subscript-protocol/cli add webhook` | Scaffold the signed webhook receiver route. |
| `npx @subscript-protocol/cli doctor` | Diagnose an existing integration. |
| `npx @subscript-protocol/cli verify` | Verify generated files against the protocol templates. |
| `npx @subscript-protocol/cli update` | Update generated files to the latest templates. |

### Options

| Flag | Description |
| --- | --- |
| `-h, --help` | Show help. |
| `-v, --version` | Show the CLI version. |
| `--mode <mode>` | `standard` (default) or `privacy-routed` (ArcaneVM confidential settlement). |
| `--no-telemetry` | Disable anonymous usage telemetry. |

## How the integration works

1. Your server route calls `POST {SUBSCRIPT_BASE_URL}/api/intent` with an
   `Authorization: Bearer ${SUBSCRIPT_SECRET_KEY}` header.
2. Store the returned `intentId` next to your order/user and redirect the browser to `checkoutUrl`.
3. SubScript settles the USDC payment on Arc and sends a signed webhook.
4. Your webhook route verifies the signature against the raw body, enforces idempotency, and unlocks
   the entitlement.

## License

MIT
