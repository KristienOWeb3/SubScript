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
