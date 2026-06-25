# SubScript Model Context Protocol (MCP) Server

An MCP server designed for developers integrating the **SubScript recurring Web3 payment protocol** on the Arc Network. By adding this server to your IDE, AI assistants (like Cursor, Claude Code, and Copilot) gain immediate context on contract routing, token addresses, and the exact ABI definition.

---

## Exposed Tools

1. **`get_subscript_config`**: Returns the Arc network testnet configuration, router addresses, native tokens, and periods.
2. **`get_subscript_abi`**: Returns the full JSON ABI for the SubScript Router contract, enabling seamless generation of Wagmi/Viem transaction hooks.

---

## Integration Guides

### 1. Cursor Integration (`cursor_mcp.json` / Settings)
To add this to Cursor, configure it as a command-line tool in **Settings > Features > MCP**:

- **Name:** `SubScript`
- **Type:** `command`
- **Command:** `npx -y @subscript/mcp`

Alternatively, add this to your `.cursor/mcp.json` configuration file:
```json
{
  "mcpServers": {
    "subscript": {
      "command": "npx",
      "args": ["-y", "@subscript/mcp"]
    }
  }
}
```

---

### 2. Claude Desktop Integration
Add the configuration to your `claude_desktop_config.json` file:

- **MacOS/Linux:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "subscript": {
      "command": "npx",
      "args": ["-y", "@subscript/mcp"]
    }
  }
}
```

---

## Local Development & Testing

1. Install dependencies:
   ```bash
   npm install
   ```

2. Test locally using the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector node index.js
   ```
