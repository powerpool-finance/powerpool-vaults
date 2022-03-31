pragma solidity 0.6.12;

interface IBAMM {
  function fetchPrice() external view returns (uint256);

  function deposit(uint256 lusdAmount) external;

  function withdraw(uint256 numShares) external;
}
