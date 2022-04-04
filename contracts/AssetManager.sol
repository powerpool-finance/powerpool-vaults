// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/balancerV3/IVault.sol";

contract AssetManager is AbstractPowerIndexRouter {

  event SetAssetsHolder(address assetsHolder);

  struct RewardsCheckpoint {
    uint128 reward;
    uint128 rate;
    uint32 timestamp;
  }

  mapping(address => mapping(uint256 => RewardsCheckpoint)) public checkpoints;

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

  function getCheckpoints() public view override returns (uint256) {

  }

  function setAssetsHolder(address _assetsHolder) external onlyOwner {
    assetsHolder = _assetsHolder;
    emit SetAssetsHolder(_assetsHolder);
  }
}
