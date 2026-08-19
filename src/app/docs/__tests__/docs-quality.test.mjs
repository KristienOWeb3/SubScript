import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* The guide used to be one page.tsx, and these assertions read it as a single string. It is now
   one route per section plus shared content modules, so the corpus is the whole tree: every
   page, the primitives, the code samples, and the Markdown twins. A fact may live on any page —
   what these tests guarantee is that it is documented SOMEWHERE and that every section still has
   a route. Where a fact belongs to one specific page, the test says so explicitly. */

const docsRoot = fileURLToPath(new URL("..", import.meta.url));

function filesUnder(directory, predicate) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      /* Skip this test directory so fixtures never satisfy an assertion about the docs. */
      return entry.name === "__tests__" ? [] : filesUnder(fullPath, predicate);
    }
    return entry.isFile() && predicate(entry.name) ? [fullPath] : [];
  });
}

const sourceFiles = filesUnder(docsRoot, (name) => name.endsWith(".tsx") || name.endsWith(".ts"));
const pageFiles = sourceFiles.filter((file) => path.basename(file) === "page.tsx");
const corpus = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const markdown = readFileSync(path.join(docsRoot, "_content", "markdown.ts"), "utf8");
const sectionsSource = readFileSync(path.join(docsRoot, "_components", "sections.ts"), "utf8");
const llmsIndex = readFileSync(path.join(docsRoot, "..", "..", "..", "public", "llms.txt"), "utf8");

/* Slugs declared in the registry, minus the overview's empty slug which lives at /docs itself. */
const declaredSlugs = [...sectionsSource.matchAll(/slug:\s*"([^"]*)"/g)]
  .map((match) => match[1])
  .filter(Boolean);

function assertDocumented(needle, haystack = corpus, label = "docs") {
  assert.ok(
    haystack.includes(needle),
    `Expected ${label} to document ${JSON.stringify(needle)}, but no file mentions it.`,
  );
}

test("every declared section has its own route", () => {
  assert.ok(declaredSlugs.length >= 16, `Expected the full section list, saw ${declaredSlugs.length}`);

  for (const slug of declaredSlugs) {
    const page = path.join(docsRoot, slug, "page.tsx");
    assert.ok(existsSync(page), `Section "${slug}" has no page at docs/${slug}/page.tsx`);
  }

  /* The overview owns /docs itself. */
  assert.ok(existsSync(path.join(docsRoot, "page.tsx")), "Missing overview page at docs/page.tsx");
});

test("every section page declares its own metadata", () => {
  for (const file of pageFiles) {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(docsRoot, file);
    assert.match(
      source,
      /export const metadata/,
      `${relative} must export metadata so the split produces distinct titles and canonicals`,
    );
  }
});

test("every section has a Markdown twin for agents", () => {
  for (const slug of declaredSlugs) {
    assertDocumented(`  ${slug}: \``, markdown, "the Markdown twins");
  }
  /* The overview twin is keyed by the empty slug and served as /docs/index.md. */
  assertDocumented('"": `#', markdown, "the Markdown twins");
});

test("docs lead developers through a complete first integration", () => {
  for (const identifier of ["amountUsdcMicros", "externalReference", "idempotencyKey", "checkoutUrl"]) {
    assertDocumented(identifier);
  }
});

test("docs expose agent-friendly verification and machine-readable surfaces", () => {
  for (const required of [
    "/openapi.json",
    "/llms.txt",
    "/api/intent/:id",
    "/api/user/vault/status",
    "npx @subscriptonarc/cli trigger",
    "/api/test/clocks",
  ]) {
    assertDocumented(required);
  }
});

test("the whole guide is also served as one generated text file", () => {
  /* /docs.txt is built from the same bodies as the .md twins instead of being committed under
     public/. A hand-maintained copy drifts from the pages it describes — llms-full.txt is the
     resident example — so these assertions pin the properties that generation depends on. */
  assert.ok(
    existsSync(path.join(docsRoot, "..", "docs.txt", "route.ts")),
    "Missing the /docs.txt route handler at app/docs.txt/route.ts",
  );
  assertDocumented("export function fullTextDocument", markdown, "the Markdown twins module");

  /* Built by walking docsSections, so a new section joins /docs.txt the moment it joins the pager.
     A literal slug list here would quietly stop covering new pages. Sliced from the declaration so
     the function's own doc comment cannot satisfy the match. */
  const builder = markdown.slice(markdown.indexOf("export function fullTextDocument"));
  assert.match(
    builder,
    /docsSections\s*\.map/,
    "fullTextDocument must map over docsSections rather than a hardcoded slug list",
  );

  /* Discoverable from both the index agents read first and the page humans read first, or nothing
     ever learns the file exists. */
  assertDocumented("/docs.txt", llmsIndex, "the llms.txt index");
  assertDocumented("/docs.txt", corpus, "the docs pages");
});

