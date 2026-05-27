#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const abiPath = join(__dirname, "abi.json");

// 1. Initialize the MCP Server
const server = new Server(
  {
    name: "subscript-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 2. Register Tool Listings
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_subscript_config",
        description: "Returns the Arc Network configuration and standard contract addresses for the SubScript protocol.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_subscript_abi",
        description: "Returns the full JSON ABI for the SubScript Router contract required for Wagmi/Viem integration.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_zk_integration_guide",
        description: "Returns the developer integration guide for SubScript's Zero-Knowledge (ZK) privacy architecture.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// 3. Register Tool Call handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  try {
    if (name === "get_subscript_config") {
      const config = {
        network: "Arc Testnet",
        chainId: 5042002,
        routerAddress: "[Leave Placeholder]",
        verifierAddress: "[Leave Placeholder]",
        gasToken: "USDC",
        protocolFeeBps: 100, // 1% fee
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(config, null, 2),
          },
        ],
      };
    }

    if (name === "get_subscript_abi") {
      const abiContent = await readFile(abiPath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: abiContent,
          },
        ],
      };
    }

    if (name === "get_zk_integration_guide") {
      const guide = `
# SubScript Zero-Knowledge (ZK) Integration Guide

SubScript utilizes a Tornado Cash-style commitment architecture to mathematically decouple the user's funding wallet (Payer) from the user's service access wallet (Burner). 

A 1% protocol fee (100 basis points) is automatically deducted at the contract level from all subscription payments, leaving 99% routed directly to the merchant.

## Three-Step Integration Workflow

### Step 1: Deposit and Commitment (Payer Wallet)
The user's funding wallet approves the SubScript Router to spend USDC, then calls the \`depositAndCommit\` function with a hashed secret (the commitment).
- **USDC Approval:** approve the router to spend \`depositAmount\`.
- **Function Call:** \`depositAndCommit(bytes32 commitment, uint256 amount)\`

\`\`\`typescript
// Example using Wagmi/Viem
import { useWriteContract } from 'wagmi';
import { parseUnits } from 'viem';

const { writeContractAsync: deposit } = useWriteContract();

// Generate a random 32-byte secret and hash it to create the commitment
const secret = crypto.getRandomValues(new Uint8Array(32));
const commitment = keccak256(secret);

await deposit({
  address: ROUTER_ADDRESS,
  abi: SUBSCRIPT_ABI,
  functionName: 'depositAndCommit',
  args: [commitment, parseUnits("10", 6)]
});
\`\`\`

---

### Step 2: Local ZK-SNARK Proof Generation
The frontend uses \`snarkjs\` to generate a ZK-SNARK proof locally. The proof demonstrates that the user knows the secret pre-image corresponding to a valid commitment on-chain, without revealing the secret itself.

\`\`\`typescript
import * as snarkjs from 'snarkjs';

// Load circuit wasm and zkey files to generate proof
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { secret: secret, commitment: commitment },
  "subscript.wasm",
  "subscript_final.zkey"
);
\`\`\`

---

### Step 3: Verify and Activate (Burner Wallet)
The user switches to a clean, unlinkable **burner wallet** (to ensure privacy) and calls the \`verifyAndActivate\` function. This burner wallet acts as the subscriber and authorizes the merchant to trigger monthly payments anonymously.
- **Function Call:** \`verifyAndActivate(bytes32[] proof, bytes32 nullifierHash, address merchant, uint256 amount, uint256 period)\`

\`\`\`typescript
const { writeContractAsync: activate } = useWriteContract();

await activate({
  address: ROUTER_ADDRESS,
  abi: SUBSCRIPT_ABI,
  functionName: 'verifyAndActivate',
  args: [proof, nullifierHash, merchantAddress, parseUnits("10", 6), 2592000n]
});
\`\`\`
      `.trim();

      return {
        content: [
          {
            type: "text",
            text: guide,
          },
        ],
      };
    }

    throw new Error(`Tool ${name} not found`);
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing tool: ${error.message}`,
        },
      ],
    };
  }
});

// 4. Start Server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error running SubScript MCP server:", error);
  process.exit(1);
});
