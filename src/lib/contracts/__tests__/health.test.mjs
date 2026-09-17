import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ethers } from "ethers";
import { EXPECTED_CONTRACTS } from "../health.ts";

test("vault health checks accept V3 and cover the application's vault ABI", () => {
    const root = new URL("../../../../", import.meta.url);
    const source = readFileSync(new URL("src/lib/vault/onchain.ts", root), "utf8");
    const abi = source.match(/export const VAULT_ABI = \[([\s\S]*?)\];/)[1];
    const signatures = [...abi.matchAll(/"(function [^"]+)"/g)].map((match) =>
        ethers.FunctionFragment.from(match[1]).format("sighash"),
    );
    const artifact = JSON.parse(readFileSync(new URL(
        "artifacts/contracts/SubScriptVault.sol/SubScriptVault.json", root,
    ), "utf8"));
    const deployedInterface = new ethers.Interface(artifact.abi);
    const spec = EXPECTED_CONTRACTS.find((entry) => entry.name === "SubScriptVault");
    for (const signature of spec.functions) {
        assert.ok(deployedInterface.getFunction(signature), `V3 does not expose ${signature}`);
    }
    for (const signature of signatures) {
        assert.ok(spec.functions.includes(signature), `Health check misses ${signature}`);
    }
    const cliSource = readFileSync(new URL("scripts/check-contracts.mjs", root), "utf8");
    const cliVault = cliSource.match(/name: "SubScriptVault"[\s\S]*?functions: \[([\s\S]*?)\]/)[1];
    const cliSignatures = [...cliVault.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(cliSignatures.sort(), [...spec.functions].sort());
});
