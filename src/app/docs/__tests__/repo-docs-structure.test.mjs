import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function markdownFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return markdownFiles(fullPath);
        return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
    });
}

test("supporting documentation stays out of the repository root", () => {
    const rootDocs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && [".md", ".txt"].includes(path.extname(entry.name)))
        .map((entry) => entry.name)
        .sort();

    assert.deepEqual(rootDocs, ["README.md"]);
    assert.ok(existsSync(path.join(root, "docs", "README.md")));
});

test("relative Markdown links resolve after documentation moves", () => {
    const files = [path.join(root, "README.md"), ...markdownFiles(path.join(root, "docs"))];
    const missing = [];

    for (const file of files) {
        const markdown = readFileSync(file, "utf8");
        for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
            const href = match[1].trim().replace(/^<|>$/g, "");
            if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;

            const target = href.split(/[?#]/, 1)[0];
            const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
            if (!existsSync(resolved)) {
                missing.push(`${path.relative(root, file)} -> ${href}`);
            }
        }
    }

    assert.deepEqual(missing, []);
});
