# SubScript Protocol Security Operations (SECOPS) & Incident Response Runbook

This runbook defines the operational security procedures, multi-sig calldata generation, emergency pause controls, contract upgrade processes, key compromise playbooks, and incident response frameworks for SubScript on Arc Mainnet.

---

## 1. Governance Architecture & Multi-Sig Roles

### 1.1 Role Definitions
*   **Network:** Arc Network Mainnet (`5042001`)
*   **Multi-Sig Owner (`MULTISIG_ADDRESS`):** Gnosis Safe multi-sig (e.g., 3-of-5 threshold) with air-gapped hardware signer wallets (Ledger/Trezor). Controls UUPS proxy upgrades, emergency pausing, parameter updates, and dispute resolutions.
*   **Official Protocol Treasury (`TREASURY_ADDRESS`):** Cold multi-sig address receiving the protocol's 1% merchant fees.
*   **Admin Keeper EOA (`PRIVATE_KEY`):** Automated signer for customer subscription renewals (`/api/cron/customer-billing`) and payroll campaigns.
*   **Vault Drawer Keeper EOA (`KEEPER_PRIVATE_KEY`):** Authorized in `SubScriptVault` (`authorizedDrawers`) to settle matured metered-vault cycles.
*   **Gas Sponsor EOA (`SPONSOR_PRIVATE_KEY`):** Funded wallet for Circle Gas Station deficit top-ups.

---

## 2. Emergency Pause & Unpause Execution

Both `SubScriptRouter` and `SubScriptVault` inherit OpenZeppelin `PausableUpgradeable` and are controlled exclusively by the Multi-Sig Safe.

### 2.1 SubScriptRouter Pause / Unpause
*Pausing the Router halts `depositForMerchant`, merchant `withdraw`, `withdrawTo`, and `executeBatchPayout`.*

#### Calldata Generation:
```bash
# Pause SubScriptRouter
cast calldata "pause()"
# -> Output: 0x84b0196e

# Unpause SubScriptRouter
cast calldata "unpause()"
# -> Output: 0x3f4b7b65
```

### 2.2 SubScriptVault Pause / Unpause
*Pausing the Vault halts new `commit` escrow deposits and keeper settlement `drawUsageFor`. `reclaimAbandonedEscrow` remains functional after the 7-day grace period even while paused to guarantee user fund safety.*

#### Calldata Generation:
```bash
# Pause SubScriptVault
cast calldata "pause()"
# -> Output: 0x84b0196e

# Unpause SubScriptVault
cast calldata "unpause()"
# -> Output: 0x3f4b7b65
```

### 2.3 Gnosis Safe Multi-Sig Execution Steps
1. Navigate to the Gnosis Safe web dashboard on Arc Mainnet.
2. Click **New Transaction** → **Contract Interaction** (or Raw Transaction).
3. In the **Target Address** field, paste the target UUPS Proxy address (`SubScriptRouter` or `SubScriptVault`).
4. Set **ETH / USDC Value** to `0`.
5. In the **Data (hex)** field, paste `0x84b0196e` (to pause) or `0x3f4b7b65` (to unpause).
6. Sign the transaction using your hardware wallet.
7. Collect threshold signatures from co-signers.
8. Broadcast the transaction and verify status on Arcscan.

---

## 3. UUPS Contract Upgrade Procedure

`SubScriptRouter` and `SubScriptVault` are upgradeable via UUPS (ERC-1822) proxies. Upgrades require deploying a new logic implementation and executing `upgradeToAndCall` from the Multi-Sig Safe.

### Step A: Deploy New Logic Implementation
Deploy the new implementation bytecode using Foundry or Hardhat:
```bash
forge create contracts/SubScriptRouter.sol:SubScriptRouter \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_KEY \
  --verify
# -> Note the implementation address: 0xNEW_IMPLEMENTATION_ADDRESS
```

