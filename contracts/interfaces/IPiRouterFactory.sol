// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IPiRouterFactory {
  function buildRouter(address _piToken, bytes calldata _args) external returns (address);
}
