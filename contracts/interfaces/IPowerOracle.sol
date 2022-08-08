// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IPowerOracle {
  function assetPrices(address _token) external view returns (uint256);
}
