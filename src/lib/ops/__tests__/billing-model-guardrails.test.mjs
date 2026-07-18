import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("payment intents reject recurring fields and ambiguous recurring products", () => {
  const semantics = read("src/lib/paymentIntentSemantics.ts");
  const route = read("src/app/api/intent/route.ts");

  for (const field of [
    "interval",
    "intervalSeconds",
    "intervalCount",
    "periodDays",
    "planId",
    "publishToDm",
    "subscriber",
    "merchantCustomerId",
  ]) {
    assert.match(semantics, new RegExp(`"${field}"`));
  }

  assert.match(semantics, /subscription\|subscribe\|subscriber\|recurring/);
  assert.match(semantics, /daily\|weekly\|monthly\|quarterly\|yearly/);
  assert.match(semantics, /starter\|basic\|standard\|pro\|professional\|premium/);
  assert.match(route, /subscription_fields_on_payment_intent/);
  assert.match(route, /ambiguous_recurring_product/);
  assert.match(route, /confirmOneTime !== true/);
  assert.match(route, /paymentType:\s*"one_time"/);
  assert.match(route, /appearsInDmPlanPicker:\s*false/);
});

test("CLI keeps recurring init and one-time add-checkout on different endpoints", () => {
  const scaffold = read("packages/cli/src/commands/scaffold.ts");
  const addCheckout = read("packages/cli/src/commands/addCheckout.ts");
  const routeTemplate = read("packages/cli/src/templates/checkoutRouteTemplate.ts");
  const doctor = read("packages/cli/src/commands/doctor.ts");

  assert.match(scaffold, /billingMode:\s*"subscription"/);
  assert.match(addCheckout, /billingMode:\s*"one_time"/);
  assert.match(routeTemplate, /"\/api\/v1\/subscriptions"/);
  assert.match(routeTemplate, /"\/api\/intent"/);
  assert.doesNotMatch(routeTemplate, /confirmOneTime:\s*true/);
  assert.match(routeTemplate, /publishToDm:\s*true/);
  assert.match(routeTemplate, /authorizeSubscriptionCheckout/);
  assert.match(routeTemplate, /Never copy these values from request JSON/);
  assert.doesNotMatch(routeTemplate, /body\?\.(subscriber|merchantCustomerId|intervalSeconds)/);
  assert.match(doctor, /recurring_fields_on_payment_intent/);
  assert.match(doctor, /\/api\/v1\/plans/);
});

