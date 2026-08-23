# Two implementation prompts

Copy either block into a fresh agent session. They're independent — run in any order.

Both assume the repo root is the SubScript project and that `.claude/CLAUDE.md` is in effect.

---

## Prompt 1 — Make receipts and notifications human-readable

**Context for you (not part of the prompt):** the real bug is a schema gap, not CSS. `Receipt` has no title column, so the page literally has nothing human to display. Fix the data first or the restyle will just be prettier hex.

```text
Read .claude/CLAUDE.md first, then invoke the frontend-design skill before writing any UI code.

GOAL
SubScript's pitch is "human-readable receipts you can verify." Right now a receipt shows a
machine token as its headline. Fix that end to end — data, page, email, and notifications —
so a person reading a receipt sees what they bought, from whom, for how much, and when.
Never a hex string as the primary content.

THE PROBLEM, WITH EVIDENCE

1. src/app/receipt/[receiptId]/ReceiptClient.tsx:319 sets the page <h1> to
   {receipt.receipt_id} — the headline of the receipt is "rcpt-" plus 32 hex chars.

2. Line 351 renders the "Memo note" field as {receipt.memo_note || receipt.receipt_id},
   so when there's no memo the same hex string appears twice on one page.

3. ROOT CAUSE: prisma/schema.prisma model Receipt (line ~619) has no human title column.
   Fields are receiptId, paymentLinkId, txHash, chainId, memoContract, payerAddress,
   beneficiaryAddress, merchantAddress, amountUsdc, memoNote, shareUrl, status,
   blockNumber, logIndex, confirmedAt, invitedAddresses, createdAt, updatedAt.
   Meanwhile sendPaymentReceiptEmail in src/lib/email/transactional.ts accepts a
   paymentTitle argument that is never persisted anywhere. The page cannot show what the
   payment was for because that fact is not stored.

4. "Memo note" is a database column name used as a user-facing label. Users don't know
   what a memo is.

5. Every label uses text-[10px] uppercase tracking-[0.24em]. CLAUDE.md requires sentence
   case for user-facing headings, not ALL CAPS. Body copy is text-xs and text-[9px] —
   unreadable for a document someone may print or forward.

6. "Opt-In Privacy" (line 316) and "Invite Address to View Receipt" (line 374) are Title
   Case jargon. "Address" here means wallet address, which most payers won't parse.

7. src/lib/email/transactional.ts renders "Receipt {receiptId}" in the payment receipt
   email body and a CTA reading "View private receipt".

8. src/components/dashboard/NotificationBell.tsx has the same aesthetic problem —
   uppercase tracking-wider labels, text-[9px]/text-[10px] copy, font-mono timestamps —
   and it renders on a light panel while the receipt page is dark, so the two surfaces
   don't look related.

WHAT TO DO

A. Schema and data
   - Add a nullable `title` (String?, @map("title")) to model Receipt. Write a Prisma
     migration under supabase/migrations/ following the naming and header-comment
     convention of the existing files there.
   - Populate title at receipt creation on every path that creates a Receipt. Source it
     from the payment link title, the subscription plan name, or the checkout intent
     title, whichever applies. Find all creation sites; do not guess.
   - Return title from GET /api/receipts/[receiptId] alongside the existing fields.
   - Backfill: for rows with a paymentLinkId, derive the title from the linked record.
     Leave the rest null — do not invent titles for historical rows.

B. The receipt page
   - Headline becomes the human subject: title, falling back to memoNote, falling back to
     "Payment to {merchant display name}". The raw receipt ID must NEVER be the fallback.
   - Resolve merchant and payer to display names using the existing Identity component so
     a name appears wherever one is registered, with the truncated address only as its
     own fallback.
   - Demote the receipt ID to a small "Reference" row near the bottom, with a copy button,
     labelled so it reads as the on-chain reference rather than the subject of the page.
   - Rename "Memo note" to "Note", and hide the whole block when there is no note. Never
     show an empty or ID-filled note field.
   - Rewrite the privacy badge as a plain sentence explaining that only the payer, the
     merchant, and people they invite can open this page. Sentence case.
   - Rewrite the invite section in plain language — heading and helper text both. Keep the
     0x input, but explain what to paste.
   - Raise base type size so the document is comfortably readable. Sentence case
     throughout. Remove the wide-tracked all-caps micro-labels.

C. Theme
   A receipt is a document, not a dashboard panel. Keep the dark app chrome, but render
   the receipt card itself as a light document surface with clear typographic hierarchy so
   it reads as something you'd forward to an accountant. Keep the #00d2b4 accent. Add a
   print stylesheet and a "Save as PDF" affordance that uses the browser print path — a
   receipt's main job is expenses and tax.

D. Email
   In src/lib/email/transactional.ts, lead the payment receipt email with the same human
   subject line, and use the merchant display name. Move the receipt ID to small print at
   the bottom, or drop it — the CTA link already carries it. Change the CTA label from
   "View private receipt" to something plainer. Keep the shared renderEmailLayout, the
   idempotency keys, and every htmlEscape call exactly as they are.

E. Notifications
   - Apply the same copy and type rules to src/components/dashboard/NotificationBell.tsx:
     sentence case, no all-caps tracking, readable sizes, relative timestamps in plain
     words ("2 hours ago") instead of mono uppercase.
   - Audit every producer of notification title/body strings — src/lib/push.ts,
     src/app/api/notifications/route.ts, and anywhere else that authors them. No
     notification may contain a raw rcpt- ID, a bare 0x address, or a database enum name.
     Each one should read as a sentence a person would say.
   - Make the bell's visual language consistent with the receipt surface.

HARD CONSTRAINTS — DO NOT BREAK THESE
   - Do not change the receipt ID format, generateReceiptId, isReceiptId, or the
     /receipt/[receiptId] URL shape. The ID is the on-chain memo string passed by
     buildMerchantPaymentTx in src/lib/arc/memo.ts, and it appears in idempotency keys.
     This task is about presentation, not identity.
   - Do not weaken the receipt authorization check in
     src/app/api/receipts/[receiptId]/route.ts. Default-deny stays: payer, merchant, and
     invited addresses only.
   - Preserve every existing comment and docstring not directly tied to a change. Several
     explain non-obvious decisions.
   - Keep all HTML escaping in the email layer.

VERIFY
   - npx tsc --noEmit --pretty false
   - npm run build
   - Grep the repo for any remaining place a raw rcpt- ID or bare 0x address is rendered
     as primary user-facing content, and report what you find.
   - Show me the receipt page before and after, including the no-title fallback case and
     the no-note case.
```

