import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path) => readFile(join(root, path), "utf8");

/* The guide is one route per section rather than a single page.tsx, so assert against the whole
   tree: a concept documented anywhere in /docs still counts as documented. */
async function docsTreeSource() {
    const docsRoot = join(root, "src", "app", "docs");
    const entries = await readdir(docsRoot, { recursive: true, withFileTypes: true });
    const files = entries
        .filter((entry) => entry.isFile() && (entry.name === "page.tsx" || entry.name.endsWith(".ts")))
        .map((entry) => join(entry.parentPath ?? entry.path, entry.name));

    const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
    return contents.join("\n");
}

test("sponsored merchant-plan route creates single-use one-time gift checkouts with guardrails", async () => {
    const route = await source("src/app/api/user/requests/merchant-plan/route.ts");

    assert.match(route, /requireAccountRole\(requester,\s*"USER"\)/);
    assert.match(route, /MAX_PENDING_SPONSORED_REQUESTS\s*=\s*10/);
    assert.match(route, /status:\s*"PENDING"[\s\S]*stateSnapshot:\s*\{\s*path:\s*\["isSponsored"\]/);
    assert.match(route, /stateSnapshot:\s*\{\s*path:\s*\["sponsoredPlanId"\]/);
    assert.match(route, /requested amount does not match the merchant plan price/);
    assert.match(route, /maxUses:\s*1/);
    assert.match(route, /receiverAddress/);
    assert.match(route, /beneficiaryAddress:\s*normalizedRequester/);
    assert.match(route, /expiresAt[\s\S]*LINK_TTL_MS/);
    assert.match(route, /durationSeconds:\s*Number\(plan\.periodSeconds\)/);
});

test("the 5-minute dedupe window only reuses a gift link that is aimed at the same recipient", async () => {
    const route = await source("src/app/api/user/requests/merchant-plan/route.ts");

    /* The recipient used to be resolved AFTER the dedupe query, which meant the query could not filter on
       them: a friend-locked request raised inside the window was handed the public link from moments
       earlier (lock gone, DM skipped by the early return), and a public request was handed a friend-locked
       link that /verify refuses for everyone but that friend. Resolution has to come first. */
    const receiverResolved = route.search(/let\s+receiverAddress\s*:/);
    const dedupeQuery = route.search(/paymentLink\s*\.\s*findFirst/);
    assert.ok(receiverResolved > -1, "expected receiverAddress to be resolved in the route");
    assert.ok(dedupeQuery > -1, "expected a findFirst dedupe query in the route");
    assert.ok(
        receiverResolved < dedupeQuery,
        "receiverAddress must be resolved before the dedupe findFirst, or the dedupe cannot filter on it",
    );

    /* And the query has to actually use it. Public links store null, so threading the resolved value
       through keeps public and friend-locked links in separate buckets. */
    assert.match(route, /findFirst\(\s*\{[\s\S]*?receiverAddress[\s\S]*?orderBy/);
});

test("friend-locked gift links are enforced server-side without leaking receiver_address publicly", async () => {
    const verifyRoute = await source("src/app/api/payment-links/verify/route.ts");
    const embeddedPayRoute = await source("src/app/api/user/payment-links/[id]/pay/route.ts");
    const payPage = await source("src/app/pay/[id]/page.tsx");
    const payClient = await source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(verifyRoute, /paymentLink\.receiver_address[\s\S]*locked to another SubScript user/);
    assert.match(embeddedPayRoute, /link\.receiverAddress[\s\S]*locked to another SubScript user/);
    assert.match(payPage, /beneficiary_address/);
    assert.doesNotMatch(payPage, /select\([^)]*receiver_address/);
    assert.match(payClient, /Gift payment/);
    assert.match(payClient, /Access will be granted to/);
});

test("sponsored metadata is merged into payment.succeeded webhooks", async () => {
    const webhooks = await source("src/lib/webhooks.ts");
    const worker = await source("src/lib/payments/paymentLinkVerificationWorker.ts");
    const docs = await docsTreeSource();

    assert.match(webhooks, /metadata\?:\s*Record<string,\s*unknown>/);
    assert.match(webhooks, /\.\.\.\(args\.metadata \?\? \{\}\)/);
    assert.match(worker, /\.from\("payment_links"\)[\s\S]*\.select\("state_snapshot"\)/);
    /* Takes the settlement moment now, because `accessUntil` is measured from when the friend
       actually paid rather than from when the request was raised. */
    assert.match(worker, /sponsoredWebhookMetadata\(parentLink\?\.state_snapshot,\s*new Date\(\)\)/);
    assert.match(worker, /isSponsored:\s*true/);
    /* Both casings, which is the documented contract for every field on the payload ("Pick one; they
       will not diverge"). This field was camelCase-only, so `is_sponsored` read as absent — i.e. NOT a
       gift — to a handler that had followed the snake_case convention the rest of the payload
       advertises. It is the field a gift handler branches on first, so that silence credited the payer
       rather than the beneficiary. */
    assert.match(worker, /is_sponsored:\s*true/);
    assert.match(worker, /duration_seconds/);
    /* An absolute end date, not just a duration the merchant has to derive a start for. This is the
       value the docs tell integrators to extend the beneficiary's access window to. */
    assert.match(worker, /access_until: accessUntil/);
    assert.match(worker, /accessUntil,/);
    /* Stated outright so a handler cannot mistake a gift for the start of a recurring plan. */
    assert.match(worker, /renews: false/);
    assert.match(worker, /one_time: true/);
    assert.match(docs, /POST \/api\/user\/requests\/merchant-plan/);
    assert.match(docs, /extend the existing access window/);
});

test("a gifted access window announces that it is one-time and when it ends", async () => {
    const worker = await source("src/lib/payments/paymentLinkVerificationWorker.ts");
    const catalog = await source("src/lib/dms/catalog.ts");
    const lifecycle = await source("src/lib/dms/lifecycle.ts");
    const reminders = await source("src/app/api/cron/payment-reminders/route.ts");

    /* The confirmation DM used to say only "your access is active", which reads like the start of a
       subscription. The beneficiary had no way to know the payment was one-time or when it ran out. */
    assert.match(worker, /one-time payment/);
    assert.match(worker, /won't renew/);
    assert.match(worker, /is covered until/);

    /* A gift creates no subscriptions row, so no billing cron sees it. The end-of-window notice is
       its own type and is swept from the settling payment plus the link's durationSeconds. */
    assert.match(catalog, /SPONSORED_ACCESS_ENDING/);
    assert.match(lifecycle, /export async function sendSponsoredAccessEndingDm/);
    assert.match(reminders, /sendSponsoredAccessEndingDm/);
    assert.match(reminders, /path: \["isSponsored"\], equals: true/);
    assert.match(reminders, /SPONSORED_LEAD_HOURS/);
});

test("user dashboard exposes gift link creation from merchant DM plan controls", async () => {
    const dashboard = await source("src/app/dashboard/user/page.tsx");

    assert.match(dashboard, /Ask a Friend to Pay/);
    assert.match(dashboard, /\/api\/user\/requests\/merchant-plan/);
    assert.match(dashboard, /friendUsername:\s*giftFriendUsername\.trim\(\)/);
    assert.match(dashboard, /Share this checkout anywhere/);
});
