import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/* Link-preview crawlers (Telegram especially) cache by image URL. If public/og.png changes
   without a version bump, they keep showing the old card. */
test("OG_IMAGE_VERSION matches public/og.png", () => {
    const hash = createHash("md5").update(readFileSync("public/og.png")).digest("hex").slice(0, 8);
    const source = readFileSync("src/lib/seo/ogImage.ts", "utf8");
    assert.match(source, new RegExp(`OG_IMAGE_VERSION = "${hash}"`), `bump OG_IMAGE_VERSION to "${hash}"`);
});

test("no page links the unversioned og.png", () => {
    for (const file of ["src/app/layout.tsx", "src/app/pay/[id]/page.tsx", "src/app/commit/[merchantAddress]/page.tsx", "src/app/subscribe/[planId]/page.tsx"]) {
        assert.doesNotMatch(readFileSync(file, "utf8"), /["`\/]og\.png["`]/, file);
    }
});
