// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "./IRouterConnector.sol";

interface IRouterVaultConnector is IRouterConnector {
  function distributePoolBalance(address _feeReceiver, bytes calldata _params) external;
}
