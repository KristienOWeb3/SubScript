import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    assertMerchantSignupAllowed,
    generateInviteToken,
    isMerchantInviteOnlyEnforced,
    markGrantClaimed,
    findConflictingAccountForEmail,
} from "../accessGrants.js";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* Minimal stand-in for the pg client register-role hands to the gate. Records every statement so a
   test can assert on the SQL that ran, and answers from a scripted table of rows. */
function fakeClient({ grants = [], roles = [], embedded = [], customers = [] } = {}) {
    const statements = [];
    return {
        statements,
        async query(sql, params = []) {
            statements.push({ sql, params });
            const text = sql.replace(/\s+/g, " ").trim().toLowerCase();

            if (text.startsWith("select email from merchant_access_grants where invite_token")) {
                const row = grants.find((g) => g.invite_token === params[0]);
                return { rows: row ? [{ email: row.email }] : [] };
            }
            if (text.startsWith("select email, granted_by, invite_token")) {
                const row = grants.find((g) => g.email === params[0]);
                return { rows: row ? [row] : [] };
            }
            if (text.startsWith("update merchant_access_grants")) {
                const row = grants.find((g) => g.email === params[0]);
                if (row) {
                    row.claimed_at = row.claimed_at || new Date();
                    row.claimed_wallet = params[1];
                }
                return { rows: [] };
            }
            if (text.includes("from user_embedded_wallets") && text.includes("union all")) {
                const hit =
                    embedded.find((e) => e.email === params[0]) ||
                    customers.find((c) => c.email === params[0]);
                return {
                    rows: hit
                        ? [{
                            wallet_address: hit.wallet_address,
                            provider: hit.provider ?? null,
                            source: hit.provider === undefined ? "customer_profile" : "embedded_wallet",
                        }]
                        : [],
                };
            }
            if (text.startsWith("select role from account_roles")) {
                const row = roles.find((r) => r.address === params[0]);
                return { rows: row ? [{ role: row.role }] : [] };
            }
            return { rows: [] };
        },
    };
}

const GRANTED = "billing@acme.com";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

function grantRow(overrides = {}) {
    return {
        email: GRANTED,
        granted_by: "0xadmin",
        invite_token: "tok-acme",
        claimed_at: null,
        claimed_wallet: null,
        revoked_at: null,
        note: null,
        ...overrides,
    };
}

test("a granted email may open a merchant account, and the row is locked for update", async () => {
    const client = fakeClient({ grants: [grantRow()] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: GRANTED,
        wallet: WALLET,
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.grant.email, GRANTED);

    /* Without FOR UPDATE two concurrent signups both read an unclaimed grant and both redeem it. */
    const lookup = client.statements.find((s) => s.sql.includes("from merchant_access_grants"));
    assert.match(lookup.sql.toLowerCase(), /for update/);
});

test("an email with no grant is refused, and told where to ask", async () => {
    const client = fakeClient({ grants: [grantRow()] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: "stranger@example.com",
        wallet: WALLET,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "MERCHANT_INVITE_REQUIRED");
    assert.match(decision.message, /merchant-access/);
});

test("no verified email is refused before any grant lookup happens", async () => {
    const client = fakeClient({ grants: [grantRow()] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: null,
        wallet: WALLET,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "MERCHANT_EMAIL_REQUIRED");
    assert.equal(client.statements.length, 0);
});

test("a revoked grant is refused", async () => {
    const client = fakeClient({ grants: [grantRow({ revoked_at: new Date() })] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: GRANTED,
        wallet: WALLET,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "MERCHANT_INVITE_REVOKED");
});

test("an invite link used with someone else's email names the real problem", async () => {
    const client = fakeClient({ grants: [grantRow()] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: "someone.else@example.com",
        wallet: WALLET,
        inviteToken: "tok-acme",
    });

    /* Not the generic "you need an invite": the business forwarded a link, and only naming that
       tells them what to do about it. */
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "MERCHANT_INVITE_EMAIL_MISMATCH");
});

test("an unknown invite token falls through to the email check rather than erroring", async () => {
    const client = fakeClient({ grants: [grantRow()] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: GRANTED,
        wallet: WALLET,
        inviteToken: "tok-does-not-exist",
    });

    assert.equal(decision.allowed, true);
});

test("a grant already claimed by another wallet cannot be spent twice", async () => {
    const client = fakeClient({
        grants: [grantRow({ claimed_at: new Date(), claimed_wallet: OTHER_WALLET })],
    });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: GRANTED,
        wallet: WALLET,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "MERCHANT_INVITE_CLAIMED");
});

test("the same wallet retrying its own claim is allowed through", async () => {
    const client = fakeClient({
        grants: [grantRow({ claimed_at: new Date(), claimed_wallet: WALLET })],
    });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: GRANTED,
        wallet: WALLET.toUpperCase(),
    });

    assert.equal(decision.allowed, true);
});