test("docs pin the conventions an integrator gets wrong first", () => {
  /* These lived in a hand-written report card until 2026-08-19, where four claims about missing
     features stayed wrong for a month because prose does not execute. Anything falsifiable belongs
     here instead: a regression fails the build rather than waiting for someone to re-grade. */
  for (const required of [
    /* The unit convention. Sending 15.00 rather than "15000000" is the costliest typo in this API. */
    "micro-USDC",
    /* Metered billing: the accrual call, the running total it exposes, the commitment policy. */
    "/api/user/vault/report-usage",
    "accruedUsageUsdc",
    "/api/merchant/vault/commit-config",
    /* The legacy status alias stays documented while integrations are still pinned to it. */
    "/api/intent/status",
  ]) {
    assertDocumented(required);
  }
});

test("docs present subscriptions as a first-class shipped API", () => {
  const subscriptions = readFileSync(path.join(docsRoot, "subscriptions", "page.tsx"), "utf8");
  assertDocumented("/api/v1/subscriptions", subscriptions, "the subscriptions page");
  assertDocumented("fixed-schedule subscription checkouts today", subscriptions, "the subscriptions page");
  assertDocumented("subscription.renewed", subscriptions, "the subscriptions page");
});

test("docs tell an integrator how to read a subscription back without the webhook", () => {
  /* Added 2026-08-19 after an integrator audit found the list returned neither the merchant's own
     reference nor a period end, and the only single-read rejected the ids the list handed out.
     Each assertion is one finding that cost real money. */
  const subscriptions = readFileSync(path.join(docsRoot, "subscriptions", "page.tsx"), "utf8");
  for (const required of [
    /* The mapping a merchant needs when a webhook is missed. */
    "externalReference",
    /* The period end, so nobody reimplements createdAt + intervalSeconds and lands 2 hours off. */
    "currentPeriodEnd",
    /* Single-resource retrieval, and the on-chain id cancellation needs. */
    "/api/v1/subscriptions/{id}",
    "subscriptionId",
  ]) {
    assertDocumented(required, subscriptions, "the subscriptions page");
  }
  /* Both statuses that the mirror-backed derivation made reachable. */
  assertDocumented("past_due", subscriptions, "the subscriptions page");
  assertDocumented("expired", subscriptions, "the subscriptions page");
});

test("docs prevent one-time intents from being mistaken for recurring DM plans", () => {
  assertDocumented("/api/v1/plans");
  assertDocumented("publishToDm: true");
  assertDocumented("merchantCustomerId");
  assertDocumented("upgrade-only");
  assert.match(corpus, /is one-time only/i, "Docs must state that /api/intent is one-time only");
  assert.match(corpus, /never (creates a recurring plan|appears in DM plan controls)/i);
});

test("docs make endpoint selection and delivery observability explicit", () => {
  for (const required of [
    "One-time payment",
    "Public recurring plan",
    "User-specific subscription checkout",
    "DM-visible subscription checkout",
    "Metered billing",
    "publishToDm: true",
    "/api/webhooks/endpoints",
    "/api/webhooks/events/replay",
    "/api/webhooks/test",
  ]) {
    assertDocumented(required);
  }
});

test("docs explain the identifiers developers must persist", () => {
  for (const identifier of ["intent.id", "externalReference", "receiptToken", "request_id"]) {
    assertDocumented(identifier);
  }
});

test("webhook example verifies raw bytes, timestamp, and constant-time signature", () => {
  const samples = readFileSync(path.join(docsRoot, "_content", "samples.ts"), "utf8");
  for (const required of ["await req.text()", "Math.abs(now - timestamp) > 300", "crypto.timingSafeEqual", "event.id"]) {
    assertDocumented(required, samples, "the webhook sample");
  }
});

test("docs distinguish sandbox and live behavior", () => {
  for (const required of ["sk_test_", "sk_live_", "sandbox: true", "merchant_payout_wallet_missing"]) {
    assertDocumented(required);
  }
});

test("docs never recommend exposing secret keys to the browser", () => {
  assert.doesNotMatch(corpus, /NEXT_PUBLIC_SUBSCRIPT_(SECRET|WEBHOOK)/);
  assert.match(corpus, /server-side only/i);
});

test("the shell keeps explicit scroll containers for desktop and mobile navigation", () => {
  const shell = readFileSync(path.join(docsRoot, "_components", "DocsShell.tsx"), "utf8");
  assertDocumented("max-h-[calc(100vh-4rem)]", shell, "the docs shell");
  assertDocumented("overflow-y-auto overscroll-contain", shell, "the docs shell");
});

test("legacy #section anchors still resolve to their new routes", () => {
  const redirect = readFileSync(path.join(docsRoot, "_components", "AnchorRedirect.tsx"), "utf8");
  assertDocumented("hashchange", redirect, "the anchor redirect");
  assertDocumented("router.replace", redirect, "the anchor redirect");
});
