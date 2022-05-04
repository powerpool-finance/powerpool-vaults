// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IBAMM {
  // --- Functions ---
  function fetchPrice() external view returns (uint256);

  function stake(address) external view returns (uint256);

  function getDepositorLQTYGain(address _depositor) external view returns (uint256);

  function total() external view returns (uint256);

  function share() external view returns (uint256);

  function stock() external view returns (uint256);

  function crops(address) external view returns (uint256);

  function setParams(uint256 _A, uint256 _fee) external;

  function deposit(uint256 lusdAmount) external;

  function withdraw(uint256 numShares) external;

  function swap(
    uint256 lusdAmount,
    uint256 minEthReturn,
    address payable dest
  ) external returns (uint256);
}
