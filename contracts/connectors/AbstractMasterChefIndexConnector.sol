// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/sushi/IMasterChefV1.sol";
import "./AbstractConnector.sol";

abstract contract AbstractMasterChefIndexConnector is AbstractConnector {
  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);

  address public immutable STAKING;
  IERC20 public immutable UNDERLYING;
  WrappedPiErc20Interface public immutable PI_TOKEN;

  constructor(
    address _staking,
    address _underlying,
    address _piToken
  ) public AbstractConnector(46e12) {
    // 6 hours with 13ms block
    STAKING = _staking;
    UNDERLYING = IERC20(_underlying);
    PI_TOKEN = WrappedPiErc20Interface(_piToken);
  }

  /*** PERMISSIONLESS REWARD CLAIMING AND DISTRIBUTION ***/

  function claimRewards(PowerIndexRouterInterface.StakeStatus _status, DistributeData memory _distributeData)
    external
    override
    returns (bytes memory)
  {
    if (_status == PowerIndexRouterInterface.StakeStatus.EQUILIBRIUM) {
      uint256 tokenBefore = UNDERLYING.balanceOf(address(PI_TOKEN));
      stake(0, _distributeData);
      uint256 receivedReward = UNDERLYING.balanceOf(address(PI_TOKEN)).sub(tokenBefore);
      if (receivedReward > 0) {
        return _distributeReward(_distributeData, PI_TOKEN, UNDERLYING, receivedReward);
      }
    }
    // Otherwise the rewards are distributed each time deposit/withdraw methods are called,
    // so no additional actions required.
    return new bytes(0);
  }

  /*** INTERNALS ***/

  function stake(uint256 _amount, DistributeData memory _distributeData) public override returns (bytes memory) {
    uint256 tokenBefore = UNDERLYING.balanceOf(address(PI_TOKEN));

    PI_TOKEN.approveUnderlying(STAKING, _amount);

    _stakeImpl(_amount);

    uint256 receivedReward = UNDERLYING.balanceOf(address(PI_TOKEN)).sub(tokenBefore.sub(_amount));

    bytes memory result = new bytes(0);
    if (receivedReward > 0) {
      result = _distributeReward(_distributeData, PI_TOKEN, UNDERLYING, receivedReward);
    }

    emit Stake(msg.sender, STAKING, address(UNDERLYING), _amount);
    return result;
  }

  function redeem(uint256 _amount, DistributeData memory _distributeData) external override returns (bytes memory) {
    uint256 tokenBefore = UNDERLYING.balanceOf(address(PI_TOKEN));

    _redeemImpl(_amount);

    uint256 receivedReward = UNDERLYING.balanceOf(address(PI_TOKEN)).sub(tokenBefore).sub(_amount);

    bytes memory result;
    if (receivedReward > 0) {
      result = _distributeReward(_distributeData, PI_TOKEN, UNDERLYING, receivedReward);
    }

    emit Redeem(msg.sender, STAKING, address(UNDERLYING), _amount);
    return result;
  }

  function _stakeImpl(uint256 _amount) internal virtual;

  function _redeemImpl(uint256 _amount) internal virtual;

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
}
