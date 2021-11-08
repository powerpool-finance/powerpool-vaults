// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/WrappedPiErc20Interface.sol";
import "./interfaces/IPoolRestrictions.sol";
import "./interfaces/PowerIndexBasicRouterInterface.sol";
import "./interfaces/IRouterConnector.sol";
import "./PowerIndexNaiveRouter.sol";
import "hardhat/console.sol";

contract PowerIndexRouter is PowerIndexBasicRouterInterface, PowerIndexNaiveRouter {
  using SafeERC20 for IERC20;

  uint256 public constant HUNDRED_PCT = 1 ether;

  event SetVotingAndStaking(address indexed voting, address indexed staking);
  event SetReserveConfig(uint256 ratio, uint256 ratioLowerBound, uint256 ratioUpperBound, uint256 claimRewardsInterval);
  event SetRebalancingInterval(uint256 rebalancingInterval);
  event IgnoreRebalancing(uint256 blockTimestamp, uint256 lastRebalancedAt, uint256 rebalancingInterval);
  event RewardPool(address indexed pool, uint256 amount);
  event SetPerformanceFee(uint256 performanceFee);

  struct BasicConfig {
    address poolRestrictions;
    address powerPoke;
    address voting;
    address staking;
    uint256 reserveRatio;
    uint256 reserveRatioLowerBound;
    uint256 reserveRatioUpperBound;
    uint256 claimRewardsInterval;
    address performanceFeeReceiver;
    uint256 performanceFee;
  }

  WrappedPiErc20Interface public immutable piToken;
  IERC20 public immutable underlying;
  address public immutable performanceFeeReceiver;

  IPoolRestrictions public poolRestrictions;
  IPowerPoke public powerPoke;
  uint256 public reserveRatio;
  uint256 public claimRewardsInterval;
  uint256 public lastClaimRewardsAt;
  uint256 public lastRebalancedAt;
  uint256 public reserveRatioLowerBound;
  uint256 public reserveRatioUpperBound;
  // 1 ether == 100%
  uint256 public performanceFee;
  uint256 public lastRewardDistribution;
  uint256 public lockedProfitDegradation;
  uint256 public lockedProfit;
  uint256 public performanceFeeDebt;

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;

  struct Connector {
    IRouterConnector connector;
    uint256 share;
    bool callBeforeAfterPoke;
    uint256 lastClaimRewardsAt;
    bytes rewardsData;
    bytes pokeData;
  }
  Connector[] public connectors;

  modifier onlyPiToken() {
    require(msg.sender == address(piToken), "ONLY_PI_TOKEN_ALLOWED");
    _;
  }

  modifier onlyEOA() {
    require(tx.origin == msg.sender, "ONLY_EOA");
    _;
  }

  modifier onlyReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  modifier onlyNonReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  constructor(address _piToken, BasicConfig memory _basicConfig) public PowerIndexNaiveRouter() Ownable() {
    require(_piToken != address(0), "INVALID_PI_TOKEN");
    require(_basicConfig.reserveRatioUpperBound <= HUNDRED_PCT, "UPPER_RR_GREATER_THAN_100_PCT");
    require(_basicConfig.reserveRatio >= _basicConfig.reserveRatioLowerBound, "RR_LTE_LOWER_RR");
    require(_basicConfig.reserveRatio <= _basicConfig.reserveRatioUpperBound, "RR_GTE_UPPER_RR");
    require(_basicConfig.performanceFee < HUNDRED_PCT, "PVP_FEE_GTE_HUNDRED_PCT");
    require(_basicConfig.performanceFeeReceiver != address(0), "INVALID_PVP_ADDR");
    require(_basicConfig.poolRestrictions != address(0), "INVALID_POOL_RESTRICTIONS_ADDR");

    piToken = WrappedPiErc20Interface(_piToken);
    (, bytes memory underlyingRes) = _piToken.call(abi.encodeWithSignature("underlying()"));
    underlying = IERC20(abi.decode(underlyingRes, (address)));
    poolRestrictions = IPoolRestrictions(_basicConfig.poolRestrictions);
    powerPoke = IPowerPoke(_basicConfig.powerPoke);
//    voting = _basicConfig.voting;
//    staking = _basicConfig.staking;
    reserveRatio = _basicConfig.reserveRatio;
    reserveRatioLowerBound = _basicConfig.reserveRatioLowerBound;
    reserveRatioUpperBound = _basicConfig.reserveRatioUpperBound;
    claimRewardsInterval = _basicConfig.claimRewardsInterval;
    performanceFeeReceiver = _basicConfig.performanceFeeReceiver;
    performanceFee = _basicConfig.performanceFee;

    lastRewardDistribution = block.timestamp;
  }

  receive() external payable {}

  /*** OWNER METHODS ***/

  /**
   * @dev Changing the staking address with a positive underlying stake will break `getPiEquivalentForUnderlying`
   *      formula. Consider moving all the reserves to the piToken contract before doing this.
   */
//  function setVotingAndStaking(address _voting, address _staking) external override onlyOwner {
//    voting = _voting;
//    staking = _staking;
//    emit SetVotingAndStaking(_voting, _staking);
//  }

  function setReserveConfig(
    uint256 _reserveRatio,
    uint256 _reserveRatioLowerBound,
    uint256 _reserveRatioUpperBound,
    uint256 _claimRewardsInterval
  ) external virtual override onlyOwner {
    require(_reserveRatioUpperBound <= HUNDRED_PCT, "UPPER_RR_GREATER_THAN_100_PCT");
    require(_reserveRatio >= _reserveRatioLowerBound, "RR_LT_LOWER_RR");
    require(_reserveRatio <= _reserveRatioUpperBound, "RR_GT_UPPER_RR");

    reserveRatio = _reserveRatio;
    reserveRatioLowerBound = _reserveRatioLowerBound;
    reserveRatioUpperBound = _reserveRatioUpperBound;
    claimRewardsInterval = _claimRewardsInterval;
    emit SetReserveConfig(_reserveRatio, _reserveRatioLowerBound, _reserveRatioUpperBound, _claimRewardsInterval);
  }

  function setPerformanceFee(uint256 _performanceFee) external onlyOwner {
    require(_performanceFee < HUNDRED_PCT, "PERFORMANCE_FEE_OVER_THE_LIMIT");
    performanceFee = _performanceFee;
    emit SetPerformanceFee(_performanceFee);
  }

  function setPiTokenEthFee(uint256 _ethFee) external onlyOwner {
    require(_ethFee <= 0.1 ether, "ETH_FEE_OVER_THE_LIMIT");
    piToken.setEthFee(_ethFee);
  }

  function addConnector(IRouterConnector _connector, uint256 _share, bool _callBeforeAfterPoke) external onlyOwner {
    connectors.push(Connector(
        _connector,
        _share,
        _callBeforeAfterPoke,
        0,
        "",
        ""
    ));
  }

  function setConnector(uint256 _connectorIndex, address _connectorAddress, bool _callBeforeAfterPoke) external onlyOwner {
    connectors[_connectorIndex].connector = IRouterConnector(_connectorAddress);
    connectors[_connectorIndex].callBeforeAfterPoke = _callBeforeAfterPoke;
  }

  function setPiTokenNoFee(address _for, bool _noFee) external onlyOwner {
    piToken.setNoFee(_for, _noFee);
  }

  function withdrawEthFee(address payable _receiver) external onlyOwner {
    piToken.withdrawEthFee(_receiver);
  }

  function migrateToNewRouter(
    address _piToken,
    address payable _newRouter,
    address[] memory _tokens
  ) public override onlyOwner {
    super.migrateToNewRouter(_piToken, _newRouter, _tokens);

    _newRouter.transfer(address(this).balance);

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      IERC20 t = IERC20(_tokens[i]);
      t.safeTransfer(_newRouter, t.balanceOf(address(this)));
    }
  }

  function pokeFromReporter(
    uint256 _reporterId,
    bool _claimAndDistributeRewards,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) onlyEOA {
    _pokeFrom(_claimAndDistributeRewards, false);
  }

  function pokeFromSlasher(
    uint256 _reporterId,
    bool _claimAndDistributeRewards,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) onlyEOA {
    _pokeFrom(_claimAndDistributeRewards, true);
  }

  function _getDistributeData(Connector storage c) internal returns (IRouterConnector.DistributeData memory) {
    return IRouterConnector.DistributeData(c.rewardsData, performanceFee, performanceFeeReceiver);
  }

  function _pokeFrom(bool _claimAndDistributeRewards, bool _isSlasher) internal {

//    _beforePoke(shouldClaim);

    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();

    for (uint256 i = 0; i < connectors.length; i++) {
      Connector storage c = connectors[i];
      require(address(c.connector) != address(0), "CONNECTOR_IS_NULL");
      bool shouldClaim = _claimAndDistributeRewards && c.lastClaimRewardsAt + claimRewardsInterval < block.timestamp;

      if (c.callBeforeAfterPoke) {
        c.connector.beforePoke(c.pokeData, _getDistributeData(c), shouldClaim);
      }

      console.log("c.connector.getUnderlyingStaked()", c.connector.getUnderlyingStaked());
      (ReserveStatus status, uint256 diff, bool forceRebalance) = getReserveStatus(
        c.connector.getUnderlyingStaked(),
        c.share,
        0
      );
      if (_isSlasher) {
        require(forceRebalance || lastRebalancedAt + maxInterval < block.timestamp, "MAX_INTERVAL_NOT_REACHED");
      } else {
        require(forceRebalance || lastRebalancedAt + minInterval < block.timestamp, "MIN_INTERVAL_NOT_REACHED");
      }
      console.log("status", uint256(status));
      console.log("diff", diff);
      if (status != ReserveStatus.EQUILIBRIUM) {
        _rebalancePoke(c, status, diff);
      }

      if (shouldClaim) {
        _claimRewards(c, status);
        c.lastClaimRewardsAt = block.timestamp;
      }

      if (c.callBeforeAfterPoke) {
        c.pokeData = c.connector.afterPoke(status, shouldClaim);
      }
    }

    lastRebalancedAt = block.timestamp;
  }

  function _redeem(Connector storage c, uint256 diff) internal {
    (bool success, bytes memory result) = address(c.connector).delegatecall(
      abi.encodeWithSignature("redeem(uint256,(bytes,uint256,address))", diff, _getDistributeData(c))
    );
    require(success, string(result));
    //    require(success, "CONNECTOR_REDEEM_FAILED");
    result = abi.decode(result, (bytes));
    if (result.length > 0 && keccak256(result) != keccak256(new bytes(0))) {
      console.log("rewardsData:");
      console.logBytes(result);
      c.rewardsData = result;
    }
  }

  function _stake(Connector storage c, uint256 diff) internal {
    (bool success, bytes memory result) = address(c.connector).delegatecall(
      abi.encodeWithSignature("stake(uint256,(bytes,uint256,address))", diff, _getDistributeData(c))
    );
    require(success, string(result));
    //    require(success, "CONNECTOR_REDEEM_FAILED");
    result = abi.decode(result, (bytes));
    if (result.length > 0 && keccak256(result) != keccak256(new bytes(0))) {
      console.log("rewardsData:");
      console.logBytes(result);
      c.rewardsData = result;
    }
  }

  function _rebalancePoke(Connector storage c, ReserveStatus reserveStatus, uint256 diff) internal {
    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(c, diff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(c, diff);
    }
  }

  function redeem(uint256 _connectorIndex, uint256 _diff) public onlyOwner {
    _redeem(connectors[_connectorIndex], _diff);
  }

  function stake(uint256 _connectorIndex, uint256 _diff) public onlyOwner {
    _stake(connectors[_connectorIndex], _diff);
  }

  function initRouterByConnector(uint256 _connectorIndex) public onlyOwner {
    (bool success, bytes memory result) = address(connectors[_connectorIndex].connector).delegatecall(
      abi.encodeWithSignature("initRouter(bytes)", new bytes(0))
    );
    require(success, string(result));
  }

  /**
   * @notice Explicitly collects the assigned rewards. If a reward token is the same token as underlying, it should
   *         allocate this reward at piToken. Otherwise, it should transfer it to the router contract for a further
   *         actions.
   * @dev This is not the only way the rewards can be claimed. Sometimes they are distributed implicitly while
   *      interacting with a protocol. For ex. MasterChef distributes rewards on each `deposit()/withdraw()` action
   *      and there is no use in calling `_claimRewards()` immediately after calling one of these methods.
   */
  function _claimRewards(Connector storage c, ReserveStatus _reserveStatus) internal {
    c.connector.claimRewards(_reserveStatus, _getDistributeData(c));
  }

