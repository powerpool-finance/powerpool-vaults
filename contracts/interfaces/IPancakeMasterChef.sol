// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IPancakeMasterChef {
  function userInfo(uint256 _pid, address _user) external view returns (uint256 amount, uint256 rewardDebt);

  function pendingCake(uint256 _pid, address _user) external view returns (uint256);

  function enterStaking(uint256 _amount) external;

  function leaveStaking(uint256 _amount) external;
}
