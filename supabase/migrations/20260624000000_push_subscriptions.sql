/* SQL Migration: Push notification subscriptions.
 *
 * Stores the destinations SubScript can push to for a given wallet. Designed to be
 * transport-agnostic so a future native mobile app can reuse the same table and send path:
 *   - Web Push (browsers):   platform='web',  endpoint + p256dh + auth populated.
 *   - Native (future iOS/Android): platform='ios'|'android', device_token populated (FCM/APNs).
 */

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    platform      TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
    /* Web Push fields */
    endpoint      TEXT,
    p256dh        TEXT,
    auth          TEXT,
    /* Native push token (FCM / APNs) for the future mobile app */
    device_token  TEXT,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ
);

/* One row per browser endpoint and per native device token. */
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx
    ON push_subscriptions(endpoint) WHERE endpoint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_device_token_idx
    ON push_subscriptions(device_token) WHERE device_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_wallet_idx
    ON push_subscriptions(wallet_address);

/* Default-deny RLS to match the rest of the schema; the service role (server) bypasses it. */
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access" ON push_subscriptions;
CREATE POLICY "Deny all public access" ON push_subscriptions FOR ALL USING (false);
