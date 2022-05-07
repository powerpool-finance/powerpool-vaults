// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
//pragma experimental ABIEncoderV2;

interface ILiquidityGauge {
  struct Reward {
    address token;
    address distributor;
    uint256 period_finish;
    uint256 rate;
    uint256 last_update;
    uint256 integral;
  }

  function deposit(uint256 _value, address _addr, bool _claim_rewards) external;

  function withdraw(uint256 _value, bool _claim_rewards) external;

  function balanceOf(address _user) external view returns (uint256);

  function integrate_fraction(address user) external returns (uint256);

  function user_checkpoint(address user) external returns (bool);

  function reward_data(address user) external view returns (
    address token,
    address distributor,
    uint256 period_finish,
    uint256 rate,
    uint256 last_update,
    uint256 integral
  );
}
