const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Executing rescue script with account:", deployer.address);

  const proxyAddress = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
  const usdcAddress = "0x3600000000000000000000000000000000000000";
  const destinationAddress = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";

  /* Instantiate USDC ERC20 contract to check balances */
  const erc20Abi = [
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];
  const usdc = new hre.ethers.Contract(usdcAddress, erc20Abi, deployer);

  /* Instantiate SubScriptRouter with rescueERC20 ABI */
  const routerAbi = [
    "function rescueERC20(address token, address to, uint256 amount) external",
    "function owner() view returns (address)"
  ];
  const router = new hre.ethers.Contract(proxyAddress, routerAbi, deployer);

  const decimals = await usdc.decimals();
  const initialBalance = await usdc.balanceOf(proxyAddress);
  console.log("Initial Proxy Balance:", hre.ethers.formatUnits(initialBalance, decimals), "USDC");

  if (initialBalance === 0n) {
    console.log("No USDC balance found in the proxy contract to rescue.");
    return;
  }

  const owner = await router.owner();
  console.log("Proxy contract owner:", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Deployer is not the owner of the proxy contract. Rescue transaction cannot be executed.");
  }

  console.log("Executing rescueERC20...");
  const rescueTx = await router.rescueERC20(usdcAddress, destinationAddress, initialBalance);
  console.log("Transaction submitted. Tx Hash:", rescueTx.hash);

  const receipt = await rescueTx.wait();
  console.log("Rescue transaction receipt status:", receipt.status);

  const finalBalance = await usdc.balanceOf(proxyAddress);
  const destBalance = await usdc.balanceOf(destinationAddress);

  console.log("Final Proxy Balance:", hre.ethers.formatUnits(finalBalance, decimals), "USDC");
  console.log("Final Treasury Balance:", hre.ethers.formatUnits(destBalance, decimals), "USDC");
  console.log("Funds rescued successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
