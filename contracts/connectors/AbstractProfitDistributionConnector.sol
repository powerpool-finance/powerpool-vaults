// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../interfaces/sushi/IMasterChefV1.sol";
import "../interfaces/IRouterLockedProfitConnector.sol";
import "./AbstractConnector.sol";

abstract contract AbstractProfitDistributionConnector is AbstractConnector, IRouterLockedProfitConnector {
  using SafeMath for uint256;

  uint256 public constant DEGRADATION_COEFFICIENT = 1 ether;
  uint256 public immutable LOCKED_PROFIT_DEGRADATION;

  event DistributeReward(
    address indexed sender,
    uint256 totalReward,
    uint256 performanceFee,
    uint256 piTokenReward,
    uint256 lockedProfitBefore,
    uint256 lockedProfitAfter
  );

  constructor(uint256 _lockedProfitDegradation) {
    LOCKED_PROFIT_DEGRADATION = _lockedProfitDegradation;
  }

  /**
   * @notice Pack stake data to bytes.
   */
  function packStakeData(
    uint256 lockedProfit,
    uint256 lastRewardDistribution,
    uint256 performanceFeeDebt
  ) public pure virtual returns (bytes memory) {
    return abi.encode(lockedProfit, lastRewardDistribution, performanceFeeDebt);
  }

  /**
   * @notice Unpack stake data from bytes to variables.
   */
  function unpackStakeData(bytes memory _stakeData)
    public
    pure
    virtual
    returns (
      uint256 lockedProfit,
      uint256 lastRewardDistribution,
      uint256 performanceFeeDebt
    )
  {
    if (_stakeData.length == 0 || keccak256(_stakeData) == keccak256("")) {
      return (0, 0, 0);
    }
    (lockedProfit, lastRewardDistribution, performanceFeeDebt) = abi.decode(_stakeData, (uint256, uint256, uint256));
  }

  /**
   * @notice Calculate locked profit from packed _stakeData.
   */
  function calculateLockedProfit(bytes memory _stakeData) external view override returns (uint256) {
    (uint256 lockedProfit, uint256 lastRewardDistribution, ) = unpackStakeData(_stakeData);
    return calculateLockedProfit(lockedProfit, lastRewardDistribution);
  }

  /**
   * @notice Calculate locked profit based on lastRewardDistribution timestamp.
   * @param _lockedProfit Previous locked profit amount.
   * @param _lastRewardDistribution Timestamp of last rewards distribution.
   * @return Updated locked profit amount, calculated with past time from _lastRewardDistribution.
   */
  function calculateLockedProfit(uint256 _lockedProfit, uint256 _lastRewardDistribution) public view returns (uint256) {
    uint256 lockedFundsRatio = (block.timestamp.sub(_lastRewardDistribution)).mul(LOCKED_PROFIT_DEGRADATION);

    if (lockedFundsRatio < DEGRADATION_COEFFICIENT) {
      uint256 currentLockedProfit = _lockedProfit;
      return currentLockedProfit.sub(lockedFundsRatio.mul(currentLockedProfit) / DEGRADATION_COEFFICIENT);
    } else {
      return 0;
    }
  }

  /*** INTERNALS ***/

  /**
   * @notice Distributes performance fee from reward and calculates locked profit.
   * @param _distributeData Data is stored in the router contract and passed to the connector's functions.
   * @param _assetsManager Assets manager address.
   * @param _token ERC20 Token address to distribute reward.
   * @param _totalReward Total reward received
   * @return lockedProfitReward Rewards that locked in vesting.
   * @return stakeData Result packed rewards data.
   */
  function _distributeReward(
    DistributeData memory _distributeData,
    address _assetsManager,
    IERC20 _token,
    uint256 _totalReward
  ) internal returns (uint256 lockedProfitReward, bytes memory stakeData) {
    (uint256 lockedProfit, uint256 lastRewardDistribution, uint256 performanceFeeDebt) = unpackStakeData(
      _distributeData.stakeData
    );
    uint256 pvpReward;
    // Step #1. Distribute pvpReward
    (pvpReward, lockedProfitReward, performanceFeeDebt) = _distributePerformanceFee(
      _distributeData.performanceFee,
      _distributeData.performanceFeeReceiver,
      performanceFeeDebt,
      _assetsManager,
      _token,
      _totalReward
    );
    require(lockedProfitReward > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2 Reset lockedProfit
    uint256 lockedProfitBefore = calculateLockedProfit(lockedProfit, lastRewardDistribution);
    uint256 lockedProfitAfter = lockedProfitBefore.add(lockedProfitReward);
    lockedProfit = lockedProfitAfter;

    lastRewardDistribution = block.timestamp;

    emit DistributeReward(
      msg.sender,
      _totalReward,
      pvpReward,
      lockedProfitReward,
      lockedProfitBefore,
      lockedProfitAfter
    );

    return (lockedProfitReward, packStakeData(lockedProfit, lastRewardDistribution, performanceFeeDebt));
  }
}