test("SDK, MCP, and OpenAPI expose first-class recurring plan operations", () => {
  const sdk = read("packages/sdk/src/index.ts");
  const mcp = read("mcp-server/index.js");
  const openapi = read("src/app/api/openapi/route.ts");

  assert.match(sdk, /readonly plans =/);
  assert.match(sdk, /"POST", "\/api\/v1\/plans"/);
  assert.match(sdk, /"POST", "\/api\/v1\/subscriptions"/);
  for (const tool of ["create_plan", "list_plans", "create_subscription"]) {
    assert.match(mcp, new RegExp(`name: "${tool}"`));
  }
  assert.match(mcp, /Create a ONE-TIME payment intent only/);
  assert.match(openapi, /"\/api\/v1\/plans"/);
  assert.match(openapi, /summary: "Create a one-time payment intent"/);
  assert.match(openapi, /"422":/);
  for (const endpoint of [
    "/api/intent/{id}",
    "/api/keys",
    "/api/webhooks/endpoints",
    "/api/webhooks/events",
    "/api/webhooks/events/replay",
    "/api/webhooks/test",
    "/api/user/vault/report-usage",
  ]) {
    assert.match(openapi, new RegExp(`"${endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.match(openapi, /subscript_verification_status=settled/);
  assert.match(openapi, /publishToDm:[\s\S]*default: true/);
  assert.match(openapi, /webhookUrl/);
  assert.match(openapi, /webhookWarning/);
  assert.match(openapi, /latest:\s*\{ type: "boolean"/);
});

test("integration schemas and generated updates preserve exclusive billing choices", () => {
  const sdk = read("packages/sdk/src/index.ts");
  const mcp = read("mcp-server/index.js");
  const update = read("packages/cli/src/commands/update.ts");
  const doctor = read("packages/cli/src/commands/doctor.ts");

  assert.match(sdk, /periodDays: number;\s*intervalSeconds\?: never/);
  assert.match(sdk, /periodDays\?: never;\s*intervalSeconds: number/);
  assert.match(mcp, /oneOf:[\s\S]*required: \["periodDays"\][\s\S]*required: \["intervalSeconds"\]/);
  assert.match(mcp, /required: \["planId"\][\s\S]*not:[\s\S]*required: \["amountUsdcMicros"\]/);

  assert.match(update, /generatedContent\.match\([\s\S]*billingMode/);
  assert.match(update, /billingModeMatch\[1\]/);
  assert.doesNotMatch(update, /billingMode:\s*"subscription"/);

  assert.match(doctor, /findCheckoutApiCalls\(content\)/);
  assert.match(doctor, /intentCalls\.some\(\(call\)/);
  assert.doesNotMatch(doctor, /content\.includes\("SUBSCRIPT_SECRET_KEY"\)/);
});

test("public integration docs distinguish recurring request and webhook shapes", () => {
  const cliReadme = read("packages/cli/README.md");
  const quickstart = read("public/quickstart.md");
  const skill = read("public/skills/subscript-integration/SKILL.md");
  const apiReference = read("public/api-reference.md");

  assert.match(cliReadme, /one-time intent[\s\S]*payment\.succeeded/i);
  assert.match(cliReadme, /recurring checkout[\s\S]*subscription\.created/i);
  assert.match(quickstart, /case "subscription\.created"/);
  assert.match(skill, /Plan-based subscription:[\s\S]*\{ planId, subscriber\? \}/);
  assert.match(skill, /Inline subscription:[\s\S]*\{ amountUsdcMicros, interval \| intervalSeconds, subscriber\? \}/);

  const lines = apiReference.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index++) {
    if (/^#{1,6}\s/.test(lines[index])) {
      assert.equal(lines[index + 1], "", `heading at line ${index + 1} must be followed by a blank line`);
    }
  }
});

test("developer and agent docs state the endpoint decision and DM behavior", () => {
  const documentation = [
    "README.md",
    "public/api-reference.md",
    "public/quickstart.md",
    "public/llms.txt",
    "public/llms-full.txt",
    "public/skills/subscript-integration/SKILL.md",
    "packages/cli/README.md",
    "packages/sdk/README.md",
  ];

  for (const relativePath of documentation) {
    const content = read(relativePath);
    assert.match(content, /\/api\/intent/);
    assert.match(content, /\/api\/v1\/(plans|subscriptions)/);
    assert.match(content, /one-time/i);
    assert.match(content, /(DM|plan picker|recurring)/i);
  }

  for (const agentDoc of [
    "public/llms.txt",
    "public/llms-full.txt",
    "public/skills/subscript-integration/SKILL.md",
  ]) {
    const content = read(agentDoc);
    assert.match(content, /Never (use|create|model)/i);
    assert.match(content, /upgrade-only/i);
    assert.match(content, /merchantCustomerId/);
  }
});

test("merchant success redirects distinguish settlement from merchant fulfillment", () => {
  const oneTimeCheckout = read("src/app/pay/[id]/PublicPayClient.tsx");
  const subscriptionCheckout = read("src/app/subscribe/[planId]/SubscribeClient.tsx");

  for (const checkout of [oneTimeCheckout, subscriptionCheckout]) {
    assert.match(checkout, /subscript_verification_status/);
    assert.match(checkout, /"settled"/);
  }
});

test("developer dashboard exposes webhook setup and delivery health controls", () => {
  const dashboard = read("src/app/dashboard/page.tsx");

  assert.match(dashboard, /apiKeyWebhookUrl/);
  assert.match(dashboard, /webhookUrl/);
  assert.match(dashboard, /\/api\/webhooks\/test/);
  assert.match(dashboard, /payment\.succeeded/);
  assert.match(dashboard, /subscription\.created/);
  assert.match(dashboard, /Resend latest event/);
  assert.match(dashboard, /latestDelivery/);
  assert.match(dashboard, /Merchant wallet/);
});
