pragma solidity ^0.7.0;


contract VeBoostProxy {
  mapping(address => uint256) adjusted_balance_of;

  function setBalance(address addr, uint256 bal) external {
    adjusted_balance_of[addr] = bal;
  }
}
