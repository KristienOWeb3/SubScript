<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SubScript Agent Operating Rules

## Mainnet Documentation & Status Maintenance Rule
All coding agents working on the SubScript codebase MUST maintain and update the centralized Mainnet Master Documentation ([`docs/mainnet/README.md`](docs/mainnet/README.md)):
1. **Status Tracking:** Whenever a mainnet readiness task, smart contract deployment, SQL migration, keeper scheduler, or security check is completed, immediately update the checklist items in `docs/mainnet/README.md`.
2. **Midway Findings & Blockers:** If an agent discovers a technical blocker, contract invariant nuance, database constraint requirement, or operational dependency during execution, the agent MUST immediately log it in the **Live Progress Log** in `docs/mainnet/README.md` (Section 9.2).
3. **Concise & Necessary Only:** Keep documentation updates surgical, factual, and strictly focused on actionable parameters, hashes, addresses, and blocker resolutions.
