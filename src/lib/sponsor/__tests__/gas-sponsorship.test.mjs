import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const gasSource = readFileSync(new URL("../gas.ts", import.meta.url), "utf8");
const executeRouteSource = readFileSync(new URL("../../../app/api/execute-tx/route.ts", import.meta.url), "utf8");
const beneficiary = "0x1111111111111111111111111111111111111111";
const sponsorAddress = "0x2222222222222222222222222222222222222222";

function parseUnits(value, decimals) {
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
        throw new Error("invalid decimal value");
    }
    const [whole, fraction = ""] = value.split(".");
    if (fraction.length > decimals) throw new Error("too many decimals");
    return BigInt(whole) * (BigInt(10) ** BigInt(decimals))
        + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

function loadGasModule({ getProviderForWrite, sendTransaction }) {
    class MockWallet {
        constructor(key, provider) {
            if (key !== "valid-sponsor-key") throw new Error("invalid private key");
            this.key = key;
            this.provider = provider;
            this.address = sponsorAddress;
        }

        connect(provider) {
            return new MockWallet(this.key, provider);
        }

        sendTransaction(transaction) {
            return sendTransaction(transaction);
        }
    }

    const compiled = ts.transpileModule(gasSource, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: "gas.ts",
    }).outputText;
    const testModule = { exports: {} };
    const context = vm.createContext({
        console: { error() {} },
        process,
    });
    const wrapper = vm.runInContext(
        `(function (require, module, exports) { ${compiled}\n })`,
        context,
        { filename: "gas.test.cjs" },
    );
    wrapper((specifier) => {
        if (specifier === "ethers") {
            return {
                ethers: {
                    Wallet: MockWallet,
                    isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value),
                    parseUnits,
                },
            };
        }
        if (specifier === "@/lib/payments/rpc") {
            return { getRpcProviderForWrite: getProviderForWrite };
        }
        throw new Error(`Unexpected import: ${specifier}`);
    }, testModule, testModule.exports);
    return testModule.exports;
}

async function withSponsorEnvironment(run) {
    const originalKey = process.env.SPONSOR_PRIVATE_KEY;
    const originalTopup = process.env.SPONSOR_GAS_TOPUP_USDC;
    process.env.SPONSOR_PRIVATE_KEY = "valid-sponsor-key";
    process.env.SPONSOR_GAS_TOPUP_USDC = "0.10";
    try {
        await run();
    } finally {
        if (originalKey === undefined) delete process.env.SPONSOR_PRIVATE_KEY;
        else process.env.SPONSOR_PRIVATE_KEY = originalKey;
        if (originalTopup === undefined) delete process.env.SPONSOR_GAS_TOPUP_USDC;
        else process.env.SPONSOR_GAS_TOPUP_USDC = originalTopup;
    }
}

function confirmedTransaction(hash = "0xconfirmed") {
    return {
        hash,
        wait: async () => ({ hash, status: 1 }),
    };
}

test("an underfunded failure is not cached and the no-funds guarantee survives retry", async () => {
    await withSponsorEnvironment(async () => {
        let balanceChecks = 0;
        let sends = 0;
        const provider = {
            getBalance: async () => (++balanceChecks === 1 ? BigInt(0) : BigInt(1_000_000)),
        };
        const gas = loadGasModule({
            getProviderForWrite: async () => ({ provider }),
            sendTransaction: async () => {
                sends++;
                return confirmedTransaction();
            },
        });

        await assert.rejects(
            gas.requireGasSponsored(beneficiary),
            /No payment was submitted — your funds were not touched/,
        );
        const retry = await gas.ensureGasSponsored(beneficiary);

        assert.equal(retry.sponsored, true);
        assert.equal(sends, 1);
        assert.equal(balanceChecks, 2);
    });
});

test("an RPC failure is not cached and the next call retries the provider", async () => {
    await withSponsorEnvironment(async () => {
        let providerCalls = 0;
        let sends = 0;
        const provider = { getBalance: async () => BigInt(1_000_000) };
        const gas = loadGasModule({
            getProviderForWrite: async () => {
                providerCalls++;
                if (providerCalls === 1) throw new Error("RPC offline");
                return { provider };
            },
            sendTransaction: async () => {
                sends++;
                return confirmedTransaction();
            },
        });

        const failed = await gas.ensureGasSponsored(beneficiary);
        const retry = await gas.ensureGasSponsored(beneficiary);

        assert.equal(failed.sponsored, false);
        assert.equal(failed.reason, "rpc_unavailable");
        assert.equal(retry.sponsored, true);
        assert.equal(providerCalls, 2);
        assert.equal(sends, 1);
    });
});

