// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface VenusComptrollerInterface {
  function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);

  function exitMarket(address cToken) external returns (uint256);

  function claimVenus(address) external returns (uint256);

  //  function claimVenus(
  //    address[] memory holders,
  //    address[] memory cTokens,
  //    bool borrowers,
  //    bool suppliers
  //  ) external;

  function markets(address cToken)
    external
    view
    returns (
      bool,
      uint256,
      bool
    );

  function compSpeeds(address cToken) external view returns (uint256);

  function venusAccrued(address holder) external view returns (uint256);
}
