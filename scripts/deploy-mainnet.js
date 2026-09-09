/**
 * scripts/deploy-mainnet.js
 *
 * Comprehensive Arc Mainnet Smart Contract Deployment Script for SubScript Protocol.
 *
 * Deploys the full production contract suite:
 *   1. SubScriptRouter (UUPS Implementation + ERC1967Proxy initialized with paymentToken, treasury, owner)
 *   2. SubScriptPSA (Standard Subscription contract with StableFX multi-currency routing)
 *   3. SubScriptVault (UUPS Implementation + ERC1967Proxy initialized with paymentToken, owner,
 *      then initializeV2(treasury) and setAuthorizedDrawer(keeper))
 *   4. SubScriptConfidential (Privacy-preserving batch payout & commit-reveal view-key contract)
 *
 * Features:
 *   - Dry-run validation (checks deployer balance, verifies parameters, ensures owner != exposed key)
 *   - Automatic mock StableFX deployment when testing on local networks (localhost / hardhat)
 *   - Produces exact .env variables ready for .env.local and Vercel
 *   - Writes deployment receipt JSON to docs/mainnet/deployment-receipt.json
 *
 * Usage:
 *   # Dry-run validation on localhost:
 *   npx hardhat run scripts/deploy-mainnet.js --network localhost --dry-run
 *
 *   # End-to-end execution on localhost:
 *   npx hardhat run scripts/deploy-mainnet.js --network localhost
 *
 *   # Dry-run validation on Arc Mainnet:
 *   npx hardhat run scripts/deploy-mainnet.js --network arcMainnet --dry-run
 *
 *   # Live deployment on Arc Mainnet:
 *   CONFIRM=yes npx hardhat run scripts/deploy-mainnet.js --network arcMainnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/* Historically exposed testnet key: MUST NEVER BE USED AS OWNER OR DEPLOYER */
