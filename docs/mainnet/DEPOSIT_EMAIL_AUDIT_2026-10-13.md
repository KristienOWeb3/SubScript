# Deposit email duplication audit — 13 October 2026

## Confirmed incident

Production project `jntqgoneegykgtiyvvge` recorded two accepted emails for the same recipient and transaction `0xcf7266c10e1688c76bacaf70750aa41f70575ef1ed6c0f760c19281d0906805e`:

| Time (UTC) | Subject | Outbox ID |
| --- | --- | --- |
| 18:20:18 | You received a payment: 0.408774 USDC | `6b102cac-ba81-4178-943c-bb275d4313ce` |
| 18:23:52 | Deposit confirmed: 0.408774 USDC on Arc Network (5042) | `aaf1fb78-27dd-4a90-8392-ea59000c88be` |

Both had one provider attempt and different provider IDs. The settlement job identifies the transfer as `wallet_transfer`, chain `5042`, state `enqueued`. This was duplicate notification ownership, not a duplicated transfer or provider retry.

The settlement worker sends the receiver a payment receipt. The direct deposit scanner later discovers the same incoming USDC transfer. Their separate `settlement-receipt:` and `deposit:` keys bypassed the existing unique outbox identity. Equivalent overlap exists for payroll, refunds, payouts and bridge confirmations. Bridge display labels (`Arc Network` versus `Arc Network (5042)`) also previously changed email identity.

## Applied protection

Migration `supabase/migrations/20261013185408_email_financial_receipt_guard.sql` is applied on production and recorded in `_subscript_migrations` with normalized SHA-256 `9f4d7e2c5c5ca8b9d26b5cf4438759bf8e7a862e8ff1743d5e289dc9b92ee027`.

- A server-only registry atomically claims one financial confirmation per chain, transaction hash and normalized recipient email.
- The insert trigger redirects competing producer identities to the existing outbox row. Existing payloads, provider keys and delivery states remain immutable.
- Backfill preserves old receipt identities. Legacy deployed templates resolve through known Arc explorer links or durable settlement/receipt/bridge records. Late-recorded transaction evidence can recover an earlier legacy receipt during enqueue.
- New producer code supplies structured `receiptEvent` metadata, removing dependence on display text. Direct scans, custody settlement jobs and payment-link verification supply the actual chain. This application code remains in the working tree; the database guard already protects the verified production path.
- Public clients cannot access the registry or execute its parser. Functions use invoker privileges and a fixed empty search path.

No existing emails were deleted or resent. At rollout all 25 outbox rows were already accepted, with zero pending/sending rows needing suppression; eight historical confirmation claims were backfilled.

## Verification

- 754 security regression tests passed, including the expanded email suite.
- 13 database guard checks cover both producer orders, concurrent calls, backfill, late evidence, unchanged payload/provider key, recipient/chain/hash separation, explicit-metadata rejection, permissions and rollback.
- Three producer runtime checks cover scanner, wallet, payroll, vault, router and payment-link receipt metadata; sender receipts remain independent for different recipients.
- TypeScript passed; repository lint had zero errors (179 existing warnings); secret scan and whitespace checks passed.
- Production replay of the actual affected transaction, using both legacy and structured messages, returned the original payment receipt. Assertions checked unchanged payload and row count. The transaction was rolled back; no email provider was called.
- Post-migration security advisors found only the expected deny-all RLS/no-policy notice on the new registry. Existing unrelated mutable-search-path and `rls_auto_enable` execution warnings predate this change.

## Boundaries and follow-up findings

The rule is one confirmation per chain/transaction/mailbox, matching the scanner's existing granularity. Multiple financial legs delivered to the same mailbox in one transaction retain the first receipt's amount; this does not aggregate amounts. Different recipient mailboxes remain independent. Bridge initiation and completion remain separate lifecycle emails.

Legacy messages with unknown or conflicting chain evidence remain unclassified instead of being assigned to the wrong network. Settlements proved only by a durable reference, without a recoverable transaction hash, retain their existing reference deduplication. They cannot share a transaction claim until the hash is known. Deploy the structured producer metadata with the next application release.

Bridge audit also found that already-minted recovery substitutes the burn hash for an unavailable destination mint hash, and immediate/recovery recipient resolution differs. These require a separate bridge reconciliation change and were not modified in this deposit-notification fix. Unmatched zero-address mints remain eligible for deposit emails because external onramps can mint without a SubScript bridge record.

Resend's provider-key guarantee lasts 24 hours ([provider documentation](https://resend.com/docs/dashboard/emails/idempotency-keys)). The durable registry/outbox provides longer-lived deduplication. Existing ambiguous sends beyond that window continue to enter review rather than being blindly retried.

## Banner preference and design preview

The user selected the banner receipt as the preferred incoming email. Incoming settlements and payment-link receipts now use `buildDepositReceivedEmail`, so either producer wins with the banner instead of selecting an unrelated plain template. Original producer keys and the shared database claim are retained. Sender receipts remain separate. Payment-link receipts retain their private receipt button.

`core.ts` adds an email-safe platform shell for the deposit receipt: ivory `#fffff0`, pale blue `#d4e3e8`, charcoal `#353935`, the current logo and rounded cards. `transactional.ts` retains the network banner, removes duplicate quantity/USD rows and the unverified `$0.00` fee, and links the confirmed hash to Arc rather than the bridge's origin explorer. Direct scans pass the deposit timestamp.

Preview delivery was confirmed by Resend (`last_event: delivered`, provider ID `01a136bd-9587-7511-a5de-fb0db729e24c`). The email is labeled as sample data with no funds moved. The local rendering is `.omx/previews/deposit-email/preview.html`; `scripts/preview-deposit-email.ts` reproduces it and requires an explicit `--send --to` argument to email a preview. A Windows process shutdown assertion occurred after acceptance; the delivery record was verified independently and the script now closes the database pool instead of forcing process exit. No resend was attempted.

All 108 email tests passed, including the regression that first failed on the plain incoming template. TypeScript passed. Desktop and 375px mobile rendering passed visual review (95/100) with both images loaded and no horizontal overflow. The user approved this design and banner preference on 13 October 2026; application deployment remains pending. The earlier database deduplication guard remains active.
