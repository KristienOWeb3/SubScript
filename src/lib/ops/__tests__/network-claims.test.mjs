import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/* Guard against stale "which network are we on" claims.

   SubScript went live on Arc Mainnet (chain id 5042) on 2026-09-16, but /llms.txt, the policy
   mirrors and several UI strings kept telling users, integrators and AI agents that it was a
   testnet beta with valueless USDC. Prose doesn't execute, so nothing caught it. This test does.

   Two tiers:
   1. STRICT surfaces: static copy served as-is to people and agents (public/*.txt|md|json,
      README.md). Every line that mentions testnet, Sepolia, a faucet or the testnet chain id must
      be allowlisted below with a reason. Mentions of test mode / sk_test_ sandboxing are fine,
      but they have to be declared, so a new "we're on testnet" line can't slip in unnoticed.
   2. SOURCE surfaces: pages, components, API routes and email templates. Code legitimately
      branches on NEXT_PUBLIC_ENVIRONMENT and on per-link sandbox mode, so only phrasings that
      claim the PRODUCT runs on testnet (or that mainnet hasn't launched) fail here.

   An allowlist entry that no longer matches anything also fails, so the list can't rot. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");

function walk(dir, accept, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".next")) continue;
        const abs = path.join(dir, name);
        const stat = statSync(abs);
        if (stat.isDirectory()) walk(abs, accept, out);
        else if (accept(abs)) out.push(abs);
    }
    return out;
}

/* Any mention of the testnet world in strict copy. */
const STRICT_MENTION = /testnet|test[\s-]net\b|sepolia|faucet|5042002|arc-testnet|arcscan/i;

/* Phrasings that claim SubScript itself is on testnet / pre-mainnet. Checked everywhere. */
const CLAIM_PATTERNS = [
    { id: "runs-on-testnet", re: /\b(?:is|are|runs?|running|operates?|operating|currently|live|deployed)\b[^.\n]{0,40}\bon\s+(?:the\s+)?arc\s+testnet\b/i },
    { id: "testnet-beta", re: /\btestnet[\s-]+beta\b|\bbeta\s+on\s+(?:the\s+)?(?:arc\s+)?testnet\b|public\s+beta\s+(?:&|and)\s+testnet/i },
    { id: "during-the-beta", re: /\b(?:during|in)\s+the\s+(?:testnet|public)\s+beta\b|\bnot\s+during\s+the\s+beta\b/i },
    { id: "mainnet-not-launched", re: /\b(?:when|until|before|once)\s+mainnet\s+(?:launches|goes\s+live|is\s+live|ships)\b|\bavailable\s+on\s+mainnet\b|\bcarr(?:y|ies)\s+over\s+to\s+mainnet\b|\bmigration\s+to\s+mainnet\b|\bhardened\s+for\s+the\s+mainnet\s+cutover\b/i },
    { id: "wrong-mainnet-chain-id", re: /\b5042001\b/ },
    { id: "hardcoded-testnet-explorer", re: /https:\/\/testnet\.arcscan\.app/i },
    { id: "hardcoded-testnet-switch", re: /switch\s+to\s+arc\s+testnet/i },
];

/* Lines that may mention testnet, each with the reason it's accurate. `match` is a substring of
   the line (CRLF-insensitive). Keep reasons specific: they're the audit trail. */
const ALLOWLIST = [
    // ---- strict surfaces: test mode is real and lives on Arc Testnet ----
    { file: "public/api-reference.md", match: "run in sandbox mode on Arc testnet", reason: "Documents sk_test_ / sandbox:true test mode, which settles on Arc Testnet by design." },
    { file: "public/quickstart.md", match: "key works out of the box for testnet plan creation", reason: "Describes what an sk_test_ key can do in development." },
    { file: "public/mirrors/dashboard.md", match: "Sandbox (Testnet) and Production (Mainnet)", reason: "The dashboard's TEST/LIVE key toggle." },
    { file: "public/mirrors/refunds.md", match: "Arc testnet USDC and testnet contract addresses are never accepted", reason: "States that testnet records are NOT proof of a mainnet payment (mirrors /refunds)." },
    { file: "public/mirrors/terms.md", match: "testnet balances, receipts, and authorizations remain non-production records", reason: "States that testnet records are NOT production records (mirrors /terms section 3)." },
    { file: "README.md", match: "keys and local/preview builds stay on Arc Testnet for sandboxing", reason: "Explains which builds/keys use testnet next to the mainnet-live statement." },
    { file: "README.md", match: "key for funded Arc testnet settlement", reason: "Demo-key quickstart: sk_test_ keys settle on Arc Testnet." },
    // ---- source surfaces: environment-keyed explorer links ----
    { file: "src/lib/email/transactional.ts", match: "isProd ? `https://explorer.arc.io/tx/${txHash}` : `https://testnet.arcscan.app/tx/${txHash}`", reason: "Explorer picked by NEXT_PUBLIC_ENVIRONMENT." },
    { file: "src/lib/email/transactional.ts", match: "event?.chainId === 5042002 ? \"https://testnet.arcscan.app\"", reason: "Explorer picked by the receipt's own chain id (test-mode receipts link to testnet)." },
];

