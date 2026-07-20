import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import test from "node:test";

test("tracked and non-ignored local files contain no plaintext production credentials", () => {
    const result = spawnSync(process.execPath, ["scripts/check-secrets.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
    });

    assert.equal(
        result.status,
        0,
        [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
    assert.match(result.stdout, /Repository secret scan passed/);
});

test("the credential gate detects a non-ignored untracked repair script without printing its secret", () => {
    const probePath = "credential-incident-probe.mjs";
    const credential = "postgresql://incident_user:" + "temporary-test-password" + "@db.example.invalid:5432/postgres";
    writeFileSync(probePath, `const DATABASE_URL = ${JSON.stringify(credential)};\n`, "utf8");

    try {
        const result = spawnSync(process.execPath, ["scripts/check-secrets.mjs"], {
            cwd: process.cwd(),
            encoding: "utf8",
        });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /credential-incident-probe\.mjs:1 \(database_uri_with_password\)/);
        assert.doesNotMatch(result.stderr, /temporary-test-password/);
    } finally {
        unlinkSync(probePath);
    }
});

test("Vercel secret resync requires an explicit key selection or --all", () => {
    const source = readFileSync("scripts/resync-vercel-env.mjs", "utf8");
    assert.match(source, /Pass --keys NAME\[,NAME\] or --all/);
    assert.match(source, /requestedKeys/);
    assert.match(source, /Refusing to sync every credential implicitly/);
});
