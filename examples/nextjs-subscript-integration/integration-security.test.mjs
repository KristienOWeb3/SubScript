import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => readFileSync(path.join(exampleRoot, relativePath), "utf8");

test("secret-bearing routes authenticate application users and bound upstream calls", () => {
  const auth = read("app/api/subscript/_lib/applicationAuth.ts");
  const client = read("app/api/subscript/_lib/subscriptClient.ts");
  const checkout = read("app/api/subscript/checkout/route.ts");
  const plans = read("app/api/subscript/plans/route.ts");
  const subscriptions = read("app/api/subscript/subscriptions/route.ts");
  const usage = read("app/api/subscript/usage/route.ts");
  const status = read("app/api/subscript/status/[intentId]/route.ts");
  const webhook = read("app/api/subscript/webhook/route.ts");
  const documentation = read("README.md");

  assert.match(auth, /example_app_session/);
  assert.match(auth, /crypto\.timingSafeEqual/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(auth, /requireApplicationUser/);
  assert.match(client, /AbortSignal\.timeout/);
  assert.match(client, /subscript_timeout/);
  assert.match(client, /subscript_unreachable/);

  for (const route of [checkout, plans, subscriptions, usage, status]) {
    assert.match(route, /requireApplicationUser/);
    assert.match(route, /subscriptRequest/);
    assert.match(route, /applicationErrorResponse/);
    assert.doesNotMatch(route, /SUBSCRIPT_SECRET_KEY/);
  }
  assert.doesNotMatch(checkout, /request\.json\(/);
  assert.doesNotMatch(subscriptions, /request\.json\(/);
  assert.doesNotMatch(usage, /request\.json\(/);
  assert.match(plans, /admin:\s*true/);
  assert.match(status, /assertIntentStatusOwnership/);
  assert.match(webhook, /try\s*\{\s*parsed = JSON\.parse\(rawBody\)/);
  assert.match(webhook, /!parsed \|\| typeof parsed !== "object" \|\| Array\.isArray\(parsed\)/);
  assert.match(documentation, /Connect application authentication first/);
  assert.match(documentation, /server-owned/);
});