### Step B: Generate Upgrade Calldata
```bash
# Without re-initialization:
cast calldata "upgradeToAndCall(address,bytes)" <0xNEW_IMPLEMENTATION_ADDRESS> 0x

# With re-initialization (e.g. initializeV2(address)):
INIT_DATA=$(cast calldata "initializeV2(address)" <0xTREASURY_ADDRESS>)
cast calldata "upgradeToAndCall(address,bytes)" <0xNEW_IMPLEMENTATION_ADDRESS> $INIT_DATA
```

### Step C: Multi-Sig Execution
1. Create a transaction in Gnosis Safe targeting the active UUPS Proxy contract address.
2. Paste the `upgradeToAndCall` calldata into the hex data input field.
3. Simulate the transaction using Safe's simulation tool (Tenderly / built-in simulator).
4. Collect required threshold signatures and broadcast.
5. Verify on Arcscan that the proxy's EIP-1967 implementation slot points to `0xNEW_IMPLEMENTATION_ADDRESS`.

---

## 4. Operational & Governance Calldata Recipes

### 4.1 Authorize Vault Drawer Keeper
Grant keeper EOA authority to execute `drawUsageFor` on `SubScriptVault`:
```bash
cast calldata "setAuthorizedDrawer(address,bool)" <0xKEEPER_WALLET_ADDRESS> true
```

### 4.2 Resolve Vault Dispute
Resolve an active user-merchant escrow dispute on `SubScriptVault`:
```bash
# reopenSettleWindow = true allows keeper a fresh window to settle; false immediately unfreezes escrow
cast calldata "resolveDispute(address,address,bool)" <0xUSER_ADDRESS> <0xMERCHANT_ADDRESS> true
```

### 4.3 Update Protocol Treasury Address
Update the recipient address for the 1% protocol fee on `SubScriptRouter`:
```bash
cast calldata "setTreasury(address)" <0xNEW_TREASURY_ADDRESS>
```

### 4.4 Set Merchant Tier (Premium Redirection)
Set merchant tier on `SubScriptRouter` (0 = Standard, 1 = Premium):
```bash
cast calldata "setMerchantTier(address,uint8)" <0xMERCHANT_ADDRESS> 1
```

---

## 5. Incident Response Framework

### 5.1 Severity Classification Matrix

| Level | Description | Examples | Response Target |
|---|---|---|---|
| **SEV-1 (Critical)** | Direct risk to user/merchant funds; active exploit; contract vulnerability. | Smart contract invariant breach; private key leak; unauthorized fund movement. | < 15 minutes |
| **SEV-2 (Major)** | Core money path outage; zero settlement capability. | RPC cluster outage; Circle API downtime; keeper renewal failure across all merchants. | < 1 hour |
| **SEV-3 (Moderate)**| Degraded performance; non-critical feature outage. | Webhook delivery delay; analytics sync lag; email notification delays. | < 4 hours |
| **SEV-4 (Low)** | Minor bug; UI/cosmetic defect; non-financial path glitch. | Docs typo; dashboard formatting bug. | Next business day |

