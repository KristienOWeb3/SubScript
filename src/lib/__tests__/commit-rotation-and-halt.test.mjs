/* Commit ID rotation and account self-halt.
 *
 * Same shape as delegated-spend-caps.test.mjs: commitId.ts and accountHalt.ts are compiled in a VM
 * over a fake Prisma, so the authority rules and the halt cascade are testable without a database.
 * The raw-SQL debit is modelled rather than executed, which is the same boundary that file draws.
 *
 * The rotation tests exist because rotation is a security action with a specific promise: the row
 * keeps its identity, cap and ledger, and the old credential dies immediately. Both halves have to
 * hold or the feature is either useless or destructive.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

/* This file sits at src/lib/__tests__/, so three levels up is the repo root. */
function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

/* Shared store so commitId.ts and accountHalt.ts see the same rows, which is what makes the cascade
   assertions meaningful: a halt written through one module has to be visible to the other. */
function makeStore(rows) {
    const store = new Map(rows.map((row) => [row.commitId, { ...row }]));

    const byId = (id) => [...store.values()].find((candidate) => candidate.id === id) ?? null;

    const findRow = (where) => {
        if (where.commitId) return store.get(where.commitId) ?? null;
        if (where.walletAddress !== undefined) {
            for (const row of store.values()) {
                if (row.walletAddress === where.walletAddress) return row;
            }
        }
        if (where.id) return byId(where.id);
        return null;
    };

    const withParent = (row, include) => {
        if (!row) return null;
        const result = { ...row };
        if (include?.parent) {
            result.parent = row.parentCommitId ? byId(row.parentCommitId) : null;
        }
        return result;
    };

    function ancestorInactive(row) {
        let current = row;
        for (let depth = 0; depth < 32; depth += 1) {
            if (!current.parentCommitId) return false;
            const parent = byId(current.parentCommitId);
            if (!parent) return false;
            if (parent.status !== "ACTIVE") return true;
            current = parent;
        }
        return false;
    }

    const prisma = {
        userCommit: {
            findUnique: async ({ where, include }) => withParent(findRow(where), include),
            findFirst: async ({ where }) => {
                for (const row of store.values()) {
                    if (where.vaultId && row.vaultId !== where.vaultId) continue;
                    if ("parentCommitId" in where && row.parentCommitId !== where.parentCommitId) continue;
                    return row;
                }
                return null;
            },
            findMany: async ({ where }) => [...store.values()].filter((row) => {
                if ("parentCommitId" in where && row.parentCommitId !== where.parentCommitId) return false;
                if (where.status?.in && !where.status.in.includes(row.status)) return false;
                return true;
            }),
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
                const row = byId(where.id);
                /* commit_id is UNIQUE and separate from id, so a rotation re-keys the map without
                   disturbing the row. Modelling that re-key is the whole point: it is what makes the
                   old ID stop resolving while the ledger stays put. */
                const previousCommitId = row.commitId;
                Object.assign(row, data);
                if (data.commitId && data.commitId !== previousCommitId) {
                    store.delete(previousCommitId);
                    store.set(data.commitId, row);
                }
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
        $queryRaw: async (strings, ...values) => {
            const sql = strings.join(" ");
            const commitId = values.find((value) => typeof value === "string");
            const amount = values.find((value) => typeof value === "bigint");
            if (sql.includes("UPDATE user_commits")) {
                const row = store.get(commitId);
                if (!row || row.status !== "ACTIVE" || amount <= 0n) return [];
                if (ancestorInactive(row)) return [];
                if (row.spendLimitUsdc !== null && row.spentUsdc + amount > row.spendLimitUsdc) return [];
                row.spentUsdc += amount;
                return [{ spend_limit_usdc: row.spendLimitUsdc, spent_usdc: row.spentUsdc }];
            }
            const row = store.get(commitId);
            return [{ inactive: row ? ancestorInactive(row) : false }];
        },
        $executeRaw: async (strings, ...values) => {
            const commitId = values.find((value) => typeof value === "string");
            const amount = values.find((value) => typeof value === "bigint");
            const row = store.get(commitId);
            if (!row) return 0;
            row.spentUsdc = row.spentUsdc - amount > 0n ? row.spentUsdc - amount : 0n;
            return 1;
        },
        meteredVault: {
            findUnique: async () => null,
        },
    };

    return { store, prisma };
}

/* Distinct bytes per call. The sibling suite pins randomBytes to a constant, which is fine there but
   would make every rotation produce the ID it just replaced. */
function countingRandomBytes() {
    let counter = 0;
    return (size) => {
        counter += 1;
        return Buffer.alloc(size, counter);
    };
}

function compileInVm(tsSource, fileName, resolve) {
    const compiled = ts.transpileModule(tsSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName,
    }).outputText;

    const testModule = { exports: {} };
    const context = vm.createContext({ console, process, BigInt, Date, Error, RegExp, Map, Set, Buffer });
    const wrapper = vm.runInContext(
        `(function (require, module, exports) { ${compiled}\n })`,
        context,
        { filename: `${fileName}.cjs` },
    );
    wrapper(resolve, testModule, testModule.exports);
    return testModule.exports;
}

