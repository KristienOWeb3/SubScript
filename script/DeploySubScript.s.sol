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
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        address owner = vm.envOr("MULTISIG_ADDRESS", address(0x725D56151CeaC9eAd625241D13b8307B22EDDb10));
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
    }
}
