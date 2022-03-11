// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/torn/ITornStaking.sol";
import "../interfaces/torn/ITornGovernance.sol";
import "./AbstractStakeRedeemConnector.sol";


contract TornPowerIndexConnector is AbstractStakeRedeemConnector {
  address public immutable GOVERNANCE;

  constructor(
    address _staking,
    address _underlying,
    address _piToken,
    address _governance
  ) public AbstractStakeRedeemConnector(_staking, _underlying, _piToken, 46e14) {
    GOVERNANCE = _governance;
  }

  /*** VIEWERS ***/

  function getPendingRewards() public view returns (uint256 amount) {
    return ITornStaking(STAKING).checkReward(address(PI_TOKEN));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() external view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }
    return ITornGovernance(GOVERNANCE).lockedBalance(address(PI_TOKEN));
  }

  function _approveToStaking(uint256 _amount) internal override {
    PI_TOKEN.approveUnderlying(GOVERNANCE, _amount);
  }

  function _claimImpl() internal override {
    _callExternal(PI_TOKEN, STAKING, ITornStaking.getReward.selector, new bytes(0));
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, GOVERNANCE, ITornGovernance.lockWithApproval.selector, abi.encode(_amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callExternal(PI_TOKEN, GOVERNANCE, ITornGovernance.unlock.selector, abi.encode(_amount));
  }

  function isClaimAvailable(bytes _claimParams) external virtual returns (bool) {
    (uint256 reinvestDuration, uint256 reinvestRatio) = unpackClaimParams(_claimParams);
    uint256 pendingRewards = getPendingRewards();
    uint256 forecastReward =
    uint256 tornPriceRatio = getTornPriceRatio();
    uint256 wethAmount = calcTornToWethWithRatio(pendingRewards, tornPriceRatio);

    uint256 gasNeedToClaim = 66000;
    uint256 ethNeedToClaim = gasNeedToClaim.mul(tx.gasprice);
    return ethNeedToClaim > wethAmount;
  }

  function getTornPriceRatio(uint256 _tornAmountIn) public view returns (uint256) {
    uint256 uniswapTimePeriod = 5400;
    uint256 uniswapTornSwappingFee = 10000;
    uint256 uniswapWethSwappingFee = 0;

    return UniswapV3OracleHelper.getPriceRatioOfTokens(
      [torn, UniswapV3OracleHelper.WETH],
      [uniswapTornSwappingFee, uniswapWethSwappingFee],
      uniswapTimePeriod
    );
  }

  function calcWethOutByTornIn(uint256 _tornAmountIn) public view returns (uint256) {
    return calcTornToWethWithRatio(_tornAmountIn, getTornPriceRatio());
  }

  function calcTornToWethWithRatio(uint256 _tornAmount, uint256 _ratio) public pure returns (uint256) {
    return _tornAmount.mul(UniswapV3OracleHelper.RATIO_DIVIDER).div(_ratio);
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packClaimParams(uint256 duration, uint256 ratio) public pure returns (bytes memory) {
    return abi.encode(duration, ratio);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams) public pure returns (uint256 duration, uint256 ratio) {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0, 0);
    }
    (duration, ratio) = abi.decode(_claimParams, (uint256, uint256));
  }
}
