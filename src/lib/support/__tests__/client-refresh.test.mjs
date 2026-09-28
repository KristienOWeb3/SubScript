import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    normalizeSupportTicket,
    shouldShowInitialSupportLoader,
    supportTicketFingerprint,
} from "../clientRefresh.ts";

const ticket = {
    id: "ticket-1",
    creatorWallet: "0xabc",
    creatorRole: "USER",
    subject: "Payment question",
    status: "OPEN",
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
    lastMessageAt: "2026-09-27T10:00:00.000Z",
    messages: [{
        id: "message-1",
        ticketId: "ticket-1",
        senderWallet: "0xabc",
        senderRole: "USER",
        content: "Where is my receipt?",
        createdAt: "2026-09-27T10:00:00.000Z",
    }],
};

test("support responses normalize omitted and null optional fields before dedupe", () => {
    const normalized = normalizeSupportTicket(ticket);
    const explicitNulls = {
        ...ticket,
        creatorAlias: null,
        creatorProfilePic: null,
        claimedByAdminWallet: null,
        claimedByAdminAlias: null,
        messageCount: 1,
        messages: ticket.messages.map((message) => ({
            ...message,
            senderAlias: null,
            senderProfilePic: null,
        })),
    };

    assert.equal(supportTicketFingerprint(normalized), supportTicketFingerprint(explicitNulls));
    assert.notEqual(
        supportTicketFingerprint(normalized),
        supportTicketFingerprint({ ...explicitNulls, messages: [{ ...explicitNulls.messages[0], content: "Updated reply" }] })
    );
});

test("the initial support loader can never reappear after content has loaded", () => {
    assert.equal(shouldShowInitialSupportLoader(true, false), true);
    assert.equal(shouldShowInitialSupportLoader(true, true), false);
    assert.equal(shouldShowInitialSupportLoader(false, true), false);

    const modal = readFileSync(new URL("../../../components/support/SupportChatModal.tsx", import.meta.url), "utf8");
    assert.match(modal, /setInterval\(\(\) => void refreshSupport\("background"\), 3000\)/);
    assert.match(modal, /document\.visibilityState === "hidden"/);
    assert.doesNotMatch(modal, /support.*skeleton/i);
    assert.match(modal, /Couldn’t refresh support updates\. We’ll try again\./);
});
