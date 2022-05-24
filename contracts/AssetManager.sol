// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./AbstractPowerIndexRouter.sol";
import "./interfaces/balancerV3/IVault.sol";
import "./interfaces/IRouterVaultConnector.sol";

contract AssetManager is AbstractPowerIndexRouter {
  using SafeMath for uint256;

  enum BalancerV2JoinKind {
    INIT,
    EXACT_TOKENS_IN_FOR_BPT_OUT,
    TOKEN_IN_FOR_EXACT_BPT_OUT
  }
  enum BalancerV2ExitKind {
    EXACT_BPT_IN_FOR_ONE_TOKEN_OUT,
    EXACT_BPT_IN_FOR_TOKENS_OUT,
    BPT_IN_FOR_EXACT_TOKENS_OUT
  }

  bytes32 public poolId;
  address public poolAddress;

  constructor(
    address _assetsHolder,
    address _underlying,
    BasicConfig memory _basicConfig
  ) AbstractPowerIndexRouter(_assetsHolder, _underlying, _basicConfig) {}

  function setPoolInfo(bytes32 _poolId, address _poolAddress) external onlyOwner {
    poolId = _poolId;
    poolAddress = _poolAddress;
  }

  function getAssetsHolderUnderlyingBalance() public view override returns (uint256) {
    uint256 balance = 0;
    for (uint256 i = 0; i < connectors.length; i++) {
      require(address(connectors[i].connector) != address(0), "CONNECTOR_IS_NULL");
      balance = balance.add(connectors[i].connector.getUnderlyingReserve());
    }
    return balance;
  }

  function migrateToNewAssetManager(
    bytes memory _migrateData,
    address payable _newRouter,
    address[] memory _tokens
  ) external virtual onlyOwner {
    super.migrateToNewRouter(_newRouter, _tokens);

    for (uint256 i = 0; i < connectors.length; i++) {
      if (address(connectors[i].connector) != address(0)) {
        connectors[i].connector.migrate(_migrateData);
      }
    }
  }

  function distributeRestPoolBalance(uint256 _connectorIndex, bytes calldata _params) external onlyOwner {
    (bool success, bytes memory result) = (address(connectors[_connectorIndex].connector)).delegatecall(
      abi.encodeWithSignature("distributePoolBalance(address,bytes)", performanceFeeReceiver, _params)
    );
    require(success, string(result));
  }

  function emergencyWithdraw(
    uint256 _underlyingAmount,
    uint256 _maxBPTAmountIn,
    bool _returnDiff
  ) external returns (uint256 poolBalanceDiff) {
    require(connectors.length == 1, "AVAILABLE_ONLY_FOR_ONE_CONNECTOR");
    Connector storage c = connectors[0];
    (IAsset[] memory tokens, , ) = IVault(assetsHolder).getPoolTokens(poolId);
    uint256[] memory minAmountsOut = new uint256[](tokens.length);

    for (uint256 i = 0; i < tokens.length; i++) {
      if (address(tokens[i]) == address(underlying)) {
        minAmountsOut[i] = _underlyingAmount;
        break;
      }
    }
    IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest(
      tokens,
      minAmountsOut,
      getEmergencyExitUserData(_maxBPTAmountIn, minAmountsOut),
      false
    );

    uint256 underlyingReserve = c.connector.getUnderlyingReserve();
    require(underlyingReserve < _underlyingAmount, "NOT_EMERGENCY");
    uint256 underlyingStaked = c.connector.getUnderlyingStaked().sub(_underlyingAmount);

    (StakeStatus status, uint256 diff, ) = getStakeStatus(
      underlyingReserve,
      underlyingStaked,
      underlyingStaked,
      0,
      c.share
    );

    if (status == StakeStatus.EXCESS) {
      _redeem(c, _underlyingAmount.add(diff));
    } else if (status == StakeStatus.SHORTAGE) {
      _redeem(c, _underlyingAmount.sub(diff));
    }

    IERC20(poolAddress).transferFrom(msg.sender, address(this), _maxBPTAmountIn);

    uint256 poolBalanceBefore;
    if (_returnDiff) {
      poolBalanceBefore = IERC20(poolAddress).balanceOf(address(this));
    }

    IVault(assetsHolder).exitPool(poolId, address(this), msg.sender, request);

    if (_returnDiff) {
      uint256 poolBalanceAfter = IERC20(poolAddress).balanceOf(address(this));
      poolBalanceDiff = poolBalanceBefore.sub(poolBalanceAfter);
      IERC20(poolAddress).transfer(msg.sender, poolBalanceDiff);
    }
  }

  function getEmergencyExitUserData(uint256 _maxBPTAmountIn, uint256[] memory _amountsOut)
    public
    view
    returns (bytes memory)
  {
    return abi.encode(uint256(BalancerV2ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT), _amountsOut, _maxBPTAmountIn);
  }
}
