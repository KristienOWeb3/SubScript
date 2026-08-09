/* Delegated spending caps: the invariants that keep a sub-user inside the budget their parent set.
   commitId.ts is compiled in a VM with a fake Prisma so the cap arithmetic, authority resolution,
   and release-on-failure accounting are testable without a database.

   The atomic debit in recordSubUserSpend is raw SQL, so the fake models its predicate rather than
   executing it. That boundary is the point: these tests pin the JS-side contract (what gets
   reserved, what gets released, who funds a delegated send), and the SQL's own guarantee —
   serialising concurrent debits — is enforced by Postgres and asserted here only as "the
   conditional matched or it didn't". */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

/* This file sits at src/lib/__tests__/, so three levels up is the repo root. */
function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const commitIdSource = source("src/lib/commitId.ts");

/* Rows are plain objects keyed by commitId. `queryRaw`/`executeRaw` receive the template strings
   tagged call, so the fake inspects the interpolated values positionally — the same order the
   statements in commitId.ts pass them. */
function loadCommitId(rows) {
    const store = new Map(rows.map((row) => [row.commitId, { ...row }]));

    const findRow = (where) => {
        if (where.commitId) return store.get(where.commitId) ?? null;
        if (where.walletAddress !== undefined) {
            for (const row of store.values()) {
                if (row.walletAddress === where.walletAddress) return row;
            }
        }
        return null;
    };

    const withParent = (row, include) => {
        if (!row) return null;
        const result = { ...row };
        if (include?.parent) {
            result.parent = row.parentCommitId
                ? ([...store.values()].find((candidate) => candidate.id === row.parentCommitId) ?? null)
                : null;
        }
        return result;
    };

    const prisma = {
        userCommit: {
            findUnique: async ({ where, include }) => withParent(findRow(where), include),
            findMany: async ({ where }) => [...store.values()].filter(
                (row) => row.parentCommitId === where.parentCommitId,
            ),
            create: async ({ data }) => {
                const row = {
                    id: data.commitId,
                    spentUsdc: 0n,
                    status: "ACTIVE",
                    walletAddress: null,
                    parentCommitId: null,
                    spendLimitUsdc: null,
                    ...data,
                };
                store.set(row.commitId, row);
                return row;
            },
            update: async ({ where, data }) => {
                const row = [...store.values()].find((candidate) => candidate.id === where.id);
                Object.assign(row, data);
                return row;
            },
            updateMany: async ({ where, data }) => {
                const row = [...store.values()].find(
                    (candidate) => candidate.id === where.id
                        && (where.walletAddress !== null || candidate.walletAddress === null),
                );
                if (!row) return { count: 0 };
                Object.assign(row, data);
                return { count: 1 };
            },
        },
        /* Stands in for the recursive-CTE debit and the ancestor-inactive probe. Values arrive in
           source order, which differs between the two statements: the debit's CTE interpolates
           commitId first and the amount second, while the release interpolates the amount first.
           Picking them out by type rather than by index keeps the fake honest if that order
           changes again. */
        $queryRaw: async (strings, ...values) => {
            const sql = strings.join(" ");
            const commitId = values.find((value) => typeof value === "string");
            const amount = values.find((value) => typeof value === "bigint");
            if (sql.includes("UPDATE user_commits")) {
                const row = store.get(commitId);
                if (!row || row.status !== "ACTIVE" || amount <= 0n) return [];
                if (ancestorInactive(store, row)) return [];
                if (row.spendLimitUsdc !== null && row.spentUsdc + amount > row.spendLimitUsdc) return [];
                row.spentUsdc += amount;
                return [{ spend_limit_usdc: row.spendLimitUsdc, spent_usdc: row.spentUsdc }];
            }
            const row = store.get(commitId);
            return [{ inactive: row ? ancestorInactive(store, row) : false }];
        },
        $executeRaw: async (strings, ...values) => {
            const commitId = values.find((value) => typeof value === "string");
            const amount = values.find((value) => typeof value === "bigint");
            const row = store.get(commitId);
            if (!row) return 0;
            // GREATEST(spent - amount, 0) — the column's >= 0 CHECK, mirrored.
            row.spentUsdc = row.spentUsdc - amount > 0n ? row.spentUsdc - amount : 0n;
            return 1;
        },
    };

    const compiled = ts.transpileModule(commitIdSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: "commitId.ts",
    }).outputText;

    const testModule = { exports: {} };
    const context = vm.createContext({ console, process, BigInt, Date, Error, RegExp, Map, Set });
    const wrapper = vm.runInContext(
        `(function (require, module, exports) { ${compiled}\n })`,
        context,
        { filename: "commitId.test.cjs" },
    );
    wrapper((specifier) => {
        if (specifier === "crypto") return { randomBytes: (n) => Buffer.alloc(n, 7) };
        if (specifier === "@/lib/prisma") return { prisma };
        if (specifier === "@/lib/identityDisplay") return { accountDisplayName: (_a, b) => b };
        throw new Error(`Unexpected import: ${specifier}`);
    }, testModule, testModule.exports);

    return { ...testModule.exports, store };
}

