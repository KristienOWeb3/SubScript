import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
    new URL("../../../../.github/workflows/integration-smoke.yml", import.meta.url),
    "utf8",
);
const smokeScript = await readFile(
    new URL("../../../../scripts/subscript-integration-smoke.mjs", import.meta.url),
    "utf8",
);
const subscriptionsRoute = await readFile(
    new URL("../../../app/api/v1/subscriptions/route.ts", import.meta.url),
    "utf8",
);

test("post-deploy smoke probes the public production origin", () => {
    assert.match(
        workflow,
        /SUBSCRIPT_BASE_URL: \$\{\{ vars\.SUBSCRIPT_PRODUCTION_URL \|\| 'https:\/\/www\.subscriptonarc\.com' \}\}/,
    );
    assert.doesNotMatch(
        workflow,
        /SUBSCRIPT_BASE_URL: \$\{\{ github\.event\.deployment_status\.(?:environment_url|target_url)/,
    );
});

test("deployment smoke does not exhaust persistent merchant resources", () => {
    assert.match(smokeScript, /r\.status === 403 && r\.json\.code === "quota_exceeded"/);
    assert.match(smokeScript, /api\("DELETE", `\/api\/payment-links\/\$\{encodeURIComponent\(intentId\)\}`/);
    assert.match(smokeScript, /publishToDm:\s*false/);
});

test("test API keys retain test-mode KYC behavior across subscription lifecycle operations", () => {
    const modeAwareTierChecks = subscriptionsRoute.match(
        /requireEnterpriseAndTier1\(auth\.merchantAddress, auth\.mode\)/g,
    ) || [];
    assert.equal(modeAwareTierChecks.length, 3, "GET, POST and DELETE must all retain the authenticated key mode");
});
