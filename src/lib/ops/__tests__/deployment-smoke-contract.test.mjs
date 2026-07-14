import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
    new URL("../../../../.github/workflows/integration-smoke.yml", import.meta.url),
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
