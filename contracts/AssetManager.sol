// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/balancerV3/IVault.sol";

contract AssetManager is AbstractPowerIndexRouter {

  event SetAssetsHolder(address assetsHolder, bytes32 poolId);

  // RewardsAssetManager manages a single Pool, to which it allocates all rewards that it receives.
  bytes32 public poolId;

  modifier withCorrectPool(bytes32 pId) {
    require(pId == poolId, "SinglePoolAssetManager called with incorrect poolId");
    _;
  }

  constructor(address _assetsHolder, address _underlying, BasicConfig memory _basicConfig) public AbstractPowerIndexRouter(_assetsHolder, _underlying, _basicConfig) {

  }

  function getAssetsHolderUnderlyingBalance() public view override returns (uint256) {
    //TODO: implement getAssetsHolderUnderlyingBalance
    return underlying.balanceOf(assetsHolder);
  }

  function getUnderlyingReserve() public view override returns (uint256) {
    //TODO: implement getUnderlyingReserve
    return underlying.balanceOf(assetsHolder);
  }

  function setAssetsHolder(address _assetsHolder, bytes32 _poolId) external onlyOwner {
    assetsHolder = _assetsHolder;
    poolId = _poolId;
    emit SetAssetsHolder(_assetsHolder, _poolId);
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
    (poolCash, , , ) = IVault(assetsHolder).getPoolTokenInfo(poolId, IERC20(underlying));
    // Calculate the managed portion of funds locally as the Vault is unaware of returns
    poolManaged = aum;
  }

  function _getAUM() internal view returns (uint256) {
    return IERC20(underlying).balanceOf(address(this));
  }
}
