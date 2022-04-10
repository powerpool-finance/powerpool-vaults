// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IRouterConnector.sol";

/**
 * @notice Connectors execute staking strategies by calling from PowerIndexRouter with delegatecall. Therefore,
 * connector contracts should not have any rights stored in other contracts. Instead, rights for connector logic
 * must be provided to PowerIndexRouter by proxy pattern, where the router is a proxy, and the connectors are
 * implementations. Every connector implementation has unique staking logic for stake, redeem, beforePoke, and
 * afterPoke functions, that returns data to save in PowerIndexRouter storage because connectors don't have any
 * storage.
 */
abstract contract AbstractConnector is IRouterConnector {
  using SafeMath for uint256;

  uint256 public constant HUNDRED_PCT = 1 ether;

  event Stake(address indexed sender, address indexed staking, address indexed underlying, uint256 amount);
  event Redeem(address indexed sender, address indexed staking, address indexed underlying, uint256 amount);

  event DistributePerformanceFee(
    uint256 performanceFeeDebtBefore,
    uint256 performanceFeeDebtAfter,
    uint256 underlyingBalance,
    uint256 performance
  );

  /**
   * @notice Call external contract by piToken (piERC20) contract.
   * @param _piToken piToken(piERC20) to call from.
   * @param _contract Contract to call.
   * @param _sig Function signature to call.
   * @param _data Data of function arguments to call.
   * @return Data returned from contract.
   */
  function _callExternal(
    WrappedPiErc20Interface _piToken,
    address _contract,
    bytes4 _sig,
    bytes memory _data
  ) internal returns (bytes memory) {
    return _piToken.callExternal(_contract, _sig, _data, 0);
  }

  /**
   * @notice Distributes performance fee from reward.
   * @param _performanceFee Share of fee to subtract as performance fee.
   * @param _performanceFeeReceiver Receiver of performance fee.
   * @param _performanceFeeDebt Performance fee amount left from last distribution.
   * @param _assetsManager Assets manager address.
   * @param _underlying Underlying ERC20 token.
   * @param _totalReward Total reward amount.
   * @return performance Fee amount calculated to distribute.
   * @return remainder Diff between total reward amount and performance fee.
   * @return resultPerformanceFeeDebt Not yet distributed performance amount due to insufficient balance on
   *         piToken (piERC20).
   */
  function _distributePerformanceFee(
    uint256 _performanceFee,
    address _performanceFeeReceiver,
    uint256 _performanceFeeDebt,
    address _assetsManager,
    IERC20 _underlying,
    uint256 _totalReward
  )
    internal
    returns (
      uint256 performance,
      uint256 remainder,
      uint256 resultPerformanceFeeDebt
    )
  {
    performance = 0;
    remainder = 0;
    resultPerformanceFeeDebt = _performanceFeeDebt;

    if (_performanceFee > 0) {
      performance = _totalReward.mul(_performanceFee).div(HUNDRED_PCT);
      remainder = _totalReward.sub(performance);

      uint256 performanceFeeDebtBefore = _performanceFeeDebt;
      uint256 underlyingBalance = _underlying.balanceOf(address(_assetsManager));
      uint256 totalFeeToPayOut = performance.add(performanceFeeDebtBefore);
      if (underlyingBalance >= totalFeeToPayOut) {
        _transferFeeToReceiver(_assetsManager, _underlying, _performanceFeeReceiver, totalFeeToPayOut);
      } else {
        resultPerformanceFeeDebt = totalFeeToPayOut.sub(underlyingBalance);
        _transferFeeToReceiver(_assetsManager, _underlying, _performanceFeeReceiver, underlyingBalance);
      }

      emit DistributePerformanceFee(performanceFeeDebtBefore, resultPerformanceFeeDebt, underlyingBalance, performance);
    } else {
      remainder = _totalReward;
    }
  }

  function _transferFeeToReceiver(
    address _assetManager,
    IERC20 _underlying,
    address _feeReceiver,
    uint256 _amount
  ) internal virtual {
    _safeTransfer(WrappedPiErc20Interface(_assetManager), _underlying, _feeReceiver, _amount);
  }

  /**
   * @notice Transfer token amount from piToken(piERC20) to destination.
   * @param _piToken piToken(piERC20).
   * @param _token ERC20 token address.
   * @param _to Destination address.
   * @param _value Amount to transfer.
   */
  function _safeTransfer(
    WrappedPiErc20Interface _piToken,
    IERC20 _token,
    address _to,
    uint256 _value
  ) internal {
    bytes memory response = _piToken.callExternal(
      address(_token),
      IERC20.transfer.selector,
      abi.encode(_to, _value),
      0
    );

    if (response.length > 0) {
      // Return data is optional
      require(abi.decode(response, (bool)), "ERC20 operation did not succeed");
    }
  }

  function isClaimAvailable(
    bytes calldata _claimParams, // solhint-disable-line
    uint256 _lastClaimRewardsAt, // solhint-disable-line
    uint256 _lastChangeStakeAt // solhint-disable-line
  ) external view virtual override returns (bool) {
    return true;
  }
}
