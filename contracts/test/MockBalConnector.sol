// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./MockSwapper.sol";
import "../connectors/BalPowerIndexConnector.sol";

contract MockBalConnector is BalPowerIndexConnector {
  event MockWrapperCallback(uint256 withdrawAmount);
  event TestMigrate(bytes migrateData);

  MockSwapper immutable swapper;

  constructor(
    address _assetManager,
    address _staking,
    address _underlying,
    address _rewardsToken,
    address _rewardsMinter,
    address _vault,
    bytes32 _pId,
    address _poolAddress,
    address _swapper
  )
    BalPowerIndexConnector(
      _assetManager,
      _staking,
      _underlying,
      _rewardsToken,
      _rewardsMinter,
      _vault,
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
