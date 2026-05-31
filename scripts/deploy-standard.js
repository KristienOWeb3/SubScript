const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying standard SubScript contract with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
  console.log(`Linking SubScript to USDC address: ${usdcAddress}`);

  console.log("\n--- Deploying Standard SubScript Contract ---");
  const SubScript = await hre.ethers.getContractFactory("SubScript");
  const subScript = await SubScript.deploy(usdcAddress);
  await subScript.waitForDeployment();
  const subScriptAddress = await subScript.getAddress();
  
  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`  SubScript Standard Contract: ${subScriptAddress}`);
  console.log("========================================");
  console.log("\nUpdate your configurations with:");
  console.log(`  STANDARD_CONTRACT_ADDRESS=${subScriptAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
