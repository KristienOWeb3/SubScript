// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/SubScriptRouter.sol";

/**
 * @title DeploySubScript
 * @notice Foundry script to deploy the SubScriptRouter implementation and ERC1967 proxy.
 */
contract DeploySubScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0x0637528b9afbc627b22542e333971af4dd2f0f48a99f261436cf8f35efa15c8a));
        
        address owner = vm.envOr("MULTISIG_ADDRESS", address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10));
        address treasury = vm.envOr("TREASURY_ADDRESS", address(0xaFCb6d3e9ebeD1A4BF78384689A1fFf280132295));
        address paymentToken = vm.envOr("USDC_ADDRESS", address(0xF7C6416aecC5bECbbB003548f3e4bEA96Eb916fc));

        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying SubScriptRouter implementation...");
        SubScriptRouter implementation = new SubScriptRouter();
        console.log("SubScriptRouter implementation deployed at:", address(implementation));

        console.log("Deploying ERC1967Proxy and initializing atomically...");
        bytes memory initData = abi.encodeWithSelector(
            SubScriptRouter.initialize.selector,
            paymentToken,
            treasury,
            owner
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        console.log("SubScriptRouter Proxy deployed at:", address(proxy));

        vm.stopBroadcast();
    }
}
