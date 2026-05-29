# SubScript Merchant Control Dashboard

The central command dashboard for merchants integrating the SubScript protocol.

## Navigation Sections

### 1. Overview
*   **Active Subscriptions:** Monitor active subscriber metrics and recurring volume.
*   **Balance & Settlement:** View real-time USDC balance stored in the vault ledger, ready for pull settlement.
*   **Premium Mode Status:** Displays whether the connected wallet has upgraded to Premium Mode.

### 2. API Credentials
*   **API Key Management:** Provides integration credentials:
    *   `pk_test_*` / `pk_live_*` Publishable Keys.
    *   Secret Key management with instant "Roll Credentials" rotation features.
*   **Environment Toggle:** Instantly switch between Sandbox (Testnet) and Production (Mainnet) contexts.

### 3. Checkout Setup
*   **Dynamic Code Generator:** Generate copy-pasteable React, Next.js, and HTML integration scripts.
*   **Customization Panel:** Change plan name, plan description, price (USDC), and checkout layout parameters. The integration code updates dynamically.

### 4. Webhooks
*   **Chronological Event Stream:** Inspect webhook payloads (e.g. `subscription.session.created`, `subscription.payment.failed`, `subscription.payment.succeeded`).
*   **Replay System:** Re-send historical webhooks directly from the developer panel.

### 5. Fiat Off-Ramp Settlement
*   **Split Settlements:** Adjust custom percentage slider (e.g. 50/50 split) between automated bank wire (USD fiat) and crypto (native USDC).
*   **Premium Cold Routing:** Override active session keys to send funds directly to corporate multisigs, ledger addresses, or hardware wallets.
