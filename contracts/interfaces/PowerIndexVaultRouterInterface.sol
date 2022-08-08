// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface PowerIndexVaultRouterInterface {
  function enableRouterCallback(address _piToken, bool _enable) external;

  function piTokenCallback(address sender, uint256 _withdrawAmount) external payable;
}
