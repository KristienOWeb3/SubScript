# Transaction PIN: where it should be required

There is no PIN, passcode, or step-up authentication anywhere in SubScript today. This lists where one should be required, where it shouldn't, and what makes it real rather than decorative.

---

## Why this matters more here than in most wallets

For embedded-wallet users — which is most of them — there is currently **nothing** between a session cookie and the entire wallet balance.

`src/app/api/execute-tx/route.ts` authorizes from `getSessionWallet(request.headers)` and nothing else. It then reads `encrypted_private_key` or `circle_wallet_id` and signs server-side. There is no wallet popup, no signature prompt, no confirmation step, because SubScript holds the keys. That's the whole point of the custody model and it's what makes the product usable — but it also means the usual last line of defence doesn't exist.

Three things compound it:

- **Sessions last 30 days.** Confirmed by the comment in `src/lib/auth.ts` around line 177. A stolen session is a month of spending authority.
- **The cookie is domain-wide** (`.subscriptonarc.com`), so it works on the dashboard, the checkout host, and every future subdomain.
- **Gas is sponsored**, so an attacker doesn't need to fund anything first. They just spend.

Note the asymmetry: a SIWE user with an external wallet gets a MetaMask prompt on every transaction. So this gap affects only your embedded-wallet users — who are the majority, and the least likely to be running hardware wallets and dedicated browsers.

A PIN is the missing per-action consent step. It's not a second auth factor and shouldn't be sold as one.

---

## Tier 1 — Always, every time, no exceptions

Irreversible movement of value out of the user's control, or changes to how value leaves.

1. **Withdrawal to an external address** — the `withdraw` path in `execute-tx`. Highest priority item on this list.
2. **Adding or changing a withdrawal or payout address.** This is the account-takeover payoff, not just a settings change. PIN *plus* an email alert *plus* a cooling-off window before the new address can receive anything.
3. **Peer-to-peer transfer** to another user or wallet.
4. **Batch payments** — the "Send Out" / "Batch Payments" surface. One action, many recipients, largest single blast radius in the product.
5. **Payroll execution**, and separately **payroll authorization** (`payroll.authorization_required`). Two distinct approvals, two PIN prompts.
6. **Merchant payout claim or settlement withdrawal.**
7. **Vault withdrawal** — `api/user/vault/withdraw` and `withdrawVaultShare`.
8. **Private key export** for legacy exportable wallets. Arguably the most severe action in the entire product: it hands over permanent, irrevocable control. PIN *and* a fresh OTP, not either alone.
9. **Setting, changing, or disabling the PIN itself.**
10. **Linking a new wallet via SIWE**, or **claiming a sub-user invite onto your wallet**.

## Tier 2 — Always, because it creates standing authority

These aren't one-off payments. Each one authorizes future money movement, so the consent has to be deliberate even when the immediate amount is small.

11. **Creating a subscription** — authorizing a recurring bounded charge.
12. **Raising an existing subscription's authorization** — upgrade, quantity increase, addon. Raising a ceiling is a new consent; lowering it is not.
13. **Creating a commit vault** or committing escrow to a merchant.
14. **Raising a vault commit amount**, or **enabling auto top-up** — auto top-up especially, since it converts a bounded commitment into a recurring one.
15. **Creating a sub-user or delegate.**
16. **Raising a sub-user's spend cap**, and especially **lifting the cap entirely** (`updateSubUserLimit` with `null`).
17. **Rotating a commit ID**, once that exists. It re-credentials a live delegate and invalidates what they're holding.
18. **Accepting a payment request or merchant plan offer** from a DM. The DM channel is proof-of-transaction gated, but accepting still creates an authorization.

## Tier 3 — Threshold and context based

Configurable, so the user tunes their own friction. Defaults should be conservative.

