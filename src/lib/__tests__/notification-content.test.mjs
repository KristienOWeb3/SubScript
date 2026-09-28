import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

import { normalizeNotificationActionUrl } from "../notifications/actionUrl.ts";

const root = new URL("../../../", import.meta.url);

function applicationSources(directory) {
    return readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && [".ts", ".tsx", ".js", ".jsx"].includes(extname(entry.name)))
        .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
}

test("removed affiliate campaign copy is absent from production application sources", () => {
    const source = applicationSources("src").filter((contents) => !contents.includes("notification-content.test.mjs")).join("\n");
    const forbidden = [
        ["New", "Campaign", "Unlocked"].join(" "),
        ["Run", "your", "own", "affiliate", "program", "with", "zero", "overhead"].join(" "),
        ["Partner", "Affiliate", "Program"].join(" "),
    ];

    for (const phrase of forbidden) assert.equal(source.includes(phrase), false);

    for (const htmlFile of ["merchant-dashboard.html", "public/merchant-dashboard.html"]) {
        const html = readFileSync(new URL(htmlFile, root), "utf8");
        for (const phrase of forbidden) assert.equal(html.includes(phrase), false, `Forbidden copy found in ${htmlFile}`);
    }
});

test("notification CTAs resolve only to existing platform route families", () => {
    const valid = [
        "/user?tab=inbox&chat=0xabc",
        "/merchant?tab=settings",
        "/dashboard/user",
        "/support?ticket=ticket-1",
        "/receipt/receipt-1",
        "/pay/payment-1",
        "/commit/acme-cloud",
        "https://www.subscriptonarc.com/docs#webhooks",
    ];
    for (const value of valid) assert.ok(normalizeNotificationActionUrl(value), value);

    for (const value of ["https://example.com/phish", "/missing-page", "/dashboard/missing", "//example.com", "javascript:alert(1)"]) {
        assert.equal(normalizeNotificationActionUrl(value), null, value);
    }

    const routeDirectories = new Set(
        readdirSync(new URL("src/app", root), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
    );
    for (const segment of ["user", "merchant", "dashboard", "support", "receipt", "pay", "commit", "docs"]) {
        assert.ok(routeDirectories.has(segment), `missing app route for /${segment}`);
    }
});
