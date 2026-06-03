const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Upgrading contract with account:", deployer.address);

  const proxyAddress = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";

  /* 1. Deploy the new SubScriptRouter implementation contract */
  console.log("\n--- Deploying new SubScriptRouter implementation ---");
  const SubScriptRouter = await hre.ethers.getContractFactory("SubScriptRouter");
  const newImpl = await SubScriptRouter.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New SubScriptRouter implementation deployed to:", newImplAddress);

  /* 2. Perform UUPS proxy upgrade by calling upgradeToAndCall on the proxy */
  console.log("\n--- Upgrading UUPS Proxy ---");
  const UUPS_ABI = [
    "function upgradeToAndCall(address newImplementation, bytes data) external",
    "function owner() view returns (address)"
  ];
  const proxy = new hre.ethers.Contract(proxyAddress, UUPS_ABI, deployer);

  const owner = await proxy.owner();
  console.log("Proxy current owner:", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Deployer is not the owner of the proxy contract. Upgrade cannot be executed.");
  }

  console.log("Executing upgradeToAndCall...");
  const upgradeTx = await proxy.upgradeToAndCall(newImplAddress, "0x");
  console.log("Transaction submitted. Tx Hash:", upgradeTx.hash);
  
  const receipt = await upgradeTx.wait();
  console.log("Upgrade receipt status:", receipt.status);
  console.log("Proxy successfully upgraded to new implementation!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
