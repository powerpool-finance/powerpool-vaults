const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber, pokeFromReporter, deployContractWithBytecode } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const BakeryChefPowerIndexConnector = artifacts.require('BakeryChefPowerIndexConnector');
const PowerIndexVaultRouter = artifacts.require('PowerIndexVaultRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockERC20 = artifacts.require('MockERC20');

const BakeryMasterChef = artifactFromBytecode('bsc/BakeryMasterChef');
const BakeryToken = artifactFromBytecode('bsc/BakeryToken');

BakeryChefPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
PowerIndexVaultRouter.numberFormat = 'String';

const { web3 } = WrappedPiErc20;

describe('BakeryMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let bake, bakeryChef, poolRestrictions, piBake, myRouter, connector, poke, cvp;

  beforeEach(async function () {
    cvp = await MockERC20.new('CVP', 'CVP', 18, ether(10e6.toString()));
    // bsc: 0xe02df9e3e622debdd69fb838bb799e3f168902c5
    bake = await BakeryToken.new('BakeryToken', 'BAKE');

    // bsc: 0x20ec291bb8459b6145317e7126532ce7ece5056f
    bakeryChef = await BakeryMasterChef.new(
      bake.address,
      deployer, // devAddress
      ether(400), // bakeStartBlock - BAKE tokens created first block
      await latestBlockNumber(), // startBlock
      (await latestBlockNumber()) + 1000, // bonusEndBlock
      300, // bonusBeforeBulkBlockSize
      ether(10), // bonusBeforeCommonDifference
      ether(10),// bonusEndCommonDifference
    );
    await bake.mintTo(deployer, ether('10000000'));

    poolRestrictions = await MockPoolRestrictions.new();
    piBake = await WrappedPiErc20.new(bake.address, stub, 'Wrapped BAKE', 'piBAKE');

    poke = await deployContractWithBytecode('ppagent/ppagent', web3, [
      deployer, // owner_,
      cvp.address, // cvp_,
      ether(1e3), // minKeeperCvp_,
      '60', // pendingWithdrawalTimeoutSeconds_
    ]);
    myRouter = await PowerIndexVaultRouter.new(
      piBake.address,
      bake.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        bakeryChef.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        60 * 60,
        60 * 60 * 2,
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
        await bake.transfer(alice, ether('10000'));
        await bake.approve(piBake.address, ether('10000'), { from: alice });
        await piBake.deposit(ether('10000'), { from: alice });

        await pokeFromReporter(poke);

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

      await pokeFromReporter(poke);

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
        await myRouter.setReserveConfig(ether('0.2'), ether('0.1'), ether('0.3'), time.duration.hours(1), time.duration.hours(2), {
          from: piGov,
        });
      });

      it('should DO rebalance on withdrawal if the rebalancing interval hasnt passed but meet the lower bound', async () => {
        await time.increase(time.duration.minutes(50));
        assert.equal(await bake.balanceOf(piBake.address), ether('2000'));

        await piBake.withdraw(ether(1500), { from: alice });
        await pokeFromReporter(poke);

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('50546.031746032'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(6800));
        assert.equal(await bake.balanceOf(piBake.address), ether('1915.8730158728'));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));
        assert.equal(await bake.balanceOf(piBake.address), ether('2000'));

        await piBake.withdraw(ether(1000), { from: alice });
        assert.equal(await bake.balanceOf(piBake.address), ether('1000'));
        await pokeFromReporter(poke);

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('50946.031746032000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(7200));
        assert.equal(await bake.balanceOf(piBake.address), ether('2015.8730158728'));
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval hasnt passed but meet the upper bound', async () => {
        await time.increase(time.duration.minutes(50));

        await bake.approve(piBake.address, ether(1500), { from: alice });
        await piBake.deposit(ether(1500), { from: alice });
        await pokeFromReporter(poke);

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('53282.539682544'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(9200));
        assert.equal(await bake.balanceOf(piBake.address), ether('2569.8412698376'));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
      });

      it('should increase reserve if required', async () => {
        await bake.transfer(piBake.address, ether(1000), { from: deployer });

        let stakeAndClaimStatus = await myRouter.getStakeAndClaimStatusByConnectorIndex('0', false);
        assert.equal(stakeAndClaimStatus.diff, '800000000000000000000');
        assert.equal(stakeAndClaimStatus.status, '2');
        assert.equal(stakeAndClaimStatus.forceRebalance, false);

        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
        await bake.transfer(piBake.address, ether(10000), { from: deployer });

        assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
        assert.equal(await bake.balanceOf(piBake.address), ether(13000));

        stakeAndClaimStatus = await myRouter.getStakeAndClaimStatusByConnectorIndex('0', false);
        assert.equal(stakeAndClaimStatus.diff, '8800000000000000000000');
        assert.equal(stakeAndClaimStatus.status, '2');
        assert.equal(stakeAndClaimStatus.forceRebalance, true);

        const res = await pokeFromReporter(poke);
        const distributeRewards = BakeryChefPowerIndexConnector.decodeLogs(res.logs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('253.968253968'));

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('60546.031746032'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(16800));
        assert.equal(await bake.balanceOf(piBake.address), ether('4415.8730158728'));

        assert.equal(await myRouter.getUnderlyingStaked(), ether(16800));
        assert.equal(await myRouter.getAssetsHolderUnderlyingBalance(), ether('4415.8730158728'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(21000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('21215.8730158728'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('215.8730158728'));
        assert.equal(await bake.balanceOf(piBake.address), ether('4415.8730158728'));

        await time.increase(time.duration.hours(10));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('21215.8730158728'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('21215.8730158728'));
      });
    });

    describe('edge RRs', async () => {
      it('should stake all the underlying tokens with 0 RR', async () => {
        await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, 0, { from: piGov });

        await pokeFromReporter(poke);
        assert.equal(await bake.balanceOf(bakeryChef.address), ether('53073.015873016000000000'));
        assert.equal(await bake.balanceOf(piBake.address), ether('107.9365079364'));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, 0, { from: piGov });

        await pokeFromReporter(poke);
        assert.equal(await bake.balanceOf(bakeryChef.address), ether('43073.015873016000000000'));
        assert.equal(await bake.balanceOf(piBake.address), ether('10107.9365079364'));
      });
    });
  });
});
