// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IRouterConnector.sol";

abstract contract AbstractConnector is IRouterConnector {
  using SafeMath for uint256;

  uint256 public constant DEGRADATION_COEFFICIENT = 1 ether;
  uint256 public constant HUNDRED_PCT = 1 ether;
  uint256 public immutable LOCKED_PROFIT_DEGRADATION;

  event Stake(address indexed sender, address indexed staking, address indexed underlying, uint256 amount);
  event Redeem(address indexed sender, address indexed staking, address indexed underlying, uint256 amount);

  event DistributeReward(
    address indexed sender,
    uint256 totalReward,
    uint256 performanceFee,
    uint256 piTokenReward,
    uint256 lockedProfitBefore,
    uint256 lockedProfitAfter
  );

  event DistributePerformanceFee(
    uint256 performanceFeeDebtBefore,
    uint256 performanceFeeDebtAfter,
    uint256 underlyingBalance,
    uint256 performance
  );

  constructor(uint256 _lockedProfitDegradation) public {
    LOCKED_PROFIT_DEGRADATION = _lockedProfitDegradation;
  }

  function _callExternal(
    WrappedPiErc20Interface _piToken,
    address _staking,
    bytes4 _sig,
    bytes memory _data
  ) internal returns (bytes memory) {
    return _piToken.callExternal(_staking, _sig, _data, 0);
  }

  /**
   * @notice Distributes an underlying token reward received in the same tx earlier.
   */
  function _distributeReward(
    DistributeData memory _distributeData,
    WrappedPiErc20Interface _piToken,
    IERC20 _token,
    uint256 _totalReward
  ) internal returns (bytes memory rewardsData) {
    (uint256 lockedProfit, uint256 lastRewardDistribution, uint256 performanceFeeDebt) = unpackRewardsData(
      _distributeData.rewardsData
    );
    uint256 pvpReward;
    uint256 piTokenReward;
    // Step #1. Distribute pvpReward
    (pvpReward, piTokenReward, performanceFeeDebt) = _distributePerformanceFee(
      _distributeData.performanceFee,
      _distributeData.performanceFeeReceiver,
      performanceFeeDebt,
      _piToken,
      _token,
      _totalReward
    );
    require(piTokenReward > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2 Reset lockedProfit
    uint256 lockedProfitBefore = calculateLockedProfit(lockedProfit, lastRewardDistribution);
    uint256 lockedProfitAfter = lockedProfitBefore.add(piTokenReward);
    lockedProfit = lockedProfitAfter;

    lastRewardDistribution = block.timestamp;

    emit DistributeReward(msg.sender, _totalReward, pvpReward, piTokenReward, lockedProfitBefore, lockedProfitAfter);

    return packRewardsData(lockedProfit, lastRewardDistribution, performanceFeeDebt);
  }

  function _distributePerformanceFee(
    uint256 _performanceFee,
    address _performanceFeeReceiver,
    uint256 _performanceFeeDebt,
    WrappedPiErc20Interface _piToken,
    IERC20 _underlying,
    uint256 _totalReward
  )
    internal
    returns (
      uint256 performance,
      uint256 remainder,
      uint256 resultPerformanceFeeDebt
    )
  {
    performance = 0;
    remainder = 0;
    resultPerformanceFeeDebt = _performanceFeeDebt;

    if (_performanceFee > 0) {
      performance = _totalReward.mul(_performanceFee).div(HUNDRED_PCT);
      remainder = _totalReward.sub(performance);

      uint256 performanceFeeDebtBefore = _performanceFeeDebt;
      uint256 underlyingBalance = _underlying.balanceOf(address(_piToken));
      uint256 totalFeeToPayOut = performance.add(performanceFeeDebtBefore);
      if (underlyingBalance >= totalFeeToPayOut) {
        _safeTransfer(_piToken, _underlying, _performanceFeeReceiver, totalFeeToPayOut);
      } else {
        resultPerformanceFeeDebt = totalFeeToPayOut.sub(underlyingBalance);
        _safeTransfer(_piToken, _underlying, _performanceFeeReceiver, underlyingBalance);
      }

      emit DistributePerformanceFee(performanceFeeDebtBefore, resultPerformanceFeeDebt, underlyingBalance, performance);
    } else {
      remainder = _totalReward;
    }
  }

  function packRewardsData(
    uint256 lockedProfit,
    uint256 lastRewardDistribution,
    uint256 performanceFeeDebt
  ) public pure returns (bytes memory) {
    return abi.encode(lockedProfit, lastRewardDistribution, performanceFeeDebt);
  }

  function unpackRewardsData(bytes memory _rewardsData)
    public
    pure
    returns (
      uint256 lockedProfit,
      uint256 lastRewardDistribution,
      uint256 performanceFeeDebt
    )
  {
    if (_rewardsData.length == 0 || keccak256(_rewardsData) == keccak256("")) {
      return (0, 0, 0);
    }
    (lockedProfit, lastRewardDistribution, performanceFeeDebt) = abi.decode(_rewardsData, (uint256, uint256, uint256));
  }

  function calculateLockedProfit(bytes memory _rewardsData) external view override returns (uint256) {
    (uint256 lockedProfit, uint256 lastRewardDistribution, ) = unpackRewardsData(_rewardsData);
    return calculateLockedProfit(lockedProfit, lastRewardDistribution);
  }

  function calculateLockedProfit(uint256 lockedProfit, uint256 lastRewardDistribution) public view returns (uint256) {
    uint256 lockedFundsRatio = (block.timestamp.sub(lastRewardDistribution)).mul(LOCKED_PROFIT_DEGRADATION);

    if (lockedFundsRatio < DEGRADATION_COEFFICIENT) {
      uint256 currentLockedProfit = lockedProfit;
      return currentLockedProfit.sub(lockedFundsRatio.mul(currentLockedProfit) / DEGRADATION_COEFFICIENT);
    } else {
      return 0;
    }
  }

  function _safeTransfer(
    WrappedPiErc20Interface _piToken,
    IERC20 _token,
    address _to,
    uint256 _value
  ) internal {
    bytes memory response = _piToken.callExternal(
      address(_token),
      IERC20.transfer.selector,
      abi.encode(_to, _value),
      0
    );

    if (response.length > 0) {
      // Return data is optional
      require(abi.decode(response, (bool)), "ERC20 operation did not succeed");
    }
  }
}
