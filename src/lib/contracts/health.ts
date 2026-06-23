/* Deployed-contract health check.
 *
 * Verifies that every contract address the app talks to (a) has code deployed and
 * (b) actually exposes the function selectors the app calls. This catches the class
 * of bug that took down payment links on launch day: code calling an on-chain
 * function that the *deployed* contract doesn't have (e.g. a stale/un-upgraded proxy
 * or an undeployed address). `tsc`/`build` cannot catch this — only an on-chain check.
 *
 * Single source of truth for the expected manifest. Used by /api/health/contracts and
 * scripts/check-contracts.mjs.
 */
import { ethers } from "ethers";
import {
    SUBSCRIPT_ROUTER_ADDRESS,
    STANDARD_CONTRACT_ADDRESS,
    CONFIDENTIAL_CONTRACT_ADDRESS,
    SUBSCRIPT_VAULT_ADDRESS,
    USDC_NATIVE_GAS_ADDRESS,
} from "@/lib/contracts/constants";

const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type ContractSpec = {
    name: string;
    address: string;
    /** Function signatures the app calls on this contract. */
    functions: string[];
    /** Native predeploy (e.g. Arc USDC): probe functionally instead of scanning bytecode. */
    native?: boolean;
};

/** The functions the app actually invokes on each contract. Keep in sync with usage. */
export const EXPECTED_CONTRACTS: ContractSpec[] = [
    {
        name: "SubScriptRouter",
        address: SUBSCRIPT_ROUTER_ADDRESS,
        functions: [
            "depositForMerchant(address,uint256,string)",
            "withdraw()",
            "withdrawTo(address)",
            "executeBatchPayout(address[],uint256[])",
            "configurePayoutDestination(address)",
            "setMerchantTier(address,uint8)",
            "merchantBalances(address)",
        ],
    },
    {
        name: "SubScriptPSA (standard subscriptions)",
        address: STANDARD_CONTRACT_ADDRESS,
        functions: [
            "createSubscription(address,uint256,uint256)",
            "cancelSubscription(uint256)",
            "executePayment(uint256,uint256)",
            "isSequenceExecuted(uint256,uint256)",
            "nextSubscriptionId()",
            "subscriptions(uint256)",
        ],
    },
    {
        name: "SubScriptConfidential",
        address: CONFIDENTIAL_CONTRACT_ADDRESS,
        functions: ["registerViewKey(bytes32)"],
    },
    {
        name: "SubScriptVault",
        address: SUBSCRIPT_VAULT_ADDRESS,
        functions: [
            "commit(address,uint256)",
            "withdrawSurplus(address,uint256)",
            "drawUsage(address,uint256)",
            "drawUsageFor(address,address,uint256)",
            "merchantClaim()",
            "setRequiredCommit(uint256)",
            "getVault(address,address)",
            "requiredCommit(address)",
            "merchantClaimable(address)",
        ],
    },
    {
        name: "USDC (native gas token)",
        address: USDC_NATIVE_GAS_ADDRESS,
        functions: ["balanceOf(address)", "allowance(address,address)", "transfer(address,uint256)", "transferFrom(address,address,uint256)", "approve(address,uint256)"],
        native: true,
    },
];

function selector(sig: string) {
    return ethers.id(sig).slice(2, 10);
}

export type ContractResult = {
    name: string;
    address: string;
    implementation?: string;
    deployed: boolean;
    missing: string[];
    ok: boolean;
    note?: string;
};

export type AuditResult = {
    healthy: boolean;
    rpcUrl: string;
    checkedAt: string;
    results: ContractResult[];
};

function defaultRpc() {
    return process.env.ARC_RPC_PRIMARY || process.env.RPC_URL || "https://rpc.testnet.arc.network";
}

export async function auditContracts(rpcUrl: string = defaultRpc()): Promise<AuditResult> {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const results: ContractResult[] = [];

    for (const spec of EXPECTED_CONTRACTS) {
        const entry: ContractResult = { name: spec.name, address: spec.address, deployed: false, missing: [], ok: true };

        if (spec.native) {
            /* Predeploys may not expose scannable bytecode; verify functionally. */
            try {
                const c = new ethers.Contract(spec.address, ["function balanceOf(address) view returns (uint256)"], provider);
                await c.balanceOf("0x0000000000000000000000000000000000000000");
                entry.deployed = true;
                entry.note = "native predeploy — verified via balanceOf probe";
            } catch (err: any) {
                entry.ok = false;
                entry.note = `native probe failed: ${err?.shortMessage || err?.message || "error"}`;
            }
            results.push(entry);
            continue;
        }

        let code = await provider.getCode(spec.address);
        if (code === "0x") {
            entry.ok = false;
            entry.deployed = false;
            entry.missing = [...spec.functions];
            entry.note = "no code at address (contract not deployed)";
            results.push(entry);
            continue;
        }
        entry.deployed = true;

        /* Resolve EIP-1967 proxy implementation if present. */
        try {
            const raw = await provider.getStorage(spec.address, EIP1967_IMPL_SLOT);
            if (raw && raw !== "0x" + "0".repeat(64)) {
                const impl = ethers.getAddress("0x" + raw.slice(26));
                entry.implementation = impl;
                code = await provider.getCode(impl);
            }
        } catch {
            /* not a proxy / slot unreadable — scan the address code directly */
        }

        for (const sig of spec.functions) {
            if (!code.includes(selector(sig))) entry.missing.push(sig);
        }
        entry.ok = entry.missing.length === 0;
        results.push(entry);
    }

    return {
        healthy: results.every((r) => r.ok),
        rpcUrl,
        checkedAt: new Date().toISOString(),
        results,
    };
}
