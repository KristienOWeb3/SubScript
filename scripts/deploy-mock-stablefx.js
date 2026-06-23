/* Deploy the testnet StableFX mock used by SubScriptPSA/SubScriptConfidential.
 *
 * This is for Arc testnet when a canonical Circle StableFX router address is not
 * available. Same-token USDC subscriptions bypass StableFX; the mock only serves
 * the constructor dependency and explicit multi-token test paths.
 *
 *   npx hardhat run scripts/deploy-mock-stablefx.js --network arcTestnet
 */
const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying MockStableFX with account:", deployer.address);
    console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

    const Factory = await hre.ethers.getContractFactory("MockStableFX");
    const stableFx = await Factory.deploy();
    await stableFx.waitForDeployment();

    const address = await stableFx.getAddress();
    console.log("\n========================================");
    console.log("  MOCK STABLEFX DEPLOYED");
    console.log("========================================");
    console.log(`  STABLEFX_ROUTER_ADDRESS=${address}`);
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
