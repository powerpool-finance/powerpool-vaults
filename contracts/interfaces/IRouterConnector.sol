// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "../interfaces/PowerIndexRouterInterface.sol";

interface IRouterConnector {
  struct DistributeData {
    bytes stakeData;
    bytes stakeParams;
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

  function initRouter(bytes calldata) external;

  function getUnderlyingStaked() external view returns (uint256);

  function getUnderlyingReserve() external view returns (uint256);

  function getUnderlyingTotal() external view returns (uint256);

  function isClaimAvailable(
    bytes calldata _claimParams,
    uint256 _lastClaimRewardsAt,
    uint256 _lastChangeStakeAt
  ) external view returns (bool);

  function redeem(uint256 _amount, DistributeData calldata _distributeData)
    external
    returns (bytes calldata, bool claimed);

  function stake(uint256 _amount, DistributeData calldata _distributeData)
    external
    returns (bytes calldata, bool claimed);

  function migrate(bytes calldata) external;

  function claimRewards(
    PowerIndexRouterInterface.StakeStatus _status,
    DistributeData calldata _distributeData,
    bytes calldata _claimParams
  )
    external
    returns (bytes calldata);
}
