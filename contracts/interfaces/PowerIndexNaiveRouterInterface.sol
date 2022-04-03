// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface PowerIndexNaiveRouterInterface {
  function migrateToNewRouter(
    address _piToken,
    address payable _newRouter,
    address[] memory _tokens
  ) external;

  function enableRouterCallback(address _piToken, bool _enable) external;

  function piTokenCallback(address sender, uint256 _withdrawAmount) external payable;
}
