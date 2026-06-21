# SubScript Protocol - Features & Services Catalog

SubScript is a fast, private, and reliable decentralized subscription platform built on the Arc Network. It allows merchants to create non-custodial recurring payment systems, checkout links, and institutional payroll streams using Uniswap's Permit2 standard and Arc's privacy precompiles.

---

## 1. Core Smart Contract Architecture

The protocol layer operates completely non-custodially and transiently.

### SubScriptRouter.sol
* **Stateless Transient Vault**: Operates as a transient dispatcher that routes payouts to merchant-defined addresses instantly, holding zero balance across blocks.
* **Tier-Gated Payout Destination**: Allows Premium merchants to configure custom payout addresses (`merchantPayoutDestination`), automatically rerouting standard on-chain settlements.
* **Array-Size Hardening**: Restricts batch payouts using explicit requirements (\`recipients.length < 255\`) to prevent block gas limit exhaustion.

### SubScriptPSA.sol
* **Permit2 PSA subscriptions**: Leverages the Permit2 allowance standard for recurring subscription processing instead of legacy ERC-20 infinite approvals.
* **Non-Custodial Pull Payments**: Enables keepers to pull recurring payments automatically from subscribers based on active sign-offs and signatures.

### SubScriptConfidential.sol
* **Confidential Batch Payouts**: Extends standard subscription flows by integrating Arc Network's native privacy precompiles (address \`0x88\`).
* **Shielded Metadata**: Emits masked events for shielded batches (hiding counterparty addresses and exposing only aggregate amounts).
* **View Key Governance**: Allows merchants to register a hash of their view key to decrypt and fetch historical plaintext logs, protecting transactional privacy on-chain.

---

## 2. Database Models (Prisma / PostgreSQL Schema)

The persistent database layer tracks off-chain state and audit trails.

* **WaitlistLead**: Captures waitlist submissions (emails, wallet addresses, and monthly volume).
* **ApiKey**: Stores merchant publishable and secret keys for API authentication.
* **WebhookEndpoint & WebhookEvent**: Manages registered listener URLs and events (logs event status, payload, and receiver responses).
* **Session**: Tracks client sessions for wallet-based authentication.
* **PaymentLink**: Stores generated checkout links (including newly added idempotency keys and merchant name snapshots).
* **PaymentLinkPayment**: Tracks individual payments matching generated checkout links.
* **Merchant**: Stores merchant tier levels (\`FREE\` vs. \`PREMIUM\`), payout destinations, balances, and view key hashes.
* **Subscription**: Monitors subscription agreements, current nonces, next billing dates, and billing periods.
* **PaymentSession**: Manages dynamic session cycles (pending, processing, completed, or reconciliation state).
* **PayoutBatch, PayoutBatchChunk, PayoutBatchItem**: Tracks multi-transaction payroll executions and balances.
* **IdempotencyKey**: Stores API request execution locks to prevent double-charging or duplicate entries.
* **LedgerEntry**: Records non-custodial accounting logs.
* **WebhookDelivery**: Audits webhook delivery attempts, retries, and errors.
* **MerchantEmailTemplate**: Stores custom exit survey subject lines and bodies for churn recovery emails.
* **PayrollCampaign & PayrollRecipient**: Stores campaign titles, payment frequencies, next paydays, Permit2 credentials, and employee wallets for Institutional Payroll.
* **MeteredVault**: Stores prepaid usage balances, thresholds, top-up amounts, monthly velocity limits, and per-merchant customer consumption state.
* **AddressAlias**: Stores SubScript DNS-style aliases that map human-readable names to user and merchant wallet addresses.

---

## 3. Backend API Services

Next.js App Router API handlers power integration endpoints.

### Authentication & Sessions (\`/api/auth\`)
* **Signature-Based Auth**: Validates wallet signatures to create secure session cookies.

### Developer API Keys (\`/api/keys\`)
* **Key Management**: Allows Premium merchants to generate and revoke public/secret keys.

### Payment Links Service (\`/api/payment-links\`)
* **Checkout Link Creation**: CRUD endpoints for payment checkout links.
* **Idempotency Locks**: Automatically returns existing records for matching idempotency keys to prevent duplicate database writes.
* **Merchant Snapshots**: Writes a merchant name snapshot to the link record to protect against retrospective name updates.

### Metered Vaults (\`/api/user/vault/*\`)
* **Flexible Usage-Based Billing**: Lets merchants report API token usage, AI model consumption, storage capacity, pay-per-view access, or other metered events against a user's prepaid vault.
* **Automatic Top-Up Triggers**: Tracks thresholds and top-up amounts so low balances can initiate a replenishment flow without forcing static subscription tiers.
* **Monthly Velocity Controls**: Enforces monthly spending limits for metered relationships.

### DNS Alias Service (\`/api/merchant/alias\`)
* **Human-Readable Payment Identities**: Allows users and merchants to register wallet aliases for easier recognition, transfer routing, and checkout display.
* **Role-Aware Namespaces**: Supports user-facing `.sub` names and merchant-facing `.hq` / `.biz` names.

### Webhook Infrastructure (\`/api/webhooks\`)
* **Webhook CRUD (\`/webhooks/endpoints\`)**: Allows Premium merchants to register webhook URLs.
* **Event Dispatcher (\`/webhooks/dispatch\`)**: Validates webhook signatures and enqueues events to all active merchant listener URLs.
* **Subscript Sync (\`/webhooks/subscript\`)**: Syncs on-chain subscription events directly into the off-chain database.

### Automated Keepers & Cron Executors
* **Billing Cron (\`/api/cron/billing\`)**: Automatically checks and triggers execution of due subscriptions.
* **Payroll Cron (\`/api/internal/payroll\`)**: Loops over active payroll campaigns, checks due dates, transfers USDC from organization vaults, and calls the confidential batch payout contract.

### Institutional Payroll CRUD (\`/api/merchant/payroll\`)
* **Premium Gated Operations**: Rejects non-premium merchants (returning 403 Forbidden) for GET, POST, PUT, and DELETE methods.

---

## 4. Frontend Dashboards & UIs

A premium dark glassmorphic web dashboard designed for desktop screens.

### Merchant Portal
* **Earnings & Balances**: Visualizes available and reserved USDC balances.
* **API Configuration Panel**: Allows merchants to manage API keys, webhooks, and payout routing.
* **Upgrade Portal**: Facilitates subscribing to the Premium tier.

### Checkout Page (\`/pay/[id]\`)
* **Permit2 Signature Checkout**: Dynamic payment links with Open Graph and Twitter Card relative image paths for optimized social previews.

### Institutional Payroll Panel (\`/dashboard/payroll\`)
* **Campaign Manager**: Form to title payroll plans, set cycles, and upload recipient wallets.
* **Permit2 Signature Flow**: Signs EIP-712 Permit2 typed data approvals allowing keepers to pull payroll funds.
* **Tier-Lock Overlay**: Injects a glass lock card with a Lock icon for Standard tier merchants, covering all inputs and directing them to the upgrade screen.

### Usage-Based Billing Surfaces
* **Merchant Analytics Vault View**: Shows active customer prepaid vaults and lets merchants report usage through API-backed controls.
* **User Vault Controls**: Lets users configure merchant vault thresholds, top-up amounts, and monthly limits.

---

## 4.5 Product Feature Positioning

* **Pay for Me / Sponsored Subscriptions**: Designed for relationships where parents, employers, teams, or sponsors cover another user's costs while limiting unnecessary data exposure.
* **Automated Notification Gateways**: Enterprise messaging surfaces combine webhooks, DMs, and managed notification delivery for high-volume payment operations.
* **Quantum-Resilience Roadmap**: The protocol inherits Arc's roadmap for post-quantum wallet signatures, privacy-sector hybrid cryptography, and validator communication hardening.

---

## 5. Developer CLI & Integration Tooling

A CLI tool for scaffolding SubScript integrations.

* **Project Scaffolding**: Installs SDK packages, generates environment templates (\`.env.local\`), and scaffolds boilerplate Next.js webhook routes.
* **Agent Integration Rules**: Generates a \`.cursorrules\` context file that mandates local environment key usage and webhook signature validation before handling raw payloads.

---

## 6. Model Context Protocol (MCP) Server

SubScript exposes a Model Context Protocol server to allow AI editors (such as Cursor or Claude) to interact with the project natively.

* **Smithery Scanning Support**: A static card path (\`/.well-known/mcp/server-card.json\` routed via GET API) allows automated registries to scan capabilities cleanly without method restrictions.
