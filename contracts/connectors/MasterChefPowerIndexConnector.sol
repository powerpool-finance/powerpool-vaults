// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../interfaces/sushi/IMasterChefV1.sol";
import "./AbstractStakeRedeemConnector.sol";

/**
 * Compatible with:
 * - MDEX: https://bscscan.com/address/0x6aee12e5eb987b3be1ba8e621be7c4804925ba68,
 *   pending rewards via pending(pid, user)
 */
contract MasterChefPowerIndexConnector is AbstractStakeRedeemConnector {
  uint256 public immutable MASTER_CHEF_PID;

  constructor(
    address _staking,
    address _underlying,
    address _piToken,
    uint256 _masterChefPid
  ) AbstractStakeRedeemConnector(_staking, _underlying, _piToken, 46e12) {
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

  function _claimImpl() internal override {
    _stakeImpl(0);
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, STAKING, IMasterChefV1.deposit.selector, abi.encode(MASTER_CHEF_PID, _amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, STAKING, IMasterChefV1.withdraw.selector, abi.encode(MASTER_CHEF_PID, _amount));
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packClaimParams(uint256 _minPending) external pure returns (bytes memory) {
    return abi.encode(_minPending);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams) public pure returns (uint256 minPending) {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0);
    }
    (minPending) = abi.decode(_claimParams, (uint256));
  }

  /**
   * @notice Checking: is pending rewards enough to reinvest
   * @param _claimParams Claim parameters, that stored in PowerIndexRouter
   */
  function isClaimAvailable(bytes calldata _claimParams, uint256, uint256) external view override virtual returns (bool) {
    uint256 minClaimAmount = unpackClaimParams(_claimParams);
    return getPendingRewards() >= minClaimAmount;
  }
}
