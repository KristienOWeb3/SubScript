require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
  const usdcAddress = process.env.USDC_ADDRESS || "0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc";

  if (!privateKey) {
    console.error("Error: PRIVATE_KEY must be defined in the .env file");
    process.exit(1);
  }

  console.log("Connecting to network via RPC:", rpcUrl);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log("Deploying standard SubScript contract with account:", wallet.address);

  // Read balance
  const balance = await provider.getBalance(wallet.address);
  console.log("Account balance (native USDC gas):", ethers.formatUnits(balance, 6), "USDC");

  // Read compile artifact
  const artifactPath = path.join(__dirname, "../artifacts/contracts/SubScript.sol/SubScript.json");
  if (!fs.existsSync(artifactPath)) {
    console.error(`Error: Compilation artifact not found at ${artifactPath}. Run npx hardhat compile first.`);
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const { abi, bytecode } = artifact;

  console.log("\n--- Deploying Standard SubScript Contract ---");
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(usdcAddress);
  console.log("Transaction hash:", contract.deploymentTransaction().hash);
  
  console.log("Waiting for transaction confirmation...");
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("\n========================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`  SubScript Standard Contract: ${contractAddress}`);
  console.log("========================================");
  console.log("\nUpdate your configurations with:");
  console.log(`  STANDARD_CONTRACT_ADDRESS=${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
