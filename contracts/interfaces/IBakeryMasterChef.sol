// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IBakeryMasterChef {
  function poolUserInfoMap(address _pair, address _user) external view returns (uint256 amount, uint256 rewardDebt);

  function pendingBake(address _pair, address _user) external view returns (uint256);

  function deposit(address _pair, uint256 _amount) external;

  function withdraw(address _pair, uint256 _amount) external;
}