test("email and wallet comparisons ignore case and surrounding space", async () => {
    const client = fakeClient({ grants: [grantRow()] });
    const decision = await assertMerchantSignupAllowed(client, {
        verifiedEmail: "  BILLING@ACME.COM  ",
        wallet: WALLET.toUpperCase(),
    });

    assert.equal(decision.allowed, true);
});

test("markGrantClaimed records the wallet and keeps the first claim time", async () => {
    const grants = [grantRow()];
    const client = fakeClient({ grants });
    await markGrantClaimed(client, GRANTED.toUpperCase(), WALLET.toUpperCase());

    assert.equal(grants[0].claimed_wallet, WALLET);
    assert.ok(grants[0].claimed_at);

    const update = client.statements.at(-1).sql.toLowerCase();
    assert.match(update, /coalesce\(claimed_at, now\(\)\)/);
});

test("findConflictingAccountForEmail reports the role blocking a grant", async () => {
    const client = fakeClient({
        embedded: [{ email: "taken@example.com", wallet_address: WALLET, provider: "email_otp" }],
        roles: [{ address: WALLET, role: "USER" }],
    });

    const conflict = await findConflictingAccountForEmail(client, "taken@example.com");
    assert.equal(conflict.walletAddress, WALLET);
    assert.equal(conflict.role, "USER");

    assert.equal(await findConflictingAccountForEmail(client, "free@example.com"), null);
});

