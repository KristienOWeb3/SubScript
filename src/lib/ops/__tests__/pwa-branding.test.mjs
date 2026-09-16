import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

function pngSize(path) {
    const data = readFileSync(new URL(path, root));
    assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test("install prompt is limited to each dashboard overview and permanently records first display", () => {
    const installer = source("src/components/PwaInstaller.tsx");
    assert.match(installer, /pathname === "\/dashboard" \|\| pathname === "\/dashboard\/user"/);
    assert.match(installer, /localStorage\.getItem\(PROMPTED_KEY\) === "1"/);
    assert.match(installer, /localStorage\.setItem\(PROMPTED_KEY, "1"\)/);
    assert.match(installer, /if \(!isOverview \|\| !visible \|\| !deferredPrompt\) return null/);
});

test("site metadata and PWA manifest use generated SubScript brand assets", () => {
    const layout = source("src/app/layout.tsx");
    const manifest = source("src/app/manifest.ts");
    for (const asset of ["/favicon.ico", "/favicon-48x48.png", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
        assert.match(layout, new RegExp(asset.replaceAll(".", "\\.")));
    }
    for (const asset of ["/favicon-48x48.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]) {
        assert.match(manifest, new RegExp(asset.replaceAll(".", "\\.")));
    }

    assert.deepEqual(pngSize("public/icon-192.png"), { width: 192, height: 192 });
    assert.deepEqual(pngSize("public/icon-512.png"), { width: 512, height: 512 });
    assert.deepEqual(pngSize("public/icon-maskable-512.png"), { width: 512, height: 512 });
    assert.deepEqual(pngSize("public/apple-touch-icon.png"), { width: 180, height: 180 });
});

test("brand generation remains reproducible from the supplied source logos", () => {
    const generator = source("scripts/generate-brand-assets.mjs");
    assert.match(generator, /Subscript Logo colored background\.png/);
    assert.match(generator, /Subscript Logo transparent background\.png/);
    assert.match(generator, /favicon\.ico/);

    for (const path of [
        "src/components/Navbar.tsx",
        "src/components/auth/AuthSplitLayout.tsx",
        "src/components/UserDashboardHeader.tsx",
        "src/components/DashboardHeader.tsx",
    ]) {
        assert.match(source(path), /\/logo-(?:transparent|colored)\.png|\/logo\.png/, `${path} uses a generated logo`);
    }
});
