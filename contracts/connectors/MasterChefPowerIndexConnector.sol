// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/sushi/IMasterChefV1.sol";
import "./AbstractMasterChefIndexConnector.sol";

/**
 * Compatible with:
 * - MDEX: https://bscscan.com/address/0x6aee12e5eb987b3be1ba8e621be7c4804925ba68,
 *   pending rewards via pending(pid, user)
 */
contract MasterChefPowerIndexConnector is AbstractMasterChefIndexConnector {
  uint256 public immutable MASTER_CHEF_PID;

  constructor(address _staking, address _underlying, address _piToken, uint256 _masterChefPid) public AbstractMasterChefIndexConnector(_staking, _underlying, _piToken) {
    MASTER_CHEF_PID = _masterChefPid;
  }

  /*** VIEWERS ***/

  function getPendingRewards() external view returns (uint256 amount) {
    return IMasterChefV1(STAKING).pending(MASTER_CHEF_PID, address(PI_TOKEN));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() public view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IMasterChefV1(STAKING).userInfo(MASTER_CHEF_PID, address(PI_TOKEN));
    return amount;
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callStaking(PI_TOKEN, STAKING, IMasterChefV1.deposit.selector, abi.encode(MASTER_CHEF_PID, _amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callStaking(PI_TOKEN, STAKING, IMasterChefV1.withdraw.selector, abi.encode(MASTER_CHEF_PID, _amount));
  }
}
