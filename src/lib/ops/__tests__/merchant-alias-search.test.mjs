import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
    new URL("../../../../src/app/api/merchant/alias/route.ts", import.meta.url),
    "utf8",
);

test("merchant alias lookup is case-insensitive without accepting LIKE wildcards", () => {
    const getHandler = route.slice(
        route.indexOf("export async function GET"),
        route.indexOf("export async function POST"),
    );
    assert.match(getHandler, /const normalizedAlias = queryAlias\.toLowerCase\(\)\.trim\(\)/);
    assert.match(getHandler, /!USER_ALIAS_REGEX\.test\(normalizedAlias\) && !ENTERPRISE_ALIAS_REGEX\.test\(normalizedAlias\)/);
    assert.match(getHandler, /\.ilike\("alias", normalizedAlias\)/);
    assert.doesNotMatch(getHandler, /\.eq\("alias", normalizedAlias\)/);
});
