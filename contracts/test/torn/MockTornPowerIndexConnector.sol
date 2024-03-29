// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../../connectors/TornPowerIndexConnector.sol";

contract MockTornPowerIndexConnector is TornPowerIndexConnector {
  constructor(
    address _staking,
    address _underlying,
    address _piToken,
    address _governance
  ) TornPowerIndexConnector(_staking, _underlying, _piToken, _governance) {}

  function getTornPriceRatio() public pure override returns (uint256) {
    return 15000000000000000;
  }
}