function loadModules(rows) {
    const { store, prisma } = makeStore(rows);
    const randomBytes = countingRandomBytes();

    const commitId = compileInVm(source("src/lib/commitId.ts"), "commitId.ts", (specifier) => {
        if (specifier === "crypto") return { randomBytes };
        if (specifier === "@/lib/prisma") return { prisma };
        if (specifier === "@/lib/identityDisplay") return { accountDisplayName: (_a, b) => b };
        throw new Error(`Unexpected import: ${specifier}`);
    });

    const accountHalt = compileInVm(source("src/lib/accountHalt.ts"), "accountHalt.ts", (specifier) => {
        if (specifier === "@/lib/prisma") return { prisma };
        /* Only haltGuard touches NextResponse, and nothing here exercises it. */
        if (specifier === "next/server") return { NextResponse: { json: (body, init) => ({ body, init }) } };
        throw new Error(`Unexpected import: ${specifier}`);
    });

    return { ...commitId, accountHalt, store };
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
    haltedAt: null,
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
        haltedAt: null,
        ...overrides,
    };
}

/* A second root with its own delegate, so "cannot touch a sibling" is tested against a row that
   really is owned by somebody else rather than one that merely does not exist. */
const OTHER_PARENT = {
    ...PARENT,
    id: "cmt_other0000",
    commitId: "cmt_other0000",
    walletAddress: "0xother",
    displayName: "Other parent",
};

function otherChild(overrides = {}) {
    return child({
        id: "cmt_child00b",
        commitId: "cmt_child00b",
        walletAddress: "0xchildb",
        parentCommitId: OTHER_PARENT.id,
        displayName: "Other child",
        ...overrides,
    });
}

/* ----------------------------- Rotation ----------------------------------- */

test("rotation preserves the cap and the spend ledger", async () => {
    const lib = loadModules([PARENT, child({ spentUsdc: 40n, spendLimitUsdc: 100n })]);

    const { previousCommitId, subUser } = await lib.rotateSubUserCommitId("0xparent", "cmt_child00a");

    assert.equal(previousCommitId, "cmt_child00a");
    assert.notEqual(subUser.commitId, "cmt_child00a");
    /* The identity the ledger hangs off is the row id, which rotation must not touch. */
    assert.equal(subUser.id, "cmt_child00a");
    assert.equal(subUser.spentUsdc, 40n);
    assert.equal(subUser.spendLimitUsdc, 100n);
    assert.equal(subUser.parentCommitId, PARENT.id);
    assert.equal(subUser.status, "ACTIVE");
    assert.ok(subUser.commitIdRotatedAt instanceof Date);
});

