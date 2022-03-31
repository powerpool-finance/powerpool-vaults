// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/bprotocol/IBAMM.sol";
import "./AbstractConnector.sol";
import { UniswapV3OracleHelper } from "../libs/UniswapV3OracleHelper.sol";

contract BProtocolPowerIndexConnector is AbstractConnector {
  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);

  uint256 public constant RATIO_CONSTANT = 10000000 ether;
  address public immutable STAKING;
  IERC20 public immutable UNDERLYING;
  WrappedPiErc20Interface public immutable PI_TOKEN;

  constructor(
    address _staking,
    address _underlying,
    address _piToken
  ) public AbstractConnector(46e14) {
    STAKING = _staking;
    UNDERLYING = IERC20(_underlying);
    PI_TOKEN = WrappedPiErc20Interface(_piToken);
  }

  // solhint-disable-next-line
  function claimRewards(PowerIndexRouterInterface.StakeStatus _status, DistributeData memory _distributeData)
    external
    override
    returns (bytes memory stakeData)
  {
    return new bytes(0);
  }

  function stake(uint256 _amount, DistributeData memory) public override returns (bytes memory result, bool claimed) {
    emit Stake(msg.sender, STAKING, address(UNDERLYING), _amount);
  }

  function redeem(uint256 _amount, DistributeData memory)
    external
    override
    returns (bytes memory result, bool claimed)
  {
    emit Redeem(msg.sender, STAKING, address(UNDERLYING), _amount);
  }

  function beforePoke(
    bytes memory _pokeData,
    DistributeData memory _distributeData,
    bool _willClaimReward
  ) external override {}

  function afterPoke(
    PowerIndexRouterInterface.StakeStatus, /*reserveStatus*/
    bool /*_rewardClaimDone*/
  ) external override returns (bytes memory) {
    return new bytes(0);
  }

  function initRouter(bytes calldata) external override {
    _approveToStaking(uint256(-1));
  }

  /*** VIEWERS ***/

  function getPendingRewards() public view returns (uint256) {
    return 0;
  }

  /**
   * @notice Checking: is pending rewards in LUSD enough to cover transaction cost to reinvest
   * @param _claimParams Claim parameters, that stored in PowerIndexRouter
   * @param _lastClaimRewardsAt Last claim action timestamp
   * @param _lastChangeStakeAt Last stake/unstake action timestamp
   */
  function isClaimAvailable(
    bytes calldata _claimParams,
    uint256 _lastClaimRewardsAt,
    uint256 _lastChangeStakeAt
  ) external view virtual override returns (bool) {
    (uint256 paybackDuration, uint256 gasToReinvest) = unpackClaimParams(_claimParams);
//    (, , uint256 forecastByPending) = getPendingAndForecastReward(
//      _lastClaimRewardsAt,
//      _lastChangeStakeAt,
//      paybackDuration
//    );
    return false;
  }

  /**
   * @notice Get reinvest transaction cost in LUSD
   * @param _gasUsed Gas used for reinvest transaction
   * @param _gasPrice Gas price
   */
  function getLusdUsedToReinvest(uint256 _gasUsed, uint256 _gasPrice) public view returns (uint256) {
    return calcLusdOutByWethIn(_gasUsed.mul(_gasPrice));
  }

  /**
   * @notice Get Uniswap V3 LUSD price ratio
   */
  function getLusdPriceRatio() public view virtual returns (uint256) {
    uint32 uniswapTimePeriod = 5400;
    uint24 uniswapLusdSwappingFee = 10000;
    uint24 uniswapWethSwappingFee = 0;

    return
      UniswapV3OracleHelper.getPriceRatioOfTokens(
        [address(UNDERLYING), UniswapV3OracleHelper.WETH],
        [uniswapLusdSwappingFee, uniswapWethSwappingFee],
        uniswapTimePeriod
      );
  }

  /**
   * @notice Convert LUSD amount to WETH amount with built in ratio
   * @param _tornAmountIn LUSD amount to convert
   */
  function calcWethOutByLusdIn(uint256 _tornAmountIn) external view returns (uint256) {
    return calcWethOutByLusdInWithRatio(_tornAmountIn, getLusdPriceRatio());
  }

  /**
   * @notice Convert LUSD amount to WETH amount by provided rario
   * @param _tornAmount LUSD amount to convert
   * @param _ratio Uniswap V3 ratio
   */
  function calcWethOutByLusdInWithRatio(uint256 _tornAmount, uint256 _ratio) public pure returns (uint256) {
    return _tornAmount.mul(_ratio).div(UniswapV3OracleHelper.RATIO_DIVIDER);
  }

  /**
   * @notice Convert WETH amount to LUSD amount with built in ratio
   * @param _wethAmount WETH amount to convert
   */
  function calcLusdOutByWethIn(uint256 _wethAmount) public view returns (uint256) {
    return calcLusdOutByWethInWithRatio(_wethAmount, getLusdPriceRatio());
  }

  /**
   * @notice Convert WETH amount to LUSD amount with provided ratio
   * @param _wethAmount WETH amount to convert
   * @param _ratio Uniswap V3 ratio
   */
  function calcLusdOutByWethInWithRatio(uint256 _wethAmount, uint256 _ratio) public pure returns (uint256) {
    return _wethAmount.mul(UniswapV3OracleHelper.RATIO_DIVIDER).div(_ratio);
  }

  /**
   * @notice Pack claim params to bytes.
   */
  function packClaimParams(uint256 paybackDuration, uint256 gasToReinvest) public pure returns (bytes memory) {
    return abi.encode(paybackDuration, gasToReinvest);
  }

  /**
   * @notice Unpack claim params from bytes to variables.
   */
  function unpackClaimParams(bytes memory _claimParams)
    public
    pure
    returns (uint256 paybackDuration, uint256 gasToReinvest)
  {
    if (_claimParams.length == 0 || keccak256(_claimParams) == keccak256("")) {
      return (0, 0);
    }
    (paybackDuration, gasToReinvest) = abi.decode(_claimParams, (uint256, uint256));
  }

  /*** OVERRIDES ***/

  function getUnderlyingStaked() public view override returns (uint256) {
    return 0;
  }

  function _approveToStaking(uint256 _amount) internal {
    PI_TOKEN.approveUnderlying(STAKING, _amount);
  }

  function _claimImpl() internal {
    _callExternal(PI_TOKEN, STAKING, IBAMM.withdraw.selector, abi.encode(0));
  }

  function _stakeImpl(uint256 _amount) internal {
    _callExternal(PI_TOKEN, STAKING, IBAMM.deposit.selector, abi.encode(_amount));
  }

  function _redeemImpl(uint256 _amount) internal {
    _callExternal(PI_TOKEN, STAKING, IBAMM.withdraw.selector, abi.encode(_amount));
  }
}
