import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function loadVaultSharing(initialVault, initialCommits = []) {
    const vault = { ...initialVault };
    const commits = new Map(initialCommits.map((c) => [c.id || c.commitId, { ...c }]));

    const prisma = {
        meteredVault: {
            findUnique: async () => vault,
        },
        userCommit: {
            findFirst: async ({ where }) => {
                for (const row of commits.values()) {
                    if (row.vaultId === where.vaultId && row.parentCommitId === where.parentCommitId) {
                        return row;
                    }
                }
                return null;
            },
            findMany: async ({ where }) => {
                return [...commits.values()].filter(
                    (row) =>
                        row.vaultId === where.vaultId &&
                        row.parentCommitId === where.parentCommitId &&
                        (!where.status?.in || where.status.in.includes(row.status)),
                );
            },
            create: async ({ data }) => {
                const row = {
                    id: data.commitId,
                    commitId: data.commitId,
                    spentUsdc: 0n,
                    status: "ACTIVE",
                    parentCommitId: null,
                    spendLimitUsdc: null,
                    createdAt: new Date(),
                    ...data,
                };
                commits.set(row.commitId, row);
                return row;
            },
        },
    };

    const commitIdTs = source("src/lib/commitId.ts");
    const vaultSharingTs = source("src/lib/vaultCommitSharing.ts");

    const compiledCommitId = ts.transpileModule(commitIdTs, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    const compiledSharing = ts.transpileModule(vaultSharingTs, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    const context = vm.createContext({
        console,
        BigInt,
        Math,
        Date,
        TypeError,
        Error,
        process,
        crypto,
        exports: {},
        module: { exports: {} },
        require: (specifier) => {
            if (specifier === "crypto" || specifier === "node:crypto") {
                const c = { ...crypto, default: crypto };
                return c;
            }
            if (specifier === "@/lib/prisma") return { prisma };
            if (specifier === "@/lib/identityDisplay") return { accountDisplayName: (x) => x.displayName || x.walletAddress };
            if (specifier === "@/lib/commitId") {
                const commitIdExports = {};
                const commitIdModule = { exports: commitIdExports };
                const commitIdFn = vm.runInContext(
                    `(function(exports, module, require){ ${compiledCommitId} })`,
                    context,
                );
                commitIdFn(commitIdExports, commitIdModule, context.require);
                return commitIdModule.exports;
            }
            throw new Error(`Unhandled import in test: ${specifier}`);
        },
    });

    const sharingFn = vm.runInContext(
        `(function(exports, module, require){ ${compiledSharing} })`,
        context,
    );
    const moduleObj = { exports: {} };
    sharingFn(moduleObj.exports, moduleObj, context.require);
    return { ...moduleObj.exports, vault, commits };
}

test("unallocatedUsdc accounts for accrued vault usage", async () => {
    const vault = {
        id: "v_123",
        userAddress: "0xPrimary",
        balanceUsdc: 2_000_000n, // 2.0 USDC committed
        accruedUsageUsdc: 1_500_000n, // 1.5 USDC already used by primary
    };

    const lib = loadVaultSharing(vault, [
        { id: "root_1", commitId: "cmt_root_1", vaultId: "v_123", parentCommitId: null, status: "ACTIVE" },
    ]);

    const result = await lib.listVaultShares("0xPrimary", "v_123");
    assert.equal(result.escrowUsdc, 2_000_000n);
    assert.equal(result.allocatedUsdc, 0n);
    // Unallocated USDC must be 2.0 - 1.5 = 0.5 USDC (500,000 micros), NOT 2.0 USDC!
    assert.equal(result.unallocatedUsdc, 500_000n);
});

test("createVaultShare prevents assigning a cap greater than unallocated escrow after usage", async () => {
    const vault = {
        id: "v_123",
        userAddress: "0xPrimary",
        balanceUsdc: 2_000_000n, // 2.0 USDC committed
        accruedUsageUsdc: 1_500_000n, // 1.5 USDC already used
    };

    const lib = loadVaultSharing(vault, [
        { id: "root_1", commitId: "cmt_root_1", vaultId: "v_123", parentCommitId: null, status: "ACTIVE" },
    ]);

    // Attempting to assign 2.0 USDC cap must fail because only 0.5 USDC is available unallocated
    await assert.rejects(
        () =>
            lib.createVaultShare({
                userAddress: "0xPrimary",
                vaultId: "v_123",
                displayName: "Alice",
                spendLimitUsdc: 2_000_000n,
            }),
        /At most 0.5 USDC is still unassigned/i,
    );

    // Assigning 0.5 USDC cap (500,000 micros) succeeds
    const share = await lib.createVaultShare({
        userAddress: "0xPrimary",
        vaultId: "v_123",
        displayName: "Alice",
        spendLimitUsdc: 500_000n,
    });
    assert.equal(share.spendLimitUsdc, 500_000n);
});
