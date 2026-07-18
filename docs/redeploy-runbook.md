# Redeploy runbook — fresh contracts owned by a secure key (Path A)

The live Router / Confidential(PSA) / Vault on Arc testnet are all owned by the **exposed key**
(`0x59D67d7c…`, private key in git history). Rotating env keys did nothing to on-chain ownership,
and the deployed bytecode is the old (vulnerable) version. Path A replaces all three with fresh
contracts owned by a secure key and running the hardened code — sidestepping the compromised key
entirely. **You run the deploys** (they need your secure key); this repo now has the tooling.

> Deploy tooling refuses to deploy owned by the exposed key, so you can't recreate the problem.

## 0. Prerequisites

- Foundry (`forge`) and Node/Hardhat installed (both already used by this repo).
- A **fresh secure key** whose private key was never committed. Generate offline and store in a
  password manager / secrets vault:
  ```bash
  node -e "const w=require('ethers').Wallet.createRandom(); console.log('address:', w.address); console.log('PRIVATE KEY (save securely):', w.privateKey)"
  ```
  Call its address `SECURE_OWNER`. Fund it with a little USDC on Arc testnet (USDC is the gas token).
- `RPC_URL` for Arc testnet (`https://rpc.testnet.arc.network`).

> For a multisig owner: deploy with a secure EOA first (the deploy runs `onlyOwner` setup), then
> `transferOwnership` to the Safe afterward. The vault/router are single-step OZ Ownable.

## 1. Deploy order

Run from the repo root. `PRIVATE_KEY` = your `SECURE_OWNER` key everywhere below.

### 1a. StableFX router (needed by Confidential)
Testnet: deploy the mock, or reuse an existing StableFX address.
```bash
PRIVATE_KEY=0x<secure> RPC_URL=<arc> npx hardhat run scripts/deploy-mock-stablefx.js --network arcTestnet
# -> note the address as STABLEFX_ROUTER_ADDRESS
```

### 1b. Router (UUPS proxy)
```bash
npx hardhat run scripts/deploy-router.js --network arcTestnet
# -> note the printed "SubScriptRouter proxy:" address as NEW_ROUTER
```
Reads `MULTISIG_ADDRESS` (owner, required — hard-fails on the exposed key) + `TREASURY_ADDRESS` from
`.env`. (Foundry alternative if you have `forge`: `forge script script/DeploySubScript.s.sol --rpc-url <arc> --broadcast`.)

### 1c. Confidential / subscription contract (constructor)
```bash
PRIVATE_KEY=0x<secure> CONTRACT_OWNER_ADDRESS=<SECURE_OWNER> \
  STABLEFX_ROUTER_ADDRESS=<from 1a> USDC_ADDRESS=0x3600000000000000000000000000000000000000 \
  npx hardhat run scripts/deploy-confidential.js --network arcTestnet
# -> note the address as NEW_STANDARD (the "standard contract")
```

### 1d. Vault (UUPS proxy)
```bash
npx hardhat run scripts/deploy-vault.js --network arcTestnet
# -> note the printed "SubScriptVault proxy:" address as NEW_VAULT
```
Reads `VAULT_OWNER_ADDRESS` / `TREASURY_ADDRESS` / `KEEPER_ADDRESS` from `.env`. The deployer must
equal `VAULT_OWNER_ADDRESS` (owner-only setup — `initializeV2`, `setAuthorizedDrawer` — runs here).
(Foundry alternative: `forge script script/DeployVault.s.sol --rpc-url <arc> --broadcast`.)

## 2. Point the app at the new contracts

Update these in **Vercel (Production + Preview)** and local `.env.local`, then redeploy the app:

| Variable | New value |
|---|---|
| `NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS` | `NEW_ROUTER` |
| `NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS` | `NEW_STANDARD` |
| `NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS` | `NEW_VAULT` |
| `STABLEFX_ROUTER_ADDRESS` | from 1a |
| `PRIVATE_KEY` (admin/owner ops) | your secure key |
| `KEEPER_PRIVATE_KEY` / `KEEPER_SECRET` | already rotated |

`bin/sue.js` and `scripts/check-contracts.mjs` read the router/vault addresses from env, so they
follow automatically once the vars are set.

## 3. Old state and funds

On-chain state does NOT migrate — new contracts start empty, so existing subscriptions and vault
commits live only on the OLD (abandoned) contracts. For testnet the clean path is a fresh start:

- **DB mirror**: the mirror rows (subscriptions, `metered_vaults`, receipts) reference old contract
  addresses / sub IDs. Either clear the mirror for the affected surfaces so users re-subscribe /
  re-commit on the new contracts, or leave old rows read-only and let new activity accrue. Do NOT let
  the keeper act on old-contract sub IDs against the new contracts.
- **Old router's 35 USDC**: still recoverable by the exposed owner. Before fully abandoning, you may
  `rescueERC20` it to safety using the exposed key (one last use), or ignore it (testnet).
- **Old vault balances**: users can `withdrawSurplus` / `reclaimAbandonedEscrow` from the old vault.

## 4. Verify

```bash
# router invariants + storage layout (now points at NEW_ROUTER via env)
SUBSCRIPT_ROUTER_ADDRESS=<NEW_ROUTER> node bin/sue.js verify
# broader contract health
npm run check:contracts
```
Confirm on-chain `owner()` of all three is `SECURE_OWNER` (not `0x59D67d7c…`), and the vault's
`authorizedDrawers[keeper]` is true.

## 5. After redeploy — the hardened code is now live

Because you deployed the current source, the fixes that only existed in source are now on-chain:
Router rescue-liability guard, PSA FX slippage bound (`maxPaymentAmount` / `ExcessiveSwapInput`),
vault reclaim window, corrected Confidential semantics. No separate upgrade step is needed. If you
later DO upgrade (UUPS), `bin/sue.js` now selects the newest canonical build-info deterministically
and rolls the proxy back on a failed upgrade — Blocker #2 is fixed.
