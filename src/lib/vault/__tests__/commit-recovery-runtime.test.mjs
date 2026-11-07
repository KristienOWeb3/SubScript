import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { ethers } from "ethers";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../../../../", import.meta.url);
const wallet = "0x1111111111111111111111111111111111111111";
const merchant = "0x2222222222222222222222222222222222222222";
const vault = "0x3333333333333333333333333333333333333333";
const token = "0x4444444444444444444444444444444444444444";
const hash = `0x${"a".repeat(64)}`;
const approvalHash = `0x${"b".repeat(64)}`;
const constants = { SUBSCRIPT_VAULT_ADDRESS: vault, SUBSCRIPT_VAULT_CHAIN_ID: 5042, ARC_MAINNET_CHAIN_ID: 5042, USDC_NATIVE_GAS_ADDRESS: token };
function load(path, modules, extra = {}) {
    const compiled = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const context = vm.createContext({ module: { exports: {} }, exports: {}, require: name => {
        assert.ok(name in modules, `Missing test module ${name}`); return modules[name];
    }, Request, Response, Headers, URL, Date, BigInt, setTimeout, clearTimeout, AbortSignal,
    console: { error() {} }, ...extra });
    context.exports = context.module.exports;
    vm.runInContext(compiled, context);
    return context.module.exports;
}
function commitReceipt({ wrongMerchant = false, innerFailed = false } = {}) {
    const abi = new ethers.Interface([
        "event Transfer(address indexed from,address indexed to,uint256 value)",
        "event Committed(address indexed user,address indexed merchant,uint256 amount,uint256 balance,uint256 owedCleared,bool active)",
        "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
    ]);
    const log = (address, event, args) => ({ address, ...abi.encodeEventLog(abi.getEvent(event), args) });
    return { status: 1, logs: [log(token, "Transfer", [wallet, vault, 2_000_000n]),
        log(vault, "Committed", [wallet, wrongMerchant ? token : merchant, 2_000_000n, 2_000_000n, 0, true]),
        ...(innerFailed ? [log(vault, "UserOperationEvent", [hash, wallet, token, 0, false, 0, 0])] : [])] };
}
const camel = name => name.replace(/_([a-z])/g, (_all, letter) => letter.toUpperCase());
const snake = name => name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const rowObject = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), key === "chain_id" && value !== null ? BigInt(value) : value]));
async function fixture() {
    const db = new PGlite();
    await db.exec("create role anon;create role authenticated;create role service_role;");
    await db.exec(readFileSync(new URL("supabase/migrations/20260717040000_vault_commit_intents.sql", root), "utf8"));
    await db.exec(readFileSync(new URL("supabase/migrations/20261016094128_vault_commit_recovery.sql", root), "utf8"));
    await db.exec("create table user_embedded_wallets(wallet_address text,circle_wallet_id text); insert into user_embedded_wallets values('" + wallet + "','owned-wallet');");
    const query = async (sql, params = []) => (await db.query(sql, params)).rows;
    const store = {
        findUnique: async ({ where }) => rowObject((await query("select * from vault_commit_intents where request_id=$1", [where.requestId]))[0]),
        create: async ({ data }) => {
            const entries = Object.entries(data);
            const rows = await query(`insert into vault_commit_intents(${entries.map(([key]) => snake(key)).join(",")}) values(${entries.map((_, i) => `$${i + 1}`).join(",")}) returning *`, entries.map(([, value]) => typeof value === "bigint" ? value.toString() : value));
            return rowObject(rows[0]);
        },
        updateMany: async ({ where, data }) => {
            const args = [], terms = [];
            for (const [key, value] of Object.entries(where)) {
                if (value === null) terms.push(`${snake(key)} is null`);
                else if (value && typeof value === "object" && "in" in value) { args.push(value.in); terms.push(`${snake(key)}=any($${args.length}::text[])`); }
                else { args.push(value); terms.push(`${snake(key)}=$${args.length}`); }
            }
            const fields = Object.entries(data).map(([key, value]) => { args.push(value); return `${snake(key)}=$${args.length}`; });
            const rows = await query(`update vault_commit_intents set ${fields.join(",")},updated_at=now() where ${terms.join(" and ")} returning request_id`, args);
            return { count: rows.length };
        },
        findMany: async () => (await query("select * from vault_commit_intents where status in ('PENDING','SUBMITTED') order by updated_at limit 5")).map(rowObject),
    };
    const prisma = { vaultCommitIntent: store, meteredVault: { updateMany: async () => ({ count: 1 }) }, subscriptDm: { updateMany: async () => ({ count: 0 }) },
        merchant: { findUnique: async () => ({ tier: "FREE", verified: true }) } };
    const providerTransactions = new Map(), receipts = new Map(), submissions = new Map();
    let allowance = 50_000_000n, balance = 10_000_000n, balanceReads = 0, accepted = 0, approvalNeeded = false;
    let failMirror = false, providerOwner = "owned-wallet";
    const callbacks = [];
    const submit = async (phase, key, onSubmitted) => {
        const identity = `${phase}:${key}`;
        let id = submissions.get(identity);
        if (!id) { id = crypto.randomUUID(); submissions.set(identity, id); accepted++; }
        providerTransactions.set(id, { walletId: providerOwner, state: "SENT", ...(phase === "approval" ? { txHash: approvalHash } : {}) });
        await onSubmitted(id);
        return { circleTxId: id, txHash: "" };
    };
    const onchain = {
        readUsdcBalance: async () => { balanceReads++; return balance; },
        readUsdcAllowance: async () => allowance,
        readProvider: () => ({ getTransactionReceipt: async txHash => receipts.get(txHash) ?? null }),
        syncVaultMirror: async () => { if (failMirror) throw new Error("Mirror unavailable"); return { active: true, balance: 2_000_000n }; },
        submitVaultApproval: async (_wallet, _amount, key, callback) => approvalNeeded ? submit("approval", key, callback) : null,
        submitVaultCommit: async (_wallet, _merchant, _amount, key, callback) => submit("commit", key, callback),
    };
    const pg = { pgQuery: query, pgMaybeOne: async (sql, params) => (await query(sql, params))[0] ?? null };
    const receiptModule = load("src/lib/payments/settlementReceiptRecovery.ts", {
        "node:crypto": crypto, ethers: { ethers }, "@/lib/serverPg": pg, "@/lib/circle/devWallets": {},
        "@/lib/vault/onchain": {}, "@/lib/contracts/constants": constants,
        "@/lib/email/settlementReceipts": {}, "@/lib/email/core": {}, "@/lib/email/outbox": {},
        "@/lib/spendingLimits": {},
    });
    const settlement = { ...receiptModule, confirmSettlementReceiptJob: async () => {}, recordSettlementReceiptSubmission: async () => {},
        prepareSettlementReceiptJob: async () => "receipt-job", dispatchSettlementReceipts: async () => {} };
    const recovery = load("src/lib/vault/commitRecovery.ts", {
        ethers: { ethers }, "@/lib/prisma": { prisma }, "@/lib/serverPg": pg, "@/lib/contracts/constants": constants,
        "./onchain": onchain, "@/lib/circle/devWallets": { getDevWalletsClient: () => ({ getTransaction: async ({ id }) => ({ data: { transaction: providerTransactions.get(id) } }) }) },
        "@/lib/payments/settlementReceiptRecovery": settlement, "@/lib/events/recordMerchantEvent": { recordMerchantEvent: async () => {} },
    });
    class CirclePaymasterPolicyError extends Error {}
    const route = load("src/app/api/user/vault/commit/route.ts", {
        "@/lib/auth/financialPinPolicy": { financialPinContext() {} }, "@/lib/auth/transactionPin": { withTransactionPin: (_policy, handler) => handler },
        "@/lib/auth/financialAuthorizationContext": { assertAuthorizedMerchantDestination() {} },
        "next/server": { NextResponse: Response, after: callback => callbacks.push(callback) }, ethers: { ethers },
        "@/lib/auth": { getSessionWallet: async () => wallet }, "@/lib/accounts/roles": { requireAccountRole: async () => ({ ok: true }) },
        "@/lib/dms/system": { parseUsdcToMicros: value => ethers.parseUnits(value, 6) }, "@/utils/security": { sanitizeInput: value => value },
        "@/lib/vault/onchain": onchain, "@/lib/contracts/constants": constants, "@/lib/payments/settlementReceiptRecovery": settlement,
        "@/lib/custody": { deterministicIdempotencyKey: value => crypto.createHash("sha256").update(value).digest("hex"), CirclePaymasterPolicyError },
        "@/lib/sponsor/sponsorship": { requireSponsoredGas: async () => {}, isSponsoredGasError: () => false }, "@/lib/prisma": { prisma },
        "@/lib/network/registry": { assertFinancialNetworkReady() {} }, "@/lib/accountHalt": { haltGuard: async () => null },
        "@/lib/merchants/identity": { isCommitSlug: () => false }, "@/lib/kyc/tier": { getAccountKycTier: async () => ({ tier: 1 }) },
        "@/lib/vault/commitRecovery": recovery,
    });
    const seed = async (extra = {}) => store.create({ data: { requestId: "request-0001", userAddress: wallet, merchantAddress: merchant,
        amountUsdc: "2000000", custodyIdempotencyKey: "custody-key", environment: "LIVE", chainId: 5042n, contractAddress: vault, ...extra } });
    const post = () => route.POST(new Request("https://example.test/api/user/vault/commit", { method: "POST", headers: { "x-request-id": "request-0001" }, body: JSON.stringify({ merchantAddress: merchant, amountUsdc: "2" }) }));
    return { db, query, store, seed, post, route, recovery, receipts, providerTransactions, submissions,
        accepted: () => accepted, balanceReads: () => balanceReads,
        setBalance: value => { balance = value; }, setApproval: value => { approvalNeeded = value; }, setAllowance: value => { allowance = value; },
        failMirror: value => { failMirror = value; }, setProviderOwner: value => { providerOwner = value; }, close: () => db.close() };
}

