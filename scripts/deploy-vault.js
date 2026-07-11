/* Deploy a FRESH SubScriptVault (UUPS proxy) owned by a secure address, using plain hardhat-ethers
 * (deploy implementation + ERC1967Proxy manually — no hardhat-upgrades plugin needed). Wires
 * treasury (initializeV2) and the keeper drawer (setAuthorizedDrawer); both are onlyOwner, so the
 * DEPLOYER must equal the owner. To end up owned by a multisig, deploy with a secure EOA, then
 * transferOwnership afterward.
 *
 * Env: PRIVATE_KEY (deployer = owner), RPC_URL, VAULT_OWNER_ADDRESS (required), TREASURY_ADDRESS
 *      (required), KEEPER_ADDRESS (optional drawer), USDC_ADDRESS (defaults to Arc USDC).
 * Run: npx hardhat run scripts/deploy-vault.js --network arcTestnet
 */
const hre = require("hardhat");

const EXPOSED_OWNER = "0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69";

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const paymentToken = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
    const owner = process.env.VAULT_OWNER_ADDRESS || process.env.CONTRACT_OWNER_ADDRESS;
    const treasury = process.env.TREASURY_ADDRESS;
    const keeper = process.env.KEEPER_ADDRESS || "";

    if (!owner || !hre.ethers.isAddress(owner) || owner === hre.ethers.ZeroAddress) {
        throw new Error("VAULT_OWNER_ADDRESS (owner) is required and must be a valid non-zero address.");
    }
    if (owner.toLowerCase() === EXPOSED_OWNER.toLowerCase() || deployer.address.toLowerCase() === EXPOSED_OWNER.toLowerCase()) {
        throw new Error("Refusing to deploy with the exposed key as owner/deployer. Use a fresh secure key.");
    }
    if (!treasury || !hre.ethers.isAddress(treasury) || treasury === hre.ethers.ZeroAddress) {
        throw new Error("TREASURY_ADDRESS is required and must be a valid non-zero address.");
    }
    if (deployer.address.toLowerCase() !== owner.toLowerCase()) {
        throw new Error("Deployer must equal VAULT_OWNER_ADDRESS (owner-only setup runs in this script).");
    }

    console.log("Deploying SubScriptVault with account:", deployer.address);
    console.log("  paymentToken:", paymentToken, " treasury:", treasury, " keeper:", keeper || "(none)");

    const Vault = await hre.ethers.getContractFactory("SubScriptVault");
    const impl = await Vault.deploy();
    await impl.waitForDeployment();
    const implAddress = await impl.getAddress();

    /* initialize(paymentToken, owner) */
    const initData = Vault.interface.encodeFunctionData("initialize", [paymentToken, owner]);

    const Proxy = await hre.ethers.getContractFactory("ERC1967Proxy");
    const proxy = await Proxy.deploy(implAddress, initData);
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();

    /* Interact through the vault ABI at the proxy address for owner-only setup. */
    const vault = Vault.attach(proxyAddress);
    const tx1 = await vault.initializeV2(treasury);
    await tx1.wait();
    console.log("  initializeV2(treasury) done.");
    if (keeper && hre.ethers.isAddress(keeper) && keeper !== hre.ethers.ZeroAddress) {
        const tx2 = await vault.setAuthorizedDrawer(keeper, true);
        await tx2.wait();
        console.log("  setAuthorizedDrawer(keeper, true) done.");
    }

    console.log("\n========================================");
    console.log("  SubScriptVault impl :", implAddress);
    console.log("  SubScriptVault proxy:", proxyAddress);
    console.log("========================================");
    console.log("Set NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS to the PROXY address.");
}

main().catch((e) => { console.error(e); process.exit(1); });
