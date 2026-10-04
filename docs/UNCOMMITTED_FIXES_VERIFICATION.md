# Send review fixes and mobile navigation

Completed the nine original findings and two follow-up findings from the uncommitted-change review, and softened mobile bottom-bar selection. Existing desktop send form and unrelated working-tree edits are preserved.

## Requirements and evidence

| Requirement | Change | Verification |
|---|---|---|
| Unknown confirmation must not release spending limits | Persist submitted reservations in the existing reservation table before custody submission; retain them past the 15-minute TTL and rolling windows; reconcile only the owned Circle operation on terminal evidence | Executed route regressions and isolated Postgres tests with a reservation older than 40 days, owner isolation, late confirmation and repeated terminal polls |
| Outer/Circle success must not hide an inner transfer failure | Status requires actual sender USDC credit and checks embedded user-operation failure; missing chain evidence remains pending | Confirmed outer transaction with failed inner operation, missing receipt, RPC failure, another wallet and stale provider state regressions |
| Failed sends must not trigger fees or success receipts | Background settlement stops on proven failure or uncertain confirmation | Executed background callbacks prove no fee/receipt for inner reverts and timeouts |
| Batches must settle each item | Early acceptance applies only to root single sends; batches and delegated sends retain confirmation per leg | Successful and partial batches, delegated allowance accounting and root fast acceptance tests |
| Every settled batch recipient needs a receipt | Synchronous receipt processing retains the complete settled list | Full and partial batch receipt assertions |
| An Arc burn must not imply destination delivery | Open and closed bridge receipts use destination status and require completed minting | Executed modal and dashboard polling tests; distinct burn/mint hashes retain the sender's burn identity and reconcile actual optimistic storage without duplicates |
| Confirmed pending sends must not subtract principal twice | Update the optimistic hash before balance refresh, independently of presentation/Done | Actual Next browser checks show 98.88 after a 1 USDC send plus 0.125 fee while the Arrived sheet stays open |
| Failed pending sends must release the displayed reservation | Terminal failure removes the optimistic record before balance refresh, including after Done | Actual Next browser checks show reserved 99.00 returning to 100.00 both before and after Done |
| Retrying an accepted send must not create another permanent reservation | Early root single sends reuse the exact Circle transfer identity under the spending lock; retain is idempotent and terminal callbacks cannot rewrite finalized/released accounting | Actual isolated Postgres executes reserve/retain/bind twice, late confirmation/failure after 40 days, conflicting owner/payload, released rejection and expired unsubmitted cap checks; route tests prove stable identity and conservative replay failures |
| Closing a second pending receipt must preserve the first send's tracking | Independent watches keyed by optimistic ID, with per-operation cancellation and unmount cleanup | Six production callback regressions plus four actual Next browser cases cover first-send confirmation/failure after a second pending/failed receipt closes, independent balances, duplicate enrollment and aborted late responses |
| Mobile Deposit must respect reduced motion | One animation wrapper removes decorative duration/delay; close/swap guards handle overlapping actions and cancellation | Four Chromium checks across 390px/1280px, including recorded WAAPI timing, reduced motion and repeated closing |
| Bottom-bar switching needs more grace | Shared moving highlight and labels over 580ms with matching easing, interruptible selection; reduced motion switches immediately | Standalone and actual Next browser frame sampling proves intermediate widths, correct final selection after rapid clicks, and immediate reduced-motion updates; screenshots inspected |

The dashboard's two memoization lint errors were resolved by placing the arrival polling effect after the callback declarations it uses. No callback removal or repeated-fetch behavior was introduced.

## Verification

- 87 targeted unit/integration checks pass, including actual isolated Postgres execution against the existing reservation schema.
- All 21 send-flow Chromium checks pass against the actual Next runtime, including the reference animation, desktop form, individual pending failures, four overlapping-send cases and navigation motion.
- Four Deposit and two standalone navigation Chromium checks pass.
- TypeScript, full-source ESLint (`eslint src --quiet`), and scoped `git diff --check` pass.
- Browser payments, provider calls and RPC responses are controlled fixtures. No live transfers, production migration or deployment were performed.

## Changed files

- `src/components/dashboard/MobileFloatingNav.tsx`, `src/app/globals.css`: continuous selected highlight and label motion.
- `src/components/DepositModal.tsx`: reduced-motion timing and animation cancellation/overlap handling.
- `src/app/dashboard/user/page.tsx`, `src/components/SendSingleModal.tsx`, `src/lib/optimisticTx.ts`, `src/lib/payments/sendQuote.ts`: terminal settlement cleanup, destination tracking and stable history identity.
- `src/app/api/user/wallet/send/route.ts`, `src/app/api/user/wallet/send/status/route.ts`, `src/lib/custody/index.ts`, `src/lib/spendingLimits.ts`: verified settlement, batch receipts and durable submitted reservations.
- `tests/mobile-nav.spec.ts`, `tests/mobile-nav-playwright.config.ts`, `tests/deposit-modal.spec.ts`, `tests/send-flow.spec.ts`, `src/components/dashboard/__tests__/MobileFloatingNav.test.mjs`, `src/lib/payments/__tests__/sendQuote-rpc.test.mjs`, `src/lib/payments/__tests__/sendSettlement-regression.test.mjs`: regression coverage.
- This verification record and `docs/mainnet/README.md`: findings and completed-check evidence.

Simplifications: replaced instant independent tab backgrounds with one shared selection highlight; centralized Deposit's reduced-motion timing; separated optimistic settlement updates from history presentation; reused spending operations on retry and removed singleton settlement tracking. No dependencies were added.

The follow-up label-stutter fix uses measured numeric widths and naturally sized inner text, removes overlapping button layout projection, and aligns label/button timing. Two standalone browser checks verify constant glyph width and monotonic reveal; two checks against the running dashboard, two navigation lifecycle tests, TypeScript and scoped lint pass.

## Operational limits

The existing bounded background task has no durable fee/email retry worker. A transfer that confirms after that task ends can need manual fee/receipt recovery. A lost acceptance response without a Circle transaction ID retains a conservative reservation and requires manual reconciliation. These cases must not be treated as failed sends or automatically resent. Submitted reservations use the existing table/schema; no migration was introduced.
