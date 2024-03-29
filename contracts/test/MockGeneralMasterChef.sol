// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockGeneralMasterChef {
  address token;

  constructor(address _token) {
    token = _token;
  }

  function deposit(uint256, uint256 _amount) external {
    IERC20(token).transferFrom(msg.sender, address(42), _amount);
  }

  function withdraw(uint256, uint256) external {}

  function userInfo(uint256, address) external pure returns (uint256 amount, uint256 rewardDebt) {
    return (0, 0);
  }
}
