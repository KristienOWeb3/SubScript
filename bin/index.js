#!/usr/bin/env node

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ARC_TESTNET_CHAIN_ID = 5042002;
const SUBSCRIPT_ROUTER_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
const STANDARD_CONTRACT_ADDRESS = "0x3c7f095575C66eF21D501D63E265A51240849924";
const USDC_NATIVE_GAS_ADDRESS = "0x3600000000000000000000000000000000000000";

const red = "\x1b[31m";
const green = "\x1b[38;2;0;210;180m";
const yellow = "\x1b[33m";
const cyan = "\x1b[36m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

function parseArgs(argv) {
    const args = argv.slice(2);
    const command = args[0] || "";
    let merchant = "";

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--merchant" && args[i + 1]) {
            merchant = args[i + 1];
            i++;
        }
    }

    return { command, merchant };
}

function isValidEvmAddress(addr) {
    return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function detectPackageManager(cwd) {
    if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
    if (existsSync(path.join(cwd, "bun.lockb"))) return "bun";
    return "npm";
}

function buildInstallCommand(pm, packages) {
    const pkgString = packages.join(" ");
    switch (pm) {
        case "pnpm": return `pnpm add ${pkgString}`;
        case "yarn": return `yarn add ${pkgString}`;
        case "bun": return `bun add ${pkgString}`;
        default: return `npm install ${pkgString}`;
    }
}

const combinedAbi = [
    {
        type: "function",
        name: "depositAndCommit",
        stateMutability: "nonpayable",
        inputs: [
            { name: "commitment", type: "bytes32", internalType: "bytes32" },
            { name: "amount", type: "uint256", internalType: "uint256" }
        ],
        outputs: []
    },
    {
        type: "function",
        name: "verifyAndActivate",
        stateMutability: "nonpayable",
        inputs: [
            { name: "proof", type: "bytes32[]", internalType: "bytes32[]" },
            { name: "nullifierHash", type: "bytes32", internalType: "bytes32" },
            { name: "merchant", type: "address", internalType: "address" },
            { name: "amount", type: "uint256", internalType: "uint256" },
            { name: "period", type: "uint256", internalType: "uint256" }
        ],
        outputs: []
    },
    {
        type: "function",
        name: "withdraw",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: []
    },
    {
        type: "function",
        name: "cancelSubscription",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_subId", type: "uint256", internalType: "uint256" }
        ],
        outputs: []
    },
    {
        type: "function",
        name: "merchantBalances",
        stateMutability: "view",
        inputs: [
            { name: "account", type: "address", internalType: "address" }
        ],
        outputs: [
            { name: "", type: "uint256", internalType: "uint256" }
        ]
    },
    {
        type: "function",
        name: "merchantTiers",
        stateMutability: "view",
        inputs: [
            { name: "", type: "address", internalType: "address" }
        ],
        outputs: [
            { name: "", type: "uint8", internalType: "uint8" }
        ]
    },
    {
        type: "function",
        name: "merchantPayoutDestination",
        stateMutability: "view",
        inputs: [
            { name: "", type: "address", internalType: "address" }
        ],
        outputs: [
            { name: "", type: "address", internalType: "address" }
        ]
    },
    {
        type: "function",
        name: "configurePayoutDestination",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_newDestination", type: "address", internalType: "address" }
        ],
        outputs: []
    },
    {
        type: "function",
        name: "setMerchantTier",
        stateMutability: "nonpayable",
        inputs: [
            { name: "_merchant", type: "address", internalType: "address" },
            { name: "_tier", type: "uint8", internalType: "uint8" }
        ],
        outputs: []
    },
    {
        type: "function",
        name: "nextSubscriptionId",
        stateMutability: "view",
        inputs: [],
        outputs: [
            { name: "", type: "uint256", internalType: "uint256" }
        ]
    },
    {
        type: "function",
        name: "subscriptions",
        stateMutability: "view",
        inputs: [
            { name: "", type: "uint256", internalType: "uint256" }
        ],
        outputs: [
            { name: "subscriber", type: "address", internalType: "address" },
            { name: "merchant", type: "address", internalType: "address" },
            { name: "amount", type: "uint256", internalType: "uint256" },
            { name: "period", type: "uint256", internalType: "uint256" },
            { name: "nextPayment", type: "uint256", internalType: "uint256" },
            { name: "isActive", type: "bool", internalType: "bool" }
        ]
    },
    {
        type: "event",
        name: "SubscriptionActivated",
        inputs: [
            { name: "nullifierHash", type: "bytes32", indexed: true, internalType: "bytes32" },
            { name: "merchant", type: "address", indexed: true, internalType: "address" },
            { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
            { name: "period", type: "uint256", indexed: false, internalType: "uint256" }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "MerchantPayoutRerouted",
        inputs: [
            { name: "merchant", type: "address", indexed: true, internalType: "address" },
            { name: "oldDestination", type: "address", indexed: true, internalType: "address" },
            { name: "newDestination", type: "address", indexed: true, internalType: "address" }
        ],
        anonymous: false
    },
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    },
    {
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [
            { name: "account", type: "address" }
        ],
        outputs: [{ name: "", type: "uint256" }]
    },
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" }
        ],
        outputs: [{ name: "", type: "uint256" }]
    }
];

