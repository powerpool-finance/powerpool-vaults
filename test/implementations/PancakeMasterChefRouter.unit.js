const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('./../helpers');
const { buildBasicRouterConfig, buildPancakeMasterChefRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const PancakeMasterChefIndexRouter = artifacts.require('PancakeMasterChefIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockPoke = artifacts.require('MockPoke');

const PancakeMasterChef = artifactFromBytecode('bsc/PancakeMasterChef');
const PancakeSyrupPool = artifactFromBytecode('bsc/PancakeSyrupPool');

MockERC20.numberFormat = 'String';
PancakeMasterChefIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe('PancakeMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let cake, syrupPool, masterChef, poolRestrictions, piCake, myRouter, poke;

  beforeEach(async function () {
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

    poolRestrictions = await PoolRestrictions.new();
    piCake = await WrappedPiErc20.new(cake.address, stub, 'Wrapped CAKE', 'piCAKE');

    poke = await MockPoke.new(true);
    myRouter = await PancakeMasterChefIndexRouter.new(
      piCake.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        masterChef.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildPancakeMasterChefRouterConfig(cake.address),
    );

    await syrupPool.transferOwnership(masterChef.address);
    await piCake.changeRouter(myRouter.address, { from: stub });
    await masterChef.add(20306, cake.address, false);
    await myRouter.transferOwnership(piGov);

    assert.equal(await myRouter.owner(), piGov);
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

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(piCake.address), ether(2000));
        assert.equal(await cake.balanceOf(masterChef.address), ether(8000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await cake.balanceOf(piCake.address), ether('8.499372088'));
          assert.equal(await cake.balanceOf(masterChef.address), ether(10000));
          const userInfo = await masterChef.userInfo(0, piCake.address);
          assert.equal(userInfo.amount, ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await myRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
          });
          assert.equal(await cake.balanceOf(piCake.address), ether('5008.499372088000000000'));
          const userInfo = await masterChef.userInfo(0, piCake.address);
          assert.equal(userInfo.amount, ether(5000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
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

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
      assert.equal(await cake.balanceOf(piCake.address), ether(2000));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await myRouter.redeem(ether(8000), { from: piGov });
      await myRouter.setVotingAndStaking(masterChef.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await cake.balanceOf(masterChef.address), ether(42000));
      assert.equal(await cake.balanceOf(piCake.address), ether('10001.359899530000000000'));
      assert.equal(await piCake.balanceOf(alice), ether(10000));
      assert.equal(await piCake.totalSupply(), ether(10000));
      await piCake.withdraw(ether(1000), { from: alice });
      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'STAKING_IS_NULL');
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), {
          from: piGov,
        });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await myRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(50800));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8800));
        assert.equal(await cake.balanceOf(piCake.address), ether('2208.159397207200000000'));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piCake.withdraw(ether(1000), { from: alice });
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(49200));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(7200));
        assert.equal(await cake.balanceOf(piCake.address), ether('1806.799497670400000000'));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromReporter(0, false, '0x'), 'MIN_INTERVAL_NOT_REACHED');
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
        assert.equal(await cake.balanceOf(piCake.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await cake.transfer(piCake.address, ether(1000), { from: alice });

        assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
        assert.equal(await cake.balanceOf(piCake.address), ether(3000));

        const res = await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        expectEvent(res, 'DistributeReward', {
          totalReward: ether('3.199763608'),
        });

        assert.equal(await cake.balanceOf(masterChef.address), ether(50800));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8800));
        assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await myRouter.getUnderlyingReserve(), ether('2202.7197990668'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(11000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11002.7197990668'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('2.7197990668'));
        assert.equal(await cake.balanceOf(piCake.address), ether('2202.7197990668'));

        await time.increase(time.duration.hours(10));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('11002.7197990668'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11002.7197990668'));
      });
    });

    describe('edge RRs', async () => {
      it('should stake all the underlying tokens with 0 RR', async () => {
        await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await cake.balanceOf(masterChef.address), ether(52000));
        assert.equal(await cake.balanceOf(piCake.address), ether('2.7197990668'));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await cake.balanceOf(masterChef.address), ether(42000));
        assert.equal(await cake.balanceOf(piCake.address), ether('10002.7197990668'));
      });
    });
  });
});
