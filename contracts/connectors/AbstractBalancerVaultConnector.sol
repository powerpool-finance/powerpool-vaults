// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractConnector.sol";
import "../interfaces/balancerV3/IVault.sol";

abstract contract AbstractBalancerVaultConnector is AbstractConnector {
  using SafeMath for uint256;

  address payable public immutable ASSET_MANAGER;
  address public immutable VAULT;
  IERC20 public immutable UNDERLYING;
  bytes32 public immutable PID;
  IERC20 public immutable POOL;

  constructor(
    address _assetManager,
    address _underlying,
    address _vault,
    bytes32 _pId,
    address _poolAddress
  ) AbstractConnector() {
    ASSET_MANAGER = payable(_assetManager);
    UNDERLYING = IERC20(_underlying);
    VAULT = _vault;
    PID = _pId;
    POOL = IERC20(_poolAddress);
  }

  /**
   * @dev Transfers capital into the asset manager, and then invests it
   * @param _underlyingStaked - staked balance
   * @param _amount - the amount of tokens being deposited
   */
  function _capitalIn(uint256 _underlyingStaked, uint256 _amount) internal {
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
  function _capitalOut(uint256 _underlyingStaked, uint256 _amount) internal {
    IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
    // Update the vault with new managed balance accounting for returns
    ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, PID, UNDERLYING, _underlyingStaked);
    // Pull funds from the vault
    ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, PID, UNDERLYING, _amount);

    IVault(VAULT).managePoolBalance(ops);
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

  function distributePoolBalance(address _feeReceiver, bytes calldata) external {
    POOL.transfer(_feeReceiver, POOL.balanceOf(ASSET_MANAGER));
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
}
