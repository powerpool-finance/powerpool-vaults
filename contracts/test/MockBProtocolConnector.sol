// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../connectors/BProtocolPowerIndexConnector.sol";
import "./MockSwapper.sol";

contract MockBProtocolConnector is BProtocolPowerIndexConnector {
  event MockWrapperCallback(uint256 withdrawAmount);
  event TestMigrate(bytes migrateData);

  MockSwapper immutable swapper;

  constructor(
    address _assetManager,
    address _staking,
    address _underlying,
    address _vault,
    address _stabilityPool,
    address _rewardsToken,
    bytes32 _pId,
    address _poolAddress,
    address _swapper
  )
    BProtocolPowerIndexConnector(
      _assetManager,
      _staking,
      _underlying,
      _vault,
      _stabilityPool,
      _rewardsToken,
      _pId,
      _poolAddress
    )
  {
    swapper = MockSwapper(_swapper);
  }

  function _swapRewardsToUnderlying(uint256 _rewardsAmount) internal override {
    swapper.swap(address(REWARDS_TOKEN), address(UNDERLYING), _rewardsAmount);
  }

  function getSwapperAddress() public view override returns (address) {
    return address(swapper);
  }

  function migrate(bytes calldata _migrateData) external virtual override {
    emit TestMigrate(_migrateData);
  }
}
