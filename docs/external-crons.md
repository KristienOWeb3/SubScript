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

## Schedule these externally

All via **`GET`** with the `Authorization` header above:

| Endpoint | Suggested cadence | Purpose |
|---|---|---|
| `/api/cron/reconcile` | every 15 min | Recover stuck premium-upgrade payment sessions (user-facing — keep frequent) |
| `/api/cron/games-timeout` | hourly | Settle expired DM games, relay the referee-signed result on-chain, reclaim escrow for expired unjoined invites |
| `/api/cron/billing` | daily | Premium (merchant→SubScript) recurring billing + grace-period downgrades |
| `/api/internal/payroll` | daily | Execute due payroll campaigns (per-payday atomic claim makes overlapping runs safe) |
| `/api/internal/billing` | daily | Premium downgrade sweep for delinquent merchants |

### Gotchas

- **`/api/internal/billing` — use GET for the sweep.** Its `POST` handler is the
  HMAC-signed protocol webhook receiver (verified with `SUBSCRIPT_WEBHOOK_SECRET`),
  **not** the cron. Point the scheduler at `GET`.
- **Idempotency / safety.** These are safe to over-run: `games-timeout` settlement is
  idempotent, `customer-billing`/`cron-billing` gate every charge on the contract's
  sequence bitmap, and `internal/payroll` atomically claims each payday before moving
  funds. A missed run just delays work to the next tick — it never double-charges.
- **If a keeper silently stops,** the symptoms are: premium upgrades stuck "pending"
  (reconcile), subscriptions not renewing (cron-billing / customer-billing), payroll
  not paying out (internal/payroll), premium not downgrading after non-payment
  (internal/billing), or games not auto-settling at the 24h deadline (games-timeout).

## Required env for the keepers

- `KEEPER_SECRET` (or `CRON_SECRET`) — auth for all of the above.
- `PRIVATE_KEY` — admin/keeper signer for billing, payroll, reconcile, vault-draw.
- `KEEPER_PRIVATE_KEY` — the DM-game referee/relayer (games-timeout settlement relay)
  and vault drawer; must be a funded EOA and match the on-chain referee/drawer.
- `SPONSOR_PRIVATE_KEY` — gas sponsorship for server-signed embedded-wallet actions.
