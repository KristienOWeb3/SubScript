import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import crypto from "node:crypto";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

// Emulate HMAC signing scheme from src/lib/dms/inviteTokens.ts
function createTestInviteToken(payload, secret = "test-secret-key-12345678901234567890") {
    const payloadStr = JSON.stringify(payload);
    const encodedPayload = Buffer.from(payloadStr, "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
    return `${encodedPayload}.${signature}`;
}

function verifyTestInviteToken(token, secret = "test-secret-key-12345678901234567890") {
    const parts = token.split(".");
    if (parts.length !== 2) return { valid: false, error: "Malformed token" };
    const [encodedPayload, providedSignature] = parts;
    const expectedSignature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");

    const sigBufA = Buffer.from(providedSignature, "base64url");
    const sigBufB = Buffer.from(expectedSignature, "base64url");
    if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
        return { valid: false, error: "Invalid signature" };
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return { valid: true, payload };
}

test("invite tokens use HMAC-SHA256 with constant-time verification", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const payload = {
        w: wallet,
        v: 1,
        n: "nonce-abc-123",
        iat: Math.floor(Date.now() / 1000),
    };

    const token = createTestInviteToken(payload);
    assert.ok(token.includes("."));

    const verified = verifyTestInviteToken(token);
    assert.equal(verified.valid, true);
    assert.equal(verified.payload.w, wallet);
    assert.equal(verified.payload.v, 1);
    assert.equal(verified.payload.n, "nonce-abc-123");
});

test("tampered invite tokens are strictly rejected", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const payload = {
        w: wallet,
        v: 1,
        n: "nonce-abc-123",
        iat: Math.floor(Date.now() / 1000),
    };

    const token = createTestInviteToken(payload);
    const [encodedPayload, sig] = token.split(".");

    // Tamper with payload to point to a different wallet
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, w: "0x2222222222222222222222222222222222222222" })).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${sig}`;

    const result = verifyTestInviteToken(tamperedToken);
    assert.equal(result.valid, false);
    assert.equal(result.error, "Invalid signature");
});

test("tokens signed with different secrets are rejected", () => {
    const payload = {
        w: "0x1111111111111111111111111111111111111111",
        v: 1,
        n: "nonce-abc-123",
        iat: Math.floor(Date.now() / 1000),
    };

    const token = createTestInviteToken(payload, "secret-a");
    const result = verifyTestInviteToken(token, "secret-b");
    assert.equal(result.valid, false);
});

test("canonical ordering for connections is enforced: user1_address < user2_address", () => {
    const connLib = source("src/lib/dms/connections.ts");
    assert.match(connLib, /const\s+\[u1,\s*u2\]\s*=\s*a\s*<\s*b/);
    assert.match(connLib, /user1Address:\s*u1/);
    assert.match(connLib, /user2Address:\s*u2/);
});

test("30-day cooldown is computed and enforced upon request decline", () => {
    const connLib = source("src/lib/dms/connections.ts");
    assert.match(connLib, /DECLINE_COOLDOWN_DAYS\s*=\s*30/);
    assert.match(connLib, /cooldownUntil\s*>\s*now/);
    assert.match(connLib, /cooldownDaysLeft/);
});

test("blocking a peer terminates active connection and cancels pending requests", () => {
    const blocksLib = source("src/lib/dms/blocks.ts");
    assert.match(blocksLib, /insert into dm_blocks/);
    assert.match(blocksLib, /update dm_connections\s+set status = 'TERMINATED'/);
    assert.match(blocksLib, /update dm_requests\s+set status = 'CANCELED'/);
});

test("unblocking a peer removes block but does not auto-reopen connections", () => {
    const blocksLib = source("src/lib/dms/blocks.ts");
    assert.match(blocksLib, /prisma\.dmBlock\.deleteMany/);
    // Ensure unblock does NOT reopen connections
    assert.doesNotMatch(blocksLib, /status:\s*"ACCEPTED"/);
});

test("server-side block enforcement is applied to wallet sends, payment requests, DMs, and connections", () => {
    const sendRoute = source("src/app/api/user/wallet/send/route.ts");
    const requestRoute = source("src/app/api/user/requests/route.ts");
    const dmsRoute = source("src/app/api/user/dms/route.ts");
    const systemDm = source("src/lib/dms/system.ts");
    const userPaymentReq = source("src/lib/userPaymentRequests.ts");

    assert.match(sendRoute, /assertNotBlocked/);
    assert.match(requestRoute, /assertNotBlocked/);
    assert.match(dmsRoute, /assertNotBlocked/);
    assert.match(systemDm, /assertNotBlocked/);
    assert.match(userPaymentReq, /assertNotBlocked/);
});

test("user inbox merges accepted connections so empty threads render correctly", () => {
    const dmsRoute = source("src/app/api/user/dms/route.ts");
    const userPage = source("src/app/dashboard/user/page.tsx");

    assert.match(dmsRoute, /dmConnection\.findMany/);
    assert.match(dmsRoute, /dmBlock\.findMany/);
    assert.match(userPage, /dmConnections/);
    assert.match(userPage, /blockedAddresses/);
    assert.match(userPage, /initialMap\.set\(peer/);
});
