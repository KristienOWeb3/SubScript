import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sponsorshipSource = readFileSync(new URL("../sponsorship.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
    new URL("../../../../supabase/migrations/20260717010000_sponsored_gas_operations.sql", import.meta.url),
    "utf8",
);
const wallet = "0x3333333333333333333333333333333333333333";

function parseUnits(value, decimals) {
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
        throw new Error("invalid decimal value");
    }
    const [whole, fraction = ""] = value.split(".");
    if (fraction.length > decimals) throw new Error("too many decimals");
    return BigInt(whole) * (BigInt(10) ** BigInt(decimals))
        + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

/**
 * Load sponsorship.ts in an isolated VM with scripted collaborators.
 * `claims` is a queue of outcomes the claim RPC returns in order.
 */
function loadSponsorshipModule({
    custodyRow,
    claims,
    accountType = "SCA",
    balance = parseUnits("1", 18),
    transferOutcome,
    confirmByHash = async () => false,
    sponsorEnabled = true,
    updateOutcomes = [],
}) {
    const calls = { transfers: [], updates: [], claims: [], custodyLookups: 0, confirmLookups: [] };
    const claimQueue = [...claims];
    const updateQueue = [...updateOutcomes];
    const preparedHash = "0x" + "ab".repeat(32);
    const preparedTransaction = "0x02abcdef";

    const compiled = ts.transpileModule(sponsorshipSource, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: "sponsorship.ts",
    }).outputText;
    const testModule = { exports: {} };
    const context = vm.createContext({
        console: { error() {}, log() {}, warn() {} },
        process,
        setTimeout,
    });
    const wrapper = vm.runInContext(
        `(function (require, module, exports) { ${compiled}\n })`,
        context,
        { filename: "sponsorship.test.cjs" },
    );
    wrapper((specifier) => {
        if (specifier === "ethers") {
            return { ethers: { isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value), parseUnits } };
        }
        if (specifier === "@/lib/serverPg") {
            return {
                pgMaybeOne: async (sql, params) => {
                    if (sql.includes("select circle_wallet_id")) {
                        calls.custodyLookups++;
                        return custodyRow;
                    }
                    if (sql.includes("claim_sponsored_gas_operation")) {
                        calls.claims.push(params);
                        const next = claimQueue.shift();
                        if (!next) throw new Error("unexpected extra claim");
                        if (next instanceof Error) throw next;
                        return { result: next };
                    }
                    if (sql.includes("update_sponsored_gas_operation")) {
                        calls.updates.push(params);
                        const next = updateQueue.shift();
                        if (next instanceof Error) throw next;
                        return { result: { outcome: next || "UPDATED" } };
                    }
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            };
        }
        if (specifier === "@/lib/payments/rpc") {
            return {
                executeWithRpcFallback: async (operation) => ({
                    result: await operation({ getBalance: async () => balance }),
                    rpcEndpoint: "mock://rpc",
                }),
            };
        }
        if (specifier === "@/lib/circle/devWallets") {
            return { configuredAccountType: () => accountType };
        }
        if (specifier === "@/lib/sponsor/gas") {
            return {
                isGasSponsorshipEnabled: () => sponsorEnabled,
                prepareSponsorTransfer: async (beneficiary, valueWei) => ({
                    outcome: "prepared",
                    txHash: preparedHash,
                    preparedTransaction,
                    beneficiary,
                    valueWei,
                }),
                submitPreparedSponsorTransfer: async (rawTransaction, txHash) => {
                    calls.transfers.push({ rawTransaction, txHash });
                    return transferOutcome || { outcome: "confirmed", txHash: preparedHash };
                },
                reconcileSponsorTransferByHash: async (hash) => {
                    calls.confirmLookups.push(hash);
                    return await confirmByHash(hash) ? "confirmed" : "pending";
                },
            };
        }
        throw new Error(`Unexpected import: ${specifier}`);
    }, testModule, testModule.exports);
    return { module: testModule.exports, calls };
}

const CIRCLE_ROW = { circle_wallet_id: "cw-1", encrypted_private_key: null };
const LEGACY_ROW = { circle_wallet_id: null, encrypted_private_key: "enc" };

