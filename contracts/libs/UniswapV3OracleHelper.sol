// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import { OracleLibrary } from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import { IUniswapV3Factory } from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Decimals {
  function decimals() external view returns (uint8);
}

library UniswapV3OracleHelper {
  using SafeMath for uint256;

  IUniswapV3Factory public constant UniswapV3Factory = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);
  ISwapRouter public constant UniswapV3Router = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);
  address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
  uint256 public constant RATIO_DIVIDER = 1e18;
  uint24 public constant poolFee = 3000;

  /**
   * @notice This function should return the price of baseToken in quoteToken, as in: quote/base (WETH/TORN)
   * @dev uses the Uniswap written OracleLibrary "getQuoteAtTick", does not call external libraries,
   *      uses decimals() for the correct power of 10
   * @param baseToken token which will be denominated in quote token
   * @param quoteToken token in which price will be denominated
   * @param fee the uniswap pool fee, pools have different fees so this is a pool selector for our usecase
   * @param period the amount of seconds we are going to look into the past for the new token price
   * @return returns the price of baseToken in quoteToken
   * */
  function getPriceOfTokenInToken(
    address baseToken,
    address quoteToken,
    uint24 fee,
    uint32 period
  ) internal view returns (uint256) {
    uint128 base = uint128(10)**uint128(IERC20Decimals(quoteToken).decimals());
    if (baseToken == quoteToken) {
      return base;
    } else {
      (int24 timeWeightedAverageTick, ) = OracleLibrary.consult(
        UniswapV3Factory.getPool(baseToken, quoteToken, fee),
        period
      );
      return OracleLibrary.getQuoteAtTick(timeWeightedAverageTick, base, baseToken, quoteToken);
    }
  }

  /**
   * @notice This function should return the price of token in WETH
   * @dev simply feeds WETH in to the above function
   * @param token token which will be denominated in WETH
   * @param fee the uniswap pool fee, pools have different fees so this is a pool selector for our usecase
   * @param period the amount of seconds we are going to look into the past for the new token price
   * @return returns the price of token in WETH
   * */
  function getPriceOfTokenInWETH(
    address token,
    uint24 fee,
    uint32 period
  ) internal view returns (uint256) {
    return getPriceOfTokenInToken(token, WETH, fee, period);
  }

  /**
   * @notice This function should return the price of WETH in token
   * @dev simply feeds WETH into getPriceOfTokenInToken
   * @param token token which WETH will be denominated in
   * @param fee the uniswap pool fee, pools have different fees so this is a pool selector for our usecase
   * @param period the amount of seconds we are going to look into the past for the new token price
   * @return returns the price of token in WETH
   * */
  function getPriceOfWETHInToken(
    address token,
    uint24 fee,
    uint32 period
  ) internal view returns (uint256) {
    return getPriceOfTokenInToken(WETH, token, fee, period);
  }

  /**
   * @notice This function returns the price of token[0] in token[1], but more precisely and importantly the price ratio
      of the tokens in WETH
   * @dev this is done as to always have good prices due to WETH-token pools mostly always having the most liquidity
   * @param tokens array of tokens to get ratio for
   * @param fees the uniswap pool FEES, since these are two independent tokens
   * @param period the amount of seconds we are going to look into the past for the new token price
   * @return returns the price of token[0] in token[1]
   * */
  function getPriceRatioOfTokens(
    address[2] memory tokens,
    uint24[2] memory fees,
    uint32 period
  ) internal view returns (uint256) {
    return
      getPriceOfTokenInWETH(tokens[0], fees[0], period).mul(RATIO_DIVIDER) /
      getPriceOfTokenInWETH(tokens[1], fees[1], period);
  }

  function swapByMiddleWeth(
    uint256 _amountIn,
    address _tokenFrom,
    address _tokenTo
  ) internal returns (uint256 amountOut) {
    IERC20(_tokenFrom).approve(address(UniswapV3Router), _amountIn);

    ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
      path: abi.encodePacked(_tokenFrom, poolFee, WETH, poolFee, _tokenTo),
      recipient: msg.sender,
      deadline: block.timestamp,
      amountIn: _amountIn,
      amountOutMinimum: 0
    });

    // Executes the swap.
    amountOut = UniswapV3Router.exactInput(params);
  }

  function swapByTwoMiddleWethDai(
    uint256 _amountIn,
    address _tokenFrom,
    address _tokenTo
  ) internal returns (uint256 amountOut) {
    IERC20(_tokenFrom).approve(address(UniswapV3Router), _amountIn);

    ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
      path: abi.encodePacked(_tokenFrom, poolFee, WETH, poolFee, DAI, poolFee, _tokenTo),
      recipient: msg.sender,
      deadline: block.timestamp,
      amountIn: _amountIn,
      amountOutMinimum: 0
    });

    // Executes the swap.
    amountOut = UniswapV3Router.exactInput(params);
  }
}
