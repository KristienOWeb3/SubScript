/* Deploy a FRESH SubScriptRouter (UUPS proxy) owned by a secure address, using plain hardhat-ethers
 * (deploy implementation + ERC1967Proxy manually — no hardhat-upgrades plugin needed). Hardhat
 * equivalent of script/DeploySubScript.s.sol.
 *
 * Env: PRIVATE_KEY (deployer), RPC_URL, MULTISIG_ADDRESS (owner, required), TREASURY_ADDRESS,
 *      USDC_ADDRESS (defaults to Arc USDC).
 * Run: npx hardhat run scripts/deploy-router.js --network arcTestnet
 */
const hre = require("hardhat");

const EXPOSED_OWNER = "0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69";

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const paymentToken = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
    const owner = process.env.MULTISIG_ADDRESS || process.env.CONTRACT_OWNER_ADDRESS;
    const treasury = process.env.TREASURY_ADDRESS || owner;

    if (!owner || !hre.ethers.isAddress(owner) || owner === hre.ethers.ZeroAddress) {
        throw new Error("MULTISIG_ADDRESS (owner) is required and must be a valid non-zero address.");
    }
    if (owner.toLowerCase() === EXPOSED_OWNER.toLowerCase() || deployer.address.toLowerCase() === EXPOSED_OWNER.toLowerCase()) {
        throw new Error("Refusing to deploy with the exposed key as owner/deployer. Use a fresh secure key.");
    }
    if (!hre.ethers.isAddress(treasury) || treasury === hre.ethers.ZeroAddress) {
        throw new Error("TREASURY_ADDRESS must be a valid non-zero address.");
    }

    console.log("Deploying SubScriptRouter with account:", deployer.address);
    console.log("  paymentToken:", paymentToken, " treasury:", treasury, " owner:", owner);

    const Router = await hre.ethers.getContractFactory("SubScriptRouter");
    const impl = await Router.deploy();
    await impl.waitForDeployment();
    const implAddress = await impl.getAddress();

    /* initialize(paymentToken, treasury, initialOwner) */
    const initData = Router.interface.encodeFunctionData("initialize", [paymentToken, treasury, owner]);

    const Proxy = await hre.ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(implAddress, initData);
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();

    console.log("\n========================================");
    console.log("  SubScriptRouter impl :", implAddress);
    console.log("  SubScriptRouter proxy:", proxyAddress);
    console.log("========================================");
    console.log("Set NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS to the PROXY address.");
}

main().catch((e) => { console.error(e); process.exit(1); });
