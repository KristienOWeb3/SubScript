import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path) => readFile(join(root, path), "utf8");

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
    const docs = await source("src/app/docs/page.tsx");

    assert.match(webhooks, /metadata\?:\s*Record<string,\s*unknown>/);
    assert.match(webhooks, /\.\.\.\(args\.metadata \?\? \{\}\)/);
    assert.match(worker, /\.from\("payment_links"\)[\s\S]*\.select\("state_snapshot"\)/);
    assert.match(worker, /sponsoredWebhookMetadata\(parentLink\?\.state_snapshot\)/);
    assert.match(worker, /isSponsored:\s*true/);
    assert.match(worker, /duration_seconds/);
    assert.match(docs, /POST \/api\/user\/requests\/merchant-plan/);
    assert.match(docs, /extend the existing access window/);
});

test("user dashboard exposes gift link creation from merchant DM plan controls", async () => {
    const dashboard = await source("src/app/dashboard/user/page.tsx");

    assert.match(dashboard, /Ask a Friend to Pay/);
    assert.match(dashboard, /\/api\/user\/requests\/merchant-plan/);
    assert.match(dashboard, /friendUsername:\s*giftFriendUsername\.trim\(\)/);
    assert.match(dashboard, /Share this checkout anywhere/);
});
