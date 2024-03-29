// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface ITornGovernance {
  function lockedBalance(address _user) external view returns (uint256 amount);

  function lockWithApproval(uint256 amount) external;

  function unlock(uint256 amount) external;
}