test("Circle SCA wallets resolve through Gas Station with no direct sponsor transfer", async () => {
    const { module, calls } = loadSponsorshipModule({
        custodyRow: CIRCLE_ROW,
        accountType: "SCA",
        claims: [{ outcome: "GAS_STATION" }],
    });
    const result = await module.ensureSponsoredGas({ wallet, action: "vault_commit", requestKey: "vault-commit:test-1" });
    assert.equal(result.sponsored, true);
    assert.equal(result.method, "gas_station");
    assert.equal(calls.transfers.length, 0, "no SPONSOR_PRIVATE_KEY transfer may reach an SCA wallet");
    assert.equal(calls.claims[0][3], "CIRCLE_SCA");
    assert.equal(calls.claims[0][4], "0", "gas-station records consume no budget");
});

test("custody is detected server-side; unknown wallets are never sponsored", async () => {
    const { module, calls } = loadSponsorshipModule({ custodyRow: null, claims: [] });
    const result = await module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-2" });
    assert.equal(result.sponsored, false);
    assert.equal(result.reason, "not_custodial");
    assert.equal(calls.transfers.length, 0);
    assert.equal(calls.custodyLookups, 1);
});

test("legacy EOA wallets receive one bounded, durably recorded top-up", async () => {
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
    });
    const result = await module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-3" });
    assert.equal(result.sponsored, true);
    assert.equal(result.method, "sponsor_topup");
    assert.equal(calls.transfers.length, 1);
    /* Terminal state recorded with the transfer hash. */
    assert.equal(calls.updates.length, 2);
    assert.equal(calls.updates[0][2], "PREPARED");
    assert.equal(calls.updates[0][3], "0x" + "ab".repeat(32));
    assert.equal(calls.updates[0][6], "0x02abcdef");
    assert.equal(calls.updates[1][2], "CONFIRMED");
});

test("the top-up is the bounded deficit, never a fixed amount on top of principal", async () => {
    /* Wallet holds principal + half the gas target: only the missing half is sponsored. */
    const principal = parseUnits("5", 18);
    const halfTarget = parseUnits("0.05", 18);
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        balance: principal + halfTarget,
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
    });
    const result = await module.ensureSponsoredGas({
        wallet, action: "vault_commit", requestKey: "vault-commit:test-4",
        principalRequiredWei: principal,
    });
    assert.equal(result.sponsored, true);
    assert.equal(calls.claims[0][4], halfTarget.toString());
});

test("a wallet already holding gas beyond its principal is not topped up at all", async () => {
    const principal = parseUnits("5", 18);
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        balance: principal + parseUnits("0.5", 18),
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
    });
    const result = await module.ensureSponsoredGas({
        wallet, action: "vault_commit", requestKey: "vault-commit:test-5",
        principalRequiredWei: principal,
    });
    assert.equal(result.sponsored, true);
    assert.equal(result.method, "sufficient_balance");
    assert.equal(calls.transfers.length, 0);
    assert.equal(calls.updates[0][2], "SKIPPED_SUFFICIENT_BALANCE");
});

test("a receipt timeout never sends another top-up; the retry reconciles by hash", async () => {
    const hash = "0x" + "cd".repeat(32);
    const first = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
        transferOutcome: { outcome: "submitted_unconfirmed", txHash: hash },
    });
    const ambiguous = await first.module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-6" });
    assert.equal(ambiguous.sponsored, false);
    assert.equal(ambiguous.ambiguous, true);
    assert.equal(ambiguous.txHash, hash);
    assert.equal(first.calls.updates[0][2], "PREPARED");
    assert.equal(first.calls.updates[1][2], "SUBMITTED");

    /* A different serverless instance retries: the durable record answers RECONCILE. */
    const second = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "RECONCILE", leaseToken: "lease-2", sponsorTxHash: hash }],
        confirmByHash: async () => true,
    });
    const reconciled = await second.module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-6" });
    assert.equal(reconciled.sponsored, true);
    assert.equal(reconciled.method, "reused_topup");
    assert.equal(reconciled.txHash, hash);
    assert.equal(second.calls.transfers.length, 0, "reconciliation must never rebroadcast");
});

