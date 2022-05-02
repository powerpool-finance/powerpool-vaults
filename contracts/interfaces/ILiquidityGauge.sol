// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface ILiquidityGauge {
  function deposit(uint256 _value, address _addr, bool _claim_rewards) external;

  function withdraw(uint256 _value, bool _claim_rewards) external;

  function claim_rewards(address _addr, address _receiver) external;

  function claimable_reward(address _user, address _reward_token) external view returns (uint256);

  function balanceOf(address _user) external view returns (uint256);
}
