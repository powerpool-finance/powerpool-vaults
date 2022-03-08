// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

interface ITornStaking {
  function checkReward(address user) external view returns (uint256 amount);

  function getReward() external;
}