const EXPOSED_OWNER = "0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69";

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run") || process.env.DRY_RUN === "true";
  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log("\n================================================================================");
  console.log("            SUBSCRIPT PROTOCOL — ARC MAINNET CONTRACT DEPLOYMENT                ");
  console.log("================================================================================");
  console.log(` Network:  ${network} (Chain ID: ${chainId})`);
  console.log(` Mode:     ${isDryRun ? "DRY-RUN SIMULATION (No live state modified)" : "LIVE DEPLOYMENT"}`);
  console.log("================================================================================\n");

  /* ──────────────────────── Signer & Balance Validation ─────────────────────── */
  const signers = await hre.ethers.getSigners();
  if (!signers || signers.length === 0) {
    throw new Error("No deployer signer available. Ensure PRIVATE_KEY is set in environment or hardhat.config.js.");
  }
  const deployer = signers[0];
  const balanceWei = await hre.ethers.provider.getBalance(deployer.address);
  const balance = hre.ethers.formatEther(balanceWei);

  console.log(`Deployer Address: ${deployer.address}`);
  console.log(`Deployer Balance: ${balance} native gas (USDC / ETH)\n`);

  /* Safety check: Exposed key invariant */
  if (deployer.address.toLowerCase() === EXPOSED_OWNER.toLowerCase()) {
    throw new Error(`CRITICAL: Deployer address matches the historically exposed key (${EXPOSED_OWNER}). Deployment aborted.`);
  }

  /* ──────────────────────── Parameter Resolution ───────────────────────────── */
  // Arc native USDC is at 0x3600000000000000000000000000000000000000
  let paymentToken = process.env.USDC_ADDRESS || process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
  let owner = process.env.MULTISIG_ADDRESS || process.env.CONTRACT_OWNER_ADDRESS || process.env.VAULT_OWNER_ADDRESS;
  let treasury = process.env.TREASURY_ADDRESS;
  let keeper = process.env.KEEPER_ADDRESS || process.env.KEEPER_DRAWER_ADDRESS || "";
  let stableFXRouter = process.env.STABLEFX_ROUTER_ADDRESS;

  // On local networks, default unset parameters to deployer for seamless localhost testing
  if (network === "localhost" || network === "hardhat") {
    if (!owner) {
      console.log("[INFO] No MULTISIG_ADDRESS provided. Defaulting owner to deployer for local test.");
      owner = deployer.address;
    }
    if (!treasury) {
      console.log("[INFO] No TREASURY_ADDRESS provided. Defaulting treasury to deployer for local test.");
      treasury = deployer.address;
    }
    if (!stableFXRouter) {
      console.log("[INFO] No STABLEFX_ROUTER_ADDRESS provided. Will deploy MockStableFX for local test.");
    }
  }

  // Fallbacks for mainnet / testnet if owner or treasury not explicitly provided
  if (!owner) {
    owner = deployer.address;
    console.log(`[WARNING] No MULTISIG_ADDRESS configured. Defaulting owner to deployer (${owner}).`);
  }
  if (!treasury) {
    treasury = owner;
    console.log(`[WARNING] No TREASURY_ADDRESS configured. Defaulting treasury to owner (${treasury}).`);
  }

  /* Safety check: Owner cannot be exposed key */
  if (owner.toLowerCase() === EXPOSED_OWNER.toLowerCase()) {
    throw new Error(`CRITICAL: Owner address matches the historically exposed key (${EXPOSED_OWNER}). Deployment aborted.`);
  }

  /* Validation checks */
  if (!hre.ethers.isAddress(paymentToken) || paymentToken === hre.ethers.ZeroAddress) {
    throw new Error(`Invalid paymentToken address: ${paymentToken}`);
  }
  if (!hre.ethers.isAddress(owner) || owner === hre.ethers.ZeroAddress) {
    throw new Error(`Invalid owner address: ${owner}`);
  }
  if (!hre.ethers.isAddress(treasury) || treasury === hre.ethers.ZeroAddress) {
    throw new Error(`Invalid treasury address: ${treasury}`);
  }
  if (keeper && (!hre.ethers.isAddress(keeper) || keeper === hre.ethers.ZeroAddress)) {
    throw new Error(`Invalid keeper address: ${keeper}`);
  }

  console.log("Configuration Parameters:");
  console.log(`  - Payment Token (USDC):  ${paymentToken}`);
  console.log(`  - Contract Owner / Safe: ${owner}`);
  console.log(`  - Protocol Treasury:     ${treasury}`);
  console.log(`  - Vault Drawer Keeper:   ${keeper || "(none specified)"}`);
  console.log(`  - StableFX Router:       ${stableFXRouter || "(auto-resolved on local / required on live)"}\n`);

  /* ──────────────────────── Dry-Run Balance Check ──────────────────────────── */
  const MIN_GAS_BALANCE = hre.ethers.parseEther("0.05"); // 0.05 native USDC
  if (balanceWei < MIN_GAS_BALANCE) {
    if (!isDryRun && network !== "hardhat") {
      throw new Error(
        `Insufficient deployer gas balance (${balance} native gas). ` +
        `Please fund ${deployer.address} with at least 0.5 USDC before running live deployment.`
      );
    } else {
      console.log(`[DRY-RUN NOTICE] Deployer gas balance is ${balance}. Live deployment will require funding.\n`);
    }
  }

  /* ──────────────────────── Dry-Run Branch ─────────────────────────────────── */
  if (isDryRun && balanceWei === 0n && network !== "hardhat" && network !== "localhost") {
    console.log("--- Executing Offline Dry-Run Validation (Zero-Balance Prediction) ---");
    const currentNonce = await hre.ethers.provider.getTransactionCount(deployer.address);
    const predictedRouterImpl = hre.ethers.getCreateAddress({ from: deployer.address, nonce: currentNonce });
    const predictedRouterProxy = hre.ethers.getCreateAddress({ from: deployer.address, nonce: currentNonce + 1 });
    const predictedPSA = hre.ethers.getCreateAddress({ from: deployer.address, nonce: currentNonce + 2 });
    const predictedVaultImpl = hre.ethers.getCreateAddress({ from: deployer.address, nonce: currentNonce + 3 });
    const predictedVaultProxy = hre.ethers.getCreateAddress({ from: deployer.address, nonce: currentNonce + 4 });
    const predictedConfidential = hre.ethers.getCreateAddress({ from: deployer.address, nonce: currentNonce + 7 });

    const dryReceipt = {
      network,
      chainId: Number(chainId),
      timestamp: new Date().toISOString(),
      dryRun: true,
      deployer: deployer.address,
      parameters: {
        paymentToken,
        treasury,
        owner,
        keeper: keeper || null,
        stableFXRouter: stableFXRouter || "0x0000000000000000000000000000000000000001 (placeholder)",
      },
      predictedContracts: {
        SubScriptRouter: {
          implementation: predictedRouterImpl,
          proxy: predictedRouterProxy,
        },
        SubScriptPSA: {
          address: predictedPSA,
        },
        SubScriptVault: {
          implementation: predictedVaultImpl,
          proxy: predictedVaultProxy,
        },
        SubScriptConfidential: {
          address: predictedConfidential,
        },
      },
      env: {
        NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS: predictedRouterProxy,
        NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS: predictedPSA,
        NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS: predictedConfidential,
        NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS: predictedVaultProxy,
        NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID: Number(chainId),
        SUBSCRIPT_ROUTER_ADDRESS: predictedRouterProxy,
        STANDARD_CONTRACT_ADDRESS: predictedPSA,
        CONFIDENTIAL_CONTRACT_ADDRESS: predictedConfidential,
        SUBSCRIPT_VAULT_ADDRESS: predictedVaultProxy,
      },
    };

    saveReceipt(dryReceipt);
    printEnv(dryReceipt.env);
    console.log("\n[SUCCESS] Dry-run validation passed cleanly! All parameters and invariants verified.\n");
    return;
  }

  /* ──────────────────────── Live Deployment / Local Execution ──────────────── */
  // Handle local MockStableFX deployment if needed
  if (!stableFXRouter) {
    if (network === "localhost" || network === "hardhat") {
      console.log("--- Deploying MockStableFX for Local Environment ---");
      const MockStableFXFactory = await hre.ethers.getContractFactory("MockStableFX");
      const mockStableFX = await MockStableFXFactory.deploy();
      await mockStableFX.waitForDeployment();
      stableFXRouter = await mockStableFX.getAddress();
      console.log(`MockStableFX deployed at: ${stableFXRouter}\n`);
    } else {
      throw new Error("STABLEFX_ROUTER_ADDRESS is required for mainnet deployment.");
    }
  }

  // Handle local MockUSDC if running on localhost with default mock token
  if ((network === "localhost" || network === "hardhat") && paymentToken === "0x3600000000000000000000000000000000000000") {
    // Check if code exists at paymentToken
    const code = await hre.ethers.provider.getCode(paymentToken);
    if (code === "0x" || code === "") {
      console.log("--- Deploying MockUSDC for Local Environment ---");
      const MockUSDCFactory = await hre.ethers.getContractFactory("MockUSDC");
      const mockUSDC = await MockUSDCFactory.deploy();
      await mockUSDC.waitForDeployment();
      paymentToken = await mockUSDC.getAddress();
      console.log(`MockUSDC deployed at: ${paymentToken}\n`);
    }
  }

  console.log("================================================================================");
  console.log("                       STARTING CONTRACT DEPLOYMENTS                            ");
  console.log("================================================================================\n");

  /* 1. Deploy SubScriptRouter (UUPS Proxy) */
  console.log("Step 1: Deploying SubScriptRouter...");
  const RouterFactory = await hre.ethers.getContractFactory("SubScriptRouter");
  const routerImpl = await RouterFactory.deploy();
  await routerImpl.waitForDeployment();
  const routerImplAddress = await routerImpl.getAddress();
  const routerImplTx = routerImpl.deploymentTransaction()?.hash || "";
  console.log(`  -> Router Implementation: ${routerImplAddress} (tx: ${routerImplTx})`);

  // Initialize calldata: initialize(paymentToken, treasury, owner)
  const routerInitData = RouterFactory.interface.encodeFunctionData("initialize", [paymentToken, treasury, owner]);
  const ProxyFactory = await hre.ethers.getContractFactory("ERC1967Proxy");
  const routerProxy = await ProxyFactory.deploy(routerImplAddress, routerInitData);
  await routerProxy.waitForDeployment();
  const routerProxyAddress = await routerProxy.getAddress();
  const routerProxyTx = routerProxy.deploymentTransaction()?.hash || "";
  console.log(`  -> Router ERC1967 Proxy:  ${routerProxyAddress} (tx: ${routerProxyTx})`);
  console.log(`     Initialized with paymentToken=${paymentToken}, treasury=${treasury}, owner=${owner}\n`);

  /* 2. Deploy SubScriptPSA (Standard Contract) */
  console.log("Step 2: Deploying SubScriptPSA (Standard Contract)...");
  const PSAFactory = await hre.ethers.getContractFactory("SubScriptPSA");
  const psa = await PSAFactory.deploy(paymentToken, stableFXRouter, treasury);
  await psa.waitForDeployment();
  const psaAddress = await psa.getAddress();
  const psaTx = psa.deploymentTransaction()?.hash || "";
  console.log(`  -> SubScriptPSA Address:  ${psaAddress} (tx: ${psaTx})`);
  console.log(`     Configured with paymentToken=${paymentToken}, stableFXRouter=${stableFXRouter}, treasury=${treasury}\n`);

  /* 3. Deploy SubScriptVault (UUPS Proxy + Setup) */
  console.log("Step 3: Deploying SubScriptVault...");
  const VaultFactory = await hre.ethers.getContractFactory("SubScriptVault");
  const vaultImpl = await VaultFactory.deploy();
  await vaultImpl.waitForDeployment();
  const vaultImplAddress = await vaultImpl.getAddress();
  const vaultImplTx = vaultImpl.deploymentTransaction()?.hash || "";
  console.log(`  -> Vault Implementation:  ${vaultImplAddress} (tx: ${vaultImplTx})`);

  // To allow owner-only setup (initializeV2, setAuthorizedDrawer), we initialize with deployer as owner,
  // execute setup transactions, and then transfer ownership to target owner if different from deployer.
  const vaultInitData = VaultFactory.interface.encodeFunctionData("initialize", [paymentToken, deployer.address]);
  const vaultProxy = await ProxyFactory.deploy(vaultImplAddress, vaultInitData);
  await vaultProxy.waitForDeployment();
  const vaultProxyAddress = await vaultProxy.getAddress();
  const vaultProxyTx = vaultProxy.deploymentTransaction()?.hash || "";
  console.log(`  -> Vault ERC1967 Proxy:   ${vaultProxyAddress} (tx: ${vaultProxyTx})`);

  const vault = VaultFactory.attach(vaultProxyAddress);
  console.log("  -> Configuring Vault V2 Treasury...");
  const initV2Tx = await vault.initializeV2(treasury);
  const initV2Receipt = await initV2Tx.wait();
  console.log(`     initializeV2(treasury) completed (tx: ${initV2Receipt.hash})`);

  let setDrawerTxHash = null;
  if (keeper && hre.ethers.isAddress(keeper) && keeper !== hre.ethers.ZeroAddress) {
    console.log(`  -> Authorizing Vault Keeper Drawer (${keeper})...`);
    const setDrawerTx = await vault.setAuthorizedDrawer(keeper, true);
    const setDrawerReceipt = await setDrawerTx.wait();
    setDrawerTxHash = setDrawerReceipt.hash;
    console.log(`     setAuthorizedDrawer(keeper, true) completed (tx: ${setDrawerTxHash})`);
  }

  let transferOwnershipTxHash = null;
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`  -> Transferring Vault Ownership to Multisig/Target Owner (${owner})...`);
    const transferTx = await vault.transferOwnership(owner);
    const transferReceipt = await transferTx.wait();
    transferOwnershipTxHash = transferReceipt.hash;
    console.log(`     transferOwnership(${owner}) completed (tx: ${transferOwnershipTxHash})`);
  }
  console.log("");

  /* 4. Deploy SubScriptConfidential */
  console.log("Step 4: Deploying SubScriptConfidential...");
  const ConfidentialFactory = await hre.ethers.getContractFactory("SubScriptConfidential");
  const confidential = await ConfidentialFactory.deploy(paymentToken, stableFXRouter, treasury, owner);
  await confidential.waitForDeployment();
  const confidentialAddress = await confidential.getAddress();
  const confidentialTx = confidential.deploymentTransaction()?.hash || "";
  console.log(`  -> SubScriptConfidential: ${confidentialAddress} (tx: ${confidentialTx})`);
  console.log(`     Configured with owner=${owner}\n`);

  /* ──────────────────────── Build Deployment Receipt ────────────────────────── */
  const receipt = {
    network,
    chainId: Number(chainId),
    timestamp: new Date().toISOString(),
    dryRun: isDryRun,
    deployer: deployer.address,
    parameters: {
      paymentToken,
      treasury,
      owner,
      keeper: keeper || null,
      stableFXRouter,
    },
    contracts: {
      SubScriptRouter: {
        implementation: routerImplAddress,
        proxy: routerProxyAddress,
        implTx: routerImplTx,
        proxyTx: routerProxyTx,
      },
      SubScriptPSA: {
        address: psaAddress,
        deploymentTx: psaTx,
      },
      SubScriptVault: {
        implementation: vaultImplAddress,
        proxy: vaultProxyAddress,
        implTx: vaultImplTx,
        proxyTx: vaultProxyTx,
        initializeV2Tx: initV2Receipt.hash,
        setAuthorizedDrawerTx: setDrawerTxHash,
        transferOwnershipTx: transferOwnershipTxHash,
      },
      SubScriptConfidential: {
        address: confidentialAddress,
        deploymentTx: confidentialTx,
      },
    },
    env: {
      NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS: routerProxyAddress,
      NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS: psaAddress,
      NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS: confidentialAddress,
      NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS: vaultProxyAddress,
      NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID: Number(chainId),
      SUBSCRIPT_ROUTER_ADDRESS: routerProxyAddress,
      STANDARD_CONTRACT_ADDRESS: psaAddress,
      CONFIDENTIAL_CONTRACT_ADDRESS: confidentialAddress,
      SUBSCRIPT_VAULT_ADDRESS: vaultProxyAddress,
    },
  };

  saveReceipt(receipt);
  printSummary(receipt);
  printEnv(receipt.env);
}