test("cross-instance retries reuse the durable record instead of sending again", async () => {
    const hash = "0x" + "ef".repeat(32);
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "REUSED", status: "CONFIRMED", sponsorTxHash: hash }],
    });
    const result = await module.ensureSponsoredGas({ wallet, action: "subscribe", requestKey: "subscribe-plan:test-7" });
    assert.equal(result.sponsored, true);
    assert.equal(result.txHash, hash);
    assert.equal(calls.transfers.length, 0);
});

test("daily wallet, action and global budget limits refuse sponsorship", async () => {
    for (const [outcome, reason] of [
        ["WALLET_LIMIT", "wallet_limit"],
        ["ACTION_LIMIT", "action_limit"],
        ["BUDGET_EXHAUSTED", "budget_exhausted"],
    ]) {
        const { module, calls } = loadSponsorshipModule({
            custodyRow: LEGACY_ROW,
            claims: [{ outcome }],
        });
        const result = await module.ensureSponsoredGas({ wallet, action: "vault_commit", requestKey: `vault-commit:test-8:${outcome}` });
        assert.equal(result.sponsored, false);
        assert.equal(result.reason, reason);
        assert.equal(calls.transfers.length, 0);
    }
});

test("concurrent same-instance attempts share one sponsorship", async () => {
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
    });
    const [a, b] = await Promise.all([
        module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-9" }),
        module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-9" }),
    ]);
    assert.deepEqual(a, b);
    assert.equal(calls.claims.length, 1);
    assert.equal(calls.transfers.length, 1);
});

test("requireSponsoredGas never claims funds were untouched while a transfer is ambiguous", async () => {
    const { module } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "RECONCILE", leaseToken: "lease-2", sponsorTxHash: "0x" + "11".repeat(32) }],
        confirmByHash: async () => false,
    });
    await assert.rejects(
        module.requireSponsoredGas({ wallet, action: "vault_commit", requestKey: "vault-commit:test-10" }),
        (error) => {
            assert.equal(error.name, "SponsoredGasError");
            assert.equal(error.kind, "ambiguous");
            assert.doesNotMatch(error.message, /funds were not touched/);
            assert.match(error.message, /do not submit a duplicate payment/i);
            return true;
        },
    );
});

test("an emergency stop refuses every sponsorship before any lookup", async () => {
    const original = process.env.SPONSOR_EMERGENCY_STOP;
    process.env.SPONSOR_EMERGENCY_STOP = "true";
    try {
        const { module, calls } = loadSponsorshipModule({ custodyRow: LEGACY_ROW, claims: [] });
        const result = await module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-11" });
        assert.equal(result.sponsored, false);
        assert.equal(result.reason, "emergency_stop");
        assert.equal(calls.custodyLookups, 0);
        assert.equal(calls.transfers.length, 0);
    } finally {
        if (original === undefined) delete process.env.SPONSOR_EMERGENCY_STOP;
        else process.env.SPONSOR_EMERGENCY_STOP = original;
    }
});

test("the durable claim enforces limits and lease semantics inside the database", () => {
    /* Cross-instance correctness lives in SQL, where every serverless instance meets. */
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public\.sponsored_gas_operations/);
    assert.match(migrationSource, /request_key TEXT NOT NULL UNIQUE/);
    assert.match(migrationSource, /pg_advisory_xact_lock/);
    assert.match(migrationSource, /'WALLET_LIMIT'/);
    assert.match(migrationSource, /'ACTION_LIMIT'/);
    assert.match(migrationSource, /'BUDGET_EXHAUSTED'/);
    assert.match(migrationSource, /'RECONCILE'/);
    assert.match(migrationSource, /SECURITY DEFINER/);
    assert.match(migrationSource, /SET search_path = ''/);
    assert.match(migrationSource, /REVOKE ALL ON TABLE public\.sponsored_gas_operations FROM PUBLIC, anon, authenticated/);
    /* Abuse-relevant statuses count toward daily limits; only real movement counts. */
    assert.match(migrationSource, /status IN \('PENDING', 'PREPARED', 'SUBMITTED', 'CONFIRMED'\)/);
    assert.match(migrationSource, /gas-sponsor:global-budget/);
    assert.match(migrationSource, /request_key IS DISTINCT FROM p_request_key/);
    assert.match(migrationSource, /v_existing\.custody_type IS DISTINCT FROM p_custody/);
    assert.match(migrationSource, /prepared_transaction/);
    /* A definitive revert is terminal but remains bound to the persisted transaction hash. */
    assert.match(migrationSource, /v_row\.status = 'FAILED' AND v_row\.sponsor_tx_hash IS NOT NULL/);
    assert.match(migrationSource, /HASH_CONFLICT/);
});

