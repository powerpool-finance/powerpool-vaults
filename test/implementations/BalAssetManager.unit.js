const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, zeroAddress, maxUint256, deployContractWithBytecode } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const MockWETH = artifacts.require('MockWETH');
const MockSwapper = artifacts.require('MockSwapper');
const BalPowerIndexConnector = artifacts.require('MockBalConnector');
const AssetManager = artifacts.require('AssetManager');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockPoke = artifacts.require('MockPoke');
const StablePoolFactory = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePoolFactory');
const StablePool = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePool');
const LiquidityGaugeMock = artifacts.require('LiquidityGaugeMock');
const BalancerMinterMock = artifacts.require('BalancerMinterMock');

MockERC20.numberFormat = 'String';
BalPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
AssetManager.numberFormat = 'String';
BalPowerIndexConnector.numberFormat = 'String';

const { web3 } = MockERC20;
const { toBN } = web3.utils;

describe('BalAssetManager Tests', () => {

  let deployer, alice, eve, piGov, stub, pvp;

  before(async function () {
    [deployer, alice, eve, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let lusd,
    lqty,
    bbausd,
    bal,
    weth,
    authorizer,
    vault,
    stablePoolFactory,
    staking,
    poolRestrictions,
    assetManager,
    connector,
    poke,
    pid,
    lusdSecond,
    swapper;

  const pauseWindowDuration = 7776000;
  const bufferPeriodDuration = 2592000;

  function approximatelyEqual(num1, num2) {
    num1 = toBN(num1.toString(10));
    num2 = toBN(num2.toString(10));
    assert.equal(
      (num1.gt(num2) ? num1.mul(toBN(ether(1))).div(num2) : num2.mul(toBN(ether(1))).div(num1)).lt(toBN(ether(1.001))),
      true,
    );
  }

  beforeEach(async function () {
    weth = await MockWETH.new();

    // mainnet: 0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6
    authorizer = await deployContractWithBytecode('balancerV3/Authorizer', web3, [piGov]);
    // mainnet: 0xba12222222228d8ba445958a75a0704d566bf2c8
    vault = await deployContractWithBytecode('balancerV3/Vault', web3, [
      authorizer.address,
      weth.address,
      pauseWindowDuration,
      bufferPeriodDuration,
    ]);
    await authorizer.grantRoles(['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'], deployer, {
      from: piGov,
    });
    bbausd = await MockERC20.new('bbaUSD', 'bbaUSD', '18', ether(20e6), { from: deployer });
    lusd = await MockERC20.new('LUSD', 'LUSD', '18', ether(20e6), { from: deployer });
    bal = await MockERC20.new('BAL', 'BAL', '18', ether(20e6), { from: deployer });
    // mainnet: 0xa5bf2ddf098bb0ef6d120c98217dd6b141c74ee0
    // const weightedPoolFactory = await WeightedPoolFactory.new(vault.address);
    // const wethSecond = web3.utils.toBN(weth.address).gt(web3.utils.toBN(bal.address));
    // let res = await weightedPoolFactory.create(
    //   'Balancer PP Stable Pool',
    //   'bb-p-USD',
    //   wethSecond ? [bal.address, weth.address] : [weth.address, bal.address],
    //   wethSecond ? [ether(0.8), ether(0.2)] : [ether(0.2), ether(0.8)],
    //   [zeroAddress, zeroAddress],
    //   1e12,
    //   deployer,
    // );
    //
    // const balPool = await StablePool.at(res.receipt.logs[0].args.pool);
    // mainnet: 0x6f5a2ee11e7a772aeb5114a20d0d7c0ff61eb8a0
    // const veBoostProxy = await VeBoostProxy.new();
    // mainnet: 0xba100000625a3754423978a60c9317c58a424e3d
    // const balancerToken = await deployContractWithBytecode('crv/BalancerGovernanceToken', web3, [
    //   'BAL',
    //   'BAL'
    // ]);
    // mainnet: 0xf302f9f50958c5593770fdf4d4812309ff77414f
    // const balancerTokenAdmin = await deployContractWithBytecode('crv/BalancerTokenAdmin', web3, [
    //   vault.address,
    //   balancerToken.address
    // ]);
    // mainnet: 0xc128a9954e6c874ea3d62ce62b468ba073093f25
    // const votingEscrow = await VotingEscrow.new(balPool.address);
    // mainnet: 0xc128468b7ce63ea702c1f104d55a2566b13d3abd
    // const gaugeController = await deployContractWithBytecode('crv/GaugeController', web3, [votingEscrow.address, piGov]);
    // mainnet: 0x239e55f427d44c3cc793f49bfb507ebe76638a2b
    // const balancerMinter = await deployContractWithBytecode('crv/BalancerMinter', web3, [
    //   balancerTokenAdmin.address,
    //   gaugeController.address,
    // ]);
    // mainnet: 0x68d019f64a7aa97e2d4e7363aee42251d08124fb
    // const liquidityGauge = await deployContractWithBytecode('crv/LiquidityGauge', web3, [
    //   balancerMinter.address,
    //   veBoostProxy.address,
    //   piGov
    // ]);
    staking = await LiquidityGaugeMock.new(bbausd.address, bal.address, ether('0.01'));
    const balancerMinter = await BalancerMinterMock.new(bal.address);

    poolRestrictions = await MockPoolRestrictions.new();

    poke = await MockPoke.new(true);
    assetManager = await AssetManager.new(
      vault.address,
      lusd.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        staking.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        0,
        pvp,
        ether('0.15'),
      ),
    );

    lusdSecond = web3.utils.toBN(lusd.address).gt(web3.utils.toBN(bbausd.address));
    stablePoolFactory = await StablePoolFactory.new(vault.address);
    let res = await stablePoolFactory.create(
      'Balancer PP Stable Pool',
      'bb-p-USD',
      lusdSecond ? [bbausd.address, lusd.address] : [lusd.address, bbausd.address],
      lusdSecond ? [assetManager.address, zeroAddress] : [zeroAddress, assetManager.address],
      200,
      5e14,
      deployer,
    );

    const pool = await StablePool.at(res.receipt.logs[0].args.pool);

    await bbausd.approve(vault.address, maxUint256);
    await lusd.approve(vault.address, maxUint256);

    pid = await pool.getPoolId();

    await vault.joinPool(pid, deployer, deployer, {
      assets: lusdSecond ? [bbausd.address, lusd.address] : [lusd.address, bbausd.address],
      maxAmountsIn: [ether(2e6), ether(2e6)],
      userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [0, [ether(2e6), ether(2e6)]]),
      fromInternalBalance: false,
    });

    swapper = await MockSwapper.new();
    await swapper.setRatio(bal.address, bbausd.address, ether(0.5));
    await bbausd.transfer(swapper.address, ether(1e6));

    connector = await BalPowerIndexConnector.new(
      assetManager.address,
      staking.address,
      bbausd.address,
      bal.address,
      balancerMinter.address,
      vault.address,
      pid,
      swapper.address,
    );
    await assetManager.setConnectorList([
      {
        connector: connector.address,
        share: ether(1),
        callBeforeAfterPoke: false,
        newConnector: true,
        connectorIndex: 0,
      },
    ]);

    await assetManager.initRouterByConnector('0', '0x');
    await assetManager.transferOwnership(piGov);
    assert.equal(await assetManager.owner(), piGov);

    await bbausd.transfer(alice, ether(1e6));
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
    });

    it('should claim rewards and reinvest', async () => {
      await assetManager.setClaimParams('0', await connector.packClaimParams(time.duration.minutes(60)), { from: piGov });

      await assetManager.pokeFromReporter('1', false, '0x');
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      await time.increase(time.duration.minutes(60));
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'NOTHING_TO_DO');

      await bbausd.approve(staking.address, await bbausd.balanceOf(alice), { from: alice });
      await staking.deposit(ether(5000), alice, false, {from: alice});
      assert.equal(await assetManager.getUnderlyingStaked(), ether(1600000));
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether(400000));
      assert.equal(await assetManager.getUnderlyingTotal(), ether(2000000));
      assert.equal(await staking.balanceOf(assetManager.address), ether(1600000));

      await time.increase(time.duration.minutes(60));

      const expectedReward = ether(71.81557632398753894);
      const expectedFee = ether(71.81557632398753894 * 0.15);

      approximatelyEqual(await connector.contract.methods.getPendingRewards().call({}).then(r => r.toString()), expectedReward);

      let res = await connector.getPendingRewards();
      let transfer = MockERC20.decodeLogs(res.receipt.rawLogs).filter(
        l => l.event === 'Transfer',
      )[0];
      assert.equal(transfer.args.from, '0x0000000000000000000000000000000000000000');
      assert.equal(transfer.args.to, assetManager.address);
      approximatelyEqual(transfer.args.value, expectedReward);

      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'NOTHING_TO_DO');
      res = await assetManager.pokeFromReporter('1', true, '0x');
      transfer = MockERC20.decodeLogs(res.receipt.rawLogs).filter(
        l => l.address === bal.address && l.event === 'Transfer',
      )[0];
      assert.equal(transfer.args.from, assetManager.address);
      assert.equal(transfer.args.to, pvp);
      approximatelyEqual(transfer.args.value, expectedFee);

      transfer = MockERC20.decodeLogs(res.receipt.rawLogs).filter(
        l => l.address === bal.address && l.event === 'Transfer',
      )[1];
      assert.equal(transfer.args.from, assetManager.address);
      assert.equal(transfer.args.to, swapper.address);
      approximatelyEqual(transfer.args.value, toBN(expectedReward).sub(toBN(expectedFee)));

      transfer = MockERC20.decodeLogs(res.receipt.rawLogs).filter(
        l => l.address === bbausd.address && l.event === 'Transfer',
      )[1];
      assert.equal(transfer.args.from, assetManager.address);
      assert.equal(transfer.args.to, staking.address);
      approximatelyEqual(transfer.args.value, ether(30.525856697819314641));

      approximatelyEqual(await assetManager.getUnderlyingStaked(), ether(1600030.530093457943925234));
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether(400000));
      approximatelyEqual(await assetManager.getUnderlyingTotal(), ether(2000030.530093457943925234));
      approximatelyEqual(await staking.balanceOf(assetManager.address), ether(1600030.530093457943925234));
    });
  });
});
