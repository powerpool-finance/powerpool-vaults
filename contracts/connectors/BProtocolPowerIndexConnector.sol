// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../interfaces/bprotocol/IBAMM.sol";
import "../interfaces/balancerV3/IVault.sol";
import "../interfaces/liquidity/IStabilityPool.sol";
import "./AbstractConnector.sol";
import { UniswapV3OracleHelper } from "../libs/UniswapV3OracleHelper.sol";

import "hardhat/console.sol";

contract BProtocolPowerIndexConnector is AbstractConnector {
  using SafeMath for uint256;

  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);

  uint256 public constant RATIO_CONSTANT = 10000000 ether;
  address public immutable ASSET_MANAGER;
  address public immutable STAKING;
  address public immutable STABILITY_POOL;
  address public immutable LQTY_TOKEN;
  address public immutable VAULT;
  IERC20 public immutable UNDERLYING;
  bytes32 public immutable PID;

  constructor(
    address _assetManager,
    address _staking,
    address _underlying,
    address _vault,
    address _stabilityPool,
    address _lqtyToken,
    bytes32 _pId
  ) public AbstractConnector(46e14) {
    ASSET_MANAGER = _assetManager;
    STAKING = _staking;
    UNDERLYING = IERC20(_underlying);
    VAULT = _vault;
    STABILITY_POOL = _stabilityPool;
    LQTY_TOKEN = _lqtyToken;
    PID = _pId;
  }

  // solhint-disable-next-line
  /**
   * @notice Checking: is pending rewards in TORN enough to cover transaction cost to reinvest
   * @param _claimParams Claim parameters, that stored in PowerIndexRouter
   * @param _lastClaimRewardsAt Last claim action timestamp
   * @param _lastChangeStakeAt Last stake/unstake action timestamp
   */
  function isClaimAvailable(
    bytes calldata _stakeData,
    bytes calldata _claimParams
  ) external view virtual override returns (bool) {
    (uint256 minAmount) = unpackClaimParams(_claimParams);

    (, , uint256 forecastByPending) = getPendingAndForecastReward(
      _lastClaimRewardsAt,
      _lastChangeStakeAt,
      paybackDuration
    );
    return forecastByPending >= getTornUsedToReinvest(gasToReinvest, tx.gasprice);
  }

  // solhint-disable-next-line
  function claimRewards(PowerIndexRouterInterface.StakeStatus _status, DistributeData memory _distributeData)
    external
    override
    returns (bytes memory stakeData)
  {
    uint256 pending = getPendingRewards();
    if (pending > 0) {
      _claimImpl();
    }
    uint256 receivedReward = UNDERLYING.balanceOf(ASSET_MANAGER);
    if (receivedReward > 0) {
      uint256 rewardsToReinvest;
      (rewardsToReinvest, stakeData) = _distributeReward(_distributeData, PI_TOKEN, UNDERLYING, receivedReward);
      //TODO: swap lqty to lusd
      _stakeImpl(rewardsToReinvest);
      return stakeData;
    }
    // Otherwise the rewards are distributed each time deposit/withdraw methods are called,
    // so no additional actions required.
    return new bytes(0);
  }

  function pendingsToStakeData(bytes memory _stakeData, uint256 _pendingRewards, uint256 _underlyingStaked, uint256 _shares, uint256 _assetsPerShare) public returns (bytes memory) {
    (uint256 lastAssetsPerShare, uint256 underlyingEarned) = unpackStakeData(_stakeData);

    uint256 underlyingStakedBefore = _shares.mul(lastAssetsPerShare).div(1 ether);
    underlyingEarned = underlyingEarned.add(_underlyingStaked.sub(underlyingStakedBefore));
    lastAssetsPerShare = _assetsPerShare;

    return packStakeData(lastAssetsPerShare, underlyingEarned);
  }

  function stake(uint256 _amount, DistributeData memory _distributeData) public override returns (bytes memory result, bool claimed) {
    console.log("stake 1");
    uint256 pendingRewards = getPendingRewards();
    (uint256 underlyingStaked, uint256 shares, uint256 assetsPerShare) = getUnderlyingStakedWithShares();
    _capitalOut(underlyingStaked, _amount);
    console.log("stake 2");
    _stakeImpl(_amount);
    emit Stake(msg.sender, STAKING, address(UNDERLYING), _amount);
    result = pendingsToStakeData(_distributeData.stakeData, pendingRewards, underlyingStaked, shares, assetsPerShare);
  }

  function redeem(uint256 _amount, DistributeData memory _distributeData)
  external
  override
  returns (bytes memory result, bool claimed)
  {
    console.log("redeem 1");
    uint256 pendingRewards = getPendingRewards();
    uint256 amountWithFee = _amount + fee;
    _redeemImpl(amountWithFee);
    (uint256 underlyingStaked, uint256 shares, uint256 assetsPerShare) = getUnderlyingStakedWithShares();
    console.log("redeem 2");
    _capitalIn(_underlyingStaked, _amount);
    emit Redeem(msg.sender, STAKING, address(UNDERLYING), _amount);
    _safeTransfer(fee);
    result = pendingsToStakeData(_distributeData.stakeData, pendingRewards, underlyingStaked, shares, assetsPerShare);
  }

  /**
   * @dev Transfers capital into the asset manager, and then invests it
   * @param amount - the amount of tokens being deposited
   */
  function _capitalIn(uint256 _underlyingStaked, uint256 _amount) private {
    IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
    // Update the vault with new managed balance accounting for returns
    ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, PID, UNDERLYING, _underlyingStaked);
    // Send funds back to the vault
    ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.DEPOSIT, PID, UNDERLYING, _amount);

    IVault(VAULT).managePoolBalance(ops);
  }

  /**
   * @notice Divests capital back to the asset manager and then sends it to the vault
   * @param amount - the amount of tokens to withdraw to the vault
   */
  function _capitalOut(uint256 _underlyingStaked, uint256 amount) private {
    (uint256 poolCash,,,) = IVault(VAULT).getPoolTokenInfo(PID, UNDERLYING);
    console.log("underlyingStaked", _underlyingStaked);
    console.log("poolCash", poolCash);
    console.log("amount  ", amount);
    IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
    // Update the vault with new managed balance accounting for returns
    ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, PID, UNDERLYING, _underlyingStaked);
    // Pull funds from the vault
    ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, PID, UNDERLYING, amount);

    IVault(VAULT).managePoolBalance(ops);
  }

  function beforePoke(
    bytes memory _pokeData,
    DistributeData memory _distributeData,
    bool _willClaimReward
  ) external override {}

  function afterPoke(
    PowerIndexRouterInterface.StakeStatus, /*reserveStatus*/
    bool /*_rewardClaimDone*/
  ) external override returns (bytes memory) {
    return new bytes(0);
  }

  function initRouter(bytes calldata) external override {
    UNDERLYING.approve(STAKING, uint(-1));
  }

  /*** VIEWERS ***/

  /**
   * @notice Checking: is pending rewards in LUSD enough to cover transaction cost to reinvest
   * @param _claimParams Claim parameters, that stored in PowerIndexRouter
   * @param _lastClaimRewardsAt Last claim action timestamp
   * @param _lastChangeStakeAt Last stake/unstake action timestamp
   */
  function isClaimAvailable(
    bytes calldata _claimParams,
    uint256 _lastClaimRewardsAt,
    uint256 _lastChangeStakeAt
  ) external view virtual override returns (bool) {
    (uint256 paybackDuration, uint256 gasToReinvest) = unpackClaimParams(_claimParams);
    //    (, , uint256 forecastByPending) = getPendingAndForecastReward(
    //      _lastClaimRewardsAt,
    //      _lastChangeStakeAt,
    //      paybackDuration
    //    );
    return false;
  }

  /**
   * @notice Get reinvest transaction cost in LUSD
   * @param _gasUsed Gas used for reinvest transaction
   * @param _gasPrice Gas price
   */
  function getLusdUsedToReinvest(uint256 _gasUsed, uint256 _gasPrice) public view returns (uint256) {
    return calcLusdOutByWethIn(_gasUsed.mul(_gasPrice));
  }

  /**
   * @notice Get Uniswap V3 LUSD price ratio
   */
  function getLusdPriceRatio() public view virtual returns (uint256) {
    uint32 uniswapTimePeriod = 5400;
    uint24 uniswapLusdSwappingFee = 10000;
    uint24 uniswapWethSwappingFee = 0;

    return
    UniswapV3OracleHelper.getPriceRatioOfTokens(
      [address(UNDERLYING), UniswapV3OracleHelper.WETH],
      [uniswapLusdSwappingFee, uniswapWethSwappingFee],
      uniswapTimePeriod
    );
  }

  /**
   * @notice Convert LUSD amount to WETH amount with built in ratio
   * @param _tornAmountIn LUSD amount to convert
   */
  function calcWethOutByLusdIn(uint256 _tornAmountIn) external view returns (uint256) {
    return calcWethOutByLusdInWithRatio(_tornAmountIn, getLusdPriceRatio());
  }

  /**
   * @notice Convert LUSD amount to WETH amount by provided rario
   * @param _tornAmount LUSD amount to convert
   * @param _ratio Uniswap V3 ratio
   */
  function calcWethOutByLusdInWithRatio(uint256 _tornAmount, uint256 _ratio) public pure returns (uint256) {
    return _tornAmount.mul(_ratio).div(UniswapV3OracleHelper.RATIO_DIVIDER);
  }

  /**
   * @notice Convert WETH amount to LUSD amount with built in ratio
   * @param _wethAmount WETH amount to convert
   */
  function calcLusdOutByWethIn(uint256 _wethAmount) public view returns (uint256) {
    return calcLusdOutByWethInWithRatio(_wethAmount, getLusdPriceRatio());
  }

  function packStakeData(uint256 _lastAssetsPerShare, uint256 _underlyingEarned, uint256 _rewardsEarned) public pure returns (bytes memory) {
    return abi.encode(_lastAssetsPerShare, _underlyingEarned, _rewardsEarned);
  }

  function unpackStakeData(bytes memory _stakeData)
    public
    pure
    returns (uint256 lastAssetsPerShare, uint256 underlyingEarned, uint256 rewardsEarned)
  {
    if (_stakeData.length == 0 || keccak256(_stakeData) == keccak256("")) {
      return (0, 0);
    }
    (lastAssetsPerShare, underlyingEarned, rewardsEarned) = abi.decode(_stakeData, (uint256, uint256, uint256));
  }

  /**
   * @notice Convert WETH amount to LUSD amount with provided ratio
   * @param _wethAmount WETH amount to convert
   * @param _ratio Uniswap V3 ratio
   */
  function calcLusdOutByWethInWithRatio(uint256 _wethAmount, uint256 _ratio) public pure returns (uint256) {
    return _wethAmount.mul(UniswapV3OracleHelper.RATIO_DIVIDER).div(_ratio);
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packClaimParams(uint256 minAmount) public pure returns (bytes memory) {
    return abi.encode(minAmount);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams)
    public
    pure
    returns (uint256 minAmount)
  {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0, 0);
    }
    (minAmount) = abi.decode(_claimParams, (uint256));
  }

  /*** OVERRIDES ***/
  function _claimImpl() internal {
    console.log("_claimImpl");
    IBAMM(STAKING).withdraw(0);
  }

  function _stakeImpl(uint256 _amount) internal {
    console.log("_stakeImpl", _amount);
    IBAMM(STAKING).deposit(_amount);
  }

  function _redeemImpl(uint256 _amount) internal {
    console.log("_redeemImpl", _amount);
    IBAMM(STAKING).withdraw(_amount);
  }

  /**
   * @dev Returns current amount of LUSD remaining in the Balancer Vault.
   */
  function getUnderlyingReserve() public view override returns (uint256) {
    (uint256 poolCash,,,) = IVault(VAULT).getPoolTokenInfo(PID, UNDERLYING);
    return poolCash;
  }

  /**
   * @dev Returns the accounted amount of LUSD borrowed from the Balancer Vault by this Asset Manager contract.
   *      managed = total - cash
   */
  function getUnderlyingManaged() external view returns (uint256) {
    (, uint256 poolManaged,,) = IVault(VAULT).getPoolTokenInfo(PID, UNDERLYING);
    return poolManaged;
  }


  /**
   * @dev Returns the actual amount of LUSD managed by this Asset Manager contract and staked to Liquity stability pool.
   *      staked = total - (cash + gain - loss)
   */
  function getUnderlyingStakedWithShares() public view override returns (uint256 staked, uint256 shares, uint256 assetsPerShare) {
    shares = IBAMM(STAKING).stake(ASSET_MANAGER);
    console.log("shares", shares);
    uint256 totalShares = IBAMM(STAKING).total();
    console.log("totalShares", totalShares);
    uint256 lusdValueTotal = IStabilityPool(STABILITY_POOL).getCompoundedLUSDDeposit(STAKING);
    console.log("lusdValueTotal", lusdValueTotal);
    if (totalShares == 0) {
      return 0;
    }
    staked = lusdValueTotal * shares / totalShares;
    assetsPerShare = lusdValueTotal * 1 ether / totalShares;
  }
  /**
   * @dev Returns the actual amount of LUSD managed by this Asset Manager contract and staked to Liquity stability pool.
   *      staked = total - (cash + gain - loss)
   */
  function getUnderlyingStaked() public view override returns (uint256 staked) {
    (staked, , ) = getUnderlyingStakedWithShares();
  }

  function getUnderlyingTotal() external view override returns (uint256) {
    // getUnderlyingReserve + getUnderlyingStaked
    return getUnderlyingReserve() + getUnderlyingStaked();
  }

  function getSharesByUnderlying(uint256 lusdAmount) external view returns (uint256) {
    uint256 amShares = IBAMM(STAKING).stake(ASSET_MANAGER);
    uint256 totalShares = IBAMM(STAKING).total();
    uint256 lusdValueTotal = IStabilityPool(STABILITY_POOL).getCompoundedLUSDDeposit(STAKING);

    return totalShares * lusdAmount / lusdValueTotal;
  }

  function getPendingRewards() public view returns (uint256) {
    uint256 crop = IERC20(LQTY_TOKEN).balanceOf(STAKING).sub(IBAMM(STAKING).stock());
    uint256 total = IBAMM(STAKING).total();
    uint256 share = IBAMM(STAKING).share();
    if (total > 0) share = add(share, rdiv(crop, total));

    uint256 amStake = IBAMM(STAKING).stake(ASSET_MANAGER);
    uint256 curr = rmul(amStake, share);

    uint256 last = IBAMM(STAKING).crops(ASSET_MANAGER);
    if (curr > last) {
      return curr - last;
    } else {
      return 0;
    }
  }

  uint256 constant RAY = 10 ** 27;

  function add(uint256 x, uint256 y) public pure returns (uint256 z) {
    require((z = x + y) >= x, "ds-math-add-overflow");
  }

  function sub(uint256 x, uint256 y) public pure returns (uint256 z) {
    require((z = x - y) <= x, "ds-math-sub-underflow");
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x, "ds-math-mul-overflow");
  }

  function div(uint128 a, uint128 b) internal pure returns (uint128) {
    require(b > 0, "SafeMath: division by zero");
    return a / b;
  }

  function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = mul(x, RAY) / y;
  }

  function rmul(uint256 x, uint256 y) public pure returns (uint256 z) {
    z = mul(x, y) / RAY;
  }
}