function ancestorInactive(store, row) {
    let current = row;
    for (let depth = 0; depth < 32; depth += 1) {
        if (!current.parentCommitId) return false;
        const parent = [...store.values()].find((candidate) => candidate.id === current.parentCommitId);
        if (!parent) return false;
        if (parent.status !== "ACTIVE") return true;
        current = parent;
    }
    return false;
}

const PARENT = {
    id: "cmt_parent000",
    commitId: "cmt_parent000",
    walletAddress: "0xparent",
    parentCommitId: null,
    spendLimitUsdc: null,
    spentUsdc: 0n,
    status: "ACTIVE",
    displayName: "Parent",
};

function child(overrides = {}) {
    return {
        id: "cmt_child00a",
        commitId: "cmt_child00a",
        walletAddress: "0xchild",
        parentCommitId: PARENT.id,
        spendLimitUsdc: 100n,
        spentUsdc: 0n,
        status: "ACTIVE",
        displayName: "Child",
        ...overrides,
    };
}

test("a spend inside the cap is allowed and debits the ledger", async () => {
    const lib = loadCommitId([PARENT, child()]);
    const result = await lib.recordSubUserSpend("cmt_child00a", 40n);
    assert.equal(result.allowed, true);
    assert.equal(result.remainingUsdc, 60n);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 40n);
});

test("a spend past the cap is refused and leaves the ledger untouched", async () => {
    const lib = loadCommitId([PARENT, child({ spentUsdc: 90n })]);
    const result = await lib.recordSubUserSpend("cmt_child00a", 20n);
    assert.equal(result.allowed, false);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 90n, "a refused spend must not debit");
});

test("a spend exactly to the cap is allowed; the next micro is not", async () => {
    const lib = loadCommitId([PARENT, child()]);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 100n)).allowed, true);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 1n)).allowed, false);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 100n);
});

test("sequential spends cannot jointly exceed the cap", async () => {
    /* The real serialisation is Postgres' row lock; what this pins is that the predicate is
       evaluated against the *committed* running total, so the second spend sees the first. */
    const lib = loadCommitId([PARENT, child()]);
    const first = await lib.recordSubUserSpend("cmt_child00a", 60n);
    const second = await lib.recordSubUserSpend("cmt_child00a", 60n);
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, false);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 60n, "only the winner may be debited");
});

test("a paused sub-user cannot spend", async () => {
    const lib = loadCommitId([PARENT, child({ status: "PAUSED" })]);
    const result = await lib.recordSubUserSpend("cmt_child00a", 1n);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /paused/i);
});

test("a revoked sub-user cannot spend", async () => {
    const lib = loadCommitId([PARENT, child({ status: "REVOKED" })]);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 1n)).allowed, false);
});

test("a paused parent cascades: the child cannot spend", async () => {
    const lib = loadCommitId([{ ...PARENT, status: "PAUSED" }, child()]);
    const result = await lib.recordSubUserSpend("cmt_child00a", 1n);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /parent/i);
});

test("an uncapped sub-user may spend any positive amount", async () => {
    const lib = loadCommitId([PARENT, child({ spendLimitUsdc: null })]);
    const result = await lib.recordSubUserSpend("cmt_child00a", 10n ** 12n);
    assert.equal(result.allowed, true);
    assert.equal(result.remainingUsdc, null);
});

test("zero and negative amounts are refused rather than crediting the cap", async () => {
    const lib = loadCommitId([PARENT, child({ spentUsdc: 50n })]);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 0n)).allowed, false);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", -25n)).allowed, false);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 50n, "a negative spend must not widen the cap");
});

test("releasing unspent budget restores headroom", async () => {
    const lib = loadCommitId([PARENT, child()]);
    await lib.recordSubUserSpend("cmt_child00a", 80n);
    await lib.releaseSubUserSpend("cmt_child00a", 30n);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 50n);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 50n)).allowed, true);
});

test("an over-release floors at zero instead of widening the cap", async () => {
    const lib = loadCommitId([PARENT, child({ spentUsdc: 10n })]);
    await lib.releaseSubUserSpend("cmt_child00a", 999n);
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 0n);
});

test("a delegated caller spends the parent's wallet, not their own", async () => {
    const lib = loadCommitId([PARENT, child()]);
    const authority = await lib.resolveSpendingAuthority("0xchild");
    assert.equal(authority.delegated, true);
    assert.equal(authority.fundingWallet, "0xparent");
    assert.equal(authority.commitId, "cmt_child00a");
});

test("a root caller funds from their own wallet and is not delegated", async () => {
    const lib = loadCommitId([PARENT]);
    const authority = await lib.resolveSpendingAuthority("0xparent");
    assert.equal(authority.delegated, false);
    assert.equal(authority.fundingWallet, "0xparent");
});

