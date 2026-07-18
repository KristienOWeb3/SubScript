import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const rpcSource = readFileSync(new URL("../../payments/rpc.ts", import.meta.url), "utf8");
const primary = "https://rpc.testnet.arc.network";
const secondary = "https://rpc.blockdaemon.testnet.arc.network";

/* `probe` stands in for the endpoint liveness check. That used to be getNetwork(), but the module
   now pins the network onto every provider — eth_chainId is the most throttled method on Arc and
   ethers sent it before anything else, so a throttled chain id made a healthy endpoint unreachable
   and the failover below never ran. With the network pinned, getNetwork() answers from memory and
   getBlockNumber() is the call that actually reaches the wire. */
function loadRpcModule({ probe }) {
    class MockJsonRpcProvider {
        constructor(url, network, options) {
            this.url = url;
            this.network = network;
            this.options = options;
        }

        getNetwork() {
            /* Pinned: resolves without a request, exactly like the real staticNetwork provider. */
            return Promise.resolve({ chainId: BigInt(5042002) });
        }

        getBlockNumber() {
            return probe(this.url);
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
            probe: async (url) => {
                calls.push(url);
                if (url === primary) {
                    /* The exact shape production emits: ethers wraps Arc's -32011 in UNKNOWN_ERROR. */
                    const error = new Error("could not coalesce error");
                    error.code = "UNKNOWN_ERROR";
                    error.error = { code: -32011, message: "request limit reached" };
                    throw error;
                }
                return 1;
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
            probe: async (url) => {
                calls.push(url);
                return 1;
            },
        });

        const selected = await rpc.getRpcProviderForWrite();

        assert.equal(selected.rpcEndpoint, primary);
        assert.deepEqual(calls, [primary]);
        assert.match(rpcSource, /https:\/\/rpc\.blockdaemon\.testnet\.arc\.network/);
        assert.match(rpcSource, /Number\(code\) === -32011/);
    });
});

test("no Arc provider spends an eth_chainId on a chain we already know", () => {
    /* Production, 2026-07-16: every sponsored vault commit died here —
         JsonRpcProvider failed to detect network and cannot start up; retry in 1s
         [gas-sponsor] ... payload={ "method": "eth_chainId" }, code=UNKNOWN_ERROR, -32011
       eth_chainId is the most throttled method on Arc's public RPC and ethers sends it before
       anything else, retrying detection internally and indefinitely. The provider never finished
       starting up, so the failover above never ran and a healthy chain read as unreachable.
       Pinning the network removes that call entirely. */
    assert.match(rpcSource, /function arcProvider\(url: string\): ethers\.JsonRpcProvider/);
    assert.match(rpcSource, /new ethers\.JsonRpcProvider\(url, ARC_CHAIN_ID, \{ staticNetwork: true \}\)/);
    assert.equal((rpcSource.match(/new ethers\.JsonRpcProvider\(/g) || []).length, 1,
        "every provider must be built by arcProvider()");

    /* The pinned id has to follow the deployment: it is what signs, so a wrong one fails every write. */
    assert.match(rpcSource, /const ARC_CHAIN_ID = IS_ARC_MAINNET \? 5042001 : 5042002/);

    /* And the liveness probe must still touch the wire — with the network pinned, getNetwork()
       answers from memory and would hand back dead endpoints. */
    assert.doesNotMatch(rpcSource, /await provider\.getNetwork\(\)/);
    assert.match(rpcSource, /await provider\.getBlockNumber\(\)/);
});
