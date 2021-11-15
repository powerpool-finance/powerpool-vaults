// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/PowerIndexNaiveRouterInterface.sol";
import "./interfaces/PowerIndexRouterInterface.sol";
import "./interfaces/WrappedPiErc20Interface.sol";

contract WrappedPiErc20 is ERC20, ReentrancyGuard, WrappedPiErc20Interface {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public immutable underlying;
  address public router;
  uint256 public ethFee;
  mapping(address => bool) public noFeeWhitelist;

  event Deposit(address indexed account, uint256 undelyingDeposited, uint256 piMinted);
  event Withdraw(address indexed account, uint256 underlyingWithdrawn, uint256 piBurned);
  event Approve(address indexed to, uint256 amount);
  event ChangeRouter(address indexed newRouter);
  event SetEthFee(uint256 newEthFee);
  event SetNoFee(address indexed addr, bool noFee);
  event WithdrawEthFee(uint256 value);
  event CallExternal(address indexed destination, bytes4 indexed inputSig, bytes inputData, bytes outputData);

  modifier onlyRouter() {
    require(router == msg.sender, "ONLY_ROUTER");
    _;
  }

  constructor(
    address _token,
    address _router,
    string memory _name,
    string memory _symbol
  ) public ERC20(_name, _symbol) {
    underlying = IERC20(_token);
    router = _router;
  }

  /**
   * @notice Deposits underlying token to the piToken
   * @param _depositAmount The amount to deposit in underlying tokens
   */
  function deposit(uint256 _depositAmount) external payable override nonReentrant returns (uint256) {
    if (noFeeWhitelist[msg.sender]) {
      require(msg.value == 0, "NO_FEE_FOR_WL");
    } else {
      require(msg.value >= ethFee, "FEE");
    }

    require(_depositAmount > 0, "ZERO_DEPOSIT");

    uint256 mintAmount = getPiEquivalentForUnderlying(_depositAmount);
    require(mintAmount > 0, "ZERO_PI_FOR_MINT");

    underlying.safeTransferFrom(msg.sender, address(this), _depositAmount);
    _mint(msg.sender, mintAmount);

    emit Deposit(msg.sender, _depositAmount, mintAmount);

    PowerIndexNaiveRouterInterface(router).piTokenCallback{ value: msg.value }(msg.sender, 0);

    return mintAmount;
  }

  /**
   * @notice Withdraws underlying token from the piToken
   * @param _withdrawAmount The amount to withdraw in underlying tokens
   * @return The amount of the burned shares
   */
  function withdraw(uint256 _withdrawAmount) external payable override nonReentrant returns (uint256) {
    if (noFeeWhitelist[msg.sender]) {
      require(msg.value == 0, "NO_FEE_FOR_WL");
    } else {
      require(msg.value >= ethFee, "FEE");
    }

    require(_withdrawAmount > 0, "ZERO_WITHDRAWAL");

    PowerIndexNaiveRouterInterface(router).piTokenCallback{ value: msg.value }(msg.sender, _withdrawAmount);

    uint256 burnAmount = getPiEquivalentForUnderlying(_withdrawAmount);
    require(burnAmount > 0, "ZERO_PI_FOR_BURN");

    _burn(msg.sender, burnAmount);
    underlying.safeTransfer(msg.sender, _withdrawAmount);

    emit Withdraw(msg.sender, _withdrawAmount, burnAmount);

    return burnAmount;
  }

  /**
   * @notice Withdraws underlying token from the piToken
   * @param _burnAmount The amount of shares to burn
   * @return The amount of the withdrawn underlying
   */
  function withdrawShares(uint256 _burnAmount) external payable override nonReentrant returns (uint256) {
    if (noFeeWhitelist[msg.sender]) {
      require(msg.value == 0, "NO_FEE_FOR_WL");
    } else {
      require(msg.value >= ethFee, "FEE");
    }

    require(_burnAmount > 0, "ZERO_WITHDRAWAL");

    uint256 withdrawAmount = getUnderlyingEquivalentForPi(_burnAmount);
    require(withdrawAmount > 0, "ZERO_UNDERLYING_TO_WITHDRAW");
    PowerIndexNaiveRouterInterface(router).piTokenCallback{ value: msg.value }(msg.sender, withdrawAmount);

    _burn(msg.sender, _burnAmount);
    underlying.safeTransfer(msg.sender, withdrawAmount);

    emit Withdraw(msg.sender, withdrawAmount, _burnAmount);

    return withdrawAmount;
  }

  function getPiEquivalentForUnderlying(uint256 _underlyingAmount) public view override returns (uint256) {
    return PowerIndexRouterInterface(router).getPiEquivalentForUnderlying(_underlyingAmount, totalSupply());
  }

  function getUnderlyingEquivalentForPi(uint256 _piAmount) public view override returns (uint256) {
    return PowerIndexRouterInterface(router).getUnderlyingEquivalentForPi(_piAmount, totalSupply());
  }

  function balanceOfUnderlying(address account) external view override returns (uint256) {
    return getUnderlyingEquivalentForPi(balanceOf(account));
  }

  function totalSupplyUnderlying() external view returns (uint256) {
    return getUnderlyingEquivalentForPi(totalSupply());
  }

  function changeRouter(address _newRouter) external override onlyRouter {
    router = _newRouter;
    emit ChangeRouter(router);
  }

  function setNoFee(address _for, bool _noFee) external override onlyRouter {
    noFeeWhitelist[_for] = _noFee;
    emit SetNoFee(_for, _noFee);
  }

  function setEthFee(uint256 _ethFee) external override onlyRouter {
    ethFee = _ethFee;
    emit SetEthFee(_ethFee);
  }

  function withdrawEthFee(address payable _receiver) external override onlyRouter {
    emit WithdrawEthFee(address(this).balance);
    _receiver.transfer(address(this).balance);
  }

  function approveUnderlying(address _to, uint256 _amount) external override onlyRouter {
    underlying.approve(_to, _amount);
    emit Approve(_to, _amount);
  }

  function callExternal(
    address _destination,
    bytes4 _signature,
    bytes calldata _args,
    uint256 _value
  ) external override onlyRouter returns (bytes memory) {
    return _callExternal(_destination, _signature, _args, _value);
  }

  function callExternalMultiple(ExternalCallData[] calldata _calls)
    external
    override
    onlyRouter
    returns (bytes[] memory results)
  {
    uint256 len = _calls.length;
    results = new bytes[](len);
    for (uint256 i = 0; i < len; i++) {
      results[i] = _callExternal(_calls[i].destination, _calls[i].signature, _calls[i].args, _calls[i].value);
    }
  }

  function getUnderlyingBalance() external view override returns (uint256) {
    return underlying.balanceOf(address(this));
  }

  function _callExternal(
    address _destination,
    bytes4 _signature,
    bytes calldata _args,
    uint256 _value
  ) internal returns (bytes memory) {
    (bool success, bytes memory data) = _destination.call{ value: _value }(abi.encodePacked(_signature, _args));

    if (!success) {
      assembly {
        let output := mload(0x40)
        let size := returndatasize()
        switch size
        case 0 {
          // If there is no revert reason string, revert with the default `REVERTED_WITH_NO_REASON_STRING`
          mstore(output, 0x08c379a000000000000000000000000000000000000000000000000000000000) // error identifier
          mstore(add(output, 0x04), 0x0000000000000000000000000000000000000000000000000000000000000020) // offset
          mstore(add(output, 0x24), 0x000000000000000000000000000000000000000000000000000000000000001e) // length
          mstore(add(output, 0x44), 0x52455645525445445f574954485f4e4f5f524541534f4e5f535452494e470000) // reason
          revert(output, 100) // 100 = 4 + 3 * 32 (error identifier + 3 words for the ABI encoded error)
        }
        default {
          // If there is a revert reason string hijacked, revert with it
          revert(add(data, 32), size)
        }
      }
    }

    emit CallExternal(_destination, _signature, _args, data);

    return data;
  }
}
