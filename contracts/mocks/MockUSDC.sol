// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice A mock ERC20 token mimicking USDC for testing SubScript locally.
 *         Uses 6 decimals like real USDC.
 */
contract MockUSDC is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /**
     * @notice Mint tokens to any address (faucet for testing).
     * @param to   Recipient address.
     * @param amount Amount in the smallest unit (6 decimals).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
