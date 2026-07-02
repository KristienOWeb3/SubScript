# External cron / keeper schedule

SubScript runs on **Vercel Hobby**, which caps cron jobs at **2** and only allows
**daily** cadence. So `vercel.json` holds only the two daily jobs below, and every
other keeper is driven by an **external scheduler** (e.g. cron-job.org, GitHub
Actions, a small VPS crontab) that hits the route over HTTPS with a bearer secret.

> Do **not** add these to `vercel.json` unless the project moves to Vercel Pro —
> more than 2 crons or a sub-daily cadence breaks the Hobby deploy.

## Auth

Every route below authenticates with:

```
Authorization: Bearer <KEEPER_SECRET>
```

`CRON_SECRET` is also accepted on all of them (either env var works). Requests
without a valid secret get `401`. Keep the secret out of logs/URLs — send it as a
header, not a query param.

## Managed by Vercel (already in `vercel.json` — do not double-schedule)

| Endpoint | Method | Cadence | Purpose |
|---|---|---|---|
| `/api/cron/customer-billing` | GET | daily | Renew customer→merchant subscriptions; deferred period-end cancels |
| `/api/keeper/vault-draw` | GET | daily | Draw matured metered-vault cycles on-chain |

## Ready-made scheduler: GitHub Actions

A workflow that runs all four on the cadences below already lives at
**[`.github/workflows/keepers.yml`](../.github/workflows/keepers.yml)**. It's free for
this public repo. One-time setup in **Settings → Secrets and variables → Actions**:

- Secret **`KEEPER_SECRET`** = the same value as the Vercel env `KEEPER_SECRET`.
- Secret **`KEEPER_BASE_URL`** = `https://www.subscriptonarc.com` (optional; that's the
  default if unset). No trailing slash.

Then use **Run workflow** on the Actions tab (`workflow_dispatch`) to smoke-test all
endpoints once. A failed run (401/5xx) turns red and notifies you. Caveat: GitHub
schedules are best-effort (occasionally delayed a few minutes) and auto-disable after
60 days of repo inactivity — fine for these idempotent jobs, but switch to cron-job.org
or a VPS crontab if you ever need precise timing.

## Schedule these externally

If you use a scheduler other than the workflow above, hit each **via `GET`** with the
`Authorization` header above:

| Endpoint | Suggested cadence | Purpose |
|---|---|---|
| `/api/cron/reconcile` | every 15 min | Recover stuck premium-upgrade payment sessions (user-facing — keep frequent) |
| `/api/cron/billing` | daily | Premium (merchant→SubScript) recurring billing + grace-period downgrades |
| `/api/internal/payroll` | daily | Execute due payroll campaigns (per-payday atomic claim makes overlapping runs safe) |
| `/api/internal/billing` | daily | Premium downgrade sweep for delinquent merchants |

### Gotchas

- **`/api/internal/billing` — use GET for the sweep.** Its `POST` handler is the
  HMAC-signed protocol webhook receiver (verified with `SUBSCRIPT_WEBHOOK_SECRET`),
  **not** the cron. Point the scheduler at `GET`.
- **Idempotency / safety.** These are safe to over-run: `customer-billing`/`cron-billing`
  gate every charge on the contract's sequence bitmap, and `internal/payroll` atomically
  claims each payday before moving funds. A missed run just delays work to the next
  tick — it never double-charges.
- **If a keeper silently stops,** the symptoms are: premium upgrades stuck "pending"
  (reconcile), subscriptions not renewing (cron-billing / customer-billing), payroll
  not paying out (internal/payroll), or premium not downgrading after non-payment
  (internal/billing).

## Required env for the keepers

- `KEEPER_SECRET` (or `CRON_SECRET`) — auth for all of the above.
- `PRIVATE_KEY` — admin/keeper signer for billing, payroll, reconcile, vault-draw.
- `KEEPER_PRIVATE_KEY` — the vault drawer; must be a funded EOA and match the
  on-chain drawer.
- `SPONSOR_PRIVATE_KEY` — gas sponsorship for server-signed embedded-wallet actions.
