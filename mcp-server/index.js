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
        routerAddress: "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29",
        gasToken: "USDC",
        usdcAddress: "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc",
        standardPeriod: 2592000, // 30 days in seconds
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
