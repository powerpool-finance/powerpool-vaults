// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IBAMM {
  // --- Functions ---
  function fetchPrice() external view returns (uint256);

  function stake(address) external view returns (uint256);

  function total() external view returns (uint256);

  function share() external view returns (uint256);

  function stock() external view returns (uint256);

  function nps() public returns (uint256);

  function crops(address) external view returns (uint256);

  function setParams(uint _A, uint _fee) external;

  function deposit(uint lusdAmount) external;

  function withdraw(uint numShares) external;

  function swap(uint lusdAmount, uint minEthReturn, address payable dest) external returns(uint);
}
