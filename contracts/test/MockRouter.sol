// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../PowerIndexVaultRouter.sol";
import "../WrappedPiErc20.sol";

contract MockRouter is PowerIndexVaultRouter {
  event MockWrapperCallback(uint256 withdrawAmount);

  constructor(address _piToken, address _underlying, BasicConfig memory _basicConfig) public PowerIndexVaultRouter(_piToken, _underlying, _basicConfig) {}

  function piTokenCallback(address, uint256 _withdrawAmount) external payable virtual override {
    emit MockWrapperCallback(_withdrawAmount);
  }

  function execute(address destination, bytes calldata data) external {
    destination.call(data);
  }

  function drip(address _to, uint256 _amount) external {
    WrappedPiErc20Interface(assetsHolder).callExternal(
      address(WrappedPiErc20(address(assetsHolder)).underlying()),
      IERC20(0).transfer.selector,
      abi.encode(_to, _amount),
      0
    );
  }
}