test("POST accepts a mainnet commit with explicit provenance and returns recoverable202, without pretending confirmation", async () => {
    const f = await fixture(); try {
        const response = await f.post(); assert.equal(response.status, 202);
        const body = await response.json(); assert.equal(body.pending, true); assert.equal(body.success, false);
        const intent = await f.store.findUnique({ where: { requestId: "request-0001" } });
        assert.equal(intent.environment, "LIVE"); assert.equal(intent.chainId, 5042n); assert.ok(intent.commitProviderId);
        assert.ok(intent.requestStartedAt); assert.ok(intent.preflightCompletedAt); assert.ok(intent.submissionStartedAt); assert.ok(intent.submittedAt);
        assert.equal(intent.confirmedAt, null); assert.equal(intent.status, "PENDING"); assert.equal(f.accepted(), 1);
    } finally { await f.close(); }
});

test("independent GET recovers an accepted commit after request death, verifies its exact event, and never submits", async () => {
    const f = await fixture(); try {
        await f.post(); const before = f.accepted();
        const intent = await f.store.findUnique({ where: { requestId: "request-0001" } });
        f.providerTransactions.set(intent.commitProviderId, { walletId: "owned-wallet", state: "CONFIRMED", txHash: hash });
        f.receipts.set(hash, commitReceipt());
        const response = await f.route.GET(new Request("https://example.test/api/user/vault/commit?requestId=request-0001"));
        assert.equal((await response.json()).status, "MIRRORED"); assert.equal(f.accepted(), before);
        const completed = await f.store.findUnique({ where: { requestId: "request-0001" } });
        assert.ok(completed.confirmedAt); assert.ok(completed.mirroredAt); assert.equal(completed.txHash, hash);
        f.setBalance(0n); const reads = f.balanceReads();
        assert.equal((await f.post()).status, 200); assert.equal(f.balanceReads(), reads); assert.equal(f.accepted(), before);
    } finally { await f.close(); }
});

