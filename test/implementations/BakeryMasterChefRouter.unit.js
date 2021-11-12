const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const BakeryChefPowerIndexConnector = artifacts.require('BakeryChefPowerIndexConnector');
const PowerIndexRouter = artifacts.require('PowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockPoke = artifacts.require('MockPoke');

const BakeryMasterChef = artifactFromBytecode('bsc/BakeryMasterChef');
const BakeryToken = artifactFromBytecode('bsc/BakeryToken');

BakeryChefPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = WrappedPiErc20;

const REPORTER_ID = 42;

describe('BakeryMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let bake, bakeryChef, poolRestrictions, piBake, myRouter, connector, poke;

  beforeEach(async function () {
    // bsc: 0xe02df9e3e622debdd69fb838bb799e3f168902c5
    bake = await BakeryToken.new('BakeryToken', 'BAKE');

    // bsc: 0x20ec291bb8459b6145317e7126532ce7ece5056f
    bakeryChef = await BakeryMasterChef.new(
      bake.address,
      // devAddress
      deployer,
      // bakeStartBlock - BAKE tokens created first block
      ether(400),
      // startBlock
      await latestBlockNumber(),
      // bonusEndBlock
      (await latestBlockNumber()) + 1000,
      // bonusBeforeBulkBlockSize
      300,
      // bonusBeforeCommonDifference
      ether(10),
      // bonusEndCommonDifference
      ether(10),
    );
    await bake.mintTo(deployer, ether('10000000'));

    poolRestrictions = await PoolRestrictions.new();
    piBake = await WrappedPiErc20.new(bake.address, stub, 'Wrapped BAKE', 'piBAKE');

    poke = await MockPoke.new(true);
    myRouter = await PowerIndexRouter.new(
      piBake.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        bakeryChef.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
      ),
    );

    connector = await BakeryChefPowerIndexConnector.new(bakeryChef.address, bake.address, piBake.address);

    await myRouter.setConnectorList([
      {
        connector: connector.address,
        share: ether(1),
        callBeforeAfterPoke: false,
        newConnector: true,
        connectorIndex: 0,
      },
    ]);

    await piBake.changeRouter(myRouter.address, { from: stub });
    await bakeryChef.add(20306, bake.address, false);
    await myRouter.transferOwnership(piGov);
    await bake.transferOwnership(bakeryChef.address);

    assert.equal(await myRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await myRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await bake.transfer(alice, ether('10000'));
        await bake.approve(piBake.address, ether('10000'), { from: alice });
        await piBake.deposit(ether('10000'), { from: alice });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(piBake.address), ether(2000));
        assert.equal(await bake.balanceOf(bakeryChef.address), ether(8000));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake('0', ether(2000), { from: piGov });
          const stake = BakeryChefPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Stake',
          )[0];
          assert.equal(stake.args.sender, piGov);
          assert.equal(stake.args.amount, ether(2000));
          assert.equal(await bake.balanceOf(piBake.address), ether('340'));
          assert.equal(await bake.balanceOf(bakeryChef.address), ether(10000));
          const userInfo = await bakeryChef.poolUserInfoMap(bake.address, piBake.address);
          assert.equal(userInfo.amount, ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.stake('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await myRouter.redeem('0', ether(3000), { from: piGov });
          const redeem = BakeryChefPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Redeem',
          )[0];
          assert.equal(redeem.args.sender, piGov);
          assert.equal(redeem.args.amount, ether(3000));
          assert.equal(await bake.balanceOf(piBake.address), ether(5340));
          const userInfo = await bakeryChef.poolUserInfoMap(bake.address, piBake.address);
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
      await bake.transfer(alice, ether('20000'));
      await bake.approve(piBake.address, ether('10000'), { from: alice });
      await piBake.deposit(ether('10000'), { from: alice });

      // bob
      await bake.transfer(bob, ether('42000'));
      await bake.approve(bakeryChef.address, ether('42000'), { from: bob });
      await bakeryChef.deposit(bake.address, ether('42000'), { from: bob });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
      assert.equal(await bake.balanceOf(piBake.address), ether(2000));
    });

    it('should ignore rebalancing if the connector address is 0', async () => {
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

    describe('rebalancing intervals', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.1'), ether('0.3'), time.duration.hours(1), {
          from: piGov,
        });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await myRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('53219.047619048000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8800));
        assert.equal(await bake.balanceOf(piBake.address), ether('2523.8095238092'));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piBake.withdraw(ether(1000), { from: alice });
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('51282.539682544000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(7200));
        assert.equal(await bake.balanceOf(piBake.address), ether('2069.8412698376'));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromReporter(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
        assert.equal(await bake.balanceOf(piBake.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await bake.transfer(piBake.address, ether(1000), { from: alice });

        assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
        assert.equal(await bake.balanceOf(piBake.address), ether(3000));

        const res = await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        const distributeRewards = BakeryChefPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('126.984126984'));

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('51873.015873016000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8800));
        assert.equal(await bake.balanceOf(piBake.address), ether('2307.9365079364'));

        assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await myRouter.getUnderlyingReserve(), ether('2307.9365079364'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(11000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11107.9365079364'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('107.9365079364'));
        assert.equal(await bake.balanceOf(piBake.address), ether('2307.9365079364'));

        await time.increase(time.duration.hours(10));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('11107.9365079364'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11107.9365079364'));
      });
    });

    describe('edge RRs', async () => {
      it('should stake all the underlying tokens with 0 RR', async () => {
        await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await bake.balanceOf(bakeryChef.address), ether('53073.015873016000000000'));
        assert.equal(await bake.balanceOf(piBake.address), ether('107.9365079364'));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await bake.balanceOf(bakeryChef.address), ether('43073.015873016000000000'));
        assert.equal(await bake.balanceOf(piBake.address), ether('10107.9365079364'));
      });
    });
  });
});
