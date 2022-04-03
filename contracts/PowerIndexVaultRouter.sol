// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/WrappedPiErc20Interface.sol";

contract PowerIndexVaultRouter is AbstractPowerIndexRouter {

  constructor(address _assetsHolder, address _underlying, BasicConfig memory _basicConfig) public AbstractPowerIndexRouter(_assetsHolder, _underlying, _basicConfig) {}

  /**
     * @notice Set piERC20 ETH fee for deposit and withdrawal functions.
     * @param _ethFee Fee amount in ETH.
     */
  function setPiTokenEthFee(uint256 _ethFee) external onlyOwner {
    require(_ethFee <= 0.1 ether, "ETH_FEE_OVER_THE_LIMIT");
    WrappedPiErc20Interface(assetsHolder).setEthFee(_ethFee);
  }

  /**
   * @notice Set piERC20 noFee config for account address.
   * @param _for Account address.
   * @param _noFee Value for account.
   */
  function setPiTokenNoFee(address _for, bool _noFee) external onlyOwner {
    WrappedPiErc20Interface(assetsHolder).setNoFee(_for, _noFee);
  }

  /**
   * @notice Call piERC20 `withdrawEthFee`.
   * @param _receiver Receiver address.
   */
  function withdrawEthFee(address payable _receiver) external onlyOwner {
    WrappedPiErc20Interface(assetsHolder).withdrawEthFee(_receiver);
  }

  function getAssetsHolderUnderlyingBalance() public view override returns (uint256) {
    return WrappedPiErc20Interface(assetsHolder).getUnderlyingBalance();
  }

  function getUnderlyingReserve() public view override returns (uint256) {
    return underlying.balanceOf(assetsHolder);
  }
}
