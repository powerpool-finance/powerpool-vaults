// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/torn/ITornStaking.sol";
import "../interfaces/torn/ITornGovernance.sol";
import "./AbstractStakeRedeemConnector.sol";


contract TornPowerIndexConnector is AbstractStakeRedeemConnector {
  address public immutable GOVERNANCE;

  constructor(
    address _staking,
    address _underlying,
    address _piToken,
    address _governance
  ) public AbstractStakeRedeemConnector(_staking, _underlying, _piToken, 46e14) {
    GOVERNANCE = _governance;
  }

  /*** VIEWERS ***/

  function getPendingRewards() public view returns (uint256 amount) {
    return ITornStaking(STAKING).checkReward(address(PI_TOKEN));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() external view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    return ITornGovernance(GOVERNANCE).lockedBalance(address(PI_TOKEN));
  }

  function _claimImpl() internal override {
    _callExternal(PI_TOKEN, STAKING, ITornStaking.getReward.selector, new bytes(0));
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, GOVERNANCE, ITornGovernance.lockWithApproval.selector, abi.encode(_amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, GOVERNANCE, ITornGovernance.unlock.selector, abi.encode(_amount));
  }
}
