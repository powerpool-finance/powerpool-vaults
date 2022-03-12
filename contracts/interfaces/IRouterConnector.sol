// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

pragma experimental ABIEncoderV2;

import "../interfaces/PowerIndexRouterInterface.sol";

interface IRouterConnector {
  struct DistributeData {
    bytes stakeData;
    uint256 performanceFee;
    address performanceFeeReceiver;
  }

  function beforePoke(
    bytes calldata _pokeData,
    DistributeData memory _distributeData,
    bool _willClaimReward
  ) external;

  function afterPoke(PowerIndexRouterInterface.StakeStatus _status, bool _rewardClaimDone)
    external
    returns (bytes calldata);

  function getUnderlyingStaked() external view returns (uint256);

  function isClaimAvailable(
    bytes _claimParams,
    uint256 _lastClaimRewardsAt,
    uint256 _lastChangeStakeAt
  ) external view returns (bool);

  function redeem(uint256 _amount, DistributeData calldata _distributeData) external returns (bytes calldata);

  function stake(uint256 _amount, DistributeData calldata _distributeData) external returns (bytes calldata);

  function calculateLockedProfit(bytes calldata _stakeData) external view returns (uint256);

  function claimRewards(PowerIndexRouterInterface.StakeStatus _status, DistributeData memory _distributeData)
    external
    returns (bytes memory);
}