test("a wallet with no commit row spends its own funds uncapped", async () => {
    const lib = loadCommitId([]);
    const authority = await lib.resolveSpendingAuthority("0xstranger");
    assert.equal(authority.delegated, false);
    assert.equal(authority.fundingWallet, "0xstranger");
});

test("a paused sub-user is refused at authority resolution, before any transfer", async () => {
    const lib = loadCommitId([PARENT, child({ status: "PAUSED" })]);
    await assert.rejects(() => lib.resolveSpendingAuthority("0xchild"), /paused/i);
});

test("a delegated row whose parent has no wallet fails closed", async () => {
    /* Must never fall through to the sub-user's own wallet: that would spend the wrong person's
       money with no cap applied. */
    const lib = loadCommitId([{ ...PARENT, walletAddress: null }, child()]);
    await assert.rejects(() => lib.resolveSpendingAuthority("0xchild"), /not available/i);
});

test("a cap cannot be lowered below what was already spent", async () => {
    const lib = loadCommitId([PARENT, child({ spentUsdc: 60n })]);
    await assert.rejects(
        () => lib.updateSubUserLimit("0xparent", "cmt_child00a", 50n),
        /already spent/i,
    );
});

test("a cap can be raised, lowered to the spent floor, or lifted entirely", async () => {
    const lib = loadCommitId([PARENT, child({ spentUsdc: 60n })]);
    assert.equal((await lib.updateSubUserLimit("0xparent", "cmt_child00a", 500n)).spendLimitUsdc, 500n);
    assert.equal((await lib.updateSubUserLimit("0xparent", "cmt_child00a", 60n)).spendLimitUsdc, 60n);
    assert.equal((await lib.updateSubUserLimit("0xparent", "cmt_child00a", null)).spendLimitUsdc, null);
});

test("lowering a cap immediately shrinks spendable headroom", async () => {
    const lib = loadCommitId([PARENT, child({ spendLimitUsdc: 1000n, spentUsdc: 100n })]);
    await lib.updateSubUserLimit("0xparent", "cmt_child00a", 150n);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 60n)).allowed, false);
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 50n)).allowed, true);
});

test("a negative cap is refused", async () => {
    const lib = loadCommitId([PARENT, child()]);
    await assert.rejects(() => lib.updateSubUserLimit("0xparent", "cmt_child00a", -1n), /negative/i);
});

test("a stranger cannot re-cap, pause or revoke someone else's sub-user", async () => {
    const outsider = {
        ...PARENT,
        id: "cmt_outsider0",
        commitId: "cmt_outsider0",
        walletAddress: "0xoutsider",
    };
    const lib = loadCommitId([PARENT, outsider, child()]);
    await assert.rejects(() => lib.updateSubUserLimit("0xoutsider", "cmt_child00a", 5n), /not found/i);
    await assert.rejects(() => lib.pauseSubUser("0xoutsider", "cmt_child00a"), /not found/i);
    await assert.rejects(() => lib.revokeSubUser("0xoutsider", "cmt_child00a"), /not found/i);
});

test("a sibling cannot act on a sibling", async () => {
    /* Blocked by the ownership check rather than the root check: pauseSubUser resolves the target
       first, and the sibling does not own it. The 404 wording is deliberate — a 403 here would
       confirm the sibling's commit ID exists to someone who should not learn that. */
    const sibling = child({ id: "cmt_sibling0a", commitId: "cmt_sibling0a", walletAddress: "0xsibling" });
    const lib = loadCommitId([PARENT, child(), sibling]);
    await assert.rejects(() => lib.pauseSubUser("0xsibling", "cmt_child00a"), /not found/i);
});

test("revocation is terminal — no resume, no re-cap", async () => {
    const lib = loadCommitId([PARENT, child({ status: "REVOKED" })]);
    await assert.rejects(() => lib.resumeSubUser("0xparent", "cmt_child00a"), /revoked/i);
    await assert.rejects(() => lib.updateSubUserLimit("0xparent", "cmt_child00a", 500n), /revoked/i);
});

test("pause is reversible and restores spending", async () => {
    const lib = loadCommitId([PARENT, child()]);
    await lib.pauseSubUser("0xparent", "cmt_child00a");
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 10n)).allowed, false);
    await lib.resumeSubUser("0xparent", "cmt_child00a");
    assert.equal((await lib.recordSubUserSpend("cmt_child00a", 10n)).allowed, true);
});

test("a sub-user cannot mint an uncapped grandchild to escape its own cap", async () => {
    const lib = loadCommitId([PARENT, child()]);
    await assert.rejects(
        () => lib.createSubUser({ parentWalletAddress: "0xchild", spendLimitUsdc: null }),
        /cannot manage sub-users/i,
    );
});
