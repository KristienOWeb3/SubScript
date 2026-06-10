/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

/*
 * @title IStableFX
 * @notice Interface for Circle's StableFX foreign exchange engine on the Arc Network.
 */
interface IStableFX {
    /*
     * @notice Get the input token amount needed to receive a specific output token amount.
     * @param inputToken Address of the token to be sold.
     * @param outputToken Address of the token to be purchased.
     * @param amountOut Exact amount of outputToken desired.
     * @return amountIn Amount of inputToken required.
     */
    function getAmountIn(
        address inputToken,
        address outputToken,
        uint256 amountOut
    ) external view returns (uint256 amountIn);

    /*
     * @notice Swap inputToken for outputToken.
     * @param inputToken Address of the token to swap from.
     * @param outputToken Address of the token to swap to.
     * @param amountIn Amount of inputToken to spend.
     * @param minAmountOut Minimum amount of outputToken that must be received.
     * @param recipient Address receiving the swapped output tokens.
     * @return amountOut The actual amount of outputToken received.
     */
    function swap(
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);
}
