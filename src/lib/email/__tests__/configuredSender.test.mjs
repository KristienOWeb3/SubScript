import test from "node:test";
import assert from "node:assert/strict";

import { configuredSender, parseEmailSender } from "../core.ts";

test("parseEmailSender correctly breaks down standard and bare email formats", () => {
    assert.deepEqual(
        parseEmailSender("SubScript Auth <auth@subscriptonarc.com>"),
        { name: "SubScript Auth", address: "auth@subscriptonarc.com", user: "auth", domain: "subscriptonarc.com" }
    );
    assert.deepEqual(
        parseEmailSender("auth@subscriptonarc.com"),
        { name: "", address: "auth@subscriptonarc.com", user: "auth", domain: "subscriptonarc.com" }
    );
    assert.deepEqual(
        parseEmailSender('"SubScript Receipts" <receipts@subscriptonarc.com>'),
        { name: "SubScript Receipts", address: "receipts@subscriptonarc.com", user: "receipts", domain: "subscriptonarc.com" }
    );
    assert.equal(parseEmailSender("invalid-format"), null);
});

test("configuredSender transactional never sends from auth address or display name", () => {
    const originalEnv = { ...process.env };
    try {
        delete process.env.EMAIL_FROM_RECEIPTS;
        delete process.env.EMAIL_FROM_TRANSACTIONAL;

        // Form 1: SubScript Auth with auth@ address
        process.env.EMAIL_FROM = "SubScript Auth <auth@subscriptonarc.com>";
        assert.equal(
            configuredSender("transactional"),
            "SubScript Receipts <receipts@subscriptonarc.com>"
        );

        // Form 2: SubScript with auth@ address
        process.env.EMAIL_FROM = "SubScript <auth@subscriptonarc.com>";
        assert.equal(
            configuredSender("transactional"),
            "SubScript Receipts <receipts@subscriptonarc.com>"
        );

        // Form 3: Bare auth@ address
        process.env.EMAIL_FROM = "auth@subscriptonarc.com";
        assert.equal(
            configuredSender("transactional"),
            "SubScript Receipts <receipts@subscriptonarc.com>"
        );

        // Form 4: Non-auth address preserves custom mailbox but ensures SubScript Receipts display name
        process.env.EMAIL_FROM = "SubScript <billing@subscriptonarc.com>";
        assert.equal(
            configuredSender("transactional"),
            "SubScript Receipts <billing@subscriptonarc.com>"
        );
    } finally {
        process.env = originalEnv;
    }
});

test("configuredSender respects dedicated category overrides", () => {
    const originalEnv = { ...process.env };
    try {
        process.env.EMAIL_FROM = "SubScript Auth <auth@subscriptonarc.com>";
        process.env.EMAIL_FROM_RECEIPTS = "SubScript Billing <billing@subscriptonarc.com>";
        process.env.EMAIL_FROM_SECURITY = "SubScript Security <security@subscriptonarc.com>";
        process.env.EMAIL_FROM_OPS = "SubScript Ops <alerts@subscriptonarc.com>";
        process.env.EMAIL_FROM_LIFECYCLE = "SubScript News <updates@subscriptonarc.com>";

        assert.equal(configuredSender("transactional"), "SubScript Billing <billing@subscriptonarc.com>");
        assert.equal(configuredSender("security"), "SubScript Security <security@subscriptonarc.com>");
        assert.equal(configuredSender("ops"), "SubScript Ops <alerts@subscriptonarc.com>");
        assert.equal(configuredSender("lifecycle"), "SubScript News <updates@subscriptonarc.com>");
    } finally {
        process.env = originalEnv;
    }
});

test("configuredSender derives appropriate security, ops, and lifecycle senders from EMAIL_FROM", () => {
    const originalEnv = { ...process.env };
    try {
        delete process.env.EMAIL_FROM_RECEIPTS;
        delete process.env.EMAIL_FROM_TRANSACTIONAL;
        delete process.env.EMAIL_FROM_SECURITY;
        delete process.env.EMAIL_FROM_AUTH;
        delete process.env.EMAIL_FROM_OPS;
        delete process.env.EMAIL_FROM_LIFECYCLE;

        process.env.EMAIL_FROM = "SubScript Auth <auth@subscriptonarc.com>";

        assert.equal(configuredSender("security"), "SubScript Security <auth@subscriptonarc.com>");
        assert.equal(configuredSender("ops"), "SubScript Ops <ops@subscriptonarc.com>");
        assert.equal(configuredSender("lifecycle"), "SubScript <notifications@subscriptonarc.com>");
    } finally {
        process.env = originalEnv;
    }
});

test("configuredSender falls back to sandbox on non-production when unconfigured", () => {
    const originalEnv = { ...process.env };
    try {
        delete process.env.EMAIL_FROM;
        delete process.env.EMAIL_FROM_RECEIPTS;
        delete process.env.EMAIL_FROM_TRANSACTIONAL;
        delete process.env.EMAIL_FROM_SECURITY;
        delete process.env.EMAIL_FROM_AUTH;
        delete process.env.EMAIL_FROM_OPS;
        delete process.env.EMAIL_FROM_LIFECYCLE;
        process.env.NODE_ENV = "test";

        assert.equal(configuredSender("transactional"), "SubScript Receipts <onboarding@resend.dev>");
        assert.equal(configuredSender("security"), "SubScript Security <onboarding@resend.dev>");
        assert.equal(configuredSender("ops"), "SubScript Ops <onboarding@resend.dev>");
        assert.equal(configuredSender("lifecycle"), "SubScript <onboarding@resend.dev>");
        assert.equal(configuredSender(), "SubScript <onboarding@resend.dev>");
    } finally {
        process.env = originalEnv;
    }
});
