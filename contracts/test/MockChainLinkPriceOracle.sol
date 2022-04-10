// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../interfaces/AggregatorV3Interface.sol";

contract MockChainLinkPriceOracle is AggregatorV3Interface {
  uint8 public constant override decimals = 8;
  uint256 public constant override version = 4;
  string public constant override description = "buzz";
  int256 internal _latestAnswer;
  uint80 internal latestRound;
  mapping(uint80 => int256) internal answers;

  constructor(int256 latestAnswer_) public {
    _latestAnswer = latestAnswer_;
    latestRound = 41;
    answers[41] = _latestAnswer;
    setLatestAnswer(latestAnswer_);
  }

  function setLatestAnswer(int256 latestAnswer_) public {
    latestRound += 1;
    answers[latestRound] = latestAnswer_;
  }

  function latestAnswer() public returns (int256) {
    return answers[latestRound];
  }

  function getRoundData(uint80 roundId_)
    external
    view
    override
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    roundId = roundId_;
    answer = answers[roundId_];
    startedAt = block.timestamp - 100;
    updatedAt = block.timestamp - 100;
    answeredInRound = roundId;
  }

  function latestRoundData()
    external
    view
    override
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    roundId = latestRound;
    answer = answers[latestRound];
    startedAt = block.timestamp - 100;
    updatedAt = block.timestamp - 100;
    answeredInRound = roundId;
  }
}