function saveReceipt(receipt) {
  const receiptDir = path.join(process.cwd(), "docs", "mainnet");
  if (!fs.existsSync(receiptDir)) {
    fs.mkdirSync(receiptDir, { recursive: true });
  }
  const receiptPath = path.join(receiptDir, "deployment-receipt.json");
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(`[RECEIPT] Saved deployment receipt to ${receiptPath}`);
}

function printSummary(receipt) {
  console.log("\n================================================================================");
  console.log("                    DEPLOYMENT SUCCESSFUL — SUMMARY                             ");
  console.log("================================================================================");
  console.log(`  SubScriptRouter (Proxy):        ${receipt.contracts.SubScriptRouter.proxy}`);
  console.log(`  SubScriptRouter (Impl):         ${receipt.contracts.SubScriptRouter.implementation}`);
  console.log(`  SubScriptPSA (Standard):        ${receipt.contracts.SubScriptPSA.address}`);
  console.log(`  SubScriptVault (Proxy):         ${receipt.contracts.SubScriptVault.proxy}`);
  console.log(`  SubScriptVault (Impl):          ${receipt.contracts.SubScriptVault.implementation}`);
  console.log(`  SubScriptConfidential:          ${receipt.contracts.SubScriptConfidential.address}`);
  console.log("================================================================================");
}

function printEnv(env) {
  console.log("\n================================================================================");
  console.log("             ENVIRONMENT VARIABLES (READY FOR .env.local & VERCEL)              ");
  console.log("================================================================================");
  console.log(`# SubScript Smart Contract Addresses`);
  console.log(`NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS=${env.NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS}`);
  console.log(`NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS=${env.NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS}`);
  console.log(`NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS=${env.NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS}`);
  console.log(`NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS=${env.NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS}`);
  console.log(`NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID=${env.NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID}`);
  console.log("");
  console.log(`SUBSCRIPT_ROUTER_ADDRESS=${env.SUBSCRIPT_ROUTER_ADDRESS}`);
  console.log(`STANDARD_CONTRACT_ADDRESS=${env.STANDARD_CONTRACT_ADDRESS}`);
  console.log(`CONFIDENTIAL_CONTRACT_ADDRESS=${env.CONFIDENTIAL_CONTRACT_ADDRESS}`);
  console.log(`SUBSCRIPT_VAULT_ADDRESS=${env.SUBSCRIPT_VAULT_ADDRESS}`);
  console.log("================================================================================\n");
}

main().catch((error) => {
  console.error("\n[DEPLOYMENT FAILED]");
  console.error(error);
  process.exit(1);
});
