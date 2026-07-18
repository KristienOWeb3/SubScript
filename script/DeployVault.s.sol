/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/SubScriptVault.sol";
import "../test/mocks/MockUSDC.sol";

/*
 * Deploys a FRESH SubScriptVault (UUPS proxy) owned by a secure address, mirroring the Router deploy
 * pattern. Configures treasury (initializeV2) and optionally whitelists the keeper drawer in the same
 * broadcast, so the vault is ready to use.
 *
 * Env:
 *   PRIVATE_KEY          deployer key — MUST equal VAULT_OWNER_ADDRESS (owner-only setup runs here)
 *   VAULT_OWNER_ADDRESS  required, fresh secure owner (never the exposed key)
 *   TREASURY_ADDRESS     required, fee recipient
 *   KEEPER_ADDRESS       optional, authorized drawer (the cycle-end keeper); can be set later
 */
contract DeployVault is Script {
    address constant EXPOSED_OWNER = 0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("VAULT_OWNER_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address keeper = vm.envOr("KEEPER_ADDRESS", address(0));

        require(owner != address(0), "VAULT_OWNER_ADDRESS (owner) is required");
        require(owner != EXPOSED_OWNER, "owner must NOT be the exposed key address");
        require(treasury != address(0), "TREASURY_ADDRESS is required");

        address deployer = vm.addr(deployerPrivateKey);
        /* initializeV2 and setAuthorizedDrawer are onlyOwner, so the deployer must BE the owner for
           this one-shot setup. To end up owned by a multisig, deploy with a secure EOA here, then
           transfer ownership to the multisig afterward. */
        require(deployer == owner, "deployer must equal VAULT_OWNER_ADDRESS (owner-only setup runs in this script)");

        vm.startBroadcast(deployerPrivateKey);

        address paymentToken = block.chainid == 31337
            ? address(new MockUSDC())
            : 0x3600000000000000000000000000000000000000;

        SubScriptVault impl = new SubScriptVault();
        bytes memory initData = abi.encodeWithSelector(SubScriptVault.initialize.selector, paymentToken, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        SubScriptVault vault = SubScriptVault(address(proxy));

        vault.initializeV2(treasury);
        if (keeper != address(0)) {
            vault.setAuthorizedDrawer(keeper, true);
        }

        vm.stopBroadcast();

        console.log("SubScriptVault proxy:", address(proxy));
        console.log("SubScriptVault impl :", address(impl));
        console.log("owner:               ", owner);
        console.log("treasury:            ", treasury);
        console.log("keeper drawer:       ", keeper);
    }
}
