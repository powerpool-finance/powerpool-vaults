// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/IBakeryMasterChef.sol";
import "./AbstractMasterChefIndexConnector.sol";

/**
 * Compatible with:
 * - Bakery: https://bscscan.com/address/0x20ec291bb8459b6145317e7126532ce7ece5056f,
 *   pending rewards via pendingBake(pair, user)
 * @dev Notice that in deposit/withdraw/pendingBake method signatures Bakery uses the staking token addresses
 *      instead of numerical pool IDs like in the majority of masterChef forks.
 */
contract BakeryChefPowerIndexConnector is AbstractMasterChefIndexConnector {
  constructor(
    address _staking,
    address _underlying,
    address _piToken
  ) public AbstractMasterChefIndexConnector(_staking, _underlying, _piToken) {}

  /*** VIEWERS ***/

  function getPendingRewards() external view returns (uint256 amount) {
    return IBakeryMasterChef(STAKING).pendingBake(address(UNDERLYING), address(PI_TOKEN));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() external view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IBakeryMasterChef(STAKING).poolUserInfoMap(address(UNDERLYING), address(PI_TOKEN));
    return amount;
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callStaking(PI_TOKEN, STAKING, IBakeryMasterChef.deposit.selector, abi.encode(address(UNDERLYING), _amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callStaking(PI_TOKEN, STAKING, IBakeryMasterChef.withdraw.selector, abi.encode(address(UNDERLYING), _amount));
  }
}
