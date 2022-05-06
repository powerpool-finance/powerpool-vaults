const { time, constants, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, zeroAddress, maxUint256, deployContractWithBytecode } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const MockWETH = artifacts.require('MockWETH');
const MockSwapper = artifacts.require('MockSwapper');
const BProtocolPowerIndexConnector = artifacts.require('MockBProtocolConnector');
const AssetManager = artifacts.require('AssetManager');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockPoke = artifacts.require('MockPoke');
const StablePoolFactory = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePoolFactory');
const WeightedPoolFactory = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/WeightedPoolFactory');
const StablePool = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePool');
const VeBoostProxy = artifacts.require('VeBoostProxy');

MockERC20.numberFormat = 'String';
BProtocolPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
AssetManager.numberFormat = 'String';
BProtocolPowerIndexConnector.numberFormat = 'String';

const { web3 } = MockERC20;
const { toBN } = web3.utils;

describe.skip('BalAssetManager Tests', () => {

  let deployer, alice, eve, piGov, stub, pvp;

  before(async function () {
    [deployer, alice, eve, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let lusd,
    lqty,
    ausd,
    weth,
    troveManager,
    stabilityPool,
    activePool,
    defaultPool,
    collSurplusPool,
    borrowerOperations,
    lqtyStaking,
    priceFeed,
    sortedTroves,
    communityIssuance,
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
    ethUsdPriceOracle,
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
    ausd = await MockERC20.new('aUSD', 'aUSD', '18', ether(20e6), { from: deployer });
    const busd = await MockERC20.new('bUSD', 'bUSD', '18', ether(20e6), { from: deployer });
    // mainnet: 0xa5bf2ddf098bb0ef6d120c98217dd6b141c74ee0
    const weightedPoolFactory = await WeightedPoolFactory.new(vault.address);


    // mainnet: 0x6f5a2ee11e7a772aeb5114a20d0d7c0ff61eb8a0
    const veBoostProxy = await VeBoostProxy.deploy();
    // mainnet: 0xba100000625a3754423978a60c9317c58a424e3d
    const balancerToken = await deployContractWithBytecode('crv/BalancerGovernanceToken', web3, [
      'BAL',
      'BAL'
    ]);
    // mainnet: 0xf302f9f50958c5593770fdf4d4812309ff77414f
    const balancerTokenAdmin = await deployContractWithBytecode('crv/BalancerTokenAdmin', web3, [
      vault.address,
      balancerToken.address
    ]);
    // mainnet: 0xc128a9954e6c874ea3d62ce62b468ba073093f25
    const votingEscrow = await deployContractWithBytecode('crv/VotingEscrow', web3, []);
    // mainnet: 0xc128468b7ce63ea702c1f104d55a2566b13d3abd
    const gaugeController = await deployContractWithBytecode('crv/GaugeController', web3, []);
    // mainnet: 0x68d019f64a7aa97e2d4e7363aee42251d08124fb
    const liquidityGauge = await deployContractWithBytecode('crv/LiquidityGauge', web3, []);
    // mainnet: 0x239e55f427d44c3cc793f49bfb507ebe76638a2b
    const balancerMinter = await deployContractWithBytecode('crv/BalancerMinter', web3, []);


    await authorizer.grantRoles(['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'], deployer, {
      from: piGov,
    });

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

    ausd = await MockERC20.new('aUSD', 'aUSD', '18', ether(20e6), { from: deployer });
    lusdSecond = web3.utils.toBN(lusd.address).gt(web3.utils.toBN(ausd.address));
    stablePoolFactory = await StablePoolFactory.new(vault.address);
    let res = await stablePoolFactory.create(
      'Balancer PP Stable Pool',
      'bb-p-USD',
      lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      lusdSecond ? [zeroAddress, assetManager.address] : [assetManager.address, zeroAddress],
      200,
      5e14,
      deployer,
    );

    const pool = await StablePool.at(res.receipt.logs[0].args.pool);

    await borrowerOperations.openTrove(ether(1), ether(2e6), zeroAddress, zeroAddress, { value: ether(3e3) });
    await borrowerOperations.openTrove(ether(1), ether(5e3), zeroAddress, zeroAddress, {
      value: ether(4),
      from: alice,
    });
    await borrowerOperations.openTrove(ether(1), ether(7e3), zeroAddress, zeroAddress, { value: ether(3), from: eve });

    ausd.approve(vault.address, maxUint256);
    lusd.approve(vault.address, maxUint256);

    pid = await pool.getPoolId();

    await vault.joinPool(pid, deployer, deployer, {
      assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      maxAmountsIn: [ether(2e6), ether(2e6)],
      userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [0, [ether(2e6), ether(2e6)]]),
      fromInternalBalance: false,
    });

    connector = await BProtocolPowerIndexConnector.new(
      assetManager.address,
      staking.address,
      lusd.address,
      vault.address,
      stabilityPool.address,
      lqty.address,
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
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await lusd.approve(staking.address, ether(1), { from: alice });
      await staking.deposit(ether(1), { from: alice });
      await lusd.transfer(swapper.address, await lusd.balanceOf(alice), {from: alice});
      await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });

      const res = await lusd.approve(vault.address, await ausd.balanceOf(deployer), { from: deployer });
      await vault.swap(
        {
          poolId: pid,
          kind: '0',
          assetIn: ausd.address,
          assetOut: lusd.address,
          amount: ether(1030000),
          userData: '0x',
        },
        {
          sender: deployer,
          fromInternalBalance: false,
          recipient: deployer,
          toInternalBalance: false,
        },
        '0',
        (await web3.eth.getBlock(res.receipt.blockNumber)).timestamp + 100,
      );

      await lusd.transfer(eve, ether(20000), { from: deployer });
    });

    it('should claim rewards and reinvest', async () => {
      assert.equal(await lusd.balanceOf(vault.address), '974070046021699791322769');
      const firstStake = await assetManager.pokeFromReporter('1', false, '0x');
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      await time.increase(time.duration.minutes(60));
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'NOTHING_TO_DO');

      await ethUsdPriceOracle.setLatestAnswer('190000000000');
      await troveManager.liquidateTroves(2);
      await lusd.approve(staking.address, await lusd.balanceOf(eve), { from: eve });
      // await staking.swap(ether(9000), 0, eve, {from: eve});
      await staking.swap(ether(19000), 0, eve, { from: eve });
      // await borrowerOperations.openTrove(
      //   ether(1),
      //   ether(6e3),
      //   zeroAddress,
      //   zeroAddress,
      //   {value: ether(4), from: charlie}
      // );
      // await borrowerOperations.openTrove(
      //   ether(1),
      //   ether(6e3),
      //   zeroAddress,
      //   zeroAddress,
      //   {value: ether(4), from: dan}
      // );
      // await ethUsdPriceOracle.setLatestAnswer('1000000000');
      // await troveManager.liquidateTroves(2);
      // await staking.swap(ether(9000), 0, eve, {from: eve});
      assert.equal(await assetManager.getUnderlyingStaked(), '790831021963467659876128');
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), '194814009204339958264554');
      assert.equal(await lusd.balanceOf(vault.address), '194814009204339958264554');
      assert.equal(await assetManager.getUnderlyingTotal(), '985645031167807618140682');
      let stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '2314997029221565363583');
      assert.equal(stakeAndClaimStatus.status, '1');

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '11574985146107826817913',
      );

      await vault.joinPool(pid, deployer, deployer, {
        assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
        maxAmountsIn: [ether(1e6), ether(1e6)],
        userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [1, [ether(1e6), ether(1e6)]]),
        fromInternalBalance: false,
      });

      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), '1194814009204339958264554');

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '797685002970778434636417');
      assert.equal(stakeAndClaimStatus.status, '2');

      assert.equal(await connector.getPendingRewards(), '1265970536445079147102');

      const secondStake = await assetManager.pokeFromReporter('1', false, '0x');
      assert.equal(await assetManager.getUnderlyingStaked(), '1588516024934246094512545');
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), '397129006233561523628137');
      assert.equal(await lusd.balanceOf(vault.address), '397129006233561523628137');
      assert.equal(await assetManager.getUnderlyingTotal(), '1985645031167807618140682');
      const timeSpent1 =
        (await web3.eth.getBlock(secondStake.receipt.blockNumber)).timestamp -
        (await web3.eth.getBlock(firstStake.receipt.blockNumber)).timestamp;
      assert.equal(await connector.getPendingRewards(), '0');

      await time.increase(time.duration.minutes(60));

      let lastWithdrawRes = await staking.withdraw('0', { from: alice });
      const timeSpent2 =
        (await web3.eth.getBlock(lastWithdrawRes.receipt.blockNumber)).timestamp -
        (await web3.eth.getBlock(secondStake.receipt.blockNumber)).timestamp;
      const lqtyPerSecond = ether('0.17559594735236413');
      approximatelyEqual(
        await connector.getPendingRewards(),
        toBN(lqtyPerSecond).mul(toBN((timeSpent1 + timeSpent2).toString())),
      );

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '11574985146107827410711',
      );

      let minClaimAmount = await connector.unpackClaimParams((await assetManager.connectors(0)).claimParams || '0x');
      let stakeParams = await connector.unpackStakeParams((await assetManager.connectors(0)).stakeParams || '0x');
      assert.equal(minClaimAmount, '0');
      assert.equal(stakeParams.maxETHOnStaking, '0');
      assert.equal(stakeParams.minLUSDToDistribute, '0');
      await assetManager.setClaimParams('0', await connector.packClaimParams(ether('10')), {from: piGov});
      await assetManager.setStakeParams('0', await connector.packStakeParams(ether('0.1'), ether('1000')), {from: piGov});

      minClaimAmount = await connector.unpackClaimParams((await assetManager.connectors(0)).claimParams);
      stakeParams = await connector.unpackStakeParams((await assetManager.connectors(0)).stakeParams);
      assert.equal(minClaimAmount, ether('10'));
      assert.equal(stakeParams.maxETHOnStaking, ether('0.1'));
      assert.equal(stakeParams.minLUSDToDistribute, ether('1000'));
      await time.increase(time.duration.minutes(60));
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'NOTHING_TO_DO');
      assert.equal(await connector.isClaimAvailable((await assetManager.connectors(0)).claimParams), true);

      let underlyingStaked = await connector.getUnderlyingStakedWithShares();
      assert.equal(underlyingStaked.shares, '1565265736462611586167109');
      assert.equal(await lqty.balanceOf(pvp), '0');
      const res = await assetManager.pokeFromReporter(0, true, '0x');
      underlyingStaked = await connector.getUnderlyingStakedWithShares();
      assert.equal(underlyingStaked.shares, '1566856098808651890937915');
      assert.equal(await lqty.balanceOf(pvp), '569641911827476325685');
      assert.equal(await connector.isClaimAvailable((await assetManager.connectors(0)).claimParams), false);

      await vault.swap(
        {
          poolId: pid,
          kind: '0',
          assetIn: ausd.address,
          assetOut: lusd.address,
          amount: ether(100),
          userData: '0x',
        },
        {
          sender: deployer,
          fromInternalBalance: false,
          recipient: deployer,
          toInternalBalance: false,
        },
        '0',
        (await web3.eth.getBlock(res.receipt.blockNumber)).timestamp + 100,
      );

      await time.increase(time.duration.minutes(60));
      assert.equal(await connector.isClaimAvailable((await assetManager.connectors(0)).claimParams), false);

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '11574985146107827411314',
      );

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', true);
      assert.equal(stakeAndClaimStatus.status, '1');
      assert.equal(stakeAndClaimStatus.diff, '402413009079281972718');

      assert.equal(await lusd.balanceOf(pvp), '0');
      await assetManager.pokeFromReporter(0, true, '0x');
      underlyingStaked = await connector.getUnderlyingStakedWithShares();
      assert.equal(underlyingStaked.shares, '1564748740500732319476838');
      assert.equal(await lusd.balanceOf(pvp), '1736247771916174112495');
      assert.equal(await lqty.balanceOf(pvp), '569641911827476325685');

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '592603',
      );
    });
  });
});
