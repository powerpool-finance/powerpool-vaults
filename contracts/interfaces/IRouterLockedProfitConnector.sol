// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "./IRouterConnector.sol";

interface IRouterLockedProfitConnector is IRouterConnector {
  function calculateLockedProfit(bytes calldata _stakeData) external view returns (uint256);
}
