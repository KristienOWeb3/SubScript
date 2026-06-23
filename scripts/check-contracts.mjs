/* Pre-deploy contract health check (offline / CI — no running app needed).
 *
 * Mirrors src/lib/contracts/health.ts. Verifies every contract the app calls has code
 * and exposes the expected function selectors, so deployed-vs-code drift fails the build
 * instead of reverting in production. Addresses are read from src/lib/contracts/constants.ts
 * (single source); RPC from ARC_RPC_PRIMARY / RPC_URL (defaults to Arc testnet).
 *
 *   node scripts/check-contracts.mjs        # exits 1 if any contract is unhealthy
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const constantsSrc = readFileSync(join(__dirname, "..", "src", "lib", "contracts", "constants.ts"), "utf8");

function addr(name, envVar) {
    if (envVar && process.env[envVar]) return process.env[envVar];
    // Find the const declaration and the first 0x<40 hex> literal after it.
    const re = new RegExp(`${name}[^]*?"(0x[0-9a-fA-F]{40})"`);
    const m = constantsSrc.match(re);
    if (!m) throw new Error(`Could not resolve ${name} from constants.ts`);
    return m[1];
}

const EXPECTED = [
    { name: "SubScriptRouter", address: addr("SUBSCRIPT_ROUTER_ADDRESS"), functions: [
        "depositForMerchant(address,uint256,string)", "withdraw()", "withdrawTo(address)",
        "executeBatchPayout(address[],uint256[])", "configurePayoutDestination(address)",
        "setMerchantTier(address,uint8)", "merchantBalances(address)",
    ]},
    { name: "SubScriptPSA (standard)", address: addr("STANDARD_CONTRACT_ADDRESS"), functions: [
        "createSubscription(address,uint256,uint256)", "cancelSubscription(uint256)",
        "executePayment(uint256,uint256)", "isSequenceExecuted(uint256,uint256)",
        "nextSubscriptionId()", "subscriptions(uint256)",
    ]},
    { name: "SubScriptConfidential", address: addr("CONFIDENTIAL_CONTRACT_ADDRESS"), functions: [
        "registerViewKey(bytes32)",
    ]},
    { name: "SubScriptVault", address: addr("SUBSCRIPT_VAULT_ADDRESS", "NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS"), functions: [
        "commit(address,uint256)", "withdrawSurplus(address,uint256)", "drawUsage(address,uint256)",
        "drawUsageFor(address,address,uint256)", "merchantClaim()", "setRequiredCommit(uint256)",
        "getVault(address,address)", "requiredCommit(address)", "merchantClaimable(address)",
    ]},
    { name: "USDC (native)", address: addr("USDC_NATIVE_GAS_ADDRESS"), native: true, functions: ["balanceOf(address)"] },
];

const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const sel = (s) => ethers.id(s).slice(2, 10);

async function main() {
    const rpc = process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
    const provider = new ethers.JsonRpcProvider(rpc);
    console.log(`Checking deployed contracts against ${rpc}\n`);

    let healthy = true;
    for (const spec of EXPECTED) {
        if (spec.native) {
            try {
                const c = new ethers.Contract(spec.address, ["function balanceOf(address) view returns (uint256)"], provider);
                await c.balanceOf("0x0000000000000000000000000000000000000000");
                console.log(`✅ ${spec.name} (${spec.address}) — native predeploy OK`);
            } catch (e) {
                healthy = false;
                console.log(`❌ ${spec.name} (${spec.address}) — native probe failed: ${e.shortMessage || e.message}`);
            }
            continue;
        }
        let code = await provider.getCode(spec.address);
        if (code === "0x") {
            healthy = false;
            console.log(`❌ ${spec.name} (${spec.address}) — NO CODE (not deployed)`);
            continue;
        }
        const raw = await provider.getStorage(spec.address, EIP1967_IMPL_SLOT);
        let implNote = "";
        if (raw && raw !== "0x" + "0".repeat(64)) {
            const impl = ethers.getAddress("0x" + raw.slice(26));
            code = await provider.getCode(impl);
            implNote = ` (proxy -> ${impl})`;
        }
        const missing = spec.functions.filter((s) => !code.includes(sel(s)));
        if (missing.length === 0) {
            console.log(`✅ ${spec.name} (${spec.address})${implNote}`);
        } else {
            healthy = false;
            console.log(`❌ ${spec.name} (${spec.address})${implNote} — MISSING: ${missing.join(", ")}`);
        }
    }

    console.log(`\n${healthy ? "✅ All contracts healthy." : "❌ Contract drift detected — fix before deploying."}`);
    process.exit(healthy ? 0 : 1);
}

main().catch((e) => { console.error("check-contracts failed:", e.message); process.exit(2); });
