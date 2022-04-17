// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "hardhat/console.sol";

contract MockSwapper {
  using SafeMath for uint256;

  mapping(address => mapping(address => uint256)) public ratio;

  constructor() {}

  function setRatio(
    address _tokenFrom,
    address _tokenTo,
    uint256 _ratio
  ) public {
    ratio[_tokenFrom][_tokenTo] = _ratio;
  }

  function swap(
    address _tokenFrom,
    address _tokenTo,
    uint256 _tokenFromAmount
  ) public {
    IERC20(_tokenFrom).transferFrom(msg.sender, address(this), _tokenFromAmount);
    IERC20(_tokenTo).transfer(msg.sender, _tokenFromAmount.mul(ratio[_tokenFrom][_tokenTo]).div(1 ether));
  }
}
