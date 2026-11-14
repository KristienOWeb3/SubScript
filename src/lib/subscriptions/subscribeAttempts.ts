/* Subscribe attempt bookkeeping: how a failed create is classified, and which idempotency key the
 * next try gets.
 *
 * Split out of the subscribe route so both rules are testable without the route's dependencies.
 *
 * Why it matters: the route used to mark every error it did not recognise as FAILED_TERMINAL, and
 * a terminal attempt is looked up by an idempotency key that never changes for that subscriber,
 * merchant, plan and generation. So one "insufficient USDC" turned into "Subscription attempt
 * failed" on every later try, forever, even after the user topped up.
 *
 * The three outcomes:
 *
 * - TERMINAL. A contract or provider rejection that will fail the same way however many times it
 *   runs: bad terms, a duplicate the contract refuses, a misconfigured provider. Retrying can't help.
 * - RETRYABLE. Nothing was created on-chain and the user (or time) can fix the cause, such as a
 *   balance or allowance shortfall, a gas-sponsorship refusal, or a mined revert. The next try gets
 *   a fresh key (see nextSubscribeAttemptKey). A fresh key is safe because the PSA's
 *   duplicate-active guard refuses a second live authorization with the same terms, so even a racing
 *   first transaction can't turn into two charges.
 * - UNKNOWN. The request may have reached the provider, as with a timeout or a dropped connection.
 *   The retry has to reuse the SAME key so the custody provider hands back the original
 *   transaction instead of sending another. Anything unrecognised lands here, because guessing
 *   "not submitted" is the mistake that charges twice.
 */

export type SubscribeFailureClass = "TERMINAL" | "RETRYABLE" | "UNKNOWN";

/* Contract custom errors and provider rejections that no retry can fix. */
const DEFINITIVE_PATTERNS: RegExp[] = [
    /\bInvalidAddress\b/,
    /\bInvalidAmount\b/,
    /\bInvalidPeriod\b/,
    /\bInvalidIntroductoryTerms\b/,
    /\bMaxPaymentAmountRequired\b/,
    /\bDuplicateActiveSubscription\b/,
    /\bNotAuthorized\b/,
    /API parameter invalid/i,
    /paymaster policy/i,
    /no server-held key/i,
];

/* The user can fix these, and nothing was created on-chain. */
const USER_FIXABLE_PATTERNS: RegExp[] = [
    /insufficient/i,
    /exceeds (?:balance|allowance)/i,
    /ERC20Insufficient(?:Balance|Allowance)/,
    /not enough (?:funds|balance|usdc)/i,
];

/* The request may or may not have been accepted. */
const IN_FLIGHT_PATTERNS: RegExp[] = [
    /timeout/i,
    /timed out/i,
    /network/i,
    /econnreset/i,
    /etimedout/i,
    /socket hang up/i,
    /fetch failed/i,
    /aborted/i,
    /\b50[234]\b/,
    /\bSTUCK\b/,
];

/* The provider reached a final failed state, or the transaction mined and reverted. Either way no
   subscription exists, so a fresh attempt is safe (the contract refuses duplicates). */
const NOT_CREATED_PATTERNS: RegExp[] = [
    /revert/i,
    /\b(?:FAILED|DENIED|CANCELLED)\b/,
];

export function classifySubscribeFailure(error: unknown): SubscribeFailureClass {
    const err = error as { message?: unknown; kind?: unknown; name?: unknown } | null;
    /* Gas sponsorship runs before the create is submitted. A definitive refusal (budget, policy) is
       fixable by waiting; an ambiguous one may still confirm a top-up, so its key is kept. */
    if (err?.name === "SponsoredGasError" || err?.kind === "definitive" || err?.kind === "ambiguous") {
        return err?.kind === "ambiguous" ? "UNKNOWN" : "RETRYABLE";
    }
    const message = typeof err?.message === "string" ? err.message : String(error ?? "");
    if (DEFINITIVE_PATTERNS.some((pattern) => pattern.test(message))) return "TERMINAL";
    if (USER_FIXABLE_PATTERNS.some((pattern) => pattern.test(message))) return "RETRYABLE";
    if (IN_FLIGHT_PATTERNS.some((pattern) => pattern.test(message))) return "UNKNOWN";
    if (NOT_CREATED_PATTERNS.some((pattern) => pattern.test(message))) return "RETRYABLE";
    return "UNKNOWN";
}

/* What the subscriber reads for a retryable failure. Named causes get a concrete next step; the
   rest say plainly that trying again is fine. */
export function retryableSubscribeMessage(error: unknown): string {
    const message = String((error as { message?: unknown } | null)?.message ?? error ?? "");
    if (/allowance/i.test(message)) {
        return "Your wallet didn't approve enough USDC for this subscription. Try again and approve the full amount.";
    }
    if (USER_FIXABLE_PATTERNS.some((pattern) => pattern.test(message))) {
        return "You don't have enough USDC for the first payment. Add funds, then try again. Nothing was charged.";
    }
    if ((error as { kind?: unknown } | null)?.kind === "definitive") {
        return message || "We couldn't cover the network fee for this subscription right now. Try again later. Nothing was charged.";
    }
    return "The subscription didn't go through and nothing was charged. You can try again.";
}

export const SUBSCRIBE_ATTEMPT_NONCE_SEPARATOR = ":attempt:";

/**
 * The idempotency key for the next subscribe attempt.
 *
 * `prior` is every attempt already stored under `baseKey` or one of its nonce-suffixed variants.
 * - No prior attempt: use the base key, so existing keys keep their meaning.
 * - The newest one failed retryably: mint `${baseKey}:attempt:${n}`. Its provider key derives from
 *   it, so the custody provider treats the retry as a new request instead of replaying the failure.
 * - Anything else (in flight, unknown, completed, terminal): reuse that attempt as-is.
 */
export function nextSubscribeAttemptKey<T extends { idempotencyKey: string; status: string; createdAt: Date | string }>(
    baseKey: string,
    prior: T[],
): { reuse: T | null; idempotencyKey: string | null } {
    if (prior.length === 0) return { reuse: null, idempotencyKey: baseKey };
    const newest = [...prior].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    if (newest.status !== "FAILED_RETRYABLE") return { reuse: newest, idempotencyKey: null };
    let highestNonce = 1;
    for (const attempt of prior) {
        const at = attempt.idempotencyKey.lastIndexOf(SUBSCRIBE_ATTEMPT_NONCE_SEPARATOR);
        if (at < 0 || attempt.idempotencyKey.slice(0, at) !== baseKey) continue;
        const nonce = Number(attempt.idempotencyKey.slice(at + SUBSCRIBE_ATTEMPT_NONCE_SEPARATOR.length));
        if (Number.isSafeInteger(nonce) && nonce > highestNonce) highestNonce = nonce;
    }
    return { reuse: null, idempotencyKey: `${baseKey}${SUBSCRIBE_ATTEMPT_NONCE_SEPARATOR}${highestNonce + 1}` };
}
