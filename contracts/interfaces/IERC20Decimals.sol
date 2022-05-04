// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

pragma solidity >=0.7.0 <0.8.0;

interface IERC20Decimals is IERC20 {
  function decimals() external view returns (uint256);
}
