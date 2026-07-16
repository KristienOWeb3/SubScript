import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const rpcSource = readFileSync(new URL("../../payments/rpc.ts", import.meta.url), "utf8");
const primary = "https://rpc.testnet.arc.network";
const secondary = "https://rpc.blockdaemon.testnet.arc.network";

function loadRpcModule({ getNetwork }) {
    class MockJsonRpcProvider {
        constructor(url) {
            this.url = url;
        }

        getNetwork() {
            return getNetwork(this.url);
        }
    }

    const compiled = ts.transpileModule(rpcSource, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: "rpc.ts",
    }).outputText;
    const testModule = { exports: {} };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        process,
        setTimeout,
        Math,
    });
    const wrapper = vm.runInContext(
        `(function (require, module, exports) { ${compiled}\n })`,
        context,
        { filename: "rpc.test.cjs" },
    );
    wrapper((specifier) => {
        if (specifier === "ethers") {
            return { ethers: { JsonRpcProvider: MockJsonRpcProvider } };
        }
        throw new Error(`Unexpected import: ${specifier}`);
    }, testModule, testModule.exports);
    return testModule.exports;
}

async function withRpcEnvironment(run) {
    const names = [
        "NEXT_PUBLIC_ENVIRONMENT",
        "ARC_RPC_PRIMARY",
        "RPC_URL",
        "ARC_RPC_SECONDARY",
        "RPC_FALLBACK_URL_1",
        "RPC_FALLBACK_URL_2",
    ];
    const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    process.env.NEXT_PUBLIC_ENVIRONMENT = "testnet";
    process.env.ARC_RPC_PRIMARY = primary;
    delete process.env.RPC_URL;
    delete process.env.ARC_RPC_SECONDARY;
    delete process.env.RPC_FALLBACK_URL_1;
    delete process.env.RPC_FALLBACK_URL_2;
    try {
        await run();
    } finally {
        for (const name of names) {
            if (original[name] === undefined) delete process.env[name];
            else process.env[name] = original[name];
        }
    }
}

test("Arc -32011 throttling immediately selects the distinct write fallback", async () => {
    await withRpcEnvironment(async () => {
        const calls = [];
        const rpc = loadRpcModule({
            getNetwork: async (url) => {
                calls.push(url);
                if (url === primary) {
                    const error = new Error("could not coalesce error");
                    error.code = "UNKNOWN_ERROR";
                    error.error = { code: -32011, message: "request limit reached" };
                    throw error;
                }
                return { chainId: BigInt(5042002) };
            },
        });

        const selected = await rpc.getRpcProviderForWrite();

        assert.equal(selected.rpcEndpoint, secondary);
        assert.deepEqual(calls, [primary, secondary]);
    });
});

test("the official Arc endpoint remains first and Blockdaemon is a distinct default fallback", async () => {
    await withRpcEnvironment(async () => {
        const calls = [];
        const rpc = loadRpcModule({
            getNetwork: async (url) => {
                calls.push(url);
                return { chainId: BigInt(5042002) };
            },
        });

        const selected = await rpc.getRpcProviderForWrite();

        assert.equal(selected.rpcEndpoint, primary);
        assert.deepEqual(calls, [primary]);
        assert.match(rpcSource, /https:\/\/rpc\.blockdaemon\.testnet\.arc\.network/);
        assert.match(rpcSource, /Number\(code\) === -32011/);
    });
});
