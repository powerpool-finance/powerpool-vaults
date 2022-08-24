// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IPPAgentV2 {
  function getKeeper(uint256 keeperId_)
    external view returns (
      address admin,
      address worker,
      uint256 currentStake,
      uint256 slashedStake,
      uint256 compensation,
      uint256 pendingWithdrawalAmount,
      uint256 pendingWithdrawalEndAt
    );
}