19. **Any single payment above a user-set amount.** Let them choose; default it low.
20. **Cumulative spend above a rolling daily ceiling**, regardless of individual sizes. Catches drain-by-a-thousand-cuts.
21. **First payment to a new counterparty** — new merchant, new recipient address.
22. **Any payment from a device or IP not seen before**, or within the first N minutes of a brand-new session.
23. **Any payment while a security event is recent** — email changed, new device signed in, PIN reset, delegate added. A short elevated-friction window after anything security-relevant.

## Tier 4 — Disclosure and identity, not money

Consequential in ways users underestimate, and cheap to protect.

24. **Inviting a viewer to a receipt.** This permanently discloses financial detail to a third party and there is currently **no un-invite** — `receipts/invite` only appends. Irreversible disclosure deserves the same friction as irreversible spending.
25. **Registering or transferring a DNS alias.** It's a payment identity; losing it is an impersonation risk.
26. **Changing the account email address.** Because email is the recovery path for everything else.
27. **Exporting a full transaction history.**

---

## Where a PIN should NOT be required

This half matters as much as the list above. A PIN on everything trains people to enter it reflexively, which destroys the signal exactly when it counts.

**Never gate stopping something.** Cancelling a subscription, pausing or halting your own account, pausing a delegate, revoking a delegate, lowering a spend cap. All de-escalation, all frictionless. If an attacker with a stolen session cancels your Netflix, you've lost nothing. If a legitimate user can't stop payments because they forgot a PIN, you've built the dark pattern your entire product positions against. De-escalation is always safe; only escalation needs proof.

**Never on automated renewals.** The PIN is collected when the subscription is authorized. Prompting on each renewal would break set-and-forget, which is the core value proposition. The bounded authorization *is* the standing consent — that's what makes it bounded.

**Never on read paths.** Receipts, transaction history, dashboards, analytics, support tickets. And never on sign-in — that's what OTP and the session are for. A PIN gating login is a second password, not a transaction control.

**Not applicable to merchant API calls.** Those authenticate with API keys, server to server. A PIN is a human-presence check; there's no human in that loop. Key rotation and scoping are the controls there.

---

## What makes it real rather than theatre

A PIN implemented badly is worse than none, because it creates false confidence.

**Bind it to the action, not the session.** Verify server-side, per request, against that specific action's parameters — amount and recipient. If the PIN merely "unlocks" the session for ten minutes, a stolen session plus one shoulder-surfed entry drains the wallet. Issue a short-lived signed challenge scoped to the exact transaction and require the PIN to sign that challenge, so it can't be replayed against a different payment.

**Hash it like a password.** Argon2id or scrypt. Never reversible, never logged, never in an error message, never in Sentry.

**Rate limit with care.** Exponential backoff and lockout, but lockout must not become a denial of service on the user's own funds. Fall through to OTP recovery after a cooling-off period.

**Don't let email alone reset it.** If a PIN reset only needs email access, the PIN's security collapses to email security and it stops defending against the threat it exists for. Require the PIN's reset to be slow, notified, and paired with a hold on withdrawals during the window.

**Answer the Circle question before you build.** You're on Circle *developer-controlled* MPC, so SubScript holds the key material and a PIN would be your own application layer on top. Circle's user-controlled wallet product has a PIN and challenge flow built in. Decide deliberately whether you're rolling your own or moving that class of action onto Circle's flow — building your own and later migrating would mean two PIN systems and a painful cutover.

**Be honest about the ceiling.** A PIN defends against a stolen session, a shared device, and shoulder-surfing. It does not defend against a compromised server, a malicious admin, or a hostile dependency, because in the custodial model your backend can always sign. Don't let the PIN become the reason other controls get deferred.

---

## Suggested order

Withdrawals and payout-address changes first — that pair is where a stolen session turns into permanent loss. Then batch payments and payroll, because of blast radius. Then the standing-authority set in Tier 2. Thresholds and context rules last, since they need a preferences surface and per-user tuning.

Before any of it, shorten the 30-day session for money-moving routes specifically, or add a re-authentication requirement past a certain session age. That's cheaper than a PIN system and it shrinks the window every item above is defending.
