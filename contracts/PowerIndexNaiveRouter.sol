// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/WrappedPiErc20Interface.sol";
import "./interfaces/PowerIndexNaiveRouterInterface.sol";

contract PowerIndexNaiveRouter is PowerIndexNaiveRouterInterface, Ownable {
  using SafeMath for uint256;

  function migrateToNewRouter(
    address _piToken,
    address payable _newRouter,
    address[] memory /*_tokens*/
  ) public virtual override onlyOwner {
    WrappedPiErc20Interface(_piToken).changeRouter(_newRouter);
  }

  function enableRouterCallback(address _piToken, bool _enable) public override onlyOwner {
    WrappedPiErc20Interface(_piToken).enableRouterCallback(_enable);
  }

  function piTokenCallback(address sender, uint256 _withdrawAmount) external payable virtual override {
    // DO NOTHING
  }
}
