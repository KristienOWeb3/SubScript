const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SubScriptGameEscrow with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const token = "0x3600000000000000000000000000000000000000";
  const treasury = "0x725d56151ceac9ead625241d13b8307b22eddb10";
  // The referee is our keeper address, which we retrieved earlier: 0xd761B75a2B67545357ea161AA38B5FF4D09eeC9c
  const referee = "0xd761B75a2B67545357ea161AA38B5FF4D09eeC9c";
  const owner = deployer.address;

  console.log("Constructor parameters:");
  console.log(`  token:    ${token}`);
  console.log(`  treasury: ${treasury}`);
  console.log(`  referee:  ${referee}`);
  console.log(`  owner:    ${owner}`);

  const SubScriptGameEscrow = await hre.ethers.getContractFactory("SubScriptGameEscrow");
  const escrow = await SubScriptGameEscrow.deploy(token, treasury, referee, owner);
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("\n========================================");
  console.log("  SubScriptGameEscrow DEPLOYED");
  console.log("========================================");
  console.log(`  Contract Address: ${escrowAddress}`);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
