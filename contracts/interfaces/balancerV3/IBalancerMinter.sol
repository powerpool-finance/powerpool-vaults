pragma solidity ^0.7.0;

interface IBalancerMinter {
  event MinterApprovalSet(address indexed user, address indexed minter, bool approval);

  /**
   * @notice Mint everything which belongs to `msg.sender` and send to them
   * @param gauge `LiquidityGauge` address to get mintable amount from
   */
  function mint(address gauge) external returns (uint256);

  /**
   * @notice Mint tokens for `user`
   * @dev Only possible when `msg.sender` has been approved by `user` to mint on their behalf
   * @param gauge `LiquidityGauge` address to get mintable amount from
   * @param user Address to mint to
   */
  function mintFor(address gauge, address user) external returns (uint256);

  /**
   * @notice Set whether `minter` is approved to mint tokens on your behalf
   */
  function setMinterApproval(address minter, bool approval) external;
}
