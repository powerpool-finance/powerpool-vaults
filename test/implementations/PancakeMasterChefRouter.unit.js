const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber, deployContractWithBytecode, pokeFromReporter, mineBlock } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const PancakeMasterChefIndexConnector = artifacts.require('PancakeMasterChefIndexConnector');
const PowerIndexVaultRouter = artifacts.require('PowerIndexVaultRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');

const PancakeMasterChef = artifactFromBytecode('bsc/PancakeMasterChef');
const PancakeSyrupPool = artifactFromBytecode('bsc/PancakeSyrupPool');

MockERC20.numberFormat = 'String';
PancakeMasterChefIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
PowerIndexVaultRouter.numberFormat = 'String';

const { web3 } = MockERC20;

describe('PancakeMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let cvp, cake, syrupPool, masterChef, poolRestrictions, piCake, myRouter, connector, poke;

  beforeEach(async function () {
    cvp = await MockERC20.new('CVP', 'CVP', '18', ether('10000000'));
    // bsc: 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82
    cake = await MockERC20.new('PancakeSwap Token', 'Cake', '18', ether('10000000'));
    // bsc: 0x009cf7bc57584b7998236eff51b98a168dcea9b0
    syrupPool = await PancakeSyrupPool.new(cake.address);
    // bsc: 0x73feaa1ee314f8c655e354234017be2193c9e24e
    masterChef = await PancakeMasterChef.new(
      cake.address,
      syrupPool.address,
      deployer,
      ether(40),
      await latestBlockNumber(),
    );

    poolRestrictions = await MockPoolRestrictions.new();
    piCake = await WrappedPiErc20.new(cake.address, stub, 'Wrapped CAKE', 'piCAKE');

    poke = await deployContractWithBytecode('ppagent/ppagent', web3, [
      deployer, // owner_,
      cvp.address, // cvp_,
      ether(1e3), // minKeeperCvp_,
      '60', // pendingWithdrawalTimeoutSeconds_
    ]);
    myRouter = await PowerIndexVaultRouter.new(
      piCake.address,
      cake.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        masterChef.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        60 * 60,
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
    );

    connector = await PancakeMasterChefIndexConnector.new(masterChef.address, cake.address, piCake.address);
    await myRouter.setConnectorList([
      {
        connector: connector.address,
        share: ether(1),
        callBeforeAfterPoke: false,
        newConnector: true,
        connectorIndex: 0,
      },
    ]);

    await myRouter.setClaimParams('0', await connector.packClaimParams(ether(4)), { from: deployer });

    await syrupPool.transferOwnership(masterChef.address);
    await piCake.changeRouter(myRouter.address, { from: stub });
    await masterChef.add(20306, cake.address, false);
    await myRouter.transferOwnership(piGov);

    assert.equal(await myRouter.owner(), piGov);

    let res = await poke.registerJob({
      jobAddress: myRouter.address,
      jobSelector: '0xbce0a8b3',
      useJobOwnerCredits: false,
      assertResolverSelector: true,
      maxBaseFeeGwei: '10',
      rewardPct: '10',
      fixedReward: '1000',
      jobMinCvp: ether(2000),
      calldataSource: '2',
      intervalSeconds: '0'
    }, {
      resolverAddress: myRouter.address,
      resolverCalldata: '0x39e055aa' // agentResolver
    }, '0x', {from: piGov});

    await poke.depositJobCredits(res.logs[0].args.jobKey, {from: piGov, value: ether(10)});

    await cvp.approve(poke.address, ether(2000), { from: deployer });
    await poke.registerAsKeeper(deployer, ether(2000), {from: deployer});
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await myRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await cake.transfer(alice, ether('10000'));
        await cake.approve(piCake.address, ether('10000'), { from: alice });
        await piCake.deposit(ether('10000'), { from: alice });

        await pokeFromReporter(poke);

        assert.equal(await cake.balanceOf(piCake.address), ether(2000));
        assert.equal(await cake.balanceOf(masterChef.address), ether(8000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake('0', ether(2000), { from: piGov });
          const stake = PancakeMasterChefIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Stake',
          )[0];
          assert.equal(stake.args.sender, piGov);
          assert.equal(stake.args.amount, ether(2000));
          assert.equal(await cake.balanceOf(piCake.address), ether('8.499372088'));
          assert.equal(await cake.balanceOf(masterChef.address), ether(10000));
          const userInfo = await masterChef.userInfo(0, piCake.address);
          assert.equal(userInfo.amount, ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.stake('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await myRouter.redeem('0', ether(3000), { from: piGov });
          const redeem = PancakeMasterChefIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Redeem',
          )[0];
          assert.equal(redeem.args.sender, piGov);
          assert.equal(redeem.args.amount, ether(3000));
          assert.equal(await cake.balanceOf(piCake.address), ether('5008.499372088000000000'));
          const userInfo = await masterChef.userInfo(0, piCake.address);
          assert.equal(userInfo.amount, ether(5000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.redeem('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });

    describe('setPerformanceFee()', () => {
      it('should allow the owner setting a new performanceFee', async () => {
        const res = await myRouter.setPerformanceFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPerformanceFee', {
          performanceFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(myRouter.setPerformanceFee(ether('1'), { from: piGov }), 'PERFORMANCE_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new performanceFee', async () => {
        await expectRevert(myRouter.setPerformanceFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      // alice
      await cake.transfer(alice, ether('20000'));
      await cake.approve(piCake.address, ether('10000'), { from: alice });
      await piCake.deposit(ether('10000'), { from: alice });

      // bob
      await cake.transfer(bob, ether('42000'));
      await cake.approve(masterChef.address, ether('42000'), { from: bob });
      await masterChef.enterStaking(ether('42000'), { from: bob });

      await pokeFromReporter(poke);

      assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
      assert.equal(await cake.balanceOf(piCake.address), ether(2000));
    });

    it('should allow explicitly claiming rewards', async () => {
      await time.increase(time.duration.years(1));
      await mineBlock();
      console.log('getPendingRewards', await connector.getPendingRewards());
      assert.equal(await myRouter.calculateLockedProfit(), ether(0));
      await pokeFromReporter(poke);
      let data = await myRouter.connectors(0);
      let rewards = await connector.unpackStakeData(data.stakeData);
      assert.equal(await rewards.lockedProfit, ether('4.0796986036'));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await myRouter.redeem('0', ether(8000), { from: piGov });
      await expectRevert(
        myRouter.setConnectorList(
          [
            {
              connector: constants.ZERO_ADDRESS,
              share: ether(1),
              callBeforeAfterPoke: false,
              newConnector: false,
              connectorIndex: 0,
            },
          ],
          { from: piGov },
        ),
        'CONNECTOR_IS_NULL',
      );
    });

    describe('rebalanceing intervals', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), time.duration.hours(1), {
          from: piGov,
        });
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piCake.withdraw(ether(1000), { from: alice });
        await pokeFromReporter(poke);

        assert.equal(await cake.balanceOf(masterChef.address), ether(49200));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(7200));
        assert.equal(await cake.balanceOf(piCake.address), ether('1805.4395981336'));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await myRouter.setClaimParams('0', await connector.packClaimParams(ether(100)), { from: piGov });

        await time.increase(time.duration.minutes(50));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
      });
    });

    describe('on poke', async () => {
      beforeEach(async () => {
        await time.increase(time.duration.minutes(61));
      });

      it('should do nothing when nothing has changed', async () => {
        let stakeAndClaimStatus = await myRouter.getStakeAndClaimStatusByConnectorIndex('0', true);
        assert.equal(stakeAndClaimStatus.status, '0');
        assert.equal(stakeAndClaimStatus.diff, '0');
        assert.equal(stakeAndClaimStatus.forceRebalance, false);
        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
      });

      it('should increase reserve if required', async () => {
        await cake.transfer(piCake.address, ether(1000), { from: alice });

        assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
        assert.equal(await cake.balanceOf(piCake.address), ether(3000));

        const res = await pokeFromReporter(poke);
        const distributeRewards = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('4.799645416'));

        assert.equal(await cake.balanceOf(masterChef.address), ether(50800));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8800));
        assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await myRouter.getAssetsHolderUnderlyingBalance(), ether('2204.0796986036'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(11000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11004.0796986036'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('4.0796986036'));
        assert.equal(await cake.balanceOf(piCake.address), ether('2204.0796986036'));

        await time.increase(time.duration.hours(10));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('11004.0796986036'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11004.0796986036'));
      });
    });

    describe('edge RRs', async () => {
      beforeEach(async () => {
        await time.increase(time.duration.minutes(61));
      });

      it('should stake all the underlying tokens with 0 RR', async () => {
        await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 60 * 60, 0, { from: piGov });

        await pokeFromReporter(poke);
        assert.equal(await cake.balanceOf(masterChef.address), ether(52000));
        assert.equal(await cake.balanceOf(piCake.address), ether('4.0796986036'));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 60 * 60, 0, { from: piGov });

        await pokeFromReporter(poke);
        assert.equal(await cake.balanceOf(masterChef.address), ether(42000));
        assert.equal(await cake.balanceOf(piCake.address), ether('10004.0796986036'));
      });
    });
  });

  describe('two connectors', () => {
    let secondConnector, secondMasterChef;

    async function addSecondConnector() {
      const secondSyrupPool = await PancakeSyrupPool.new(cake.address);
      secondMasterChef = await PancakeMasterChef.new(
        cake.address,
        secondSyrupPool.address,
        deployer,
        ether(40),
        await latestBlockNumber(),
      );
      secondConnector = await PancakeMasterChefIndexConnector.new(
        secondMasterChef.address,
        cake.address,
        piCake.address,
      );
      await myRouter.setConnectorList(
        [
          {
            connector: connector.address,
            share: ether(0.4),
            callBeforeAfterPoke: false,
            newConnector: false,
            connectorIndex: 0,
          },
          {
            connector: secondConnector.address,
            share: ether(0.6),
            callBeforeAfterPoke: false,
            newConnector: true,
            connectorIndex: 0,
          },
        ],
        { from: piGov },
      );

      await secondSyrupPool.transferOwnership(secondMasterChef.address);
    }

    beforeEach(async () => {
      await cake.transfer(alice, ether('10000'));
      await cake.approve(piCake.address, ether('10000'), { from: alice });
      await piCake.deposit(ether('10000'), { from: alice });
    });

    it('should allow poke with two connectors', async () => {
      await addSecondConnector();

      const res = await pokeFromReporter(poke);

      assert.equal(await cake.balanceOf(piCake.address), ether(2000));
      assert.equal(await cake.balanceOf(masterChef.address), ether(3200));
      assert.equal(await cake.balanceOf(secondMasterChef.address), ether(4800));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(3200));
      assert.equal((await secondMasterChef.userInfo(0, piCake.address)).amount, ether(4800));

      const stakes = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Stake');
      assert.equal(stakes[0].args.sender, poke.address);
      assert.equal(stakes[0].args.staking, masterChef.address);
      assert.equal(stakes[0].args.underlying, cake.address);
      assert.equal(stakes[0].args.amount, ether(3200));
      assert.equal(stakes[1].args.sender, poke.address);
      assert.equal(stakes[1].args.staking, secondMasterChef.address);
      assert.equal(stakes[1].args.underlying, cake.address);
      assert.equal(stakes[1].args.amount, ether(4800));
    });

    it('should allow second poke with two connectors', async () => {
      await myRouter.setClaimParams('0', await connector.packClaimParams(ether(1)), { from: piGov });
      let res = await pokeFromReporter(poke);

      assert.equal(await cake.balanceOf(piCake.address), ether(2000));
      assert.equal(await cake.balanceOf(masterChef.address), ether(8000));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));

      let stakes = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Stake');
      assert.equal(stakes.length, 1);
      assert.equal(stakes[0].args.sender, poke.address);
      assert.equal(stakes[0].args.staking, masterChef.address);
      assert.equal(stakes[0].args.underlying, cake.address);
      assert.equal(stakes[0].args.amount, ether(8000));

      await addSecondConnector();

      await time.increase(time.duration.minutes(61));

      res = await pokeFromReporter(poke);

      assert.equal(await cake.balanceOf(piCake.address), ether(2059.4956046364));
      assert.equal(await cake.balanceOf(masterChef.address), ether(3200));
      assert.equal(await cake.balanceOf(secondMasterChef.address), ether(4800));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(3200));
      assert.equal((await secondMasterChef.userInfo(0, piCake.address)).amount, ether(4800));

      let redeems = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Redeem');
      assert.equal(redeems.length, 1);
      assert.equal(redeems[0].args.sender, poke.address);
      assert.equal(redeems[0].args.staking, masterChef.address);
      assert.equal(redeems[0].args.underlying, cake.address);
      assert.equal(redeems[0].args.amount, ether(4800));

      stakes = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Stake');
      assert.equal(stakes.length, 1);
      assert.equal(stakes[0].args.sender, poke.address);
      assert.equal(stakes[0].args.staking, secondMasterChef.address);
      assert.equal(stakes[0].args.underlying, cake.address);
      assert.equal(stakes[0].args.amount, ether(4800));

      await expectRevert(
        myRouter.setConnectorList(
          [
            {
              connector: connector.address,
              share: ether(0.9),
              callBeforeAfterPoke: false,
              newConnector: false,
              connectorIndex: '0',
            },
          ],
          { from: piGov },
        ),
        'TOTAL_SHARE_IS_NOT_HUNDRED_PCT',
      );

      await myRouter.setConnectorList(
        [
          {
            connector: connector.address,
            share: ether(0.9),
            callBeforeAfterPoke: false,
            newConnector: false,
            connectorIndex: '0',
          },
          {
            connector: secondConnector.address,
            share: ether(0.1),
            callBeforeAfterPoke: false,
            newConnector: false,
            connectorIndex: '1',
          },
        ],
        { from: piGov },
      );

      await time.increase(time.duration.minutes(61));

      res = await pokeFromReporter(poke);

      assert.equal(await cake.balanceOf(piCake.address), ether(2181.8966092888));
      assert.equal(await cake.balanceOf(masterChef.address), ether(7242.836835338208));
      assert.equal(await cake.balanceOf(secondMasterChef.address), ether(804.759648370912));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(7242.836835338208));
      assert.equal((await secondMasterChef.userInfo(0, piCake.address)).amount, ether(804.759648370912));

      redeems = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Redeem');
      assert.equal(redeems.length, 1);
      assert.equal(redeems[0].args.sender, poke.address);
      assert.equal(redeems[0].args.staking, secondMasterChef.address);
      assert.equal(redeems[0].args.underlying, cake.address);
      assert.equal(redeems[0].args.amount, ether(3995.240351629088));

      stakes = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Stake');
      assert.equal(stakes.length, 1);
      assert.equal(stakes[0].args.sender, poke.address);
      assert.equal(stakes[0].args.staking, masterChef.address);
      assert.equal(stakes[0].args.underlying, cake.address);
      assert.equal(stakes[0].args.amount, ether(4042.836835338208));

      await cake.transfer(alice, ether('10000'));
      await cake.approve(piCake.address, ether('10000'), { from: alice });
      await piCake.deposit(ether('10000'), { from: alice });

      await time.increase(time.duration.minutes(61));

      res = await pokeFromReporter(poke);

      assert.equal(await cake.balanceOf(piCake.address), ether('4258.39547905199599623'));
      assert.equal(await cake.balanceOf(masterChef.address), ether('14565.2350269585024'));
      assert.equal(await cake.balanceOf(secondMasterChef.address), ether('1618.3594474398336'));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether('14565.2350269585024'));
      assert.equal((await secondMasterChef.userInfo(0, piCake.address)).amount, ether('1618.3594474398336'));

      stakes = PancakeMasterChefIndexConnector.decodeLogs(res.logs).filter(l => l.event === 'Stake');
      assert.equal(stakes.length, 2);
      assert.equal(stakes[0].args.sender, poke.address);
      assert.equal(stakes[0].args.staking, masterChef.address);
      assert.equal(stakes[0].args.underlying, cake.address);
      assert.equal(stakes[0].args.amount, ether('7322.3981916202944'));

      assert.equal(stakes[1].args.sender, poke.address);
      assert.equal(stakes[1].args.staking, secondMasterChef.address);
      assert.equal(stakes[1].args.underlying, cake.address);
      assert.equal(stakes[1].args.amount, ether('813.5997990689216'));
    });
  });
});
