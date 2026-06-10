# SubScript Protocol

SubScript is a fast, private, and reliable decentralized subscription platform built on the Arc Network.

## Recent Updates & Architecture Changes

We have recently completely overhauled the SubScript protocol and its frontend integration. Here is a summary of the latest changes and fixes implemented in the project.

### 1. Zero-Knowledge (ZK) Proof Architecture
We pivoted from a simple public ledger mapping to a Zero-Knowledge proof architecture. The frontend integration has been updated so that instead of calling a simple `createSubscription`, it now generates a cryptographic commitment and a ZK proof.

### 2. MCP Server Configuration & Smithery Integration
To support the new ZK architecture with developer tooling (like Cursor), we updated the Node.js Model Context Protocol (MCP) server. 
- **Smithery Registry Fix**: To allow Smithery to automatically scan our MCP server without hitting `405 Method Not Allowed` errors, we created a custom API route at `src/app/api/mcp-server-card/route.ts` that explicitly supports GET requests and provides the `server-card.json` static card.
- **Vercel Routing**: Added a `vercel.json` and updated `next.config.mjs` to rewrite the `/.well-known/mcp/server-card.json` path to our custom API route. This bypasses Vercel's strict handling of static dot-folders.

### 3. Authentication & Wallet Dashboard
- **Privy Removal**: The Privy sign-in/sign-up functionality was causing issues and has been disabled/removed to streamline the user experience.
- **Dashboard & Wallet Integration**: We are implementing a new Dashboard. The connected wallet of the user is now automatically linked to the MCP and prepended to the provided prompts, making it significantly easier for merchants to implement SubScript without needing to manually copy and paste configurations.

### 4. Waitlist & Database Reliability
- **Waitlist Fixes**: Addressed the recurring submission errors on the waitlist forms for both Enterprises and Users.
- **Supabase Integration**: The app connects to a Supabase PostgreSQL database using Prisma. We've verified database connectivity and set up automated test scripts (`test-waitlist.js` and `test-waitlist-enterprise.js`) to ensure end-to-end functionality for the waitlist flows.

### 5. Access & Middleware
- **Password Gate Removal**: The application middleware (`src/middleware.ts`) was updated to bypass the password gate, unlocking all pages for easier testing and access.

## Tech Stack
- Next.js (App Router)
- React
- Prisma
- Supabase PostgreSQL
- Tailwind CSS
- MCP (Model Context Protocol)

## Getting Started

To run the development server locally:

```bash
npm install
npx prisma generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

/* Initial Security Audit Trigger */

