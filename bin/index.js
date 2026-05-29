#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ARC_TESTNET_CHAIN_ID = 5042002;
const SUBSCRIPT_ROUTER_ADDRESS = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const USDC_NATIVE_GAS_ADDRESS = "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc";

const abi = [
  {
    type: "function",
    name: "depositAndCommit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commitment", type: "bytes32", internalType: "bytes32" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
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
      { name: "period", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
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
    ],
  },
  {
    type: "function",
    name: "setMerchantTier",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_merchant", type: "address", internalType: "address" },
      { name: "_tier", type: "uint8", internalType: "uint8" }
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "configurePayoutDestination",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_newDestination", type: "address", internalType: "address" }
    ],
    outputs: [],
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
    ],
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
    ],
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
  }
];

const constantsTs = `export const ARC_TESTNET_CHAIN_ID = ${ARC_TESTNET_CHAIN_ID} as const;
export const SUBSCRIPT_ROUTER_ADDRESS = "${SUBSCRIPT_ROUTER_ADDRESS}" as const;
export const USDC_NATIVE_GAS_ADDRESS = "${USDC_NATIVE_GAS_ADDRESS}" as const;
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
      http: ["https://5042002.rpc.thirdweb.com"],
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

const paywallTsx = `"use client";

import { useMemo, useState } from "react";
import { bytesToHex, keccak256, parseUnits, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import abi from "./abi.json";
import { SUBSCRIPT_ROUTER_ADDRESS } from "./constants";

type SubScriptPaywallProps = {
  merchantAddress: Hex;
  amountUsdc?: string;
  periodSeconds?: bigint;
  planName?: string;
  proof?: readonly Hex[];
  nullifierHash?: Hex;
};

function createCommitment() {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  const secretHex = bytesToHex(secret);

  return {
    secret: secretHex,
    commitment: keccak256(secretHex),
  };
}

export default function SubScriptPaywall({
  merchantAddress,
  amountUsdc = "10",
  periodSeconds = BigInt(2592000),
  planName = "SubScript Plan",
  proof,
  nullifierHash,
}: SubScriptPaywallProps) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [commitment, setCommitment] = useState<Hex | null>(null);
  const [secret, setSecret] = useState<Hex | null>(null);
  const [status, setStatus] = useState("Idle");

  const amount = useMemo(() => parseUnits(amountUsdc, 6), [amountUsdc]);
  const canActivate = Boolean(proof?.length && nullifierHash && commitment);

  async function depositAndCommit() {
    if (!isConnected) {
      setStatus("Connect your funding wallet first.");
      return;
    }

    const next = createCommitment();
    setSecret(next.secret);
    setCommitment(next.commitment);
    setStatus("Submitting private commitment...");

    await writeContractAsync({
      address: SUBSCRIPT_ROUTER_ADDRESS,
      abi,
      functionName: "depositAndCommit",
      args: [next.commitment, amount],
    });

    setStatus("Commitment deposited. Generate the local ZK proof, then switch to the burner wallet.");
  }

  async function verifyAndActivate() {
    if (!canActivate || !proof || !nullifierHash) {
      setStatus("Generate the burner proof before activation.");
      return;
    }

    setStatus("Activating subscription from burner wallet...");

    await writeContractAsync({
      address: SUBSCRIPT_ROUTER_ADDRESS,
      abi,
      functionName: "verifyAndActivate",
      args: [proof, nullifierHash, merchantAddress, amount, periodSeconds],
    });

    setStatus("Subscription active. Merchant receives recurring USDC less the 1% protocol fee.");
  }

  return (
    <section>
      <div>
        <p>
          SubScript is fast, private, and reliable.
        </p>
        <h2>{planName}</h2>
        <p>
          Pay {amountUsdc} USDC per period through the ZK Burner Method on Arc.
        </p>
      </div>

      <div>
        <p>Funding wallet: {address ?? "Not connected"}</p>
        <p>Merchant: {merchantAddress}</p>
        <p>Commitment: {commitment ?? "Pending deposit"}</p>
        <p>Secret: {secret ? "Stored locally. Do not send to the merchant." : "Not generated"}</p>
      </div>

      <div>
        <button
          type="button"
          onClick={depositAndCommit}
        >
          1. Deposit Commitment
        </button>
        <button
          type="button"
          onClick={verifyAndActivate}
          disabled={!canActivate}
        >
          2. Verify Burner
        </button>
      </div>

      <p>{status}</p>
    </section>
  );
}
`;

async function main() {
  const targetDir = path.join(process.cwd(), "subscript");

  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(targetDir, "constants.ts"), constantsTs, "utf8"),
    writeFile(path.join(targetDir, "abi.json"), `${JSON.stringify(abi, null, 2)}\n`, "utf8"),
    writeFile(path.join(targetDir, "SubScriptPaywall.tsx"), paywallTsx, "utf8"),
  ]);

  // ANSI escape codes for terminal styling
  const green = "\x1b[38;2;0;255;0m"; 
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  console.log(green + bold);
  console.log("███████╗██╗   ██╗██████╗ ███████╗██████╗ ██████╗ ██╗██████╗ ████████╗");
  console.log("██╔════╝██║   ██║██╔══██╗██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝");
  console.log("███████╗██║   ██║██████╔╝███████╗██║     ██████╔╝██║██████╔╝   ██║   ");
  console.log("╚════██║██║   ██║██╔══██╗╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ");
  console.log("███████║╚██████╔╝██████╔╝███████║╚██████╗██║  ██║██║██║        ██║   ");
  console.log("╚══════╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ");
  console.log("                                               ██████╗██╗     ██╗    ");
  console.log("                                              ██╔════╝██║     ██║    ");
  console.log("                                              ██║     ██║     ██║    ");
  console.log("                                              ██║     ██║     ██║    ");
  console.log("                                              ╚██████╗███████╗██║    ");
  console.log("                                               ╚═════╝╚══════╝╚═╝    ");
  console.log(reset);
  
  console.log("─────── Files successfully injected into ./subscript/ ───────");
  console.log(" 👉 constants.ts (Arc Network Deployments & 1% Fee Parameters)");
  console.log(" 👉 abi.json     (Zero-Knowledge Router ABI)");
  console.log(" 👉 SubScriptPaywall.tsx (Base Component Scaffold)\n");
  console.log("💡 Hand this folder directly to your AI agent to complete the integration!");
}

main().catch((error) => {
  console.error("Failed to generate SubScript scaffold:", error);
  process.exit(1);
});
