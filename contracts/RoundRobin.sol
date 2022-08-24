pragma solidity 0.6.12;

import "./interfaces/IPPAgentV2.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RoundRobin {
  using SafeMath for uint256;

  uint256 public constant DAY_TOTAL_SECONDS = 86400;

  event TaskRegister(uint256 indexed taskId, address indexed manager, uint256 minStake, uint256 rewardPerExecute, uint256 totalRewards, uint256 queueInterval);
  event TaskDeposit(uint256 indexed taskId, address indexed depositor, uint256 amount);
  event TaskChange(uint256 indexed taskId, uint256 minStake, uint256 rewardPerExecute, uint256 queueInterval);

  struct Task {
    address manager;
    uint256 minKeeperStake;
    uint256 rewardPerExecute;
    uint256 totalRewards;
    uint256 queueInterval;
    uint256 lastQueueNumber;
    uint256 lastExecutedByKeeper;
  }

  Task[] public tasks;

  struct KeeperStatus {
    uint256 queueNumber;
    bool isApplied;
    bool isBlacklisted;
    uint256 pendingReward;
  }

  mapping(uint256 => mapping(uint256 => KeeperStatus)) public keepersStatus;

  IPPAgentV2 public keeper;
  IERC20 public rewardsToken;

  constructor(address _keeper, address _rewardsToken) {
   keeper = IPPAgentV2(_keeper);
   rewardsToken = IERC20(_rewardsToken);
  }

  function registerTask(uint256 _minStake, uint256 _rewardPerExecute, uint256 _totalRewards, uint256 _queueInterval) public {
    rewardsToken.transferFrom(msg.sender, address(this), _totalRewards);
    tasks.push(Task(msg.sender, _minStake, _rewardPerExecute, _totalRewards, 0, _queueInterval));
    emit TaskRegister(tasks.length - 1, msg.sender, _minStake, _rewardPerExecute, _totalRewards, _queueInterval);
  }

  function depositForTask(uint256 _taskId, uint256 _amount) public {
    rewardsToken.transferFrom(msg.sender, address(this), _amount);
    tasks[_taskId].totalRewards = tasks[_taskId].totalRewards.add(_amount);
    emit TaskDeposit(_taskId, msg.sender, _amount);
  }

  function changeTask(uint256 _taskId, uint256 _minStake, uint256 _rewardPerExecute, uint256 _queueInterval) public {
    Task storage task = tasks[_taskId];
    require(task.manager == msg.sender, "NOT_MANAGER");

    task.minKeeperStake = _minStake;
    task.rewardPerExecute = _rewardPerExecute;
    task.queueInterval = _queueInterval;

    emit TaskChange(_taskId, _minStake, _rewardPerExecute, _queueInterval);
  }

  function taskBlacklistKeeper(uint256 _taskId, uint256 _keeperId, bool _isBlacklist) {
    require(tasks[_taskId].manager == msg.sender, "NOT_MANAGER");

    keepersStatus[_taskId][_keeperId].isBlacklisted = _isBlacklist;
    //TODO: subtract pending reward?
  }

  function applyForTask(uint256 _taskId, uint256 _keeperId) public {
    require(!keepersStatus[_taskId][_keeperId].isBlacklisted, "BLACKLISTED");
    require(!keepersStatus[_taskId][_keeperId].isApplied, "ALREADY_APPLIED");

    (address admin, address worker,  uint256 currentStake, uint256 slashedStake, , ,) = keeper.getKeeper(_keeperId);

    require(msg.sender == admin || msg.sender == worker, "NOT_ADMIN_OR_WORKER");
    require(currentStake.sub(slashedStake) >= tasks[_taskId].minKeeperStake, "STAKE_NOT_ENOUGH");

    keepersStatus[_taskId][_keeperId].isApplied = true;
    keepersStatus[_taskId][_keeperId].queueNumber = tasks[_taskId].lastQueueNumber++;
    require(tasks[_taskId].lastQueueNumber * tasks[_taskId].queueInterval >= DAY_TOTAL_SECONDS, "TOO_MANY_QUEUE");
  }

  function execute(uint256 _taskId, uint256 _keeperId) public {
    KeeperStatus storage kStatus = keepersStatus[_taskId][_keeperId];

    require(kStatus.isApplied, "NOT_APPLIED");
    require(!kStatus.isBlacklisted, "BLACKLISTED");

    (uint256 keeperIntervalStart, uint256 keeperIntervalEnd) = getKeeperIntervalBoundaries(_taskId, _keeperId);
    require(block.timestamp >= keeperIntervalStart && block.timestamp <= keeperIntervalEnd, "INTERVAL_BOUNDARIES");
    require(tasks[_taskId].lastExecutedByKeeper != _keeperId, "ALREADY_EXECUTED");

    tasks[_taskId].lastExecutedByKeeper = _keeperId;

    (address admin, address worker,  uint256 currentStake, uint256 slashedStake, , ,) = keeper.getKeeper(_keeperId);
    require(tx.origin == worker, "NOT_WORKER");
    require(currentStake.sub(slashedStake) >= tasks[_taskId].minKeeperStake, "STAKE_NOT_ENOUGH");

    kStatus.pendingReward = kStatus.pendingReward.add(tasks[_taskId].rewardPerExecute);
    //TODO: total pending reward in task?
  }

  function claimReward(uint256 _taskId, uint256 _keeperId) public {
    KeeperStatus storage kStatus = keepersStatus[_taskId][_keeperId];

    require(kStatus.isApplied, "NOT_APPLIED");
    require(!kStatus.isBlacklisted, "BLACKLISTED");

    (address admin, address worker,  uint256 currentStake, uint256 slashedStake, , ,) = keeper.getKeeper(_keeperId);
    require(msg.sender == admin || msg.sender == worker, "NOT_ADMIN_OR_WORKER");
    //TODO: check for slashedStake?

    tasks[_taskId].totalRewards = tasks[_taskId].totalRewards.sub(kStatus.pendingReward);
    rewardsToken.transfer(admin, kStatus.pendingReward);

    kStatus.pendingReward = 0;
  }

  function getKeeperIntervalBoundaries(uint256 _taskId, uint256 _keeperId) public view returns (uint256 keeperIntervalStart, uint256 keeperIntervalEnd) {
    uint256 secondsPerKeeper = DAY_TOTAL_SECONDS / tasks[_taskId].queueInterval;
    keeperIntervalStart = keepersStatus[_taskId][_keeperId].queueNumber * secondsPerKeeper;
    keeperIntervalEnd = keeperIntervalStart + secondsPerKeeper;
  }
}