const STRICT_FILES = () => [
    ...walk(path.join(root, "public"), (f) => /\.(txt|md|json)$/i.test(f)),
    path.join(root, "README.md"),
];

const SOURCE_FILES = () => [
    ...walk(path.join(root, "src", "app"), (f) => /\.(tsx?|mdx?)$/.test(f) && !/__tests__/.test(f)),
    ...walk(path.join(root, "src", "components"), (f) => /\.tsx?$/.test(f) && !/__tests__/.test(f)),
    ...walk(path.join(root, "src", "lib", "email"), (f) => /\.tsx?$/.test(f) && !/__tests__/.test(f)),
];

/* Comments explain code; they aren't shown to anyone. */
const isCommentLine = (line) => /^\s*(?:\/\/|\/\*|\*|\{\s*\/\*)/.test(line);

export function scanText(file, text, { strict }) {
    const violations = [];
    text.replace(/\r\n/g, "\n").split("\n").forEach((line, index) => {
        if (!strict && isCommentLine(line)) return;
        const hits = CLAIM_PATTERNS.filter((p) => p.re.test(line)).map((p) => p.id);
        if (strict && STRICT_MENTION.test(line) && hits.length === 0) hits.push("unlisted-testnet-mention");
        if (hits.length === 0) return;
        const allowed = ALLOWLIST.find((entry) => entry.file === file && line.includes(entry.match));
        if (allowed) return;
        violations.push(`${file}:${index + 1} [${hits.join(", ")}] ${line.trim().slice(0, 160)}`);
    });
    return violations;
}

test("public and static copy never claims SubScript runs on testnet", () => {
    const violations = STRICT_FILES().flatMap((abs) => scanText(rel(abs), readFileSync(abs, "utf8"), { strict: true }));
    assert.deepEqual(
        violations,
        [],
        "Stale testnet claim in public copy. Fix the copy, or add an ALLOWLIST entry with a reason if the line is about test mode:\n" + violations.join("\n"),
    );
});

test("pages, components, API routes and emails never claim the product is pre-mainnet", () => {
    const violations = SOURCE_FILES().flatMap((abs) => scanText(rel(abs), readFileSync(abs, "utf8"), { strict: false }));
    assert.deepEqual(
        violations,
        [],
        "Stale network claim in app source. Derive the name from ACTIVE_NETWORK_NAME / explorerTxUrl in src/lib/network/registry.ts, or allowlist with a reason:\n" + violations.join("\n"),
    );
});

test("every allowlist entry still matches a line and carries a reason", () => {
    for (const entry of ALLOWLIST) {
        assert.ok(entry.reason && entry.reason.length > 10, `Allowlist entry for ${entry.file} needs a reason`);
        const text = readFileSync(path.join(root, entry.file), "utf8");
        assert.ok(text.includes(entry.match), `Stale allowlist entry: "${entry.match}" no longer appears in ${entry.file}. Remove it.`);
    }
});

test("llms.txt states the mainnet network and fails if testnet is reintroduced", () => {
    const llms = readFileSync(path.join(root, "public", "llms.txt"), "utf8");
    assert.match(llms, /live on Arc Mainnet \(chain id 5042\)/i);

    /* The scanner itself must catch the regressions this test exists for. */
    const regressions = [
        "- SubScript is in public beta on the Arc testnet: all beta payments settle in testnet USDC.",
        "SubScript runs on testnet.",
        "Network: Arc Mainnet (5042001).",
        "Integrations carry over to mainnet with a configuration change.",
    ];
    for (const line of regressions) {
        assert.notDeepEqual(
            scanText("public/llms.txt", `${llms}\n${line}\n`, { strict: true }),
            [],
            `The guard failed to flag: ${line}`,
        );
    }
});

test("network-facing UI derives the network from the one registry, not a hardcoded testnet", () => {
    const registry = readFileSync(path.join(root, "src/lib/network/registry.ts"), "utf8");
    assert.match(registry, /export const ACTIVE_NETWORK_NAME: string = ACTIVE_ARC_CHAIN\.name;/);

    /* NEXT_PUBLIC_ARC_NETWORK was never set anywhere, so this branch sent mainnet users to the
       testnet explorer. The network switch is NEXT_PUBLIC_ENVIRONMENT, via the registry. */
    for (const file of ["src/components/SendSingleModal.tsx", "src/app/dashboard/user/transactions/page.tsx"]) {
        const source = readFileSync(path.join(root, file), "utf8");
        assert.doesNotMatch(source, /NEXT_PUBLIC_ARC_NETWORK/, `${file} must not read the unset NEXT_PUBLIC_ARC_NETWORK`);
        assert.match(source, /explorerTxUrl\(/, `${file} should build explorer links with explorerTxUrl()`);
    }

    /* Live intents must report the chain they settle on; the helper used to default to testnet. */
    const reconciliation = readFileSync(path.join(root, "src/lib/arc/reconciliation.ts"), "utf8");
    assert.match(reconciliation, /chainId: number = ACTIVE_ARC_CHAIN_ID/);
    const intentRoute = readFileSync(path.join(root, "src/app/api/intent/route.ts"), "utf8");
    assert.doesNotMatch(intentRoute, /arcReconciliation\(\)/, "/api/intent must pass the intent's settlementChainId");
});
