# @subscriptonarc/cli

The integration CLI for [SubScript](https://www.subscriptonarc.com) — programmable USDC payments on Arc.
Scaffold a working checkout intent route, a signed webhook receiver, and a checkout button in seconds.

SubScript integrates over a plain REST API — **there is no SDK to install**. The generated server
route and checkout button use the built-in `fetch`, so a standard hosted-checkout integration adds
zero runtime dependencies to your project.

## Quick start

```bash
# Interactive (humans at a terminal)
npx @subscriptonarc/cli

# Non-interactive (AI agents, CI, scripts) — no prompts, no dashboard round-trip
npx @subscriptonarc/cli init --key sk_test_... --merchant 0xYourWallet --framework next-app --yes
```

The wizard detects your framework (Next.js App/Pages Router, React SPA, Express), scaffolds the
files you need, and writes a `.env.local` with your keys. Without a TTY the wizard never starts —
you get the exact non-interactive command instead.

## Commands

| Command | What it does |
| --- | --- |
| `npx @subscriptonarc/cli` | Interactive setup wizard (default). |
| `npx @subscriptonarc/cli init --key <sk_...> --merchant <0x...> --yes` | Fully non-interactive setup. |
| `npx @subscriptonarc/cli init --offline --yes` | Scaffold with placeholder env values — no key, no network. |
| `npx @subscriptonarc/cli init --session <token>` | Non-interactive setup using a token from your merchant dashboard. |
| `npx @subscriptonarc/cli add checkout` | Scaffold the checkout intent server route + button. Works in a fresh repo — no `init` or config file required. |
| `npx @subscriptonarc/cli add webhook` | Scaffold the signed webhook receiver route. Also works without `init`. |
| `npx @subscriptonarc/cli doctor` | Diagnose an existing integration (CLI-generated *or* hand-written). Exits `1` when issues are found. |
| `npx @subscriptonarc/cli verify` | Verify generated files against the protocol templates. Exits `1` on FAIL. |
| `npx @subscriptonarc/cli update` | Update generated files to the latest templates. |
| `npx @subscriptonarc/cli trigger <event>` | Send a signed test webhook to your local endpoint. |

### Options

| Flag | Description |
| --- | --- |
| `-h, --help` | Show help (exit 0). |
| `-v, --version` | Show the CLI version. |
| `--json` | Emit one machine-readable JSON object on stdout: `{ ok, command, files_written, error }`. Progress logs go to stderr. |
| `--key <sk_...>` | `init`: secret key (Dashboard → Developers → API keys). |
| `--merchant <0x...>` | `init`: merchant payout wallet address. |
| `--framework <name>` | `init`/`add`: `next-app`, `next-pages`, `react-spa`, or `express` (skips auto-detect). |
| `--mode <mode>` | `standard` (default) or `privacy-routed` (ArcaneVM confidential settlement). |
| `--plan-name <name>` | `init`: subscription plan name (default `Premium Subscription`). |
| `--amount <usdc>` | `init`: plan amount cap in USDC (default `10`). |
| `--interval <seconds>` | `init`: plan interval in seconds (default `2592000` = 30 days). |
| `-y, --yes` | `init`: accept defaults, never prompt. |
| `--offline` | `init`: scaffold with placeholder env values; skips installs and all network calls. |
| `--no-components` | `init`: backend routes only, no React components. |
| `--url <endpoint>` | `trigger`: target webhook URL. |
| `--secret <whsec>` | `trigger`: signing secret (defaults to `SUBSCRIPT_WEBHOOK_SECRET` / `.env.local`). |
| `--no-telemetry` | Disable anonymous usage telemetry. |

### Exit codes

`0` on success, `1` on any failure. Errors print to **stderr** with the fix on the next line, so
agents and CI can branch on the exit code and read the remedy without scraping stdout.

### Machine-readable output

```bash
npx @subscriptonarc/cli init --offline --yes --json
```

```json
{
  "ok": true,
  "command": "init",
  "files_written": [
    ".env.local",
    ".cursorrules",
    "components/subscript/SubScriptCheckoutButton.tsx",
    "app/api/subscript/checkout/route.ts",
    "app/api/webhooks/subscript/route.ts"
  ],
  "next_steps": ["..."]
}
```

## How the integration works

1. Your server route calls `POST {SUBSCRIPT_BASE_URL}/api/intent` with an
   `Authorization: Bearer ${SUBSCRIPT_SECRET_KEY}` header.
2. Store the returned `intentId` next to your order/user and redirect the browser to `checkoutUrl`.
3. SubScript settles the USDC payment on Arc and sends a signed webhook. The canonical event name
   is `type: "payment.succeeded"` (`event: "payment.success"` is a deprecated back-compat alias).
4. Your webhook route verifies the signature against the raw body, enforces idempotency, and unlocks
   the entitlement.

## License

MIT
