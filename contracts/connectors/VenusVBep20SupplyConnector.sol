// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/venus/VenusComptrollerInterface.sol";
import "../interfaces/venus/VBep20Interface.sol";
import "./AbstractConnector.sol";

/**
 * @notice PowerIndex Router for Venus protocol.
 * @dev The router designed to work with XVS token only (XVS == UNDERLYING).
 *      Can support other tokens as underlying with further modifications.
 * @dev Venus rewards in XVS token should be claimed explicitly by calling `Comptroller.claimVenus()`. The router
 *      claims them when a poker provides the corresponding flag when calling a poke* method.
 * @dev Venus interest rewards are calculated and claimed on each poke* operation.
 */
contract VenusVBep20SupplyConnector is AbstractConnector {
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event IgnoreDueMissingStaking();
  event ClaimRewards(address indexed sender, uint256 xvsEarned);

  uint256 internal constant NO_ERROR_CODE = 0;

  address public immutable TROLLER;
  address public immutable STAKING;
  WrappedPiErc20Interface internal immutable PI_TOKEN;
  IERC20 internal immutable UNDERLYING;
  IERC20 internal immutable XVS;

  constructor(address _piToken, address _troller, address _staking, address _xvs) AbstractConnector(46e12) public { // 6 hours with 13ms block
    PI_TOKEN = WrappedPiErc20Interface(_piToken);
    STAKING = _staking;
    TROLLER = _troller;
    UNDERLYING = IERC20(VBep20Interface(_staking).underlying());
    XVS = IERC20(_xvs);
  }

  /*** THE PROXIED METHOD EXECUTORS FOR VOTING ***/

  function claimRewards(PowerIndexBasicRouterInterface.ReserveStatus, DistributeData memory _distributeData) public override returns (bytes memory) {
    // #1. Claim XVS
    address[] memory holders = new address[](1);
    holders[0] = address(PI_TOKEN);
    address[] memory tokens = new address[](1);
    tokens[0] = STAKING;

    uint256 xvsBefore = XVS.balanceOf(address(PI_TOKEN));
    PI_TOKEN.callExternal(
      TROLLER,
      VenusComptrollerInterface.claimVenus.selector,
      abi.encode(holders, tokens, false, true),
      0
    );
    uint256 xvsEarned = XVS.balanceOf(address(PI_TOKEN)).sub(xvsBefore);
    require(xvsEarned > 0, "NO_XVS_CLAIMED");

    _distributeReward(_distributeData, PI_TOKEN, XVS, xvsEarned);

    emit ClaimRewards(msg.sender, xvsEarned);
    return "";
  }

  /*** OWNER METHODS ***/

  function initRouter() external {
    address[] memory tokens = new address[](1);
    tokens[0] = STAKING;
    bytes memory result = PI_TOKEN.callExternal(
      TROLLER,
      VenusComptrollerInterface.enterMarkets.selector,
      abi.encode(tokens),
      0
    );
    uint256[] memory err = abi.decode(result, (uint256[]));
    require(err[0] == NO_ERROR_CODE, "V_ERROR");
    _callStaking(PI_TOKEN, STAKING, IERC20.approve.selector, abi.encode(STAKING, uint256(-1)));
  }

  function stake(uint256 _amount, DistributeData memory) external override returns (bytes memory) {
    require(_amount > 0, "CANT_STAKE_0");

    PI_TOKEN.approveUnderlying(STAKING, _amount);

    _callCompStaking(VBep20Interface.mint.selector, abi.encode(_amount));

    emit Stake(msg.sender, _amount);
    return "";
  }

  function redeem(uint256 _amount, DistributeData memory) external override returns (bytes memory) {
    require(_amount > 0, "CANT_REDEEM_0");

    _callCompStaking(VBep20Interface.redeemUnderlying.selector, abi.encode(_amount));

    emit Redeem(msg.sender, _amount);
    return "";
  }

  /*** POKE HOOKS ***/

  function beforePoke(bytes memory _pokeData, DistributeData memory _distributeData, bool _willClaimReward) public override {
    require(VBep20Interface(STAKING).accrueInterest() == NO_ERROR_CODE, "V_ERROR");

    uint256 last = abi.decode(_pokeData, (uint256));
    if (last > 0) {
      uint256 current = getUnderlyingStaked();
      if (current > last) {
        uint256 diff = current - last;
        // ignore the dust
        if (diff > 100) {
          _distributeReward(_distributeData, PI_TOKEN, UNDERLYING, diff);
        }
      }
    }
  }

  function afterPoke(PowerIndexBasicRouterInterface.ReserveStatus reserveStatus, bool _rewardClaimDone) public override returns (bytes memory) {
    return abi.encode(getUnderlyingStaked());
  }

  /*** VIEWERS ***/

  /**
   * @notice Get the amount of vToken will be minted in exchange of the given underlying tokens
   * @param _tokenAmount The input amount of underlying tokens
   * @return The corresponding amount of vTokens tokens
   */
  function getVTokenForToken(uint256 _tokenAmount) external view returns (uint256) {
    // token / exchangeRate
    return _tokenAmount.mul(1e18) / VBep20Interface(STAKING).exchangeRateStored();
  }

  /**
   * @notice Get the amount of underlying tokens will released in exchange of the given vTokens
   * @param _vTokenAmount The input amount of vTokens tokens
   * @return The corresponding amount of underlying tokens
   */
  function getTokenForVToken(uint256 _vTokenAmount) public view returns (uint256) {
    // vToken * exchangeRate
    return _vTokenAmount.mul(VBep20Interface(STAKING).exchangeRateStored()) / 1e18;
  }

  /**
   * @notice Get the net interest reward accrued on vToken;
   */
  function getPendingInterestReward(bytes memory _pokeData) external view returns (uint256) {
    uint256 last = abi.decode(_pokeData, (uint256));
    uint256 current = getUnderlyingStaked();
    if (last > current) {
      return 0;
    }

    return current - last;
  }

  /*** INTERNALS ***/

  function getUnderlyingStaked() public view override returns (uint256) {
    if (STAKING == address(0)) {
      return 0;
    }

    uint256 vTokenAtPiToken = IERC20(STAKING).balanceOf(address(PI_TOKEN));
    if (vTokenAtPiToken == 0) {
      return 0;
    }

    return getTokenForVToken(vTokenAtPiToken);
  }

  function _callCompStaking(bytes4 _sig, bytes memory _data) internal {
    bytes memory result = _callStaking(PI_TOKEN, STAKING, _sig, _data);
    uint256 err = abi.decode(result, (uint256));
    require(err == NO_ERROR_CODE, "V_ERROR");
  }
}
