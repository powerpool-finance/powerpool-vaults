// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/torn/ITornStaking.sol";
import "../interfaces/torn/ITornGovernance.sol";
import "./AbstractStakeRedeemConnector.sol";


contract TornPowerIndexConnector is AbstractStakeRedeemConnector {
  uint256 public constant RATIO_CONSTANT = 10000000 ether;
  address public immutable GOVERNANCE;

  constructor(
    address _staking,
    address _underlying,
    address _piToken,
    address _governance
  ) public AbstractStakeRedeemConnector(_staking, _underlying, _piToken, 46e14) {
    GOVERNANCE = _governance;
  }

  /*** VIEWERS ***/

  function getPendingRewards() public view returns (uint256) {
    return ITornStaking(STAKING).checkReward(address(PI_TOKEN));
  }

  function accumulatedRewardPerTorn() public view returns (uint256) {
    return ITornStaking(STAKING).accumulatedRewardPerTorn();
  }

  function accumulatedReward() public view returns (uint256) {
    return ITornStaking(STAKING).accumulatedRewards(address(PI_TOKEN));
  }

  function accumulatedRewardRateOnLastUpdate() public view returns (uint256) {
    return ITornStaking(STAKING).accumulatedRewardRateOnLastUpdate(address(PI_TOKEN));
  }

  function accumulatedRewardRateDiffForLastUpdate() public view returns (uint256) {
    return accumulatedRewardPerTorn().diff(accumulatedRewardRateOnLastUpdate());
  }

  function pendingReward(
    uint256 _accRewardPerTorn,
    uint256 _accRewardRateOnLastUpdate,
    uint256 _lockedBalance
  ) public view returns (uint256) {
    return _lockedBalance
    .mul(_accRewardPerTorn.sub(_accRewardRateOnLastUpdate))
    .div(RATIO_CONSTANT)
    .add(accumulatedReward());
  }

  function forecastReward(
    uint256 _accRewardPerTorn,
    uint256 _accRewardRateOnLastUpdate,
    uint256 _reinvestDuration,
    uint256 _lastRewardsUpdate,
    uint256 _lockedBalance
  ) public view returns (uint256) {
    return _reinvestDuration
      .mul(_accRewardPerTorn.sub(_accRewardRateOnLastUpdate))
      .div(block.timestamp.sub(_lastRewardsUpdate))
      .mul(_lockedBalance)
      .div(RATIO_CONSTANT);
  }

  function getPendingAndForecastReward(
    uint256 _lastClaimRewardsAt,
    uint256 _lastChangeStakeAt,
    uint256 _reinvestDuration,
    uint256 _subPendingToForecast
  ) public view returns (uint256 pending, uint256 forecast, uint256 forecastWithReinvest) {
    uint256 lastUpdate = _lastClaimRewardsAt > _lastChangeStakeAt ? _lastClaimRewardsAt : _lastChangeStakeAt;
    uint256 lockedBalance = getUnderlyingStaked();
    uint256 accRewardPerTorn = accumulatedRewardPerTorn();
    uint256 accRewardOnLastUpdate = accumulatedRewardRateOnLastUpdate();
    uint256 pending = pendingReward(accRewardPerTorn, accRewardOnLastUpdate, lockedBalance);

    return (
      pending,
      forecastReward(accRewardPerTorn, accRewardOnLastUpdate, reinvestDuration, lastUpdate, lockedBalance),
      forecastReward(
        accRewardPerTorn,
        accRewardOnLastUpdate,
        reinvestDuration,
        lastUpdate,
        lockedBalance.add(pending).sub(_subPendingToForecast)
      )
    );
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() external view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    return ITornGovernance(GOVERNANCE).lockedBalance(address(PI_TOKEN));
  }

  function _approveToStaking(uint256 _amount) internal override {
    PI_TOKEN.approveUnderlying(GOVERNANCE, _amount);
  }

  function _claimImpl() internal override {
    _callExternal(PI_TOKEN, STAKING, ITornStaking.getReward.selector, new bytes(0));
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, GOVERNANCE, ITornGovernance.lockWithApproval.selector, abi.encode(_amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, GOVERNANCE, ITornGovernance.unlock.selector, abi.encode(_amount));
  }

  function isClaimAvailable(
    bytes _claimParams,
    uint256 _lastClaimRewardsAt,
    uint256 _lastChangeStakeAt
  ) external virtual returns (bool) {
    (uint256 reinvestDuration, uint256 reinvestRatio, uint256 gasToReinvest) = unpackClaimParams(_claimParams);

    uint256 tornPriceRatio = getTornPriceRatio();
    uint256 ethNeedToReinvest = gasToReinvest.mul(tx.gasprice);
    uint256 tornNeedToReinvest = calcWethToTornWithRatio(ethNeedToReinvest, tornPriceRatio);
    (
      ,
      uint256 forecastReward,
      uint256 forecastWithReinvestReward
    ) = getPendingAndForecastReward(_lastClaimRewardsAt, _lastChangeStakeAt, reinvestDuration, tornNeedToReinvest);

    uint256 currentRatio = forecastWithReinvestReward.mul(1 ether).div(forecastReward);
    return currentRatio >= reinvestRatio;
  }

  function getTornPriceRatio(uint256 _tornAmountIn) public view returns (uint256) {
    uint256 uniswapTimePeriod = 5400;
    uint256 uniswapTornSwappingFee = 10000;
    uint256 uniswapWethSwappingFee = 0;

    return UniswapV3OracleHelper.getPriceRatioOfTokens(
      [torn, UniswapV3OracleHelper.WETH],
      [uniswapTornSwappingFee, uniswapWethSwappingFee],
      uniswapTimePeriod
    );
  }

  function calcWethOutByTornIn(uint256 _tornAmountIn) public view returns (uint256) {
    return calcTornToWethWithRatio(_tornAmountIn, getTornPriceRatio());
  }

  function calcTornToWethWithRatio(uint256 _tornAmount, uint256 _ratio) public pure returns (uint256) {
    return _tornAmount.mul(UniswapV3OracleHelper.RATIO_DIVIDER).div(_ratio);
  }

  function calcWethToTornWithRatio(uint256 _wethAmount, uint256 _ratio) public pure returns (uint256) {
    return _wethAmount.mul(_ratio).div(UniswapV3OracleHelper.RATIO_DIVIDER);
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packClaimParams(
    uint256 duration,
    uint256 ratio,
    uint256 gasToReinvest
  ) public pure returns (bytes memory) {
    return abi.encode(duration, ratio, gasToReinvest);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams) public pure returns (
    uint256 duration,
    uint256 ratio,
    uint256 gasToReinvest
  ) {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0, 0, 0);
    }
    (duration, ratio, gasToReinvest) = abi.decode(_claimParams, (uint256, uint256, uint256));
  }
}
