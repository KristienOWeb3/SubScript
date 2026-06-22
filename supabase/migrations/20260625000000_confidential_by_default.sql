/* Confidential-by-default — Phase 0.
 *
 * New merchants default to confidential (shielded) payout intent. This is safe because the
 * batch-payout path fails closed: a merchant marked shielded but without a registered view key is
 * blocked (409), never silently downgraded to a public payout.
 *
 * Existing merchants are intentionally left untouched so no one's behavior changes underneath them.
 * Baseline confidentiality (enabling shielding + registering a view key) is now free for all tiers;
 * Privacy Premium remains the paid tier for advanced controls.
 */

ALTER TABLE merchants ALTER COLUMN shielded_payouts_enabled SET DEFAULT true;
