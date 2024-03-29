// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./AbstractBalancerVaultConnector.sol";
import "../interfaces/ILiquidityGauge.sol";
import "../interfaces/balancerV3/IBalancerMinter.sol";
import "../interfaces/balancerV3/IAsset.sol";

contract BalPowerIndexConnector is AbstractBalancerVaultConnector {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);

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
    bytes32 _pId,
    address _poolAddress
  ) AbstractBalancerVaultConnector(_assetManager, _underlying, _vault, _pId, _poolAddress) {
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
    _underlying.safeTransfer(_feeReceiver, _amount);
  }

  /**
   * @dev Transfers capital into the asset manager, and then invests it
   * @param _sum - the amount of tokens being deposited
   */
  function _swapRewardsToUnderlying(uint256 _sum) internal virtual {
    IAsset[] memory assets = new IAsset[](5);
    assets[0] = IAsset(0xba100000625a3754423978a60c9317c58a424e3D); // BAL
    assets[1] = IAsset(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2); // WETH
    assets[2] = IAsset(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); // USDC
    assets[3] = IAsset(0x9210F1204b5a24742Eba12f710636D76240dF3d0); // bbaUSDC
    assets[4] = IAsset(0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2); // bbaUSD

    IVault.BatchSwapStep[] memory swaps = new IVault.BatchSwapStep[](4);
    // BAL-WETH
    swaps[0] = IVault.BatchSwapStep(0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014, 0, 1, _sum, "");
    // USDC-WETH
    swaps[1] = IVault.BatchSwapStep(0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019, 1, 2, 0, "");
    // bbaUSDC-USDC-aUSDC
    swaps[2] = IVault.BatchSwapStep(0x9210f1204b5a24742eba12f710636d76240df3d00000000000000000000000fc, 2, 3, 0, "");
    // bbaUSDT-bbaUSD-bbaDAI-bbaUSDC
    swaps[3] = IVault.BatchSwapStep(0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb20000000000000000000000fe, 3, 4, 0, "");

    int256[] memory limits = new int256[](5);
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
    (result, claimed) = ("", false);
  }

  function redeem(uint256 _amount, DistributeData memory)
    external
    override
    returns (bytes memory result, bool claimed)
  {
    uint256 underlyingStaked = getUnderlyingStaked();
    _redeemImpl(_amount);
    _capitalIn(underlyingStaked, _amount);
    emit Redeem(msg.sender, STAKING, address(UNDERLYING), _amount);
    (result, claimed) = ("", false);
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

  function packStakeData(uint256 _lastAssetsPerShare, uint256 _underlyingEarned) external pure returns (bytes memory) {
    return abi.encode(_lastAssetsPerShare, _underlyingEarned);
  }

  function unpackStakeData(bytes memory _stakeData)
    external
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
  function packClaimParams(uint256 _updateInterval) external pure returns (bytes memory) {
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
  function getPendingRewards() external returns (uint256) {
    return REWARDS_MINTER.mintFor(STAKING, ASSET_MANAGER);
  }
}
