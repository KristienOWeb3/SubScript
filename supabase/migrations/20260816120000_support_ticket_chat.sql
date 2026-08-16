-- Support ticket chat: in-app conversations between a user/merchant and the admin team.
--
-- `src/lib/support/tickets.ts` treats this migration as the source of truth and only falls back
-- to a runtime CREATE TABLE if it reaches a database where these tables are absent. Keep the
-- shape here in sync with `ensureSupportTables()`.
--
-- Admin exclusivity: the first admin to reply claims the ticket via claimed_by_admin_wallet.
-- Every other admin keeps read access, so claim is advisory-by-column rather than a row lock.

CREATE TABLE IF NOT EXISTS support_tickets (
    id VARCHAR(64) PRIMARY KEY,
    creator_wallet VARCHAR(128) NOT NULL,
    creator_role VARCHAR(32) NOT NULL DEFAULT 'USER',
    creator_alias VARCHAR(128),
    creator_profile_pic TEXT,
    subject VARCHAR(256) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    claimed_by_admin_wallet VARCHAR(128),
    claimed_by_admin_alias VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_creator ON support_tickets(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64) NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_wallet VARCHAR(128) NOT NULL,
    sender_role VARCHAR(32) NOT NULL,
    sender_alias VARCHAR(128),
    sender_profile_pic TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_ticket_messages(ticket_id);

-- The ticket list is always ordered by most recent activity, and the admin queue filters on
-- status first. Neither is covered by the single-column indexes above.
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_last_message
    ON support_tickets(status, last_message_at DESC);