test("invite tokens are long and unguessable", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();

    assert.notEqual(a, b);
    assert.ok(a.length >= 40, `token too short: ${a.length}`);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("ALLOW_PUBLIC_MERCHANT_SIGNUP=false forces enforcement without reading the database", async () => {
    const previous = process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP;
    try {
        for (const value of ["false", "0", "no", "OFF"]) {
            process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP = value;
            assert.equal(await isMerchantInviteOnlyEnforced(), true, `expected ${value} to enforce`);
        }
    } finally {
        if (previous === undefined) delete process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP;
        else process.env.ALLOW_PUBLIC_MERCHANT_SIGNUP = previous;
    }
});

test("the enforcement flag fails CLOSED, unlike every other platform flag", () => {
    const flags = source("src/lib/platform/flags.ts");
    const fallback = flags.slice(
        flags.indexOf("export const FLAGS_FALLBACK"),
        flags.indexOf("const FLAGS_UNSEEDED"),
    );
    /* Every other fallback keeps the product working; this one refuses to hand out a merchant
       account we cannot verify was granted. */
    assert.match(fallback, /merchantInviteOnlyEnabled:\s*true/);

    const gate = source("src/lib/merchants/accessGrants.ts");
    const reader = gate.slice(
        gate.indexOf("export async function isMerchantInviteOnlyEnforced"),
        gate.indexOf("export async function describeMerchantInviteEnforcement"),
    );
    assert.match(reader, /catch[\s\S]*return true/);

    /* A missing singleton row is a fresh database, not an incident — it must not silently switch
       invite-only on. Nor is a missing column: that means the code is running ahead of its
       migration, so there is nothing to enforce against. */
    assert.match(flags, /FLAGS_UNSEEDED[\s\S]*merchantInviteOnlyEnabled:\s*false/);
    assert.match(flags, /isMissingColumnError[\s\S]*P2022/);
    assert.match(flags, /isMissingColumnError\(error\)\s*\?\s*FLAGS_UNSEEDED\s*:\s*FLAGS_FALLBACK/);
});

test("register-role gates ENTERPRISE on the verified email and claims in the same transaction", () => {
    const route = source("src/app/api/auth/register-role/route.ts");

    /* The gate must run on the email the OTP/OAuth routes verified, never on request input. */
    assert.match(route, /verifiedEmail:\s*verifiedEmailVal/);
    assert.doesNotMatch(route, /verifiedEmail:\s*emailVal/);

    const enterpriseBlock = route.slice(
        route.indexOf("if (inviteOnlyEnforced)"),
        route.indexOf("if (verifiedEmailVal) {"),
    );
    assert.match(enterpriseBlock, /assertMerchantSignupAllowed/);
    assert.match(enterpriseBlock, /rollback/);

    /* Claimed alongside the merchants insert: the grant is spent exactly when the account exists. */
    const merchantInsert = route.slice(route.indexOf("insert into merchants"));
    assert.match(merchantInsert.slice(0, 800), /markGrantClaimed/);

    /* The shared code must not survive as a bypass once per-business grants are enforced: the only
       read of it lives in the not-enforced branch. (Matching on the env read, not the bare name —
       the enforced branch mentions it in a comment explaining why it is ignored.) */
    const enforcedStart = route.indexOf("if (inviteOnlyEnforced)");
    const enforcedBranch = route.slice(enforcedStart, route.indexOf("} else {", enforcedStart));
    assert.match(enforcedBranch, /assertMerchantSignupAllowed/);
    assert.doesNotMatch(enforcedBranch, /process\.env\.MERCHANT_SIGNUP_CODE/);
    assert.match(route, /process\.env\.MERCHANT_SIGNUP_CODE/);
});

test("an ungranted merchant attempt writes no role, so USER stays available", () => {
    const route = source("src/app/api/auth/register-role/route.ts");
    const refusal = route.slice(
        route.indexOf("if (accountRole.merchantRefusal)"),
        route.indexOf("if (accountRole.externalWalletMerchant)"),
    );
    assert.match(refusal, /status:\s*403/);
    assert.match(refusal, /code:\s*accountRole\.merchantRefusal\.code/);
    /* No account_roles insert on this path — the picker reopens with USER selectable. */
    assert.doesNotMatch(refusal, /insert into account_roles/);
});

test("granting an email that already has an account is refused with an explanation", () => {
    const route = source("src/app/api/admin/merchant-access/route.ts");
    const grantFn = route.slice(route.indexOf("async function grant("), route.indexOf("async function decline("));

    assert.match(grantFn, /findConflictingAccountForEmail/);
    assert.match(grantFn, /EMAIL_HAS_USER_ACCOUNT/);
    assert.match(grantFn, /status:\s*409/);
    /* Reviving a revoked grant must not resurrect the link that was handed out before we pulled it. */
    assert.match(grantFn, /revokedAt\s*\?[\s\S]*generateInviteToken\(\)/);
});

test("the public request endpoint answers identically whatever the email's status is", () => {
    const route = source("src/app/api/merchant-access/request/route.ts");

    /* One response object, returned on every path — no branch can leak "this email is approved". */
    assert.match(route, /const UNIFORM_RESPONSE/);
    const returns = route.match(/return NextResponse\.json\(UNIFORM_RESPONSE\)/g) || [];
    assert.ok(returns.length >= 2, "honeypot and success must return the same body");

    assert.match(route, /honeypot/);
    assert.match(route, /consumeDistributedRateLimit/);
    assert.match(route, /verifyCaptchaToken/);
    /* Limiter down means the queue is unprotected — refuse rather than accept unlimited writes. */
    assert.match(route, /status:\s*503/);

    /* A decided request must not be reopened by resubmitting the form. */
    assert.match(route, /existing\.status === "PENDING"/);
});

test("only root admins can flip invite-only enforcement", () => {
    const route = source("src/app/api/admin/flags/route.ts");
    const block = route.slice(
        route.indexOf("merchantInviteOnlyEnabled"),
        route.indexOf("if (Object.keys(data).length === 2)"),
    );
    assert.match(block, /!auth\.admin\.isRoot/);
    assert.match(block, /status:\s*403/);
});
