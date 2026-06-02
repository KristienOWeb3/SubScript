/* SQL Migration to enable RLS globally and enforce a strict Default Deny policy. */
/* This prevents any direct public or authenticated client access using the anon or authenticated keys. */

/* 1. Drop existing permissive policies */
DROP POLICY IF EXISTS merchants_access_policy ON merchants;
DROP POLICY IF EXISTS subscriptions_access_policy ON subscriptions;

/* 2. Explicitly enable Row-Level Security on all tables */
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_embedded_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;

/* 3. Implement strict "Default Deny" policies for all operations */
CREATE POLICY "Deny all public access" ON merchants FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON api_keys FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON waitlist_leads FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON webhook_endpoints FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON webhook_events FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON otp_codes FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON user_embedded_wallets FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON subscriptions FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON sessions FOR ALL USING (false);
CREATE POLICY "Deny all public access" ON payment_sessions FOR ALL USING (false);
