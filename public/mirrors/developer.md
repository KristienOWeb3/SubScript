# SubScript Developer Sandbox

An interactive testing environment for developers integrating SubScript.

## Features

### 1. Interactive API Sandbox
*   Simulate live API endpoints locally without deploying code.
*   Select from core protocol functions:
    *   `createSession` - Initiate a new customer subscription session.
    *   `verifySession` - Cryptographically verify session status.
    *   `revokeSession` - Cancel active subscription access.
*   Trigger simulations to view the live JSON response payload.

### 2. Sandbox Terminal
*   Displays live API responses, headers, and performance profiling.
*   Includes status indicators (`200 OK`, `400 Bad Request`, `401 Unauthorized`).
*   Lists typical response objects like `subscription.session` with metadata.

### 3. Webhook Observability
*   Events are recorded in the `merchant_events` ledger before dispatch.
*   Each delivery attempt is logged on a best-effort basis with HTTP status, response body, and timestamp; attempt rows may be absent if persistence fails after the HTTP request.
*   Endpoints are environment-scoped (TEST/LIVE) so sandbox and production traffic are isolated.
*   Secret rotation with grace-period overlap — the previous signing secret stays valid until expiry.
*   Cursor-paginated event history with `?type=` and `?environment=` filters.
*   One-click replay of any stored event from the dashboard.
