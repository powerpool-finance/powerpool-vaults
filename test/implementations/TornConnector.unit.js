const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const TornPowerIndexConnector = artifacts.require('TornPowerIndexConnector');
const PowerIndexRouter = artifacts.require('PowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockPoke = artifacts.require('MockPoke');

const TornGovernance = artifacts.require('TornGovernance');
const TornStaking = artifacts.require('TornStaking');

MockERC20.numberFormat = 'String';
TornPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
PowerIndexRouter.numberFormat = 'String';

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe('PancakeMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let torn, staking, governance, poolRestrictions, piTorn, myRouter, connector, poke;

  beforeEach(async function () {
    // mainnet: 0x77777feddddffc19ff86db637967013e6c6a116c
    torn = await MockERC20.new('Torn', 'Torn', '18', ether('10000000'));
    // mainnet: 0x5efda50f22d34f262c29268506c5fa42cb56a1ce
    governance = await TornGovernance.new(torn.address);
    // mainnet: 0x2fc93484614a34f26f7970cbb94615ba109bb4bf
    staking = await TornStaking.new(governance.address, torn.address);
    await governance.setStaking(staking.address);

    poolRestrictions = await MockPoolRestrictions.new();
    piTorn = await WrappedPiErc20.new(torn.address, stub, 'Wrapped Torn', 'piTorn');

    poke = await MockPoke.new(true);
    myRouter = await PowerIndexRouter.new(
      piTorn.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        staking.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
    );

    await piTorn.changeRouter(myRouter.address, {from: stub});

    connector = await TornPowerIndexConnector.new(staking.address, torn.address, piTorn.address, governance.address);
    await myRouter.setConnectorList([
      {
        connector: connector.address,
        share: ether(1),
        callBeforeAfterPoke: false,
        newConnector: true,
        connectorIndex: 0,
      },
    ]);

    await myRouter.transferOwnership(piGov);
    assert.equal(await myRouter.owner(), piGov);
  });

  describe.only('owner methods', async () => {
    beforeEach(async () => {
      await myRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await torn.transfer(alice, ether('10000'));
        await torn.approve(piTorn.address, ether('10000'), { from: alice });
        await piTorn.deposit(ether('10000'), { from: alice });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await torn.balanceOf(piTorn.address), ether(2000));
        assert.equal(await torn.balanceOf(governance.address), ether(8000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake('0', ether(2000), { from: piGov });
          const stake = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Stake',
          )[0];
          assert.equal(stake.args.sender, piGov);
          assert.equal(stake.args.amount, ether(2000));
          assert.equal(await torn.balanceOf(piTorn.address), ether('0'));
          assert.equal(await torn.balanceOf(governance.address), ether(10000));
          assert.equal(await governance.lockedBalance(piTorn.address), ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.stake('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await myRouter.redeem('0', ether(3000), { from: piGov });
          const redeem = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Redeem',
          )[0];
          assert.equal(redeem.args.sender, piGov);
          assert.equal(redeem.args.amount, ether(3000));
          assert.equal(await torn.balanceOf(piTorn.address), ether('5000'));
          assert.equal(await governance.lockedBalance(piTorn.address), ether(5000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.redeem('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      // alice
      await torn.transfer(alice, ether('20000'));
      await torn.approve(piTorn.address, ether('10000'), { from: alice });
      await piTorn.deposit(ether('10000'), { from: alice });

      // bob
      await torn.transfer(bob, ether('42000'));
      await torn.approve(governance.address, ether('42000'), { from: bob });
      await governance.enterStaking(ether('42000'), { from: bob });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await torn.balanceOf(governance.address), ether(50000));
      assert.equal(await torn.balanceOf(piTorn.address), ether(2000));
    });

    it('should allow explicitly claiming rewards', async () => {
      await time.increase(time.duration.years(1));
      assert.equal(await myRouter.calculateLockedProfit(), ether(0));
      await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
      let data = await myRouter.connectors(0);
      let rewards = await connector.unpackStakeData(data.stakeData);
      assert.equal(await rewards.lockedProfit, ether('2.7197990668'));

      await time.increase(time.duration.years(1));
      assert.equal(await myRouter.calculateLockedProfit(), ether(0));
      await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
      data = await myRouter.connectors(0);
      rewards = await connector.unpackStakeData(data.stakeData);
      assert.equal(await rewards.lockedProfit, ether('2.7197990668'));
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
        await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), {
          from: piGov,
        });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await torn.approve(piTorn.address, ether(1000), { from: alice });
        await piTorn.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await torn.approve(piTorn.address, ether(1000), { from: alice });
        await piTorn.deposit(ether(1000), { from: alice });
        await myRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await torn.balanceOf(governance.address), ether(50800));
        assert.equal((await governance.userInfo(0, piTorn.address)).amount, ether(8800));
        assert.equal(await torn.balanceOf(piTorn.address), ether('2208.159397207200000000'));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piTorn.withdraw(ether(1000), { from: alice });
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await torn.balanceOf(governance.address), ether(49200));
        assert.equal((await governance.userInfo(0, piTorn.address)).amount, ether(7200));
        assert.equal(await torn.balanceOf(piTorn.address), ether('1806.799497670400000000'));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await torn.approve(piTorn.address, ether(1000), { from: alice });
        await piTorn.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromReporter(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await torn.approve(piTorn.address, ether(1000), { from: alice });
        await piTorn.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'NOTHING_TO_DO');
      });

      it('should increase reserve if required', async () => {
        await torn.transfer(piTorn.address, ether(1000), { from: alice });

        assert.equal(await torn.balanceOf(governance.address), ether(50000));
        assert.equal((await governance.userInfo(0, piTorn.address)).amount, ether(8000));
        assert.equal(await torn.balanceOf(piTorn.address), ether(3000));

        const res = await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        const distributeRewards = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('3.199763608'));

        assert.equal(await torn.balanceOf(governance.address), ether(50800));
        assert.equal((await governance.userInfo(0, piTorn.address)).amount, ether(8800));
        assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await myRouter.getUnderlyingReserve(), ether('2202.7197990668'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(11000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11002.7197990668'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('2.7197990668'));
        assert.equal(await torn.balanceOf(piTorn.address), ether('2202.7197990668'));

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
        assert.equal(await torn.balanceOf(governance.address), ether(52000));
        assert.equal(await torn.balanceOf(piTorn.address), ether('2.7197990668'));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await torn.balanceOf(governance.address), ether(42000));
        assert.equal(await torn.balanceOf(piTorn.address), ether('10002.7197990668'));
      });
    });
  });
});
