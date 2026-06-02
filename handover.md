# Handover Documentation - Security Hardening, Developer Dashboard & Protocol Updates

This document outlines the security architecture passes, isolated testing setups, database lockdown configurations, and dashboard UI improvements implemented to prepare the SubScript application and protocol for production deployment.

---

## 1. Edge-Compliant Distributed Rate Limiting & Payload Checks

### Upstash Redis Rate Limiting
- **Implementation**: Managed in `src/middleware.ts` using `@upstash/redis` and `@upstash/ratelimit`. This ensures distributed rate limits run reliably inside the Next.js Edge Runtime.
- **Configured Limiters**:
  - `authLimiter`: Max 5 attempts per 15 minutes per IP. Applied to all authentication routes:
    - `/api/auth/login`
    - `/api/auth/otp/send`
    - `/api/auth/otp/verify`
    - `/api/auth/social`
    - `/api/auth/verify-signature`
  - `globalLimiter`: Max 100 requests per 15 minutes per IP. Applied to all standard API routes starting with `/api/` (except the matched auth routes).
- **Client IP Resolution**: Evaluates `request.ip` with header fallback to the first address in `x-forwarded-for`.
- **Response**: Triggers standard JSON HTTP 429 (Too Many Requests) when limits are breached.

### Payload Size Limits
- **Implementation**: Enforced globally on POST/PUT requests in `src/middleware.ts`.
- **Threshold**: Rejects payloads exceeding 1MB (1,048,576 bytes) by inspecting the `Content-Length` header before serverless functions execute.
- **Response**: Triggers JSON HTTP 413 (Payload Too Large).

---

## 2. Input Sanitization & Payload Validation

### Security Utility (`src/utils/security.ts`)
- **Sanitization**: Added `sanitizeInput<T>(input: T): T` to recursively process API request bodies:
  - Strips `<script>` blocks and generic HTML tags from string values.
  - Trims leading and trailing whitespace.
  - Prevents prototype pollution attacks by skipping keys named `__proto__`, `constructor`, or `prototype` during traversal.
- **Route Integration**: Applied sanitization and strict validation of request arguments to authentication and webhook dispatch handlers. Malformed inputs return HTTP 400 (Bad Request).

---

## 3. Environment Variables & Secrets Audit

### Secrets Removal
- **No Fallbacks**: Removed all default fallback strings for `JWT_SECRET` and `KEEPER_SECRET` from Next.js server endpoints and client-side scripts.
- **Safe Failures**: The application throws a startup error or returns HTTP 500 if these parameters are missing.

### Local Environment Configuration (`.env`)
The local `.env` configuration contains the credentials necessary for rate limiting and local testing:
- `JWT_SECRET`: Signing token for developer dashboard sessions.
- `KEEPER_SECRET`: Bearer authorization token used by the keeper bot.
- `UPSTASH_REDIS_REST_URL`: REST connection endpoint for Upstash Redis database.
- `UPSTASH_REDIS_REST_TOKEN`: Upstash authorization token.

---

## 4. Smart Contract Isolation & Test Refactoring

### Mock Isolation
- **Directory**: Shifted `MockUSDC.sol` out of the core contract directory to `test/mocks/MockUSDC.sol`. This isolates test tokens completely from production smart contract sources.
- **Network-Aware Deployment (`script/DeploySubScript.s.sol`)**:
  - Dynamically evaluates `block.chainid` before setting up contracts.
  - If `block.chainid == 31337` (Anvil Localhost), the script automatically deploys a new `MockUSDC` instance and links the router.
  - If on any other chain (Testnet or Mainnet), it skips deployment of the mock token and links to the production USDC address (`0x3600000000000000000000000000000000000000`).
- **Tests Update**: Replaced `MockUSDC` imports in `test/SubScriptRouter.t.sol` and `test/SubScriptInvariants.t.sol` to reference the test-only mock file directory `./mocks/MockUSDC.sol`.

---

## 5. Supabase Row-Level Security (RLS) Lockdown

