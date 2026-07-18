# SubScript Protocol - Strategic Architecture Suggestions

This document details suggestions and security improvements for the next phase of the SubScript Protocol.

Status audit 2026-07-08: #2 (multi-RPC failover) is implemented in `src/lib/payments/rpc.ts` (sequential provider failover with a failover metric). #4 (replay-protected webhooks) is implemented in `src/lib/webhooks.ts` (`x-subscript-signature: t=<unix>,v1=<hmac>` — HMAC over `timestamp.body`, regenerated per attempt; merchants must enforce a timestamp tolerance). #1, #3, #5, and #6 remain open.

---

## 1. Off-Chain Signature Pre-Validation
* **The Vulnerability**: Keepers currently pick up signed Permit2 allowances from the database and execute them on-chain. If a merchant's signature is invalid or expired, the on-chain transaction reverts, wasting gas fees.
* **The Solution**: Implement off-chain signature pre-validation inside the payroll trigger endpoints using `ethers.verifyTypedData`. Any invalid or expired Permit2 signatures must be rejected or marked `FAILED` before on-chain execution is attempted.

---

## 2. Multi-RPC Failover Layer
* **The Vulnerability**: Keepers rely on `process.env.RPC_URL` to query blocks and execute transactions. If the main provider encounters downtime or rate limits (HTTP 429), the keeper crashes.
* **The Solution**: Expand `executeWithRpcFallback` to dynamically switch to a pool of failover RPC endpoints:
  ```typescript
  /* Example configuration array: */
  const RPC_POOL = [
      process.env.RPC_URL_PRIMARY,
      process.env.RPC_URL_FALLBACK_1,
      process.env.RPC_URL_FALLBACK_2
  ];
  ```

---

## 3. Database Performance Indexing
* **The Issue**: As campaigns and recipients scale, scanning the tables in cron loops will degrade performance.
* **The Solution**: Add index mappings in `schema.prisma` for high-frequency queries:
  ```prisma
  /* Proposed indexing: */
  @@index([organizationAddress, status])
  @@index([campaignId])
  ```

---

## 4. Replay-Protected Webhook Payloads
* **The Vulnerability**: Webhook dispatches are susceptible to replay attacks if attackers capture payloads and re-send them to merchant endpoints.
* **The Solution**: Include a custom header containing a unix timestamp (e.g. `X-SubScript-Timestamp`) and sign the concatenated body + timestamp to prevent attackers from replaying historic webhook dispatches.

---

## 5. Gas Price Buffer & Cache
* **The Issue**: Gas spikes on-chain can cause transactions to fail or get stuck.
* **The Solution**: Implement a dynamic gas estimation buffer ($10\%$ to $20\%$ overhead) inside the keeper executor, and cache estimated fee values for 15 seconds to avoid RPC request congestion.

---

## 6. Secure Edge View Key Validation
* **The Issue**: Querying view keys on-chain consumes gas.
* **The Solution**: Perform view key validation off-chain inside secure edge functions or Vercel lambda instances, checking computed hashes against the database `view_key_hash` before invoking the smart contracts.
