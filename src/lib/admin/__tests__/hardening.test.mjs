import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { findUnserializable, jsonOk, jsonSafe } from "../../http/json.js";
import { runAdminQueriesSequentially, withAdminDbRetry } from "../db.js";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("json helpers serialize nested BigInt values exactly", async () => {
  const value = {
    merchant: {
      balance: 9007199254740993n,
      nested: [{ amount: 2500000n }],
    },
  };

  assert.deepEqual(jsonSafe(value), {
    merchant: {
      balance: "9007199254740993",
      nested: [{ amount: "2500000" }],
    },
  });
  assert.equal(findUnserializable(value), "$.merchant.balance");

  const response = jsonOk(value);
  assert.match(response.headers.get("content-type") || "", /^application\/json/);
  assert.deepEqual(await response.json(), {
    merchant: {
      balance: "9007199254740993",
      nested: [{ amount: "2500000" }],
    },
  });
});

test("runAdminQueriesSequentially preserves order without overlapping operations", async () => {
  let active = 0;
  let maxActive = 0;
  const events = [];

  const operation = (value) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${value}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push(`end:${value}`);
    active -= 1;
    return value;
  };

  const results = await runAdminQueriesSequentially([
    operation(1),
    operation(2),
    operation(3),
  ]);

  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    "start:1", "end:1",
    "start:2", "end:2",
    "start:3", "end:3",
  ]);
});

test("withAdminDbRetry retries a transient pool failure once", async () => {
  let attempts = 0;
  const result = await withAdminDbRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("Timed out fetching a new connection from the connection pool");
      error.code = "P2024";
      throw error;
    }
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("withAdminDbRetry does not retry ordinary failures", async () => {
  let attempts = 0;
  await assert.rejects(
    withAdminDbRetry(async () => {
      attempts += 1;
      throw new Error("validation failed");
    }),
    /validation failed/,
  );
  assert.equal(attempts, 1);
});

test("Google pause guards run before Circle token creation and wallet provisioning", () => {
  const deviceToken = source("src/app/api/auth/circle/google/device-token/route.ts");
  const complete = source("src/app/api/auth/circle/wallet/complete/route.ts");

  assert.ok(
    deviceToken.indexOf("await isGoogleSigninEnabled()")
      < deviceToken.indexOf("createSocialLoginDeviceToken(deviceId)"),
  );
  assert.match(deviceToken, /Google sign-in is temporarily unavailable[\s\S]*status:\s*503/);

  assert.ok(
    complete.indexOf("await isGoogleSigninEnabled()")
      < complete.indexOf("verifyGoogleIdToken(googleIdToken, clientId)"),
  );
  assert.ok(
    complete.indexOf("await isGoogleSigninEnabled()")
      < complete.indexOf("provisionEmbeddedWallet({ refId })"),
  );
});

test("all human KYC admin routes require an attributable wallet session", () => {
  const legacy = source("src/app/api/admin/kyc/route.ts");
  const review = source("src/app/api/admin/kyc/review/route.ts");

  assert.match(legacy, /requireAdmin\(request\)/g);
  assert.doesNotMatch(legacy, /verifyAdminApiKey/);
  assert.match(legacy, /actorId:\s*auth\.admin\.wallet/);
  assert.match(legacy, /actor:\s*auth\.admin\.wallet/);

  assert.match(review, /Only root admins[\s\S]*directly upgrade KYC/);
  assert.doesNotMatch(
    review,
    /if \(!account\) \{[\s\S]{0,160}accountRole\.create/,
  );
  assert.match(review, /updated\.accountRole === "ENTERPRISE"/);
});

test("merchant verification cannot manufacture a merchant or account role", () => {
  const route = source("src/app/api/admin/merchant-verify/route.ts");

  assert.match(route, /tx\.accountRole\.findUnique/);
  assert.match(route, /account\.role !== "ENTERPRISE"/);
  assert.match(route, /tx\.merchant\.update/);
  assert.doesNotMatch(route, /merchant\.upsert/);
  assert.doesNotMatch(route, /accountRole\.upsert/);
  assert.match(route, /tx\.adminAuditLog\.create/);
});

test("withdrawal holds cover user sends and role-specific sponsored transfers", () => {
  const send = source("src/app/api/user/wallet/send/route.ts");
  const execute = source("src/app/api/execute-tx/route.ts");

  assert.ok(
    send.indexOf('assertWithdrawalAllowed(fundingWallet, "USER")')
      < send.indexOf("getWalletCustody(fundingWallet)"),
  );
  assert.match(
    execute,
    /assertWithdrawalAllowed\(wallet, accountRole === "ENTERPRISE" \? "MERCHANT" : "USER"\)/,
  );
  assert.ok(
    execute.indexOf('if (action === "transferUsdc")')
      < execute.indexOf('case "transferUsdc"'),
  );
});

test("production Prisma failures cannot fall back to the JSON mock database", () => {
  const prismaSource = source("src/lib/prisma.ts");
  const offlineSource = source("src/lib/offlineDb.ts");

  assert.match(prismaSource, /offlineFallbackEnabled = process\.env\.NODE_ENV !== "production"/);
  assert.match(
    prismaSource,
    /offlineFallbackEnabled && isConnectionError\(err\)/g,
  );
  assert.doesNotMatch(offlineSource, /msg\.includes\("not found"\)/);
});

test("manual IP bans are not cached past an admin unban", () => {
  const middleware = source("src/middleware.ts");
  const redisBanBlock = middleware.slice(
    middleware.indexOf("/* 4. Redis IP Ban Check */"),
    middleware.indexOf("let rateLimitPassed", middleware.indexOf("/* 4. Redis IP Ban Check */")),
  );

  assert.doesNotMatch(redisBanBlock, /memoryBans\.set/);
  assert.match(redisBanBlock, /redis\.get\(`ban:\$\{ip\}`\)/);
});

