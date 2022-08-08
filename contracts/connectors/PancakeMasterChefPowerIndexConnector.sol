// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../interfaces/IPancakeMasterChef.sol";
import "./AbstractStakeRedeemConnector.sol";

/**
 * Compatible with:
 * - Pancake: https://bscscan.com/address/0x73feaa1ee314f8c655e354234017be2193c9e24e
 * To get pending rewards use IPancakeStaking(0x73feaa1ee314f8c655e354234017be2193c9e24e).pendingCake(0, piToken).
 */
contract PancakeMasterChefIndexConnector is AbstractStakeRedeemConnector {
  uint256 internal constant PANCAKE_POOL_ID = 0;

  constructor(
    address _staking,
    address _underlying,
    address _piToken
  ) AbstractStakeRedeemConnector(_staking, _underlying, _piToken, 46e12) {}

  /*** VIEWERS ***/

  function getPendingRewards() public view returns (uint256 amount) {
    return IPancakeMasterChef(STAKING).pendingCake(PANCAKE_POOL_ID, address(PI_TOKEN));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() public view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IPancakeMasterChef(STAKING).userInfo(PANCAKE_POOL_ID, address(PI_TOKEN));
    return amount;
  }

  function _claimImpl() internal override {
    _stakeImpl(0);
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, STAKING, IPancakeMasterChef.enterStaking.selector, abi.encode(_amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, STAKING, IPancakeMasterChef.leaveStaking.selector, abi.encode(_amount));
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
  function isClaimAvailable(
    bytes calldata _claimParams,
    uint256,
    uint256
  ) external view virtual override returns (bool) {
    uint256 minClaimAmount = unpackClaimParams(_claimParams);
    return getPendingRewards() >= minClaimAmount;
  }
}