test("independent cron reconciliation recovers a pending mirror without another financial submission", async () => {
    const f = await fixture(); try {
        await f.seed({ commitProviderId: "accepted-commit", submittedAt: new Date() });
        f.providerTransactions.set("accepted-commit", { walletId: "owned-wallet", state: "CONFIRMED", txHash: hash }); f.receipts.set(hash, commitReceipt());
        f.failMirror(true); let result = await f.recovery.reconcileVaultCommitIntent("request-0001"); assert.equal(result.status, "SUBMITTED");
        const confirmedAt = result.confirmedAt;
        f.failMirror(false); await f.recovery.recoverVaultCommitIntents();
        result = await f.store.findUnique({ where: { requestId: "request-0001" } });
        assert.equal(result.status, "MIRRORED"); assert.equal(+new Date(result.confirmedAt), +new Date(confirmedAt)); assert.equal(f.accepted(), 0);
    } finally { await f.close(); }
});

test("approval acceptance is durable; a delayed approval needs fresh authorized continuation, while GET never signs", async () => {
    const f = await fixture(); try {
        f.setApproval(true); f.setAllowance(0n);
        assert.equal((await f.post()).status, 202); assert.equal(f.accepted(), 1);
        let row = await f.store.findUnique({ where: { requestId: "request-0001" } }); assert.ok(row.approvalProviderId); assert.equal(row.commitProviderId, null);
        f.receipts.set(approvalHash, { status: 1, logs: [] }); f.setAllowance(50_000_000n);
        row = await f.recovery.reconcileVaultCommitIntent("request-0001"); assert.ok(row.approvalConfirmedAt); assert.equal(f.accepted(), 1);
        assert.equal(f.recovery.commitIntentOutcome(row).resumeRequired, true);
        assert.equal((await f.post()).status, 202); assert.equal(f.accepted(), 2);
        assert.ok((await f.store.findUnique({ where: { requestId: "request-0001" } })).commitProviderId);
    } finally { await f.close(); }
});

