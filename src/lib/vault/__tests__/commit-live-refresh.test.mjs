import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("Commit dashboards share a two-second visibility-aware refresh policy", () => {
    const policy = source("src/lib/vault/liveRefresh.ts");
    const user = source("src/app/dashboard/user/page.tsx");
    const merchant = source("src/app/dashboard/page.tsx");

    assert.match(policy, /COMMIT_LIVE_REFRESH_MS = 2_000/);
    for (const page of [user, merchant]) {
        assert.match(page, /window\.setInterval\([^;]*COMMIT_LIVE_REFRESH_MS\)/s);
        assert.match(page, /document\.visibilityState === "visible"/);
        assert.match(page, /window\.addEventListener\("focus"/);
        assert.match(page, /document\.addEventListener\("visibilitychange"/);
        assert.match(page, /silent: true/);
    }
});

test("Commit refreshes bypass caches and cannot overlap", () => {
    const user = source("src/app/dashboard/user/page.tsx");
    const merchant = source("src/app/dashboard/page.tsx");
    const config = source("src/app/api/user/vault/config/route.ts");

    for (const page of [user, merchant]) {
        assert.match(page, /vaultRefreshInFlightRef\.current/);
        assert.match(page, /fetch\("\/api\/user\/vault\/config", \{ cache: "no-store" \}\)/);
    }
    assert.equal((config.match(/"Cache-Control": "private, no-store, max-age=0"/g) || []).length, 2);
});

test("unchanged background responses do not re-render either dashboard", () => {
    const user = source("src/app/dashboard/user/page.tsx");
    const merchant = source("src/app/dashboard/page.tsx");

    for (const page of [user, merchant]) {
        assert.match(page, /const vaultSnapshotRef = useRef\(""\)/);
        assert.match(page, /if \(nextSnapshot !== vaultSnapshotRef\.current\)/);
        assert.match(page, /vaultSnapshotRef\.current = nextSnapshot/);
    }
});
