/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "../interfaces/IStableFX.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/*
 * @title MockStableFX
 * @notice Mock implementation of Circle's StableFX router for testing multi-currency pricing swaps.
 */
contract MockStableFX is IStableFX {
    using SafeERC20 for IERC20;

    /* Rate of conversion: amountIn = amountOut * rate / 100 */
    uint256 public rate = 100;

    /*
     * @notice Set custom conversion rate.
     * @param _rate Conversion rate multiplier (100 = 1:1).
     */
    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    /*
     * @dev Calculates amountIn based on the configured rate.
     */
    function getAmountIn(
        address /* inputToken */,
        address /* outputToken */,
        uint256 amountOut
    ) external view override returns (uint256 amountIn) {
        return (amountOut * rate) / 100;
    }

    /*
     * @dev Pulls inputToken from the sender and sends outputToken to the recipient.
     */
    function swap(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        /* Transfer input tokens from caller to this contract */
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), amountIn);

        /* Calculate output amount based on rate */
        amountOut = (amountIn * 100) / rate;
        require(amountOut >= minAmountOut, "MockStableFX: slippage limit reached");

        /* Transfer output tokens from this contract to the recipient */
        IERC20(outputToken).safeTransfer(recipient, amountOut);

        return amountOut;
    }
}
