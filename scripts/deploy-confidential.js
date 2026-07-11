/* Deploy SubScriptConfidential (current subscription contract).
 *
 * Why this script: the older scripts/deploy-standard.js references a non-existent
 * "SubScript" contract with a 1-arg constructor. The live contract is SubScriptPSA
 * (constructor: paymentToken, stableFXRouter), and SubScriptConfidential EXTENDS it —
 * so it has the subscription functions (createSubscription, the 2-arg executePayment,
 * isSequenceExecuted, cancelSubscription) AND registerViewKey/executeBatchPayout.
 *
 * Deploying this one contract lets you point BOTH STANDARD_CONTRACT_ADDRESS and
 * CONFIDENTIAL_CONTRACT_ADDRESS at it, fixing both contract-health gaps at once.
 *
 * Env: PRIVATE_KEY (owner/deployer), RPC_URL (Arc testnet),
 *      STABLEFX_ROUTER_ADDRESS (required), USDC_ADDRESS (optional, defaults to native).
 *
 *   npx hardhat run scripts/deploy-confidential.js --network arcTestnet
 */
const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

    const paymentToken = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
    const stableFXRouter = process.env.STABLEFX_ROUTER_ADDRESS;
    const initialOwner = process.env.CONTRACT_OWNER_ADDRESS || deployer.address;
    const treasury = process.env.TREASURY_ADDRESS || initialOwner;

    if (!stableFXRouter) {
        throw new Error("STABLEFX_ROUTER_ADDRESS is required (the IStableFX router the contract settles through).");
    }
    if (!hre.ethers.isAddress(treasury) || treasury === hre.ethers.ZeroAddress) {
        throw new Error("TREASURY_ADDRESS must be a valid non-zero address.");
    }

    /* Never redeploy owned by the historically exposed key. */
    const EXPOSED_OWNER = "0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69";
    if (!hre.ethers.isAddress(initialOwner) || initialOwner === hre.ethers.ZeroAddress) {
        throw new Error("initialOwner (CONTRACT_OWNER_ADDRESS) must be a valid non-zero address.");
    }
    if (initialOwner.toLowerCase() === EXPOSED_OWNER.toLowerCase() || deployer.address.toLowerCase() === EXPOSED_OWNER.toLowerCase()) {
        throw new Error("Refusing to deploy with the exposed key as owner/deployer. Use a fresh secure key + CONTRACT_OWNER_ADDRESS.");
    }

    console.log("\n--- Deploying SubScriptConfidential ---");
    console.log("  paymentToken:  ", paymentToken);
    console.log("  stableFXRouter:", stableFXRouter);
    console.log("  treasury:      ", treasury);
    console.log("  initialOwner:  ", initialOwner);

    const Factory = await hre.ethers.getContractFactory("SubScriptConfidential");
    /* constructor(paymentToken, stableFXRouter, treasury, initialOwner) */
    const contract = await Factory.deploy(paymentToken, stableFXRouter, treasury, initialOwner);
    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log("\n========================================");
    console.log("  DEPLOYMENT COMPLETE");
    console.log("========================================");
    console.log(`  SubScriptConfidential: ${address}`);
    console.log("========================================");
    console.log("\nUpdate src/lib/contracts/constants.ts (and any env) with:");
    console.log(`  STANDARD_CONTRACT_ADDRESS     = "${address}"`);
    console.log(`  CONFIDENTIAL_CONTRACT_ADDRESS = "${address}"`);
    console.log("\nThen verify:  npm run check:contracts");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