//  function _callVoting(bytes4 _sig, bytes memory _data) internal returns (bytes memory) {
//    return piToken.callExternal(voting, _sig, _data, 0);
//  }

//  function _checkVotingSenderAllowed() internal view {
//    require(poolRestrictions.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
//  }

  /*
   * @dev Getting status and diff of actual staked balance and target reserve balance.
   */
  function getReserveStatusForStakedBalance(uint256 _share)
    external
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      bool forceRebalance
    )
  {
    return getReserveStatus(_getUnderlyingStaked(), _share, 0);
  }

  /*
   * @dev Getting status and diff of provided staked balance and target reserve balance.
   */
  function getReserveStatus(uint256 _stakedBalance, uint256 _share, uint256 _withdrawAmount)
    public
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      bool forceRebalance
    )
  {
    uint256 expectedReserveAmount;
    uint256 underlyingBalance = piToken.getUnderlyingBalance().mul(_share).div(1 ether);
    console.log("underlyingBalance", underlyingBalance);
    console.log("piToken.getUnderlyingBalance()", piToken.getUnderlyingBalance());
    (status, diff, expectedReserveAmount) = getReserveStatusPure(
      reserveRatio,
      underlyingBalance,
      _stakedBalance,
      _withdrawAmount
    );

    if (status == ReserveStatus.EQUILIBRIUM) {
      return (status, diff, forceRebalance);
    }

    uint256 denominator = underlyingBalance.add(_stakedBalance).sub(_withdrawAmount);

    if (status == ReserveStatus.SHORTAGE) {
      uint256 numerator = expectedReserveAmount.sub(diff).mul(HUNDRED_PCT);
      uint256 currentRatio = numerator.div(denominator);
      forceRebalance = reserveRatioLowerBound >= currentRatio;
    } else if (status == ReserveStatus.EXCESS) {
      uint256 numerator = expectedReserveAmount.add(diff).mul(HUNDRED_PCT);
      uint256 currentRatio = numerator.div(denominator);
      forceRebalance = reserveRatioUpperBound <= currentRatio;
    }
  }

  // NOTICE: could/should be changed depending on implementation
  function _getUnderlyingStaked() internal view virtual returns (uint256) {
    uint256 underlyingStaked = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      underlyingStaked += connectors[i].connector.getUnderlyingStaked();
    }
    return underlyingStaked;
  }


  function getUnderlyingReserve() public view returns (uint256) {
    return underlying.balanceOf(address(piToken));
  }

  function getUnderlyingStaked() external view returns (uint256) {
    return _getUnderlyingStaked();
  }

  function calculateLockedProfit() public view returns (uint256) {
    uint256 lockedProfit = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      lockedProfit += connectors[i].connector.calculateLockedProfit(connectors[i].rewardsData);
    }
    return lockedProfit;
  }

  function getUnderlyingAvailable() public view returns (uint256) {
    // _getUnderlyingReserve + _getUnderlyingStaked - _calculateLockedProfit
    return getUnderlyingReserve().add(_getUnderlyingStaked()).sub(calculateLockedProfit());
  }

  function getUnderlyingTotal() external view returns (uint256) {
    // _getUnderlyingReserve + _getUnderlyingStaked
    return getUnderlyingReserve().add(_getUnderlyingStaked());
  }

  function getPiEquivalentForUnderlying(uint256 _underlyingAmount, uint256 _piTotalSupply)
    external
    view
    virtual
    override
    returns (uint256)
  {
    return
      getPiEquivalentForUnderlyingPure(
        _underlyingAmount,
        // underlyingOnPiToken + underlyingOnStaking - lockedProfit,
        getUnderlyingAvailable(),
        _piTotalSupply
      );
  }

  function getPiEquivalentForUnderlyingPure(
    uint256 _underlyingAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) public pure virtual override returns (uint256) {
    if (_piTotalSupply == 0) {
      return _underlyingAmount;
    }
    // return _piTotalSupply * _underlyingAmount / _totalUnderlyingWrapped;
    return _piTotalSupply.mul(_underlyingAmount).div(_totalUnderlyingWrapped);
  }

  function getUnderlyingEquivalentForPi(uint256 _piAmount, uint256 _piTotalSupply)
    external
    view
    virtual
    override
    returns (uint256)
  {
    return
      getUnderlyingEquivalentForPiPure(
        _piAmount,
        // underlyingOnPiToken + underlyingOnStaking - lockedProfit,
        getUnderlyingAvailable(),
        _piTotalSupply
      );
  }

  function getUnderlyingEquivalentForPiPure(
    uint256 _piAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) public pure virtual override returns (uint256) {
    if (_piTotalSupply == 0) {
      return _piAmount;
    }
    // _piAmount * _totalUnderlyingWrapped / _piTotalSupply;
    return _totalUnderlyingWrapped.mul(_piAmount).div(_piTotalSupply);
  }

  /**
   * @notice Calculates the desired reserve status
   * @param _reserveRatioPct The reserve ratio in %, 1 ether == 100 ether
   * @param _leftOnPiToken The amount of origin tokens left on the piToken (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction. Deprecated, pass in 0.
   * @return status The reserve status:
   * * SHORTAGE - There is not enough underlying funds on the wrapper contract to satisfy the reserve ratio,
   *           the diff amount should be redeemed from the staking contract
   * * EXCESS - there are some extra funds over reserve ratio on the wrapper contract,
   *           the diff amount should be sent to the staking contract
   * * EQUILIBRIUM - the reserve ratio hasn't changed,
   *           the diff amount is 0 and there are no additional stake/redeem actions expected
   * @return diff The difference between `adjustedReserveAmount` and `_leftOnWrapper`
   * @return expectedReserveAmount The calculated expected reserve amount
   */
  function getReserveStatusPure(
    uint256 _reserveRatioPct,
    uint256 _leftOnPiToken,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  )
    public
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 expectedReserveAmount
    )
  {
    require(_reserveRatioPct <= HUNDRED_PCT, "RR_GREATER_THAN_100_PCT");
    expectedReserveAmount = getExpectedReserveAmount(_reserveRatioPct, _leftOnPiToken, _stakedBalance, _withdrawAmount);

    console.log("expectedReserveAmount", expectedReserveAmount);
    console.log("_leftOnPiToken       ", _leftOnPiToken);
    if (expectedReserveAmount > _leftOnPiToken) {
      status = ReserveStatus.SHORTAGE;
      diff = expectedReserveAmount.sub(_leftOnPiToken);
    } else if (expectedReserveAmount < _leftOnPiToken) {
      status = ReserveStatus.EXCESS;
      diff = _leftOnPiToken.sub(expectedReserveAmount);
    } else {
      status = ReserveStatus.EQUILIBRIUM;
      diff = 0;
    }
  }

  /**
   * @notice Calculates an expected reserve amount after the transaction taking into an account the withdrawAmount
   * @param _reserveRatioPct % of a reserve ratio, 1 ether == 100%
   * @param _leftOnPiToken The amount of origin tokens left on the piToken (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction. Deprecated, now it is always 0.
   *        Introduced when the rebalancing logic was triggered by deposit/withdraw actions of piToken. Now this logic
   *        is triggered by the poke*() methods only.
   * @return expectedReserveAmount The expected reserve amount
   *
   *                           / %reserveRatio * (staked + _leftOnPiToken - withdrawAmount) \
   * expectedReserveAmount =  | ------------------------------------------------------------| + withdrawAmount
   *                           \                         100%                              /
   */
  function getExpectedReserveAmount(
    uint256 _reserveRatioPct,
    uint256 _leftOnPiToken,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  ) public pure returns (uint256) {
    return
      _reserveRatioPct.mul(_stakedBalance.add(_leftOnPiToken).sub(_withdrawAmount)).div(HUNDRED_PCT).add(
        _withdrawAmount
      );
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, _gasStart.sub(gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }
}