function buildConstantsTs(merchantAddress) {
    return `export const ARC_TESTNET_CHAIN_ID = ${ARC_TESTNET_CHAIN_ID} as const;
export const SUBSCRIPT_ROUTER_ADDRESS = "${SUBSCRIPT_ROUTER_ADDRESS}" as const;
export const STANDARD_CONTRACT_ADDRESS = "${STANDARD_CONTRACT_ADDRESS}" as const;
export const USDC_NATIVE_GAS_ADDRESS = "${USDC_NATIVE_GAS_ADDRESS}" as const;
export const MERCHANT_ADDRESS = "${merchantAddress}" as const;
export const SUBSCRIPT_PROTOCOL_FEE_BPS = 100 as const;

export const ARC_TESTNET = {
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.network",
    },
  },
} as const;
`;
}

function buildPaywallTsx() {
    return `"use client";

import { useMemo, useState, useCallback } from "react";
import {
  bytesToHex,
  keccak256,
  encodePacked,
  parseUnits,
  type Hex,
} from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import routerAbi from "./abi.json";
import {
  SUBSCRIPT_ROUTER_ADDRESS,
  USDC_NATIVE_GAS_ADDRESS,
  MERCHANT_ADDRESS,
} from "./constants";

const LOCALSTORAGE_KEY = "subscript_zk_secrets";

type ZkSecrets = {
  secret: Hex;
  nullifier: Hex;
  commitment: Hex;
};

function generateSecrets(): ZkSecrets {
  const secretBytes = new Uint8Array(32);
  const nullifierBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  crypto.getRandomValues(nullifierBytes);
  const secret = bytesToHex(secretBytes);
  const nullifier = bytesToHex(nullifierBytes);
  const commitment = keccak256(encodePacked(["bytes32", "bytes32"], [secret, nullifier]));
  return { secret, nullifier, commitment };
}

function cacheSecrets(secrets: ZkSecrets): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(secrets));
}

function loadCachedSecrets(): ZkSecrets | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LOCALSTORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZkSecrets;
  } catch {
    return null;
  }
}

type SubScriptPaywallProps = {
  amountUsdc?: string;
  periodSeconds?: bigint;
  planName?: string;
};

export default function SubScriptPaywall({
  amountUsdc = "10",
  periodSeconds = BigInt(2592000),
  planName = "SubScript Plan",
}: SubScriptPaywallProps) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<"idle" | "approving" | "depositing" | "proving" | "activating" | "done">("idle");
  const [status, setStatus] = useState("Connect your wallet to begin.");
  const [secrets, setSecrets] = useState<ZkSecrets | null>(() => loadCachedSecrets());
  const [depositTxHash, setDepositTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = useMemo(() => parseUnits(amountUsdc, 6), [amountUsdc]);

  const handleDeposit = useCallback(async () => {
    if (!isConnected || !address) {
      setError("Connect your funding wallet first.");
      return;
    }

    setError(null);

    try {
      setPhase("approving");
      setStatus("Requesting USDC approval for the SubScript Router...");

      const approvalMultiplier = BigInt(12);
      await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: routerAbi,
        functionName: "approve",
        args: [SUBSCRIPT_ROUTER_ADDRESS, amount * approvalMultiplier],
      });

      setPhase("depositing");
      setStatus("Generating cryptographic commitment...");

      const zkSecrets = generateSecrets();
      setSecrets(zkSecrets);
      cacheSecrets(zkSecrets);

      setStatus("Submitting deposit and commitment to the SubScript Router...");

      const txHash = await writeContractAsync({
        address: SUBSCRIPT_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: "depositAndCommit",
        args: [zkSecrets.commitment, amount],
      });

      setDepositTxHash(txHash);
      setPhase("proving");
      setStatus(
        "Phase A complete. Commitment deposited on-chain. " +
        "Generate the ZK proof locally, then switch to a burner wallet for Phase B activation."
      );
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Deposit transaction failed.");
      setPhase("idle");
    }
  }, [isConnected, address, amount, writeContractAsync]);

  const handleActivate = useCallback(async () => {
    if (!isConnected) {
      setError("Connect the burner wallet to activate.");
      return;
    }

    const cached = secrets || loadCachedSecrets();
    if (!cached) {
      setError("No cached ZK secrets found. Complete Phase A (deposit) first.");
      return;
    }

    setError(null);

    try {
      setPhase("activating");
      setStatus("Compiling zero-knowledge proof...");

      /*
       * ZK PROOF GENERATION HOOK
       *
       * Replace this block with your snarkjs.groth16.fullProve call.
       * The circuit expects these private inputs:
       *   - secret:    cached.secret
       *   - nullifier: cached.nullifier
       *
       * And these public inputs:
       *   - merchant:  MERCHANT_ADDRESS
       *   - amount:    amount (as string)
       *   - period:    periodSeconds (as string)
       *
       * Example:
       *   const { proof, publicSignals } = await snarkjs.groth16.fullProve(
       *     {
       *       secret: BigInt(cached.secret),
       *       nullifier: BigInt(cached.nullifier),
       *       merchant: BigInt(MERCHANT_ADDRESS),
       *       amount: amount.toString(),
       *       period: periodSeconds.toString(),
       *     },
       *     "/circuits/subscript.wasm",
       *     "/circuits/subscript_final.zkey"
       *   );
       *
       * Then format the proof array and nullifierHash for the contract call.
       */
      const nullifierHash = keccak256(cached.nullifier);

      const proofPlaceholder: Hex[] = [
        cached.secret,
        keccak256(
          encodePacked(
            ["address", "uint256", "uint256"],
            [MERCHANT_ADDRESS, amount, periodSeconds]
          )
        ),
      ];

      setStatus("Submitting activation from burner wallet...");

      await writeContractAsync({
        address: SUBSCRIPT_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: "verifyAndActivate",
        args: [
          proofPlaceholder,
          nullifierHash,
          MERCHANT_ADDRESS,
          amount,
          periodSeconds,
        ],
      });

      if (typeof window !== "undefined") {
        localStorage.removeItem(LOCALSTORAGE_KEY);
      }

      setPhase("done");
      setStatus(
        "Subscription activated. " +
        "Merchant receives recurring USDC less the 1% protocol fee."
      );
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Activation transaction failed.");
      setPhase("proving");
    }
  }, [isConnected, secrets, amount, periodSeconds, writeContractAsync]);

  return (
    <section>
      <div>
        <h2>{planName}</h2>
        <p>
          Pay {amountUsdc} USDC per period via the ZK Burner Method on Arc Testnet.
        </p>
      </div>

      <div>
        <p>Funding wallet: {address ?? "Not connected"}</p>
        <p>Merchant: {MERCHANT_ADDRESS}</p>
        <p>Commitment: {secrets?.commitment ?? "Pending deposit"}</p>
        <p>Phase: {phase}</p>
      </div>

      <div>
        <button
          type="button"
          onClick={handleDeposit}
          disabled={phase !== "idle" && phase !== "proving"}
        >
          Phase A: Approve and Deposit Commitment
        </button>
        <button
          type="button"
          onClick={handleActivate}
          disabled={phase !== "proving"}
        >
          Phase B: Activate via Burner Wallet
        </button>
      </div>

      {error && <p>{error}</p>}
      <p>{status}</p>
    </section>
  );
}
`;
}

