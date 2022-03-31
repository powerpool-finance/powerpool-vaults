// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/balancerV3/IVault.sol";

contract AssetManager is AbstractPowerIndexRouter {

  event SetAssetsHolder(address assetsHolder);

  // RewardsAssetManager manages a single Pool, to which it allocates all rewards that it receives.
  bytes32 public poolId;
  address public vault;

  modifier withCorrectPool(bytes32 pId) {
    require(pId == poolId, "SinglePoolAssetManager called with incorrect poolId");
    _;
  }

  constructor(address _assetsHolder, address _underlying, BasicConfig memory _basicConfig, address _vault, bytes32 _poolId) public AbstractPowerIndexRouter(_assetsHolder, _underlying, _basicConfig) {
    vault = _vault;
    poolId = _poolId;
  }

  function getAssetsHolderUnderlyingBalance() public view override returns (uint256) {
    //TODO: implement getAssetsHolderUnderlyingBalance
    return underlying.balanceOf(assetsHolder);
  }

  function getUnderlyingReserve() public view override returns (uint256) {
    //TODO: implement getUnderlyingReserve
    return underlying.balanceOf(assetsHolder);
  }

  function setAssetsHolder(address _assetsHolder) external onlyOwner {
    assetsHolder = _assetsHolder;
    emit SetAssetsHolder(_assetsHolder);
  }

  function getPoolBalances(bytes32 pId)
    public
    view
    withCorrectPool(pId)
    returns (uint256 poolCash, uint256 poolManaged)
  {
    (poolCash, poolManaged) = _getPoolBalances(_getAUM());
  }

  function _getPoolBalances(uint256 aum) internal view returns (uint256 poolCash, uint256 poolManaged) {
    (poolCash, , , ) = IVault(vault).getPoolTokenInfo(poolId, IERC20(underlying));
    // Calculate the managed portion of funds locally as the Vault is unaware of returns
    poolManaged = aum;
  }

  function _getAUM() internal view returns (uint256) {
    return IERC20(underlying).balanceOf(address(this));
  }

  /**
   * @dev Transfers capital into the asset manager, and then invests it
   * @param amount - the amount of tokens being deposited
   */
  function _capitalIn(uint256 amount) private {
    uint256 aum = _getAUM();

    IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
    // Update the vault with new managed balance accounting for returns
    ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, poolId, IERC20(underlying), aum);
    // Pull funds from the vault
    ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.WITHDRAW, poolId, IERC20(underlying), amount);

    IVault(vault).managePoolBalance(ops);

    _invest(amount, aum);
  }

  /**
   * @notice Divests capital back to the asset manager and then sends it to the vault
   * @param amount - the amount of tokens to withdraw to the vault
   */
  function _capitalOut(uint256 amount) private {
    uint256 aum = _getAUM();
    uint256 tokensOut = _divest(amount, aum);

    IVault.PoolBalanceOp[] memory ops = new IVault.PoolBalanceOp[](2);
    // Update the vault with new managed balance accounting for returns
    ops[0] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.UPDATE, poolId, IERC20(underlying), aum);
    // Send funds back to the vault
    ops[1] = IVault.PoolBalanceOp(IVault.PoolBalanceOpKind.DEPOSIT, poolId, IERC20(underlying), tokensOut);

    IVault(vault).managePoolBalance(ops);
  }

  /**
   * @dev Invests capital inside the asset manager
   * @param amount - the amount of tokens being deposited
   * @param aum - the assets under management
   * @return the number of tokens that were deposited
   */
  function _invest(uint256 amount, uint256 aum) internal virtual returns (uint256) {
    return 0;
  }

  /**
   * @dev Divests capital back to the asset manager
   * @param amount - the amount of tokens being withdrawn
   * @return the number of tokens to return to the vault
   */
  function _divest(uint256 amount, uint256 aum) internal virtual returns (uint256) {
    return 0;
  }
}
