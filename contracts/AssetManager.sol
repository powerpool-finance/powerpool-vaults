// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/balancerV3/IVault.sol";

contract AssetManager is AbstractPowerIndexRouter {
  using SafeMath for uint256;

  constructor(
    address _assetsHolder,
    address _underlying,
    BasicConfig memory _basicConfig
  ) AbstractPowerIndexRouter(_assetsHolder, _underlying, _basicConfig) {}

  function getAssetsHolderUnderlyingBalance() public view override returns (uint256) {
    uint256 balance = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      balance = balance.add(connectors[i].connector.getUnderlyingReserve());
    }
    return balance;
  }

  function migrateToNewAssetManager(
    bytes memory _migrateData,
    address payable _newRouter,
    address[] memory _tokens
  ) public virtual onlyOwner {
    super.migrateToNewRouter(_newRouter, _tokens);

    for (uint256 i = 0; i < connectors.length; i++) {
      if (address(connectors[i].connector) != address(0)) {
        connectors[i].connector.migrate(_migrateData);
      }
    }
  }
}
