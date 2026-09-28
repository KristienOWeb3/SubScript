import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Webhook events endpoint scopes by environment query parameter", () => {
    const routeContent = fs.readFileSync(
        path.resolve("src/app/api/webhooks/events/route.ts"),
        "utf-8"
    );
    assert.match(routeContent, /searchParams\.get\("environment"\)/);
    assert.match(routeContent, /if\s*\(environmentFilter === "TEST" \|\| environmentFilter === "LIVE"\)/);
    assert.match(routeContent, /where\.environment = environmentFilter;/);
});

test("Webhook replay endpoint scopes latest replay by requested environment", () => {
    const replayContent = fs.readFileSync(
        path.resolve("src/app/api/webhooks/events/replay/route.ts"),
        "utf-8"
    );
    assert.match(replayContent, /requestedEnvironment === "LIVE" \|\| requestedEnvironment === "TEST"/);
    assert.match(replayContent, /environment: requestedEnvironment/);
    assert.match(replayContent, /environment: merchantEvent\.environment/);
});

test("Merchant dashboard defaults webhook delivery view to LIVE", () => {
    const dashboardContent = fs.readFileSync(
        path.resolve("src/app/dashboard/page.tsx"),
        "utf-8"
    );
    // Defaults to LIVE
    assert.match(dashboardContent, /useState<"LIVE" \| "TEST">\("LIVE"\)/);
    assert.match(dashboardContent, /\/api\/webhooks\/events\?environment=\$\{env\}/);
});
