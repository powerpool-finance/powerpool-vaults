// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/WrappedPiErc20Interface.sol";
import "./interfaces/IRouterLockedProfitConnector.sol";
import "./interfaces/PowerIndexVaultRouterInterface.sol";

contract PowerIndexVaultRouter is AbstractPowerIndexRouter, PowerIndexVaultRouterInterface {
  using SafeMath for uint256;

  constructor(
    address _assetsHolder,
    address _underlying,
    BasicConfig memory _basicConfig
  ) AbstractPowerIndexRouter(_assetsHolder, _underlying, _basicConfig) {}

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

  function calculateLockedProfit() public view returns (uint256) {
    uint256 lockedProfit = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      lockedProfit += IRouterLockedProfitConnector(address(connectors[i].connector)).calculateLockedProfit(
        connectors[i].stakeData
      );
    }
    return lockedProfit;
  }

  function getUnderlyingAvailable() public view override returns (uint256) {
    // assetsHolderUnderlyingBalance + getUnderlyingStaked - _calculateLockedProfit
    return getAssetsHolderUnderlyingBalance().add(getUnderlyingStaked()).sub(calculateLockedProfit());
  }

  function migrateToNewRouter(
    address _piToken,
    address payable _newRouter,
    address[] memory _tokens
  ) public virtual onlyOwner {
    super.migrateToNewRouter(_newRouter, _tokens);

    WrappedPiErc20Interface(_piToken).changeRouter(_newRouter);
  }

  function enableRouterCallback(address _piToken, bool _enable) public override onlyOwner {
    WrappedPiErc20Interface(_piToken).enableRouterCallback(_enable);
  }

  function piTokenCallback(address, uint256 _withdrawAmount) external override payable virtual {
    PokeFromState memory state = PokeFromState(0, 0, 0, _withdrawAmount, false, true);
    _rebalance(state, false, false);
  }
}
