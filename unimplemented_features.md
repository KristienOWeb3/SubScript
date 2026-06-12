# SubScript Protocol - Unimplemented Features & Services

This document lists all features, database tables, and core services that were discussed or planned in historical development logs but have not yet been implemented in the codebase.

---

## 1. Database & Ledger Integrity

### Unified Audit Trail (`payment_receipts` table)
A proposed transaction receipts table designed to streamline support issues. It would record detailed metadata for every on-chain transfer:
* **tx_hash** (VARCHAR(66), Primary Key)
* **wallet_address** (VARCHAR(42))
* **amount** (NUMERIC)
* **recipient** (VARCHAR(42))
* **token_address** (VARCHAR(42))
* **block_number** (BIGINT)
* **verified_at** (TIMESTAMP)
* **status** (VARCHAR(20))

### Strict Database-Level Constraints
* **UNIQUE constraints**: Enforcing unique indexes on `subscriptions.payment_tx_hash` and `webhook_events.tx_hash` to guarantee ledger consistency.
* **Status validation**: Database-level check constraints (e.g. `CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED'))`) to prevent invalid state insertions.

---

## 2. Autonomous Infrastructure & Recovery

### Self-Healing Reconciliation Worker
* **Blockchain Log Indexer**: A cron-based recovery service running every 5 minutes to scan recent blocks on the Arc Network.
* **Auto-Repair Mechanics**: Compares block records against the off-chain `subscriptions` table and automatically repairs missing states or session discrepancies caused by RPC timeouts, database downtime, or server restarts.

### Keeper Operational Kill Switch
* **Emergency Halt**: An administrator-governed state check inside the keeper triggers to instantly stop recurring executions and batch transactions in the event of an exploit, migration, or upgrade.

---

## 3. Advanced Protocol Modules (Roadmap)

### Settlement Treasury Rules Module
* **Automated Payout Splitting**: Splits settlements instantly upon withdrawal based on merchant configurations (e.g., automatically routing 40% to Operations, 30% to Payroll, 20% to Treasury, and 10% to Tax Reserve).

### Scheduled Payout Orchestrator
* **Calendar Payout Streams**: Automates recurring payroll campaign executions based on exact calendar intervals without requiring manual merchant triggers.

### Cryptographic Merkle & SNARK Proofs
* **ZK-Routing Upgrade**: Expands the private routing fallback engine (`private_withdrawals` table) to support advanced zero-knowledge proof types (`future_merkle` and `future_snark` in the `proof_type` column) beyond the current `commit_reveal` baseline.

---

## 4. Wallet & Security Tooling

### Production-Grade Key Custody Integration
* **Embedded Wallets SDK**: Replaces the custom mock key management mechanics with a production-ready embedded wallet SDK (such as Turnkey, Capsule, or Privy) to securely hold real assets on-chain.

### Storage Layout Collision Validator
* **Upgrade Compiler checks**: A CLI tool that compares contract storage layout changes against previous builds before executing upgrade transactions to prevent storage slot collisions.
