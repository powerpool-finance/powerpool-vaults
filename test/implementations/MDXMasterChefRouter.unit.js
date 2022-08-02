const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber, deployContractWithBytecode, pokeFromReporter } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MDXChefPowerIndexConnector = artifacts.require('MasterChefPowerIndexConnector');
const PowerIndexVaultRouter = artifacts.require('PowerIndexVaultRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockERC20 = artifacts.require('MockERC20');

const BoardRoomMDX = artifactFromBytecode('bsc/BoardRoomMDX');
const BakeryToken = artifactFromBytecode('bsc/MdxToken');

MDXChefPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
PowerIndexVaultRouter.numberFormat = 'String';

const { web3 } = WrappedPiErc20;

describe('MDXMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let mdx, boardRoomMDX, poolRestrictions, piMdx, myRouter, connector, poke, cvp;

  beforeEach(async function () {
    cvp = await MockERC20.new('CVP', 'CVP', 18, ether(10e6.toString()));

    // bsc: 0x9c65ab58d8d978db963e63f2bfb7121627e3a739
    mdx = await BakeryToken.new();

    // bsc: 0x6aee12e5eb987b3be1ba8e621be7c4804925ba68
    boardRoomMDX = await BoardRoomMDX.new(mdx.address, 28800);
    await mdx.addMinter(deployer);
    await mdx.mint(deployer, ether('10000000'));

    poolRestrictions = await MockPoolRestrictions.new();
    piMdx = await WrappedPiErc20.new(mdx.address, stub, 'Wrapped MDX', 'piMDX');

    poke = await deployContractWithBytecode('ppagent/ppagent', web3, [
      deployer, // owner_,
      cvp.address, // cvp_,
      ether(1e3), // minKeeperCvp_,
      '60', // pendingWithdrawalTimeoutSeconds_
    ]);

    myRouter = await PowerIndexVaultRouter.new(
      piMdx.address,
      mdx.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        boardRoomMDX.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        60 * 60,
        '0',
        pvp,
        ether('0.15'),
      ),
    );

    connector = await MDXChefPowerIndexConnector.new(boardRoomMDX.address, mdx.address, piMdx.address, '0');
    await myRouter.setConnectorList([
      {
        connector: connector.address,
        share: ether(1),
        callBeforeAfterPoke: false,
        newConnector: true,
        connectorIndex: 0,
      },
    ]);

    await piMdx.changeRouter(myRouter.address, { from: stub });
    await boardRoomMDX.add(10000, mdx.address, true);
    await myRouter.transferOwnership(piGov);
    await mdx.transferOwnership(boardRoomMDX.address);

    // setting up rewards
    await mdx.approve(boardRoomMDX.address, ether(518400));
    const mdxPerBlock = ether(12);
    const startBlock = await latestBlockNumber();
    await boardRoomMDX.newReward(ether(518400), mdxPerBlock, startBlock);

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
        await mdx.transfer(alice, ether('10000'));
        await mdx.approve(piMdx.address, ether('10000'), { from: alice });
        await piMdx.deposit(ether('10000'), { from: alice });

        await pokeFromReporter(poke);

        assert.equal(await mdx.balanceOf(piMdx.address), ether(2000));
        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(526400));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake('0', ether(2000), { from: piGov });
          const stake = MDXChefPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Stake')[0];
          assert.equal(stake.args.sender, piGov);
          assert.equal(stake.args.amount, ether(2000));
          assert.equal(await mdx.balanceOf(piMdx.address), ether('10.2'));
          assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(528388));
          const userInfo = await boardRoomMDX.userInfo(0, piMdx.address);
          assert.equal(userInfo.amount, ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.stake('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await myRouter.redeem('0', ether(3000), { from: piGov });
          const redeem = MDXChefPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Redeem',
          )[0];
          assert.equal(redeem.args.sender, piGov);
          assert.equal(redeem.args.amount, ether(3000));
          assert.equal(await mdx.balanceOf(piMdx.address), ether('5010.2'));
          const userInfo = await boardRoomMDX.userInfo(0, piMdx.address);
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
      await mdx.transfer(alice, ether('20000'));
      await mdx.approve(piMdx.address, ether('10000'), { from: alice });
      await piMdx.deposit(ether('10000'), { from: alice });

      // bob
      await mdx.transfer(bob, ether('42000'));
      await mdx.approve(boardRoomMDX.address, ether('42000'), { from: bob });

      await boardRoomMDX.deposit(0, ether('42000'), { from: bob });

      await pokeFromReporter(poke);

      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(518400 + 50000));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(2000));
    });

    it('should increase reserve on deposit', async () => {
      await time.increase(time.duration.minutes(61));

      assert.equal(await piMdx.balanceOf(alice), ether(10000));
      await mdx.approve(piMdx.address, ether(1000), { from: alice });
      await piMdx.deposit(ether(1000), { from: alice });
      await pokeFromReporter(poke);

      assert.equal(await piMdx.balanceOf(alice), ether(11000));
      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('569192.32'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether('2206.528'));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
      assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8800));
    });

    it('should decrease reserve on withdrawal', async () => {
      await time.increase(time.duration.minutes(61));

      assert.equal(await piMdx.balanceOf(alice), ether(10000));

      await piMdx.withdraw(ether(1000), { from: alice });
      await pokeFromReporter(poke);

      assert.equal(await piMdx.balanceOf(alice), ether(9000));
      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('567594.24'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether('1804.896'));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(7200));
      assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(7200));
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

    describe('rebalancing intervals', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), 60 * 60, time.duration.hours(1), {
          from: piGov,
        });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await mdx.approve(piMdx.address, ether(1000), { from: alice });
        await piMdx.deposit(ether(1000), { from: alice });
        await pokeFromReporter(poke);
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piMdx.withdraw(ether(1000), { from: alice });
        await pokeFromReporter(poke);

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('567592.32'));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(7200));
        assert.equal(await mdx.balanceOf(piMdx.address), ether('1806.528'));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await mdx.approve(piMdx.address, ether(1000), { from: alice });
        await piMdx.deposit(ether(1000), { from: alice });
        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
      });
    });

    describe('on poke', async () => {
      beforeEach(async () => {
        await time.increase(time.duration.minutes(61));
      });

      it('should do nothing when nothing has changed', async () => {
        await expectRevert(pokeFromReporter(poke), 'NOTHING_TO_DO');
      });

      it('should increase reserve if required', async () => {
        await mdx.transfer(piMdx.address, ether(1000), { from: alice });

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(568400));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8000));
        assert.equal(await mdx.balanceOf(piMdx.address), ether(3000));

        const res = await pokeFromReporter(poke);
        const distributeRewards = MDXChefPowerIndexConnector.decodeLogs(res.logs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('5.76'));

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('569194.240000000000000000'));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8800));
        assert.equal(await mdx.balanceOf(piMdx.address), ether('2204.896'));

        assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await myRouter.getAssetsHolderUnderlyingBalance(), ether('2204.896'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(11000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11004.896'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('4.896'));
        assert.equal(await mdx.balanceOf(piMdx.address), ether('2204.896'));

        await time.increase(time.duration.hours(10));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('11004.896'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('11004.896'));
      });
    });

    describe('edge RRs', () => {
      beforeEach(async () => {
        await time.increase(time.duration.minutes(61));
      });

      it('should stake all the underlying tokens with 0 RR', async () => {
        await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 60 * 60, 0, { from: piGov });

        let stakeAndClaimStatus = await myRouter.getStakeAndClaimStatusByConnectorIndex('0', false);
        assert.equal(stakeAndClaimStatus.diff, '2000000000000000000000');
        assert.equal(stakeAndClaimStatus.status, '2');
        assert.equal(stakeAndClaimStatus.forceRebalance, false);

        await pokeFromReporter(poke);
        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('570394.240000000000000000'));
        assert.equal(await mdx.balanceOf(piMdx.address), ether('4.896'));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 60 * 60, 0, { from: piGov });

        await pokeFromReporter(poke);
        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('560394.240000000000000000'));
        assert.equal(await mdx.balanceOf(piMdx.address), ether('10004.896'));
      });
    });
  });
});
