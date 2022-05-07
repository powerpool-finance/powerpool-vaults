pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../interfaces/ILiquidityGauge.sol";
import "hardhat/console.sol";

contract LiquidityGaugeMock is ILiquidityGauge {
  using SafeMath for uint256;

  mapping(address => uint256) public override balanceOf;
  mapping(address => uint256) public totalRewards;
  mapping(address => Reward) public override reward_data;
  uint256 totalSupply;
  uint256 accumulated;
  uint256 lastAccumulatedAt;

  IERC20 public stakeToken;
  IERC20 public rewardsTokens;
  uint256 public rewardsPerSecond;

  constructor(IERC20 _stakeToken, IERC20 _rewardsTokens, uint256 _rewardsPerSecond) public {
    stakeToken = _stakeToken;
    rewardsTokens = _rewardsTokens;
    rewardsPerSecond = _rewardsPerSecond;
  }

  function deposit(uint256 _amount, address _depositFor, bool _claim) external override {
    console.log("stakeToken.balanceOf", stakeToken.balanceOf(msg.sender));
    stakeToken.transferFrom(msg.sender, address(this), _amount);
    balanceOf[_depositFor] = balanceOf[_depositFor].add(_amount);
    totalSupply = totalSupply.add(_amount);
    _updateAccumulated(_depositFor);
  }

  function withdraw(uint256 _amount, bool _claim) external override {
    stakeToken.transfer(msg.sender, _amount);
    balanceOf[msg.sender] = balanceOf[msg.sender].sub(_amount);
    totalSupply = totalSupply.sub(_amount);
    _updateAccumulated(msg.sender);
  }

  function _updateAccumulated(address _user) internal {
    accumulated = accumulated.add(rewardsPerSecond.mul(block.timestamp.sub(lastAccumulatedAt)));
    if (reward_data[_user].rate != 0) {
      totalRewards[_user] = totalRewards[_user].add(accumulated.sub(reward_data[_user].rate).mul(balanceOf[_user]).div(totalSupply));
    }
    reward_data[_user].rate = accumulated;
    lastAccumulatedAt = block.timestamp;
  }

  function integrate_fraction(address _user) external override returns (uint256) {
    reward_data[_user].last_update = block.timestamp;
    return totalRewards[_user];
  }

  function user_checkpoint(address _user) external override returns (bool) {
    _updateAccumulated(_user);
    return true;
  }
}
