/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/SubScriptRouter.sol";
import "../test/mocks/MockUSDC.sol";

/*
 * DeploySubScript script to deploy the SubScriptRouter implementation and ERC1967 proxy.
 */
contract DeploySubScript is Script {
    /* The historically exposed owner (private key committed to git). A fresh deploy must NEVER be
       owned by it, so we hard-fail if MULTISIG_ADDRESS resolves to it. */
    address constant EXPOSED_OWNER = 0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        /* Owner is REQUIRED — no silent fallback — so a redeploy can't accidentally ship owned by a
           default/compromised address. Set MULTISIG_ADDRESS to a fresh secure owner (multisig/EOA). */
        address owner = vm.envAddress("MULTISIG_ADDRESS");
        require(owner != address(0), "MULTISIG_ADDRESS (owner) is required");
        require(owner != EXPOSED_OWNER, "owner must NOT be the exposed key address");
        address treasury = vm.envOr("TREASURY_ADDRESS", address(0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295));
        
        address paymentToken;

        vm.startBroadcast(deployerPrivateKey);

        if (block.chainid == 31337) {
            MockUSDC mock = new MockUSDC();
            paymentToken = address(mock);
        } else {
            paymentToken = 0x3600000000000000000000000000000000000000;
        }

        SubScriptRouter implementation = new SubScriptRouter();

        bytes memory initData = abi.encodeWithSelector(
            SubScriptRouter.initialize.selector,
            paymentToken,
            treasury,
            owner
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);

        vm.stopBroadcast();

        console.log("SubScriptRouter proxy:", address(proxy));
        console.log("SubScriptRouter impl :", address(implementation));
        console.log("owner:                ", owner);
        console.log("treasury:             ", treasury);
    }
}
