// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../interfaces/bprotocol/IBAMM.sol";
import "../interfaces/balancerV3/IVault.sol";
import "../interfaces/liquidity/IStabilityPool.sol";
import "./AbstractConnector.sol";
import { UniswapV3OracleHelper } from "../libs/UniswapV3OracleHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

import "hardhat/console.sol";

contract BProtocolPowerIndexConnector is AbstractConnector {
  using SafeMath for uint256;

  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);

  uint256 public constant RATIO_CONSTANT = 10000000 ether;
  address public immutable ASSET_MANAGER;
  address public immutable STAKING;
  address public immutable STABILITY_POOL;
  address public immutable VAULT;
  IERC20 public immutable LQTY_TOKEN;
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
  ) public AbstractConnector() {
    ASSET_MANAGER = _assetManager;
    STAKING = _staking;
    UNDERLYING = IERC20(_underlying);
    VAULT = _vault;
    STABILITY_POOL = _stabilityPool;
    LQTY_TOKEN = IERC20(_lqtyToken);
    PID = _pId;
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
    uint256 receivedReward = LQTY_TOKEN.balanceOf(ASSET_MANAGER);
    if (receivedReward > 0) {
      uint256 rewardsToReinvest;
      (, rewardsToReinvest, ) = _distributePerformanceFee(
        _distributeData.performanceFee,
        _distributeData.performanceFeeReceiver,
        0,
        ASSET_MANAGER,
        UNDERLYING,
        receivedReward
      );

      UniswapV3OracleHelper.swapByMiddleWeth(rewardsToReinvest, address(LQTY_TOKEN), address(UNDERLYING));

      _stakeImpl(rewardsToReinvest);
      return stakeData;
    }
    // Otherwise the rewards are distributed each time deposit/withdraw methods are called,
    // so no additional actions required.
    return new bytes(0);
  }

  function _transferFeeToReceiver(
    address,
    IERC20 _underlying,
    address _feeReceiver,
    uint256 _amount
  ) internal override {
    //TODO: check that underlying LUSD or LQTY
    _underlying.transfer(_feeReceiver, _amount);
  }

  function pendingsToStakeData(
    uint256 _lastAssetsPerShare,
    uint256 _underlyingEarned,
    uint256 _underlyingStaked,
    uint256 _shares,
    uint256 _assetsPerShare
  ) public returns (bytes memory) {
    uint256 underlyingStakedBefore = _shares.mul(_lastAssetsPerShare).div(1 ether);
    _underlyingEarned = _underlyingEarned.add(_underlyingStaked.sub(underlyingStakedBefore));
    _lastAssetsPerShare = _assetsPerShare;

    return packStakeData(_lastAssetsPerShare, _underlyingEarned);
  }

  function stake(uint256 _amount, DistributeData memory _distributeData)
    public
    override
    returns (bytes memory result, bool claimed)
  {
    (uint256 lastAssetsPerShare, uint256 underlyingEarned) = unpackStakeData(_distributeData.stakeData);
    (uint256 underlyingStaked, uint256 shares, uint256 assetsPerShare) = getUnderlyingStakedWithShares();
    _capitalOut(underlyingStaked, _amount);
    _stakeImpl(_amount);
    emit Stake(msg.sender, STAKING, address(UNDERLYING), _amount);
    result = pendingsToStakeData(lastAssetsPerShare, underlyingEarned, underlyingStaked, shares, assetsPerShare);
    claimed = true;
  }

  function redeem(uint256 _amount, DistributeData memory _distributeData)
    external
    override
    returns (bytes memory result, bool claimed)
  {
    (uint256 underlyingStaked, uint256 shares, uint256 assetsPerShare) = getUnderlyingStakedWithShares();
    uint256 minLUSDToDistribute;
    {
      uint256 maxETHOnStaking;
      (maxETHOnStaking, minLUSDToDistribute) = unpackStakeParams(_distributeData.stakeParams);
      uint256 ethBalanceOnBamm = STAKING.balance.mul(shares).div(1 ether);
      require(ethBalanceOnBamm <= maxETHOnStaking, "MAX_ETHER_ON_BAMM");
    }

    // redeem with fee or without
    uint256 amountToRedeem = _amount;
    (uint256 lastAssetsPerShare, uint256 underlyingEarned) = unpackStakeData(_distributeData.stakeData);
    uint256 underlyingFee = underlyingEarned.mul(_distributeData.performanceFee).div(1 ether);
    if (underlyingFee >= minLUSDToDistribute) {
      amountToRedeem = amountToRedeem.add(underlyingFee);
    }
    _redeemImpl(amountToRedeem);

    // capital in amount without fee
    _capitalIn(underlyingStaked, _amount);
    emit Redeem(msg.sender, STAKING, address(UNDERLYING), _amount);

    // transfer fee to receiver
    if (amountToRedeem > _amount) {
      IERC20(UNDERLYING).transfer(_distributeData.performanceFeeReceiver, underlyingFee);
      underlyingEarned = 0;
    }

    result = pendingsToStakeData(lastAssetsPerShare, underlyingEarned, underlyingStaked, shares, assetsPerShare);
    claimed = true;
  }

  /**
   * @dev Transfers capital into the asset manager, and then invests it
   * @param _underlyingStaked - staked balance
   * @param _amount - the amount of tokens being deposited
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
   * @param _underlyingStaked - staked balance
   * @param _amount - the amount of tokens to withdraw to the vault
   */
  function _capitalOut(uint256 _underlyingStaked, uint256 _amount) private {
    IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
    // Update the vault with new managed balance accounting for returns
    ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, PID, UNDERLYING, _underlyingStaked);
    // Pull funds from the vault
    ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, PID, UNDERLYING, _amount);

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
    UNDERLYING.approve(STAKING, uint256(-1));
  }

  /*** VIEWERS ***/

  /**
   * @notice Checking: is pending rewards in LQTY enough to reinvest
   * @param _claimParams Claim parameters, that stored in PowerIndexRouter
   */
  function isClaimAvailable(bytes calldata _claimParams) external view virtual returns (bool) {
    uint256 minAmount = unpackClaimParams(_claimParams);
    return LQTY_TOKEN.balanceOf(ASSET_MANAGER).add(getPendingRewards()) >= minAmount;
  }

  function packStakeData(uint256 _lastAssetsPerShare, uint256 _underlyingEarned) public pure returns (bytes memory) {
    return abi.encode(_lastAssetsPerShare, _underlyingEarned);
  }

  function unpackStakeData(bytes memory _stakeData)
    public
    pure
    returns (uint256 lastAssetsPerShare, uint256 underlyingEarned)
  {
    if (_stakeData.length == 0 || keccak256(_stakeData) == keccak256("")) {
      return (0, 0);
    }
    (lastAssetsPerShare, underlyingEarned) = abi.decode(_stakeData, (uint256, uint256));
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packClaimParams(uint256 _minAmount) public pure returns (bytes memory) {
    return abi.encode(_minAmount);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams) public pure returns (uint256 minAmount) {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0);
    }
    (minAmount) = abi.decode(_claimParams, (uint256));
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packStakeParams(uint256 _maxETHOnStaking, uint256 _minLUSDToDistribute) public pure returns (bytes memory) {
    return abi.encode(_maxETHOnStaking, _minLUSDToDistribute);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackStakeParams(bytes memory _stakeParams)
    public
    pure
    returns (uint256 maxETHOnStaking, uint256 minLUSDToDistribute)
  {
    if (_stakeParams.length == 0 || keccak256(_stakeParams) == keccak256("")) {
      return (0, 0);
    }
    (maxETHOnStaking, minLUSDToDistribute) = abi.decode(_stakeParams, (uint256, uint256));
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
    (uint256 poolCash, , , ) = IVault(VAULT).getPoolTokenInfo(PID, UNDERLYING);
    return poolCash;
  }

  /**
   * @dev Returns the accounted amount of LUSD borrowed from the Balancer Vault by this Asset Manager contract.
   *      managed = total - cash
   */
  function getUnderlyingManaged() external view returns (uint256) {
    (, uint256 poolManaged, , ) = IVault(VAULT).getPoolTokenInfo(PID, UNDERLYING);
    return poolManaged;
  }

  /**
   * @dev Returns the actual amount of LUSD managed by this Asset Manager contract and staked to Liquity stability pool.
   *      staked = total - (cash + gain - loss)
   */
  function getUnderlyingStakedWithShares()
    public
    view
    returns (
      uint256 staked,
      uint256 shares,
      uint256 assetsPerShare
    )
  {
    shares = IBAMM(STAKING).stake(ASSET_MANAGER);
    uint256 totalShares = IBAMM(STAKING).total();
    uint256 lusdValueTotal = IStabilityPool(STABILITY_POOL).getCompoundedLUSDDeposit(STAKING);
    if (totalShares == 0) {
      return (0, 0, 0);
    }
    staked = (lusdValueTotal * shares) / totalShares;
    assetsPerShare = (lusdValueTotal * 1 ether) / totalShares;
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
    uint256 totalShares = IBAMM(STAKING).total();
    uint256 lusdValueTotal = IStabilityPool(STABILITY_POOL).getCompoundedLUSDDeposit(STAKING);

    return (totalShares * lusdAmount) / lusdValueTotal;
  }

  function getPendingRewards() public view returns (uint256) {
    uint256 crop = LQTY_TOKEN.balanceOf(STAKING).sub(IBAMM(STAKING).stock());
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

  uint256 internal constant RAY = 10**27;

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
