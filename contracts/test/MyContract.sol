// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract MyContract is Ownable {
  uint256 internal theAnswer;
  uint256 internal theAnswer2;

  constructor() Ownable() {}

  function setAnswer(uint256 _theAnswer) external onlyOwner returns (uint256) {
    theAnswer = _theAnswer;
    return 123;
  }

  function setAnswer2(uint256 _theAnswer2) external onlyOwner returns (uint256) {
    theAnswer2 = _theAnswer2;
    return 123;
  }

  function getAnswer() external view returns (uint256) {
    return theAnswer;
  }

  function getAnswer2() external view returns (uint256) {
    return theAnswer2;
  }

  function invalidOp() external pure {
    assert(false);
  }

  function revertWithoutString() external pure {
    revert();
  }

  function revertWithString() external pure {
    revert("some-unique-revert-string");
  }

  function revertWithLongString() external pure {
    revert("some-unique-revert-string-that-is-a-bit-longer-than-a-single-evm-slot");
  }
}
