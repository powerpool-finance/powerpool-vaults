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
    uint256 balance = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      balance += connectors[i].connector.getUnderlyingTotal();
    }
    return balance;
  }

  function getUnderlyingReserve() public view override returns (uint256) {
    uint256 balance = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      balance += connectors[i].connector.getUnderlyingReserve();
    }
    return balance;
  }

  function setAssetsHolder(address _assetsHolder, bytes32 _poolId) external onlyOwner {
    assetsHolder = _assetsHolder;
    poolId = _poolId;
    emit SetAssetsHolder(_assetsHolder, _poolId);
  }
}
