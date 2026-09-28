import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSupportTicketFirstAdminReplyEmail,
  buildSupportTicketAdminReplyEmail,
  buildSupportTicketResolvedEmail,
  buildSupportTicketClosedEmail,
  buildSupportTicketReopenedEmail,
  buildSupportTicketUrl,
} from "../../email/templates/support.ts";

test("buildSupportTicketUrl generates correct thread URL with ticket query param", () => {
  const url = buildSupportTicketUrl("tkt_12345");
  assert.equal(url, "https://www.subscriptonarc.com/support?ticket=tkt_12345");
});

test("first admin reply notification combines claim and reply context cleanly", () => {
  const email = buildSupportTicketFirstAdminReplyEmail({
    recipient: "requester@example.com",
    ticketId: "tkt_claim_reply_1",
    messageId: "msg_123",
    subject: "Vault settlement inquiry",
  });

  assert.equal(email.subject.includes("SubScript Support replied: Vault settlement inquiry"), true);
  assert.equal(email.text.includes("SubScript Support is handling your ticket"), true);
  assert.equal(email.text.includes("https://www.subscriptonarc.com/support?ticket=tkt_claim_reply_1"), true);
  // Invariant: no raw admin names or internal identifiers
  assert.equal(email.text.includes("admin_root"), false);
  assert.equal(email.text.includes("0x"), false);
  // Invariant: deterministic hashed idempotency key
  assert.equal(email.idempotencyKey.startsWith("support-ticket-first-reply:msg_123:"), true);
  assert.equal(email.idempotencyKey.includes("requester@example.com"), false);
  // Humanizer invariant: no em or en dashes
  assert.equal(/[\u2013\u2014]/.test(email.text), false);
  assert.equal(/[\u2013\u2014]/.test(email.html), false);
  assert.equal(/[\u2013\u2014]/.test(email.subject), false);
});

test("subsequent admin reply notification carries reply context without claiming copy", () => {
  const email = buildSupportTicketAdminReplyEmail({
    recipient: "requester@example.com",
    ticketId: "tkt_followup_2",
    messageId: "msg_456",
    subject: "Webhook latency question",
  });

  assert.equal(email.subject.includes("New reply from SubScript Support: Webhook latency question"), true);
  assert.equal(email.text.includes("New reply from SubScript Support"), true);
  assert.equal(email.text.includes("SubScript Support is handling your ticket"), false);
  assert.equal(email.text.includes("https://www.subscriptonarc.com/support?ticket=tkt_followup_2"), true);
  assert.equal(email.idempotencyKey.startsWith("support-ticket-reply:msg_456:"), true);
  assert.equal(email.idempotencyKey.includes("requester@example.com"), false);
  // Humanizer invariant: no em or en dashes
  assert.equal(/[\u2013\u2014]/.test(email.text), false);
  assert.equal(/[\u2013\u2014]/.test(email.html), false);
});

test("resolution notification contains ticket reference and subject", () => {
  const email = buildSupportTicketResolvedEmail({
    recipient: "requester@example.com",
    ticketId: "tkt_resolve_3",
    subject: "DNS verification assistance",
  });

  assert.equal(email.subject.includes("Ticket resolved: DNS verification assistance"), true);
  assert.equal(email.text.includes("DNS verification assistance"), true);
  assert.equal(email.text.includes("https://www.subscriptonarc.com/support?ticket=tkt_resolve_3"), true);
  assert.equal(email.idempotencyKey.startsWith("support-ticket-resolved:tkt_resolve_3:"), true);
  assert.equal(/[\u2013\u2014]/.test(email.text), false);
});

test("closed notification informs requester with thread link", () => {
  const email = buildSupportTicketClosedEmail({
    recipient: "requester@example.com",
    ticketId: "tkt_close_4",
    subject: "API rate limit increase",
  });

  assert.equal(email.subject.includes("Ticket closed: API rate limit increase"), true);
  assert.equal(email.text.includes("API rate limit increase"), true);
  assert.equal(email.text.includes("https://www.subscriptonarc.com/support?ticket=tkt_close_4"), true);
  assert.equal(email.idempotencyKey.startsWith("support-ticket-closed:tkt_close_4:"), true);
  assert.equal(/[\u2013\u2014]/.test(email.text), false);
});

test("reopened notification alerts requester that conversation is active again", () => {
  const email = buildSupportTicketReopenedEmail({
    recipient: "requester@example.com",
    ticketId: "tkt_reopen_5",
    subject: "Billing disagreement",
  });

  assert.equal(email.subject.includes("Ticket reopened: Billing disagreement"), true);
  assert.equal(email.text.includes("Billing disagreement"), true);
  assert.equal(email.text.includes("reopened"), true);
  assert.equal(email.text.includes("https://www.subscriptonarc.com/support?ticket=tkt_reopen_5"), true);
  assert.equal(email.idempotencyKey.startsWith("support-ticket-reopened:tkt_reopen_5:"), true);
  assert.equal(/[\u2013\u2014]/.test(email.text), false);
});