---

## Prompt 2 — Commit ID rotation and account self-halt

**Context for you (not part of the prompt):** rotation is cheap because `commit_id` is already a separate column from the row's `id` and every relationship hangs off `id`. Self-halt is the bigger gap — pause exists but only a parent can pause a child, so nobody can freeze their own account.

```text
Read .claude/CLAUDE.md first. Read src/lib/commitId.ts and src/lib/vaultCommitSharing.ts
in full before designing anything — both have long header comments explaining security
decisions you must not undo.

GOAL
Two related gaps in the commit system:
  1. A commit ID is a bearer credential and cannot be rotated.
  2. A user can pause a delegate but cannot pause their own account.

BACKGROUND YOU NEED

A commit ID is a credential, not just a key. From the header of
src/lib/vaultCommitSharing.ts: "A friend needs no SubScript account and no wallet — the
Commit ID is the whole credential they paste into the platform." And from claimSubUser in
src/lib/commitId.ts: "The 10-char commit ID doubles as the invite token."

So a leaked commit ID lets someone else spend against the primary's escrow up to that
delegate's cap. Today the only remedy is revokeSubUser, which is deliberately terminal:
"reopening a revoked delegation has to be a fresh sub-user so the spend ledger can't be
resurrected." Correct for revocation, but it means a leak costs the delegation, the spend
history, and a re-onboard.

PART 1 — ROTATION

Rotation is a one-column update. commit_id is a separate unique column from the row's id,
and parent_commit_id, spent_usdc and the cap all hang off id. So a new commit_id preserves
identity, cap, and ledger. Confirm this reading against prisma/schema.prisma and the
migrations before relying on it.

Implement:
   - rotateSubUserCommitId(parentWalletAddress, subCommitId) in src/lib/commitId.ts and
     rotateVaultShareCommitId(userAddress, commitId) in src/lib/vaultCommitSharing.ts.
   - Reuse the existing authority helpers. Sub-user rotation must go through
     requireOwnedSubUser so a delegate can never rotate a sibling. Vault share rotation
     must prove authority the way the existing pause/resume/revoke functions in that file
     do — via MeteredVault.userAddress, not wallet_address on the commit row.
   - Reuse the P2002 collision retry loop that createSubUser and createCommitRow already
     use. Do not invent a new pattern.
   - Refuse rotation on a REVOKED row, matching setSubUserStatus's 409 behaviour.
   - Old ID stops working immediately. No grace window — a grace window defeats the point
     of a leak response. Say this in a comment.
   - Add POST /api/user/commit/sub-users/rotate alongside the existing pause and revoke
     routes, following their exact auth and error-shape conventions. Use CommitAccessError
     so 403/404/409 stay distinct.
   - Rate-limit rotation per account. Without a limit it becomes a griefing vector between
     a parent and a delegate.

Two things to handle explicitly in the UI copy:
   - Rotating an UNCLAIMED sub-user regenerates an invite. Rotating a CLAIMED one
     re-credentials a live person and instantly breaks whatever they pasted into a
     merchant's platform. Same operation, different consequence — the confirmation copy
     must say which case it is, based on whether walletAddress is null.
   - The delegate has to be told. There is currently no email or DM for this; see
     docs/email-audit.md. Emit an event and add the notification, or if that's out of
     scope, make the UI state plainly that the user must tell them, and leave a TODO
     referencing the audit.

PART 2 — SELF-HALT

Pause already exists and is well built: pauseSubUser/resumeSubUser, plus
findInactiveAncestor which cascades a pause down the whole chain via a recursive CTE
rather than checking one level. Keep all of that.

What's missing: every one of those paths runs through
requireOwnedSubUser(parentWalletAddress, subCommitId), so only a parent can pause a child.
A user cannot pause their own root commit. Their only way to stop outbound money today is
cancelling every subscription individually, which is destructive.

Implement a self-halt on the caller's own root commit, authorized by their own session:
   - HALTED must stop outbound money: subscription renewals, vault draws, delegate
     spending, batch payouts, new authorizations.
   - It must NOT block sign-in, reading receipts, viewing transaction history, or opening
     a support ticket. The reasoning is already written down in the header of
     src/lib/admin/withdrawalHolds.ts — a frozen account still has to be able to answer
     questions about itself. Follow that model, and follow its fail-closed posture: a
     database error on the halt check blocks the spend rather than waving it through.
   - Halting cascades to all delegates. findInactiveAncestor already does this if the root
     status changes — verify that and extend rather than duplicating the CTE.
   - Self-resume, by the same session. Unlike revocation, halt is reversible.
   - Decide and document whether HALTED is a new CommitStatus value or a separate column.
     If you extend CommitStatus, audit every switch and comparison on it — validateSubUserCanSpend,
     resolveSpendingAuthority, claimSubUser and setSubUserStatus all branch on status and
     several assume exactly three values.

THE TENSION TO RESOLVE DELIBERATELY

Self-halt collides with the Merchant Protection Layer described in
docs/subscript-protocol-features-and-problems-solved.md section 3.18 — service lock
windows, a 72-hour ceiling for digital goods, 30 days for SaaS seats, and minimum
commitment periods on discounted plans. If halt silently voids those, it becomes a way to
consume a digital good and then freeze before paying.

Implement it so halt stops NEW authorizations immediately, while existing bounded
commitments either run to term or are broken explicitly with the merchant notified. Write
the reasoning into a header comment. If you think a different resolution is better, say so
and explain the tradeoff before implementing.

ALSO FIX WHILE YOU'RE HERE

src/lib/events/types.ts defines vault.pause_requested and vault.resumed, and neither is
ever emitted. vault.paused IS emitted, but only from src/app/api/user/vault/withdraw/route.ts,
where it means the vault was drained — not temporarily halted. That name is doing two jobs.
Split it before building on it, and wire the pause and resume events to the new code.

HARD CONSTRAINTS
   - Do not change generateCommitId, the Crockford base32 alphabet, or the ID length. The
     alphabet omits I/L/O/U so a transcribed ID can't become a different valid one, and 32
     divides 256 evenly so the modulo stays uniform. Both are documented and correct.
   - Keep revocation terminal.
   - Keep delegation exactly one level deep. requireRootCommit exists specifically to stop
     a capped sub-user minting an uncapped grandchild.
   - Do not touch recordSubUserSpend's atomic UPDATE or releaseSubUserSpend's GREATEST
     floor. The header comments explain why each is shaped that way.
   - Preserve all existing comments and docstrings not tied to a change.

VERIFY
   - npx tsc --noEmit --pretty false
   - npm run build
   - Add tests: rotation preserves spent_usdc and the cap; the old ID stops resolving;
     a delegate cannot rotate a sibling; halt cascades to delegates; a halted account can
     still sign in and read receipts; halt does not void an in-window commitment.
   - Report which files branch on CommitStatus and confirm each was reviewed.
```