test("the signed transaction is durable before broadcast and persistence failure moves no funds", async () => {
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
        updateOutcomes: [new Error("database offline")],
    });

    await assert.rejects(
        module.ensureSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-prepared-gate" }),
        /database offline/,
    );
    assert.equal(calls.updates[0][2], "PREPARED");
    assert.equal(calls.transfers.length, 0, "broadcast must remain behind the durable PREPARED write");
});

test("a reverted prepared top-up is terminal and surfaced as a definitive sponsorship error", async () => {
    const hash = "0x" + "ab".repeat(32);
    const { module, calls } = loadSponsorshipModule({
        custodyRow: LEGACY_ROW,
        claims: [{ outcome: "CLAIMED", leaseToken: "lease-1" }],
        transferOutcome: { outcome: "reverted", txHash: hash },
    });

    await assert.rejects(
        module.requireSponsoredGas({ wallet, action: "execute_tx", requestKey: "execute-tx:test-revert" }),
        (error) => error.name === "SponsoredGasError"
            && error.kind === "definitive"
            && error.reason === "topup_reverted"
            && error.txHash === hash,
    );
    assert.equal(calls.updates.at(-1)[2], "FAILED");
    assert.equal(calls.updates.at(-1)[3], hash);
});

test("Gas Station sponsorship never succeeds when its durable terminal row cannot be recorded", async () => {
    const { module, calls } = loadSponsorshipModule({
        custodyRow: CIRCLE_ROW,
        accountType: "SCA",
        claims: [new Error("database offline")],
    });
    await assert.rejects(
        module.ensureSponsoredGas({ wallet, action: "vault_commit", requestKey: "vault-commit:test-sca-persist" }),
        /database offline/,
    );
    assert.equal(calls.transfers.length, 0);
});

test("financial routes sponsor gas strictly before submitting the financial transaction", () => {
    const vaultCommit = readFileSync(new URL("../../../app/api/user/vault/commit/route.ts", import.meta.url), "utf8");
    const subscribe = readFileSync(new URL("../../../app/api/user/subscription/subscribe/route.ts", import.meta.url), "utf8");
    const change = readFileSync(new URL("../../../app/api/user/subscription/change/route.ts", import.meta.url), "utf8");

    assert.ok(vaultCommit.indexOf("requireSponsoredGas") < vaultCommit.indexOf("commitFromEmbedded(wallet"),
        "vault commit sponsors before escrowing");
    assert.ok(subscribe.indexOf("requireSponsoredGas") < subscribe.indexOf("subscribeFromEmbedded("),
        "subscribe sponsors before charging");
    assert.match(change, /requireSponsoredGas\(\{/);
    assert.ok(change.indexOf("changeClaimKey = `subscription-change:${changeFingerprint}`")
        < change.indexOf("requestKey: `sponsor:${changeFingerprint}`"),
    "plan-change claim must precede sponsorship");
    /* An impossible commit cannot farm top-ups: the request key is bound to the exact
       (request, wallet, merchant, amount) identity, so repeats reuse one durable record and
       fresh keys are throttled by the per-action daily limit. */
    assert.match(vaultCommit, /const sponsorRequestKey = `vault-commit:\$\{requestId\}:\$\{normalizedWallet\}:\$\{normalizedMerchant\}:\$\{amount\.toString\(\)\}`/);
    assert.match(vaultCommit, /requestKey: sponsorRequestKey/);
});