for (const scenario of ["wrong merchant", "wrong provider owner", "inner revert"]) test(`chain evidence refuses ${scenario}`, async () => {
    const f = await fixture(); try {
        await f.seed({ commitProviderId: "accepted-commit", submittedAt: new Date() });
        f.providerTransactions.set("accepted-commit", { walletId: scenario === "wrong provider owner" ? "another-wallet" : "owned-wallet", state: "CONFIRMED", txHash: hash });
        f.receipts.set(hash, commitReceipt({ wrongMerchant: scenario === "wrong merchant", innerFailed: scenario === "inner revert" }));
        const result = await f.recovery.reconcileVaultCommitIntent("request-0001");
        assert.equal(result.status, scenario === "inner revert" ? "FAILED" : "PENDING"); assert.equal(result.confirmedAt, null); assert.equal(f.accepted(), 0);
    } finally { await f.close(); }
});

test("an acceptance-gap retry reuses the same custody key even if available balance was already debited", async () => {
    const f = await fixture(); try {
        await f.seed({ submissionStartedAt: new Date() }); f.setBalance(0n);
        assert.equal((await f.post()).status, 202); assert.equal(f.balanceReads(), 0);
        const row = await f.store.findUnique({ where: { requestId: "request-0001" } }); assert.ok(row.commitProviderId);
        assert.equal((await f.post()).status, 202); assert.equal(f.accepted(), 1);
    } finally { await f.close(); }
});

test("migration freezes intent identity/provider binding and never invents legacy latency observations", async () => {
    const f = await fixture(); try {
        await f.seed();
        await assert.rejects(f.query("update vault_commit_intents set amount_usdc=1 where request_id='request-0001'"), /identity cannot change/);
        await f.query("update vault_commit_intents set commit_provider_id='first' where request_id='request-0001'");
        await assert.rejects(f.query("update vault_commit_intents set commit_provider_id='second' where request_id='request-0001'"), /accepted identity cannot change/);
        const row = await f.store.findUnique({ where: { requestId: "request-0001" } }); assert.equal(row.confirmedAt, null); assert.equal(row.mirroredAt, null);
    } finally { await f.close(); }
});

const browser = load("src/lib/vault/commitIntentClient.ts", {});
function storageFixture() {
    const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
for (const reply of [null, { nonsense: true }, { exists: true, status: "UNKNOWN" }, { exists: true, status: "SUBMITTED" }, "malformed"]) {
    test(`client recovery keeps the durable id when resolution is unknown: ${JSON.stringify(reply)}`, async () => {
        const storage = storageFixture(), key = browser.commitRequestStorageKey(wallet, merchant, 5042); storage.setItem(key, "request-0001");
        const result = await browser.recoverCommitRequest(storage, key, "legacy", async () => reply === null ? Promise.reject(new Error("offline"))
            : reply === "malformed" ? new Response("not-json") : Response.json(reply));
        assert.equal(result.requestId, "request-0001"); assert.equal(result.outcome, null); assert.equal(storage.getItem(key), "request-0001");
    });
}
test("client storage scopes network/wallet/merchant and migrates a legacy id only after server ownership proof", async () => {
    const storage = storageFixture(), key = browser.commitRequestStorageKey(wallet, merchant, 5042);
    assert.notEqual(key, browser.commitRequestStorageKey(token, merchant, 5042)); assert.notEqual(key, browser.commitRequestStorageKey(wallet, merchant, 5042002));
    storage.setItem("legacy", "request-0001");
    await browser.recoverCommitRequest(storage, key, "legacy", async () => Response.json({ exists: false }));
    assert.equal(storage.getItem("legacy"), "request-0001"); assert.equal(storage.getItem(key), null);
    const result = await browser.recoverCommitRequest(storage, key, "legacy", async () => Response.json({ exists: true, status: "PENDING" }));
    assert.equal(result.requestId, "request-0001"); assert.equal(storage.getItem(key), "request-0001"); assert.equal(storage.getItem("legacy"), null);
});