async function installDependencies(cwd) {
    const pm = detectPackageManager(cwd);
    const packages = ["viem", "wagmi", "snarkjs", "circomlibjs"];

    console.log(`\n${cyan}${bold}[2/4]${reset} Installing dependencies via ${bold}${pm}${reset}...`);
    console.log(`${dim}      Packages: ${packages.join(", ")}${reset}`);

    const cmd = buildInstallCommand(pm, packages);

    try {
        execSync(cmd, { cwd, stdio: "pipe" });
        console.log(`${green}      Dependencies installed successfully.${reset}`);
    } catch (err) {
        console.log(`${yellow}      Auto-install skipped (run manually): ${cmd}${reset}`);
    }
}

async function main() {
    const { command, merchant } = parseArgs(process.argv);

    if (command !== "init") {
        console.error(`\n${red}${bold}  Error: Unknown command "${command || "(none)"}".${reset}`);
        console.error(`${dim}  Usage: npx @subscript-protocol/cli@latest init --merchant <YOUR_MERCHANT_ADDRESS>${reset}\n`);
        process.exit(1);
    }

    if (!merchant) {
        console.error(`\n${red}${bold}  Error: Missing required flag --merchant <ADDRESS>.${reset}`);
        console.error(`${dim}  Copy the exact command from your SubScript Merchant Dashboard.${reset}`);
        console.error(`${dim}  Example: npx @subscript-protocol/cli@latest init --merchant 0xaBC123...${reset}\n`);
        process.exit(1);
    }

    if (!isValidEvmAddress(merchant)) {
        console.error(`\n${red}${bold}  Error: Invalid EVM address "${merchant}".${reset}`);
        console.error(`${dim}  A valid address is 42 characters starting with 0x (e.g. 0xaBC1...def0).${reset}`);
        console.error(`${dim}  Copy the exact command from your SubScript Merchant Dashboard.${reset}\n`);
        process.exit(1);
    }

    const cwd = process.cwd();
    const targetDir = path.join(cwd, "subscript");

    console.log(green + bold);
    console.log("  ███████╗██╗   ██╗██████╗ ███████╗██████╗ ██████╗ ██╗██████╗ ████████╗");
    console.log("  ██╔════╝██║   ██║██╔══██╗██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝");
    console.log("  ███████╗██║   ██║██████╔╝███████╗██║     ██████╔╝██║██████╔╝   ██║   ");
    console.log("  ╚════██║██║   ██║██╔══██╗╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ");
    console.log("  ███████║╚██████╔╝██████╔╝███████║╚██████╗██║  ██║██║██║        ██║   ");
    console.log("  ╚══════╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ");
    console.log(reset);
    console.log(`${dim}  ZK Burner Subscription Protocol - CLI v1.1.0${reset}`);
    console.log(`${dim}  Merchant: ${merchant}${reset}\n`);

    console.log(`${cyan}${bold}[1/4]${reset} Scaffolding ./subscript/ directory...`);
    await mkdir(targetDir, { recursive: true });

    const constantsContent = buildConstantsTs(merchant);
    const abiContent = JSON.stringify(combinedAbi, null, 2) + "\n";
    const paywallContent = buildPaywallTsx();

    await Promise.all([
        writeFile(path.join(targetDir, "constants.ts"), constantsContent, "utf8"),
        writeFile(path.join(targetDir, "abi.json"), abiContent, "utf8"),
        writeFile(path.join(targetDir, "SubScriptPaywall.tsx"), paywallContent, "utf8"),
    ]);

    console.log(`${green}      constants.ts${reset}            ${dim}Arc Testnet config + MERCHANT_ADDRESS${reset}`);
    console.log(`${green}      abi.json${reset}                ${dim}Router ABI (depositAndCommit, verifyAndActivate) + ERC20 ABI${reset}`);
    console.log(`${green}      SubScriptPaywall.tsx${reset}     ${dim}Two-phase ZK React component (deposit + activate)${reset}`);

    await installDependencies(cwd);

    console.log(`\n${cyan}${bold}[3/4]${reset} Verifying merchant address injection...`);
    const written = await readFile(path.join(targetDir, "constants.ts"), "utf8");
    if (written.includes(merchant)) {
        console.log(`${green}      MERCHANT_ADDRESS = "${merchant}" confirmed in constants.ts${reset}`);
    } else {
        console.log(`${yellow}      Warning: Merchant address not detected in constants.ts. Verify manually.${reset}`);
    }

    console.log(`\n${cyan}${bold}[4/4]${reset} Integration complete.\n`);
    console.log(`${bold}  Next steps:${reset}`);
    console.log(`${dim}  1. Import SubScriptPaywall from "./subscript/SubScriptPaywall"${reset}`);
    console.log(`${dim}  2. Place your circuit files (.wasm, .zkey) in /public/circuits/${reset}`);
    console.log(`${dim}  3. Replace the proof placeholder in handleActivate with snarkjs.groth16.fullProve${reset}`);
    console.log(`${dim}  4. Wrap the component with WagmiProvider configured for Arc Testnet${reset}`);
    console.log(`${dim}  5. Hand the ./subscript/ folder to your AI agent for styling and integration${reset}\n`);
}

main().catch((error) => {
    console.error(`${red}${bold}  Fatal: ${error.message || error}${reset}`);
    process.exit(1);
});
