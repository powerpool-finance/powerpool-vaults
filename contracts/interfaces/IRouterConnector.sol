pragma solidity 0.6.12;

pragma experimental ABIEncoderV2;

import "../interfaces/PowerIndexBasicRouterInterface.sol";

interface IRouterConnector {
  struct DistributeData {
    bytes rewardsData;
    uint256 performanceFee;
    address performanceFeeReceiver;
  }

  function beforePoke(bytes calldata _pokeData, DistributeData memory _distributeData, bool _willClaimReward) external;
  function afterPoke(PowerIndexBasicRouterInterface.ReserveStatus reserveStatus, bool _rewardClaimDone) external returns (bytes calldata);
  function getUnderlyingStaked() external view returns (uint256);
  function redeem(uint256 _amount, DistributeData calldata _distributeData) external returns (bytes calldata);
  function stake(uint256 _amount, DistributeData calldata _distributeData) external returns (bytes calldata);
  function calculateLockedProfit(bytes calldata _rewardsData) external view returns (uint256);

  function claimRewards(PowerIndexBasicRouterInterface.ReserveStatus _status, DistributeData memory _distributeData) external returns (bytes memory);
}
