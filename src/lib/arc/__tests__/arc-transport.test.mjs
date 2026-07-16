import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const source = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

/* Walk the tree rather than shelling out to `git grep`: its pathspecs are fnmatch, not globs, so a
   recursive double-star pathspec silently matched nothing and made this suite pass no matter what
   the code said. */
const sourceFiles = () =>
    readdirSync(path.join(ROOT, "src"), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
        .map((f) => path.join("src", f));

test("every Arc client reaches the chain through the retrying transport", () => {
    /* Arc's public RPC rate-limits per call and answers the rest with a 429 that viem will not retry
       (its shouldRetry keys off the JSON-RPC body's -32011, which isn't in its retryable set). A bare
       http() therefore drops reads on the floor whenever a surface reads more than one thing at once.
       Fixing only the wagmi transport was not enough: the dashboards, header, deposit modal and
       checkout each build their own createPublicClient, and every one of them stayed broken. */
    const offenders = sourceFiles().filter((f) => source(f).includes("transport: http()"));
    assert.deepEqual(offenders, [], `these clients bypass arcHttp and will lose reads to the limiter:\n${offenders.join("\n")}`);
});

test("the retry is keyed on the HTTP status, below viem's error mapping", () => {
    const transport = source("src/lib/arc/transport.ts");
    assert.match(transport, /export const arcHttp/);
    assert.match(transport, /fetchFn: rateLimitRetryFetch/);
    /* 429 is the signal; the JSON-RPC code is the thing viem can't see past, so we must not key on it. */
    assert.match(transport, /response\.status !== 429/);
    assert.match(transport, /retry-after/);
});

test("merchant tier is never gated on a chain read succeeding", () => {
    /* The tier is a database read. It used to be sequenced after a Promise.all of four Arc calls
       inside one try block, so a single 429 threw before setIsPremium ran — and a paying merchant got
       the upgrade lock over their own API keys, checkout and webhooks. A chain hiccup may cost a
       balance; it must not cost someone their tier. */
    const dashboard = source("src/app/dashboard/page.tsx");

    const loadTier = dashboard.slice(dashboard.indexOf("const loadTier ="), dashboard.indexOf("const loadConfidentiality ="));
    assert.match(loadTier, /setIsPremium\(/, "loadTier owns the premium flag");
    assert.doesNotMatch(loadTier, /publicClient\.readContract/, "tier must not depend on a chain read");

    const loadChainState = dashboard.slice(dashboard.indexOf("const loadChainState ="), dashboard.indexOf("await Promise.all([loadTier()"));
    assert.doesNotMatch(loadChainState, /setIsPremium\(/, "chain reads must not decide the tier");

    /* Each loader catches its own failure, so one cannot take the others down. */
    assert.match(dashboard, /await Promise\.all\(\[loadTier\(\), loadConfidentiality\(\), loadChainState\(\)\]\)/);
});

test("the merchant dashboard does not spend a rate-limited call on a value it ignores", () => {
    /* merchantTiers was read and never used — a fourth call into the limiter for nothing, competing
       with the balance reads that do matter. */
    const dashboard = source("src/app/dashboard/page.tsx");
    assert.doesNotMatch(dashboard, /functionName: "merchantTiers"/);
});
