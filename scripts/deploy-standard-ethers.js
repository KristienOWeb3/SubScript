/* Deploy SubScriptPSA v3 (USDC-only, atomic replace) with plain ethers, no hardhat runtime.
 * Run `npx hardhat compile` first so the artifact exists.
 *
 * Env: PRIVATE_KEY (deployer), RPC_URL / ARC_RPC_PRIMARY, USDC_ADDRESS (optional),
 *      TREASURY_ADDRESS (optional on testnet, defaults to the deployer; required on mainnet).
 */
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  const isMainnet = process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
  const rpcUrl = process.env.RPC_URL || process.env.ARC_RPC_PRIMARY || (isMainnet ? null : "https://rpc.testnet.arc.network");
  if (!rpcUrl) {
    console.error("Error: mainnet mode requires RPC_URL or ARC_RPC_PRIMARY. Refusing to deploy against the testnet RPC.");
    process.exit(2);
  }
  const usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";

  if (!privateKey) {
    console.error("Error: PRIVATE_KEY must be defined in the .env file");
    process.exit(1);
  }

  console.log("Connecting to network via RPC:", rpcUrl);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log("Deploying SubScriptPSA v3 with account:", wallet.address);

  const treasury = process.env.TREASURY_ADDRESS || (isMainnet ? "" : wallet.address);
  if (!ethers.isAddress(treasury) || treasury === ethers.ZeroAddress) {
    console.error("Error: TREASURY_ADDRESS must be a valid non-zero address (required on mainnet).");
    process.exit(1);
  }

  // Read balance
  const balance = await provider.getBalance(wallet.address);
  console.log("Account balance (native USDC gas):", ethers.formatUnits(balance, 18), "USDC");

  // Read compile artifact
  const artifactPath = path.join(__dirname, "../artifacts/contracts/SubScriptPSA.sol/SubScriptPSA.json");
  if (!fs.existsSync(artifactPath)) {
    console.error(`Error: Compilation artifact not found at ${artifactPath}. Run npx hardhat compile first.`);
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const { abi, bytecode } = artifact;

  console.log("\n--- Deploying SubScriptPSA ---");
  console.log(`  paymentToken (USDC): ${usdcAddress}`);
  console.log(`  treasury:            ${treasury}`);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  /* v3 constructor: (paymentToken, treasury). No FX router: the contract is USDC-only. */
  const contract = await factory.deploy(usdcAddress, treasury);
  console.log("Transaction hash:", contract.deploymentTransaction().hash);

  console.log("Waiting for transaction confirmation...");
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  if (!(await contract.supportsDeferredSubscriptions()) || !(await contract.supportsReplaceSubscriptions())) {
    throw new Error("Deployed contract is missing deferred/replace support. Wrong artifact?");
  }

  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`  SubScriptPSA v3: ${contractAddress}`);
  console.log("========================================");
  console.log("\nUpdate your configurations with:");
  console.log(`  NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`  STANDARD_CONTRACT_ADDRESS=${contractAddress}`);
  console.log("Then set the subscriptions.contract_address column DEFAULT to the same address.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
