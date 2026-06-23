const hre = require("hardhat");

/* Upgrades the SubScriptVault UUPS proxy to the current implementation
   (no-negative model + 30-day withdraw lock). Run as the proxy owner. */
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Upgrading SubScriptVault with account:", deployer.address);

  const proxyAddress = process.env.SUBSCRIPT_VAULT_ADDRESS || "0x853581e119dDED32DB886a4533A11789cF60bBFc";

  console.log("\n--- Deploying new SubScriptVault implementation ---");
  const SubScriptVault = await hre.ethers.getContractFactory("SubScriptVault");
  const newImpl = await SubScriptVault.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New SubScriptVault implementation:", newImplAddress);

  const UUPS_ABI = [
    "function upgradeToAndCall(address newImplementation, bytes data) external",
    "function owner() view returns (address)",
  ];
  const proxy = new hre.ethers.Contract(proxyAddress, UUPS_ABI, deployer);

  const owner = await proxy.owner();
  console.log("Proxy owner:", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Deployer is not the proxy owner. Upgrade cannot be executed.");
  }

  console.log("Executing upgradeToAndCall...");
  const tx = await proxy.upgradeToAndCall(newImplAddress, "0x");
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Upgrade status:", receipt.status);
  console.log("SubScriptVault upgraded. Run `npm run check:contracts` to verify.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