test("the old commit ID stops resolving the moment it is rotated", async () => {
    const lib = loadModules([PARENT, child({ spentUsdc: 40n })]);

    const before = await lib.validateSubUserCanSpend("cmt_child00a", 10n);
    assert.equal(before.allowed, true);

    const { subUser } = await lib.rotateSubUserCommitId("0xparent", "cmt_child00a");

    /* No grace window. The old ID is not "expiring soon", it is unknown. */
    const after = await lib.validateSubUserCanSpend("cmt_child00a", 10n);
    assert.equal(after.allowed, false);
    assert.equal(after.reason, "Unknown commit ID");

    const viaNewId = await lib.validateSubUserCanSpend(subUser.commitId, 10n);
    assert.equal(viaNewId.allowed, true);
    /* Cap arithmetic continues from the ledger, so 100 - 40 - 10 remains. */
    assert.equal(viaNewId.remainingUsdc, 50n);
});

test("a delegate cannot rotate a sibling, and one parent cannot rotate another's delegate", async () => {
    const lib = loadModules([PARENT, child(), OTHER_PARENT, otherChild()]);

    /* The delegate presenting its own wallet as the parent address. requireOwnedSubUser proves
       authority by the parent owning the target's parent_commit_id, so holding a commit ID is not
       enough. */
    await assert.rejects(
        () => lib.rotateSubUserCommitId("0xchild", "cmt_child00b"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 404,
    );
    /* A different root, which does own delegates, still cannot reach into this one's. */
    await assert.rejects(
        () => lib.rotateSubUserCommitId("0xother", "cmt_child00a"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 404,
    );

    /* Neither attempt changed anything. */
    assert.ok(lib.store.has("cmt_child00a"));
    assert.ok(lib.store.has("cmt_child00b"));
});

test("a revoked delegation cannot be handed a working credential", async () => {
    const lib = loadModules([PARENT, child({ status: "REVOKED", revokedAt: new Date() })]);

    await assert.rejects(
        () => lib.rotateSubUserCommitId("0xparent", "cmt_child00a"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 409,
    );
});

/* ----------------------------- Self-halt ---------------------------------- */

test("halting a root cascades to its delegates", async () => {
    const lib = loadModules([PARENT, child()]);

    const before = await lib.recordSubUserSpend("cmt_child00a", 10n);
    assert.equal(before.allowed, true);

    const halted = await lib.haltOwnAccount("0xparent");
    assert.equal(halted.status, "HALTED");
    assert.ok(halted.haltedAt instanceof Date);

    /* Nothing was written to the child. The cascade is a consequence of findInactiveAncestor and the
       atomic debit both testing `status <> 'ACTIVE'`. */
    assert.equal(lib.store.get("cmt_child00a").status, "ACTIVE");

    const preflight = await lib.validateSubUserCanSpend("cmt_child00a", 10n);
    assert.equal(preflight.allowed, false);
    assert.equal(preflight.reason, "The parent account is not active");

    const debit = await lib.recordSubUserSpend("cmt_child00a", 10n);
    assert.equal(debit.allowed, false);
    /* The ledger did not move past the pre-halt spend. */
    assert.equal(lib.store.get("cmt_child00a").spentUsdc, 10n);

    /* And the delegate cannot fund a send off the halted parent either. */
    await assert.rejects(
        () => lib.resolveSpendingAuthority("0xchild"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 403,
    );
});

test("a halted root cannot spend its own balance, and resuming restores both levels", async () => {
    const lib = loadModules([PARENT, child()]);
    await lib.haltOwnAccount("0xparent");

    /* Roots are uncapped, so the status check has to run BEFORE the "roots pass" shortcut or the
       account holder's own brake is ignored. */
    const rootPreflight = await lib.validateSubUserCanSpend("cmt_parent000", 10n);
    assert.equal(rootPreflight.allowed, false);
    assert.equal(rootPreflight.reason, "This account is on hold");

    await assert.rejects(
        () => lib.resolveSpendingAuthority("0xparent"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 403,
    );

    const resumed = await lib.resumeOwnAccount("0xparent");
    assert.equal(resumed.status, "ACTIVE");
    assert.equal(resumed.haltedAt, null);

    assert.equal((await lib.validateSubUserCanSpend("cmt_child00a", 10n)).allowed, true);
    assert.equal((await lib.resolveSpendingAuthority("0xchild")).delegated, true);
});

test("a delegate cannot halt anything, and revocation stays terminal", async () => {
    const lib = loadModules([PARENT, child(), OTHER_PARENT, otherChild({ status: "REVOKED", revokedAt: new Date() })]);

    /* requireRootCommit refuses a delegated identity, so a capped sub-user cannot present itself as
       an account and stop its parent's money. */
    await assert.rejects(
        () => lib.haltOwnAccount("0xchild"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 403,
    );
    assert.equal(lib.store.get("cmt_parent000").status, "ACTIVE");

    /* Resume is not a way back from REVOKED. */
    await assert.rejects(
        () => lib.resumeOwnAccount("0xparent"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 409,
    );

    await assert.rejects(
        () => lib.resumeSubUser("0xother", "cmt_child00b"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 409,
    );
});

test("a claimed invite cannot be taken up while the parent is on hold", async () => {
    const lib = loadModules([PARENT, child({ walletAddress: null })]);
    await lib.haltOwnAccount("0xparent");

    /* Claiming grants new spending authority, which is exactly what a hold refuses. */
    await assert.rejects(
        () => lib.claimSubUser("0xnewcomer", "cmt_child00a"),
        (error) => error.name === "CommitAccessError",
    );
});

/* ----------------------------- The halt read gate ------------------------- */

test("the halt gate reads the root commit and ignores delegated rows", async () => {
    const lib = loadModules([PARENT, child()]);
    const { getAccountHalt, isAccountHalted } = lib.accountHalt;

    assert.equal(await getAccountHalt("0xparent"), null);
    assert.equal(await isAccountHalted("0xparent"), false);

    await lib.haltOwnAccount("0xparent");

    const halt = await getAccountHalt("0xparent");
    assert.ok(halt);
    assert.equal(halt.walletAddress, "0xparent");
    assert.ok(halt.haltedAt);

    /* A delegate's wallet_address is on a child row. A paused delegate is not a halted account, and
       reading one as if it were would freeze the wrong person. */
    assert.equal(await getAccountHalt("0xchild"), null);
    await lib.pauseSubUser("0xparent", "cmt_child00a");
    assert.equal(await getAccountHalt("0xchild"), null);

    /* A wallet with no commit row at all has never been halted. */
    assert.equal(await isAccountHalted("0xstranger"), false);
});

test("the halt gate fails closed when the status cannot be read", async () => {
    const lib = loadModules([PARENT]);
    const { AccountHaltError } = lib.accountHalt;

    /* Recompiled against a Prisma that throws, because a read failure has to block the spend rather
       than wave it through — the same asymmetry withdrawalHolds.ts argues for. */
    const broken = compileInVm(source("src/lib/accountHalt.ts"), "accountHalt.ts", (specifier) => {
        if (specifier === "@/lib/prisma") {
            return { prisma: { userCommit: { findUnique: async () => { throw new Error("connection lost"); } } } };
        }
        if (specifier === "next/server") return { NextResponse: { json: (body, init) => ({ body, init }) } };
        throw new Error(`Unexpected import: ${specifier}`);
    });

    await assert.rejects(
        () => broken.assertAccountNotHalted("0xparent"),
        (error) => error.name === "AccountHaltError" && error.status === 503,
    );
    /* The keeper-facing boolean fails the same direction: unknown means do not charge. */
    assert.equal(await broken.isAccountHalted("0xparent"), true);
    assert.ok(AccountHaltError);
});

/* ----------------------------- Merchant protection ----------------------- */

test("a hold does not void an in-window commitment, and breaks one that has lapsed", async () => {
    const lib = loadModules([PARENT]);
    const { decideHaltedRenewal } = lib.accountHalt;

    const now = new Date("2026-08-21T00:00:00.000Z");
    const inWindow = new Date("2026-09-01T00:00:00.000Z");
    const lapsed = new Date("2026-08-01T00:00:00.000Z");

    /* No hold: the decision is not the keeper's business at all. Asserted field by field rather than
       with deepEqual, because the object is built inside the VM realm and so is never
       reference-equal to a literal made out here. */
    const unheld = await decideHaltedRenewal({ subscriberAddress: "0xparent", minCommitmentUntil: inWindow, now });
    assert.equal(unheld.halted, false);
    assert.equal(unheld.action, undefined);

    await lib.haltOwnAccount("0xparent");

    /* Inside the window the subscriber authorized at subscribe time, the charge still runs. Halting
       must not become a way to consume a committed term and then refuse to pay for it. */
    const running = await decideHaltedRenewal({ subscriberAddress: "0xparent", minCommitmentUntil: inWindow, now });
    assert.equal(running.halted, true);
    assert.equal(running.action, "charge");
    assert.equal(running.commitmentUntil.toISOString(), inWindow.toISOString());

    /* Window closed: nothing holds the charge open, so it is refused and the merchant is told. */
    const broken = await decideHaltedRenewal({ subscriberAddress: "0xparent", minCommitmentUntil: lapsed, now });
    assert.equal(broken.halted, true);
    assert.equal(broken.action, "break");

    /* The ordinary case, with no commitment ever promised, breaks immediately. */
    const noWindow = await decideHaltedRenewal({ subscriberAddress: "0xparent", minCommitmentUntil: null, now });
    assert.equal(noWindow.halted, true);
    assert.equal(noWindow.action, "break");
    assert.equal(noWindow.commitmentUntil, null);
});

/* ----------------------------- Read access survives a hold --------------- */

/* Source-level, in the style of src/lib/admin/__tests__/hardening.test.mjs. A hold is a spend gate,
   and the way to keep it one is to prove it was never wired into the paths that let a frozen account
   answer questions about itself. A unit test cannot show the absence of a gate; reading the source
   can. */
test("a hold gates spending only, never sign-in or reading", () => {
    const auth = source("src/lib/auth.ts");
    const notifications = source("src/app/api/notifications/route.ts");
    const subscriptionsRead = source("src/app/api/user/subscriptions/route.ts");
    const cancel = source("src/app/api/user/subscription/cancel/route.ts");
    const vaultCancel = source("src/app/api/user/vault/cancel-service/route.ts");
    const pause = source("src/app/api/user/commit/sub-users/pause/route.ts");
    const revoke = source("src/app/api/user/commit/sub-users/revoke/route.ts");

    /* Session issuing and verification: a ban belongs there, a hold does not. Gating sign-in would
       stop a held user explaining what happened, which is the failure mode the withdrawalHolds.ts
       header calls out. */
    assert.doesNotMatch(auth, /accountHalt|assertAccountNotHalted|haltGuard|HALTED/);
    assert.match(auth, /banned_accounts/);

    /* Reads stay open. */
    for (const [name, text] of [["notifications", notifications], ["subscriptions", subscriptionsRead]]) {
        assert.doesNotMatch(text, /accountHalt|assertAccountNotHalted|haltGuard/, `${name} must not be halt-gated`);
    }

    /* So do the paths that reduce outflow. Refusing these would trap the user in the state they were
       trying to leave. */
    for (const [name, text] of [
        ["subscription cancel", cancel],
        ["vault cancel-service", vaultCancel],
        ["sub-user pause", pause],
        ["sub-user revoke", revoke],
    ]) {
        assert.doesNotMatch(text, /accountHalt|assertAccountNotHalted|haltGuard/, `${name} must not be halt-gated`);
    }
});

test("every outbound-money path this change covers carries the gate", () => {
    const gated = [
        /* The caller's own wallet or escrow. */
        "src/app/api/user/wallet/send/route.ts",
        "src/app/api/user/subscription/subscribe/route.ts",
        "src/app/api/user/subscription/upgrade/route.ts",
        "src/app/api/user/subscription/change/route.ts",
        "src/app/api/user/subscription/resume/route.ts",
        "src/app/api/user/payment-links/[id]/pay/route.ts",
        "src/app/api/execute-tx/route.ts",
        "src/app/api/user/vault/commit/route.ts",
        "src/app/api/user/vault/shares/route.ts",
        "src/app/api/user/vault/auto-topup/route.ts",
        "src/app/api/user/commit/sub-users/route.ts",
        /* Batch payouts out of an organization's wallet. */
        "src/app/api/merchant/payroll/route.ts",
        "src/app/api/merchant/payroll/permit-sign/route.ts",
        "src/app/api/internal/payroll/route.ts",
        /* Unattended jobs. */
        "src/app/api/keeper/vault-topup/route.ts",
        "src/app/api/keeper/vault-draw/route.ts",
        "src/app/api/cron/customer-billing/route.ts",
        "src/app/api/user/vault/report-usage/route.ts",
    ];
    for (const path of gated) {
        assert.match(source(path), /@\/lib\/accountHalt/, `${path} must import the halt gate`);
    }

    /* Action-scoped gates, where a blanket one would block a brake. Payroll PUT carries PAUSE
       alongside RESUME and UPDATE_PERMIT, and a held organization must still be able to pause. */
    const payroll = source("src/app/api/merchant/payroll/route.ts");
    assert.match(payroll, /action === "RESUME" \|\| action === "UPDATE_PERMIT"/);

    /* execute-tx keeps the withdrawal hold ahead of the account hold in both branches, so the
       operator-placed freeze is still the first thing that answers. */
    const executeTx = source("src/app/api/execute-tx/route.ts");
    assert.ok(
        executeTx.indexOf('assertWithdrawalAllowed(wallet, "MERCHANT")')
            < executeTx.indexOf("assertAccountNotHalted(wallet)"),
    );

    /* The upgrade preview is a read, so only POST is gated. If the guard ever moves into the shared
       auth helper it would start refusing GET too. */
    const upgrade = source("src/app/api/user/subscription/upgrade/route.ts");
    assert.doesNotMatch(
        upgrade.slice(upgrade.indexOf("async function requireSubscriber"), upgrade.indexOf("export async function GET")),
        /haltGuard/,
    );

    /* Rotation must not have quietly acquired a grace window, and the ID format must be untouched. */
    const commitId = source("src/lib/commitId.ts");
    assert.match(commitId, /COMMIT_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"/);
    assert.match(commitId, /COMMIT_ID_BODY_LENGTH = 10/);
    assert.match(commitId, /THE OLD ID STOPS WORKING THE MOMENT THIS RETURNS/);
});

test("a delegate is refused the account hold endpoint rather than told it is not on hold", async () => {
    const lib = loadModules([PARENT, child()]);

    /* requireRootCommit is what GET and both mutations lean on. Answering a delegate with their own
       child row would report "not on hold" to someone whose root may well be halted. */
    await assert.rejects(
        () => lib.requireRootCommit("0xchild"),
        (error) => error.name === "CommitAccessError" && error.httpStatus === 403,
    );

    const root = await lib.requireRootCommit("0xparent");
    assert.equal(root.id, PARENT.id);

    const halt = source("src/app/api/user/commit/halt/route.ts");
    assert.match(halt, /requireRootCommit\(walletAddress\)/);
    /* Calling getOrCreateCommitForWallet would resolve a delegate's own row and defeat the refusal.
       Matched with the paren so the route's comment naming it stays allowed. */
    assert.doesNotMatch(halt, /getOrCreateCommitForWallet\(/);
    /* The write proves authority before anything is summarised, so a delegate triggers no reads.
       Sliced to POST: GET legitimately summarises before POST's body appears in the file. */
    const postBlock = halt.slice(
        halt.indexOf("export async function POST"),
        halt.indexOf("export async function DELETE"),
    );
    assert.ok(postBlock.length > 0);
    assert.ok(
        postBlock.indexOf("haltOwnAccount(walletAddress)") < postBlock.indexOf("summarizeExposure("),
    );
});
