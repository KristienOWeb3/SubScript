/* Deploy the standalone SubScriptPSA v3 subscription contract (USDC-only, atomic replace).
 *
 * Env: USDC_ADDRESS (optional, defaults to Arc native USDC),
 *      TREASURY_ADDRESS (optional, defaults to the deployer; required on arcMainnet).
 *
 *   npx hardhat run scripts/deploy-standard.js --network arcTestnet
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SubScriptPSA v3 with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "native gas");

  const usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
  const treasury = process.env.TREASURY_ADDRESS || (hre.network.name === "arcMainnet" ? "" : deployer.address);
  if (!hre.ethers.isAddress(treasury) || treasury === hre.ethers.ZeroAddress) {
    throw new Error("TREASURY_ADDRESS must be a valid non-zero address (required on arcMainnet).");
  }
  console.log(`  paymentToken (USDC): ${usdcAddress}`);
  console.log(`  treasury:            ${treasury}`);

  console.log("\n--- Deploying SubScriptPSA ---");
  const SubScriptPSA = await hre.ethers.getContractFactory("SubScriptPSA");
  /* v3 constructor: (paymentToken, treasury). No FX router: the contract is USDC-only. */
  const psa = await SubScriptPSA.deploy(usdcAddress, treasury);
  await psa.waitForDeployment();
  const psaAddress = await psa.getAddress();

  if (!(await psa.supportsDeferredSubscriptions()) || !(await psa.supportsReplaceSubscriptions())) {
    throw new Error("Deployed contract is missing deferred/replace support. Wrong artifact?");
  }

  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`  SubScriptPSA v3: ${psaAddress}`);
  console.log(`  tx:              ${psa.deploymentTransaction()?.hash || ""}`);
  console.log("========================================");
  console.log("\nUpdate your configurations with:");
  console.log(`  NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS=${psaAddress}`);
  console.log(`  STANDARD_CONTRACT_ADDRESS=${psaAddress}`);
  console.log("Then set the subscriptions.contract_address column DEFAULT to the same address.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