test("a failed top-up send is not reusable and the next call sends again", async () => {
    await withSponsorEnvironment(async () => {
        let sends = 0;
        const provider = { getBalance: async () => BigInt(1_000_000) };
        const gas = loadGasModule({
            getProviderForWrite: async () => ({ provider }),
            sendTransaction: async () => {
                sends++;
                if (sends === 1) throw new Error("transaction rejected");
                return confirmedTransaction("0xretry-confirmed");
            },
        });

        const failed = await gas.ensureGasSponsored(beneficiary);
        const retry = await gas.ensureGasSponsored(beneficiary);

        assert.equal(failed.sponsored, false);
        assert.equal(failed.reason, "topup_failed");
        assert.equal(retry.sponsored, true);
        assert.equal(retry.txHash, "0xretry-confirmed");
        assert.equal(sends, 2);
    });
});

test("concurrent callers share one top-up attempt", async () => {
    await withSponsorEnvironment(async () => {
        let providerCalls = 0;
        let sends = 0;
        let confirm;
        const confirmation = new Promise((resolve) => { confirm = resolve; });
        const provider = { getBalance: async () => BigInt(1_000_000) };
        const gas = loadGasModule({
            getProviderForWrite: async () => {
                providerCalls++;
                return { provider };
            },
            sendTransaction: async () => {
                sends++;
                return {
                    hash: "0xshared",
                    wait: async () => confirmation,
                };
            },
        });

        const first = gas.ensureGasSponsored(beneficiary);
        const second = gas.ensureGasSponsored(beneficiary.toUpperCase().replace("0X", "0x"));
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(providerCalls, 1);
        assert.equal(sends, 1);
        confirm({ hash: "0xshared", status: 1 });
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assert.deepEqual(firstResult, secondResult);
        assert.equal(firstResult.txHash, "0xshared");
    });
});

test("only a confirmed transaction is reused inside the sponsorship window", async () => {
    await withSponsorEnvironment(async () => {
        let providerCalls = 0;
        let sends = 0;
        const provider = { getBalance: async () => BigInt(1_000_000) };
        const gas = loadGasModule({
            getProviderForWrite: async () => {
                providerCalls++;
                return { provider };
            },
            sendTransaction: async () => {
                sends++;
                return confirmedTransaction("0xreusable");
            },
        });

        const first = await gas.ensureGasSponsored(beneficiary);
        const reused = await gas.ensureGasSponsored(beneficiary);

        assert.equal(first.sponsored, true);
        assert.equal(reused.sponsored, true);
        assert.equal(reused.txHash, "0xreusable");
        assert.equal(reused.reason, "recently_sponsored");
        assert.equal(providerCalls, 1);
        assert.equal(sends, 1);
    });
});

test("invalid sponsor and top-up configuration fail closed before RPC", async () => {
    await withSponsorEnvironment(async () => {
        let providerCalls = 0;
        const provider = { getBalance: async () => BigInt(1_000_000) };
        const gas = loadGasModule({
            getProviderForWrite: async () => {
                providerCalls++;
                return { provider };
            },
            sendTransaction: async () => confirmedTransaction(),
        });

        process.env.SPONSOR_PRIVATE_KEY = "not-a-key";
        const invalidKey = await gas.ensureGasSponsored(beneficiary);
        process.env.SPONSOR_PRIVATE_KEY = "valid-sponsor-key";
        process.env.SPONSOR_GAS_TOPUP_USDC = "not-an-amount";
        const invalidTopup = await gas.ensureGasSponsored(beneficiary);

        assert.equal(invalidKey.sponsored, false);
        assert.equal(invalidKey.reason, "invalid_sponsor_config");
        assert.equal(invalidTopup.sponsored, false);
        assert.equal(invalidTopup.reason, "invalid_topup_config");
        assert.equal(providerCalls, 0);
    });
});

test("user-initiated legacy wallet execution aborts unless sponsorship succeeds", () => {
    assert.match(executeRouteSource, /import \{ requireGasSponsored \} from "@\/lib\/sponsor\/gas"/);
    assert.match(executeRouteSource, /await requireGasSponsored\(wallet\.toLowerCase\(\)\)/);
    assert.doesNotMatch(executeRouteSource, /await ensureGasSponsored\(wallet\.toLowerCase\(\)\)/);
});