### Migration File (`supabase/migrations/20260531_enable_rls_default_deny.sql`)
- Enables RLS across all 9 database tables: `merchants`, `api_keys`, `waitlist_leads`, `webhook_endpoints`, `webhook_events`, `otp_codes`, `user_embedded_wallets`, `subscriptions`, and `sessions`.
- Drops old permissive select/update policies.
- Enforces strict "Default Deny" (`USING (false)`) policies for all anonymous and authenticated public roles.
- Direct database writes or reads from browser clients using public API keys are blocked. All backend queries proxy securely via the Supabase Service Role key (which bypasses RLS).

---

## 6. Developer Dashboard UI/UX Shimmer Skeletons

### Liquid Glass Skeleton (`src/components/ui/Skeleton.tsx`)
- Reusable UI component with `backdrop-filter: blur(12px)` and a subtle refractive border (`border: 1px solid rgba(255, 255, 255, 0.1)`) matching the protocol's glassmorphism style.
- Incorporates keyframes for a sweeping gradient shimmer (`liquid-glass-shimmer`) overlayed with a transparency pulse (`liquid-pulse`) to convey liquid movement and depth.

### Dashboard Layout Skeletons (`src/components/DashboardSkeleton.tsx`)
- Renders page structure skeletons that visually mirror the active views:
  - **Overview**: Placeholder shapes for stats grid cards, horizontal tier badge card, and rows of the customer/agent ledger table.
  - **Premium**: Status container, payout rerouting input boxes, keeper control buttons, and features grid.
  - **API Keys**: Skeletons for credentials metadata cards, copy triggers, and key rotation buttons.
  - **Checkout Setup**: Form configurator card on the left, code snippet blocks on the right.
  - **Webhooks**: Endpoint list items, live webhook event cards, and payload JSON viewer.

### Conditional Hydration Guard (`src/app/dashboard/page.tsx`)
- Declares initial load trackers (`initialKeysFetched`, `initialWebhooksFetched`, `initialEventsFetched`, `initialContractFetched`) representing backend api endpoints and contract calls.
- Swaps active tabs with skeleton components on load, transitioning into real data only when all initial fetches resolve.

---

## 7. Waitlist API & Landing Page Updates

### API Route Surgical Hardening (`src/app/api/waitlist/route.ts`)
- Configured to bypass RLS policies by using the server-side `SUPABASE_SERVICE_ROLE_KEY`.
- Wraps insertion queries in a try/catch block, logs the insert JSON payload to the console, and exposes raw database constraint errors directly to the client instead of hiding behind generic HTTP 500 messages.

### Frontend Waitlist Form Error Surfacing (`src/app/page.tsx`)
- Destroyed the generic hardcoded error fallback string `"We could not save that submission. Please try again."`.
- Captures raw backend error payloads (`payload.error` or `payload.details.message`) or catch-block connection strings (`err.message`) and sets them to the React form error state, enabling transparent error reporting.
- Updated the landing page hero sub-headline to: *"Recurring USDC infrastructure for AI toolchains, autonomous agents, and developer APIs. Built on the Arc Network for sub-second settlement, predictable pricing, and zero smart-contract headaches."*

---

## 8. Release & Production Verification Checklist

1. **Verify Code Integrity**:
   - Ensure type check compiles without errors:
     `npx tsc --noEmit`
   - Run the production builder:
     `npm run build`
2. **Apply Database Migration**:
   - Copy the SQL migration script from `supabase/migrations/20260531_enable_rls_default_deny.sql`.
   - Open your project dashboard in the **Supabase Console** -> **SQL Editor**.
   - Paste the SQL script and select **Run**.
3. **Configure Environment Variables in Vercel**:
   - Ensure the following variables are set in production:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `JWT_SECRET`
     - `KEEPER_SECRET`
     - `UPSTASH_REDIS_REST_URL`
     - `UPSTASH_REDIS_REST_TOKEN`
     - `RESEND_API_KEY`
