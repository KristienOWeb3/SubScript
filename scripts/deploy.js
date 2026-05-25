const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // ── 1. Deploy MockUSDC ──────────────────────────────────────────
  console.log("\n--- Deploying MockUSDC ---");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddress);

  // ── 2. Deploy SubScript (linked to MockUSDC) ───────────────────
  console.log("\n--- Deploying SubScript ---");
  const SubScript = await hre.ethers.getContractFactory("SubScript");
  const subScript = await SubScript.deploy(usdcAddress);
  await subScript.waitForDeployment();
  const subScriptAddress = await subScript.getAddress();
  console.log("SubScript deployed to:", subScriptAddress);

  // ── 3. Summary ─────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`  MockUSDC:   ${usdcAddress}`);
  console.log(`  SubScript:  ${subScriptAddress}`);
  console.log("========================================");
  console.log("\nUpdate your .env file:");
  console.log(`  CONTRACT_ADDRESS=${subScriptAddress}`);
  console.log(`  USDC_ADDRESS=${usdcAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
