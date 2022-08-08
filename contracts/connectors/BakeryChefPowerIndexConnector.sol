// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../interfaces/IBakeryMasterChef.sol";
import "./AbstractStakeRedeemConnector.sol";

/**
 * Compatible with:
 * - Bakery: https://bscscan.com/address/0x20ec291bb8459b6145317e7126532ce7ece5056f,
 *   pending rewards via pendingBake(pair, user)
 * @dev Notice that in deposit/withdraw/pending Bake method signatures, Bakery uses the staking token addresses
 *      instead of numerical pool IDs like in most masterChef forks.
 */
contract BakeryChefPowerIndexConnector is AbstractStakeRedeemConnector {
  constructor(
    address _staking,
    address _underlying,
    address _piToken
  ) AbstractStakeRedeemConnector(_staking, _underlying, _piToken, 46e12) {}

  /*** VIEWERS ***/

  function getPendingRewards() public view returns (uint256 amount) {
    return IBakeryMasterChef(STAKING).pendingBake(address(UNDERLYING), address(PI_TOKEN));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() public view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IBakeryMasterChef(STAKING).poolUserInfoMap(address(UNDERLYING), address(PI_TOKEN));
    return amount;
  }

  function _claimImpl() internal override {
    _stakeImpl(0);
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, STAKING, IBakeryMasterChef.deposit.selector, abi.encode(address(UNDERLYING), _amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, STAKING, IBakeryMasterChef.withdraw.selector, abi.encode(address(UNDERLYING), _amount));
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
