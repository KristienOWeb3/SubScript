# SubScript Protocol SECOPS Runbook

This runbook outlines the exact operational procedures for the SubScript Mainnet Multi-Sig signers to execute contract upgrades and toggle emergency pauses.

---

## 1. Environment & Roles

*   **Network:** Arc Network Mainnet
*   **Multi-Sig Owner:** `0x725D56151CeaC9eAd625241D13b8307B22EDDb10`
*   **Active UUPS Proxy Contract:** `0x835A9aEd7287068778e11df9D922B3FfaC7cFc29`
*   **Official Treasury / Cold Storage:** `0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295`

---

## 2. Emergency Pause & Unpause Execution

The `SubScriptRouter` includes a Pausable mechanism to block commitment deposits, activations, and merchant withdrawals in case of an exploit.

### Step A: Generate Calldata to PAUSE the Protocol
To execute a pause, the Multi-Sig must submit a transaction calling `pause()` on the proxy contract.

Generate the exact transaction payload using `cast`:
```bash
cast calldata "pause()"
```
*   **Output Calldata:** `0x84b0196e`

### Step B: Generate Calldata to UNPAUSE the Protocol
Once the emergency is resolved, generate the payload to resume operations:
```bash
cast calldata "unpause()"
```
*   **Output Calldata:** `0x3f4b7b65`

### Step C: Multi-Sig Execution Guide
1. Go to your Multi-Sig Interface (e.g., Safe / Gnosis Safe).
2. Create a new transaction targeting the **UUPS Proxy Address** (`0x835A9aEd7287068778e11df9D922B3FfaC7cFc29`).
3. Set `value` to `0`.
4. In the raw hex data/calldata input field, paste:
   * `0x84b0196e` (to pause) OR
   * `0x3f4b7b65` (to unpause).
5. Sign the transaction and collect threshold signatures from the signers.
6. Broadcast the transaction.

---

## 3. UUPS Contract Upgrade Procedure

The protocol is upgradeable via the UUPS (ERC-1822) proxy pattern. To perform an upgrade, follow these steps:

### Step A: Deploy the New Implementation
Deploy the new implementation contract (`SubScriptRouter` V2) using Forge:
```bash
forge create contracts/SubScriptRouter.sol:SubScriptRouter \
  --rpc-url <RPC_URL> \
  --private-key <DEPLOYER_PRIVATE_KEY> \
  --verify
```
*Take note of the deployed implementation contract address (e.g. `0xNEW_IMPLEMENTATION`).*

### Step B: Generate Upgrade Calldata
Upgrade execution requires calling `upgradeToAndCall(address,bytes)` on the proxy contract.

Generate the exact upgrade calldata using `cast`:
```bash
cast calldata "upgradeToAndCall(address,bytes)" <0xNEW_IMPLEMENTATION> 0x
```
*(Use `0x` for empty bytes if no initialization is required for the new implementation).*

### Step C: Multi-Sig Execution
1. Create a new transaction in your Multi-Sig dashboard targeting the **UUPS Proxy Address** (`0x835A9aEd7287068778e11df9D922B3FfaC7cFc29`).
2. Set `value` to `0`.
3. In the raw hex data field, paste the calldata generated in **Step B**.
4. Collect signatures and execute the transaction.
5. Verify the upgrade on the block explorer by querying the implementation address.