### 5.2 Emergency SEV-1 Incident Response Protocol

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│ 1. Identification│ ──▶ │ 2. War Room Open │ ──▶ │ 3. Emergency Stop │ ──▶ │ 4. Investigation │
│ Alert triggered │     │ IC appointed     │     │ Breakers / Pause  │     │ Root cause found │
└─────────────────┘     └──────────────────┘     └───────────────────┘     └────────┬─────────┘
                                                                                    │
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐              │
│ 7. Post-Mortem  │ ◀── │ 6. Recovery & Go │ ◀── │ 5. Patch / Upgrade│ ◀────────────┘
│ Public report   │     │ Unpause & verify │     │ Audit & deploy    │
└─────────────────┘     └──────────────────┘     └───────────────────┘
```

1. **Appoint Incident Commander (IC):** Lead engineer assumes IC role; designated Comms Lead handles stakeholder communications.
2. **Open Incident War Room:** Dedicated voice bridge (Google Meet) and encrypted Signal chat.
3. **Execute Emergency Stops:**
   - **Step 1:** In SubScript Admin Console (`/admin`), toggle `withdrawals_enabled = false` and `sponsor_emergency_stop = true`.
   - **Step 2:** If smart contract exploit is suspected, initiate emergency Safe multi-sig transaction to broadcast `pause()` (`0x84b0196e`) on `SubScriptRouter` and `SubScriptVault`.
   - **Step 3:** Enable edge maintenance mode via `maintenance_enabled = true`.
4. **Isolate Root Cause:** Reproduce in local Foundry environment with a fork of Arc mainnet.
5. **Develop & Audit Patch:** Develop smart contract or API patch, verify with full test suites, and obtain auditor sign-off.
6. **Deploy & Unpause:** Deploy patched implementation, execute `upgradeToAndCall` via Multi-Sig Safe, verify invariants, and unpause.
7. **Post-Mortem & Disclosure:** Publish full technical post-mortem within 72 hours.

---

## 6. Key Compromise Playbooks

### 6.1 Admin Keeper / Sponsor EOA Key Compromise
If `PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, or `SPONSOR_PRIVATE_KEY` is suspected compromised:
1. Immediately sweep any remaining native USDC gas from the compromised address to the Multi-Sig Safe.
2. In `SubScriptVault`, call `setAuthorizedDrawer(compromisedAddress, false)` via Safe multi-sig.
3. Generate a fresh, uncommitted keypair on an air-gapped machine.
4. Fund the new keypair with gas float.
5. In `SubScriptVault`, call `setAuthorizedDrawer(newAddress, true)`.
6. Update the corresponding environment secret (`PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `SPONSOR_PRIVATE_KEY`) in Vercel and GitHub Actions.
7. Redeploy Vercel application and test keeper run.

### 6.2 Circle Entity Secret Compromise
If the production `CIRCLE_ENTITY_SECRET` is compromised:
1. Immediately notify Circle Developer Support.
2. In Circle Developer Console, initiate emergency Entity Secret rotation.
3. Re-register new Entity Secret ciphertext using Circle Public Key API.
4. Update `CIRCLE_ENTITY_SECRET` and `CIRCLE_API_KEY` across production environment variables.
5. Redeploy application.

### 6.3 Multi-Sig Signer Key Compromise
If a single multi-sig signer hardware wallet is lost or compromised:
1. Remaining uncompromised signers (meeting the threshold) create a Gnosis Safe transaction:
   `removeOwner(prevOwner, compromisedOwner, newThreshold)` or `swapOwner(prevOwner, oldOwner, newOwner)`.
2. Hardware signers sign and broadcast the owner swap on Arcscan.
3. Verify updated owner list in Safe interface.

---

## 7. Incident Post-Mortem Template

```markdown
# Incident Post-Mortem: [Incident Title]
**Date of Incident:** YYYY-MM-DD
**Severity:** SEV-1 / SEV-2 / SEV-3
**Incident Commander:** [Name]
**Duration:** [Start Time UTC] to [Resolution Time UTC] ([X] hours)

## Executive Summary
Brief non-technical overview of what happened, customer impact, and current status.

## Impact Analysis
- Total financial loss: [0 USDC / Amount]
- Affected accounts / subscriptions: [Count]
- Service downtime duration: [Minutes]

## Timeline (UTC)
- HH:MM — Event triggered
- HH:MM — Alert received by engineering
- HH:MM — War room convened; IC appointed
- HH:MM — Emergency breaker / pause executed
- HH:MM — Root cause identified
- HH:MM — Remediation deployed
- HH:MM — Operational health verified; incident closed

## Root Cause Analysis (5 Whys)
Detailed technical breakdown of the vulnerability or failure mechanism.

## Corrective Actions & Preventative Measures
1. [Action Item 1] — Owner: [Name] — Status: [Pending / Complete]
2. [Action Item 2] — Owner: [Name] — Status: [Pending / Complete]
```
