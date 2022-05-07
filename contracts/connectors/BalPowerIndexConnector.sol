// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./AbstractBalancerVaultConnector.sol";
import "../interfaces/ILiquidityGauge.sol";
import "../interfaces/balancerV3/IBalancerMinter.sol";
import "../interfaces/balancerV3/IAsset.sol";

contract BalPowerIndexConnector is AbstractBalancerVaultConnector {
  using SafeMath for uint256;

  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);

  uint256 public constant RATIO_CONSTANT = 10000000 ether;
  address payable public immutable ASSET_MANAGER;
  address public immutable STAKING;
  IBalancerMinter public immutable REWARDS_MINTER;
  IERC20 public immutable REWARDS_TOKEN;
  address public immutable CONNECTOR;

  constructor(
    address _assetManager,
    address _staking,
    address _underlying,
    address _rewardsToken,
    address _rewardsMinter,
    address _vault,
    bytes32 _pId
  ) AbstractBalancerVaultConnector(_underlying, _vault, _pId) {
    ASSET_MANAGER = payable(_assetManager);
    STAKING = _staking;
    REWARDS_TOKEN = IERC20(_rewardsToken);
    REWARDS_MINTER = IBalancerMinter(_rewardsMinter);
    CONNECTOR = address(this);
  }

  function isReadyToClaim(bytes memory _claimParams) public view returns (bool) {
    uint256 updateInterval = unpackClaimParams(_claimParams);
    if (updateInterval == 0) {
      return true;
    }
    (, , , , uint256 lastRewardsUpdate, ) = ILiquidityGauge(STAKING).reward_data(ASSET_MANAGER);
    return lastRewardsUpdate.add(updateInterval) <= block.timestamp;
  }

  // solhint-disable-next-line
  function claimRewards(
    PowerIndexRouterInterface.StakeStatus, /*_status*/
    DistributeData memory _distributeData,
    bytes memory _claimParams
  ) external override returns (bytes memory stakeData) {
    if (isReadyToClaim(_claimParams)) {
      _claimImpl();
    }

    uint256 receivedReward = REWARDS_TOKEN.balanceOf(ASSET_MANAGER);
    if (receivedReward > 0) {
      uint256 rewardsToReinvest;
      (, rewardsToReinvest, ) = _distributePerformanceFee(
        _distributeData.performanceFee,
        _distributeData.performanceFeeReceiver,
        0,
        ASSET_MANAGER,
        REWARDS_TOKEN,
        receivedReward
      );
      _swapRewardsToUnderlying(rewardsToReinvest);

      _stakeImpl(IERC20(UNDERLYING).balanceOf(ASSET_MANAGER));
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
    _underlying.transfer(_feeReceiver, _amount);
  }

  /**
   * @dev Transfers capital into the asset manager, and then invests it
   * @param _sum - the amount of tokens being deposited
   */
  function _swapRewardsToUnderlying(uint256 _sum) internal virtual {
    IAsset[] memory assets = new IAsset[](6);
    assets[0] = IAsset(0xba100000625a3754423978a60c9317c58a424e3D); // BAL
    assets[1] = IAsset(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2); // WETH
    assets[2] = IAsset(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); // USDC
    assets[3] = IAsset(0xdAC17F958D2ee523a2206206994597C13D831ec7); // USDT
    assets[4] = IAsset(0x2BBf681cC4eb09218BEe85EA2a5d3D13Fa40fC0C); // bbaUSDT
    assets[5] = IAsset(0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2); // bbaUSD

    IVault.BatchSwapStep[] memory swaps = new IVault.BatchSwapStep[](5);
    // BAL-WETH
    swaps[0] = IVault.BatchSwapStep(0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014, 0, 1, _sum, "");
    // USDC-WETH
    swaps[1] = IVault.BatchSwapStep(0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019, 1, 2, 0, "");
    // DAI-USDC-USDT
    swaps[2] = IVault.BatchSwapStep(0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063, 2, 3, 0, "");
    // bbaUSDT-USDT-aUSDT
    swaps[3] = IVault.BatchSwapStep(0x2bbf681cc4eb09218bee85ea2a5d3d13fa40fc0c0000000000000000000000fd, 3, 4, 0, "");
    // bbaUSDT-bbaUSD-bbaDAI-bbaUSDC
    swaps[4] = IVault.BatchSwapStep(0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb20000000000000000000000fe, 4, 5, 0, "");

    int256[] memory limits = new int256[](6);
    for (uint256 i = 0; i < limits.length; i++) {
      limits[i] = type(int256).max;
    }
    IVault.FundManagement memory fundManagment = IVault.FundManagement(ASSET_MANAGER, false, ASSET_MANAGER, false);

    IVault(VAULT).batchSwap(IVault.SwapKind.GIVEN_IN, swaps, assets, fundManagment, limits, uint256(-1));
  }

  function stake(uint256 _amount, DistributeData memory) public override returns (bytes memory result, bool claimed) {
    uint256 underlyingStaked = getUnderlyingStaked();
    _capitalOut(underlyingStaked, _amount);
    _stakeImpl(_amount);
    emit Stake(msg.sender, STAKING, address(UNDERLYING), _amount);
  }

  function redeem(uint256 _amount, DistributeData memory)
    external
    override
    returns (bytes memory result, bool claimed)
  {
    uint256 underlyingStaked = getUnderlyingStaked();
    // redeem amount will be converted to shares
    _redeemImpl(_amount);
    // capital in amount without fee
    _capitalIn(underlyingStaked, _amount);
    emit Redeem(msg.sender, STAKING, address(UNDERLYING), _amount);
  }

  function initRouter(bytes calldata) external override {
    UNDERLYING.approve(STAKING, uint256(-1));
    UNDERLYING.approve(VAULT, uint256(-1));
    REWARDS_TOKEN.approve(getSwapperAddress(), uint256(-1));
    REWARDS_MINTER.setMinterApproval(ASSET_MANAGER, true);
    REWARDS_MINTER.setMinterApproval(CONNECTOR, true);
  }

  /*** VIEWERS ***/

  /**
   * @notice Checking: is pending rewards enough to reinvest
   */
  function isClaimAvailable(bytes calldata) external view virtual returns (bool) {
    return true;
  }

  function getSwapperAddress() public view virtual returns (address) {
    return VAULT;
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
  function packClaimParams(uint256 _updateInterval) public pure returns (bytes memory) {
    return abi.encode(_updateInterval);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams) public pure returns (uint256 updateInterval) {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0);
    }
    (updateInterval) = abi.decode(_claimParams, (uint256));
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
    REWARDS_MINTER.mintFor(STAKING, ASSET_MANAGER);
  }

  function _stakeImpl(uint256 _amount) internal {
    ILiquidityGauge(STAKING).deposit(_amount, ASSET_MANAGER, false);
  }

  function _redeemImpl(uint256 _amount) internal {
    ILiquidityGauge(STAKING).withdraw(_amount, false);
  }

  /**
   * @dev Returns the actual amount of LUSD managed by this Asset Manager contract and staked to Liquity stability pool.
   *      staked = total - (cash + gain - loss)
   */
  function getUnderlyingStaked() public view override returns (uint256 staked) {
    return ILiquidityGauge(STAKING).balanceOf(ASSET_MANAGER);
  }

  function getUnderlyingTotal() external view override returns (uint256) {
    // getUnderlyingReserve + getUnderlyingStaked
    return getUnderlyingReserve().add(getUnderlyingStaked());
  }

  /**
   * @dev This function should be manually changed to "view" in the ABI
   */
  function getPendingRewards() public returns (uint256) {
    return REWARDS_MINTER.mintFor(STAKING, ASSET_MANAGER);
  }
}
