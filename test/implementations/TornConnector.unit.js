const { time, constants, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, fromEther, latestBlockTimestamp } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const {
  Eip2612PermitUtils,
  Web3ProviderConnector, fromRpcSig,
} = require('@1inch/permit-signed-approvals-utils');

const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20Permit');
const TornPowerIndexConnector = artifacts.require('MockTornPowerIndexConnector');
const PowerIndexVaultRouter = artifacts.require('PowerIndexVaultRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockPoke = artifacts.require('MockPoke');

const TornGovernance = artifacts.require('TornGovernance');
const TornStaking = artifacts.require('TornStaking');

MockERC20.numberFormat = 'String';
TornPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
PowerIndexVaultRouter.numberFormat = 'String';
TornGovernance.numberFormat = 'String';

const { web3 } = MockERC20;

const REPORTER_ID = 42;
const chainId = 31337;

describe('TornConnector Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let torn, staking, governance, poolRestrictions, piTorn, myRouter, connector, poke;

  const GAS_TO_REINVEST = 1e6;
  const GAS_PRICE = 100 * 1e9;

  beforeEach(async function () {
    // mainnet: 0x77777feddddffc19ff86db637967013e6c6a116c
    torn = await MockERC20.new('Torn', 'Torn', '18', ether('10000000'), { from: deployer });
    // mainnet: 0x5efda50f22d34f262c29268506c5fa42cb56a1ce
    governance = await TornGovernance.new(torn.address);
    // mainnet: 0x2fc93484614a34f26f7970cbb94615ba109bb4bf
    staking = await TornStaking.new(governance.address, torn.address);
    await governance.setStaking(staking.address);

    poolRestrictions = await MockPoolRestrictions.new();
    piTorn = await WrappedPiErc20.new(torn.address, stub, 'Wrapped Torn', 'piTorn');

    poke = await MockPoke.new(true);
    myRouter = await PowerIndexVaultRouter.new(
      piTorn.address,
      torn.address,
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
        [pool1, pool2],
      ),
    );

    await piTorn.changeRouter(myRouter.address, { from: stub });

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

    await myRouter.initRouterByConnector('0', '0x');
    await myRouter.transferOwnership(piGov);
    assert.equal(await myRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
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
          const stake = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Stake')[0];
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
          const redeem = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Redeem')[0];
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
      await torn.transfer(staking.address, ether('200000'));
      await staking.addBurnRewards(ether('200000'));

      // alice
      await torn.transfer(alice, ether('20000'));
      await torn.approve(piTorn.address, ether('10000'), { from: alice });
      await piTorn.deposit(ether('10000'), { from: alice });

      // bob
      await torn.transfer(bob, ether('100000'));
      await torn.approve(governance.address, ether('42000'), { from: bob });
      await governance.lockWithApproval(ether('42000'), { from: bob });
    });

    it('should claim rewards and reinvest', async () => {
      await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');

      assert.equal(await governance.lockedBalance(piTorn.address), ether(8000));
      assert.equal(await torn.balanceOf(governance.address), ether(50000));
      assert.equal(await torn.balanceOf(piTorn.address), ether(2000));

      const reinvestDuration = 60 * 60;
      const claimParams = await connector.packClaimParams(reinvestDuration, GAS_TO_REINVEST);
      await myRouter.setClaimParams('0', claimParams, { from: piGov });

      await time.increase(time.duration.hours(100));
      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, true, '0x', { gasPrice: GAS_PRICE }), 'NOTHING_TO_DO');
      await torn.transfer(staking.address, ether('50000'));
      await staking.addBurnRewards(ether('50000'));

      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, true, '0x', { gasPrice: GAS_PRICE }), 'NOTHING_TO_DO');

      const c = await myRouter.connectors('0');
      const tornNeedToReinvest = await connector.getTornUsedToReinvest(GAS_TO_REINVEST, GAS_PRICE);
      let { pending, forecastByPending } = await connector.getPendingAndForecastReward(
        c.lastClaimRewardsAt,
        c.lastChangeStakeAt,
        reinvestDuration,
      );

      assert.equal(pending, ether('1600'));
      assert.equal(fromEther(forecastByPending) >= fromEther(tornNeedToReinvest), false);
      assert.equal(
        await connector.isClaimAvailable(claimParams, c.lastClaimRewardsAt, c.lastChangeStakeAt, {
          gasPrice: GAS_PRICE,
        }),
        false,
      );

      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, true, '0x', { gasPrice: GAS_PRICE }), 'NOTHING_TO_DO');

      await time.increase(time.duration.hours(100));
      await torn.transfer(staking.address, ether('100000'));
      await staking.addBurnRewards(ether('100000'));

      await connector
        .getPendingAndForecastReward(c.lastClaimRewardsAt, c.lastChangeStakeAt, reinvestDuration)
        .then(r => {
          pending = r.pending;
          forecastByPending = r.forecastByPending;
        });
      assert.equal(fromEther(forecastByPending) >= fromEther(tornNeedToReinvest), true);
      assert.equal(
        await connector.isClaimAvailable(claimParams, c.lastClaimRewardsAt, c.lastChangeStakeAt, {
          gasPrice: GAS_PRICE,
        }),
        true,
      );

      await myRouter.pokeFromReporter(REPORTER_ID, true, '0x', { gasPrice: GAS_PRICE });

      assert.equal(fromEther(await governance.lockedBalance(piTorn.address)) > 11300, true);

      assert.equal(fromEther(await myRouter.calculateLockedProfit()) > 3300, true);
      let rewards = await connector.unpackStakeData(await myRouter.connectors(0).then(r => r.stakeData));
      assert.equal(fromEther(await rewards.lockedProfit, ether('2.7197990668')) > 3300, true);
    });

    describe('on poke', async () => {
      beforeEach(async () => {
        await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
      });

      it('should do nothing when nothing has changed', async () => {
        await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'NOTHING_TO_DO');
      });

      it('should increase reserve if required', async () => {
        await torn.transfer(staking.address, ether('50000'));
        await staking.addBurnRewards(ether('50000'));

        await torn.transfer(piTorn.address, ether(1000), { from: alice });

        assert.equal(await torn.balanceOf(governance.address), ether(50000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(8000));
        assert.equal(await torn.balanceOf(piTorn.address), ether(3000));

        const res = await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
        const distributeRewards = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('1600'));

        assert.equal(await torn.balanceOf(governance.address), ether(52160));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(10160));
        assert.equal(await myRouter.getUnderlyingStaked(), ether(10160));
        assert.equal(await myRouter.getAssetsHolderUnderlyingBalance(), ether('2200'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(11000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('12360'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('1360'));
        assert.equal(await torn.balanceOf(piTorn.address), ether('2200'));

        await time.increase(time.duration.hours(10));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('12360'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('12360'));
      });
    });

    describe('on deposit/withdraw', async () => {
      it('should increase reserve if required', async () => {
        let nonce = {};

        await myRouter.enableRouterCallback(piTorn.address, true, {from: piGov});
        await myRouter.setReserveConfig('0', '0', '0', '1000', {from: piGov});

        assert.equal(await torn.balanceOf(piTorn.address), ether('10000'));
        assert.equal(await governance.lockedBalance(piTorn.address), '0');

        let vrs = await getPermitVrs(ether(10000), alice);
        let res = await piTorn.depositWithPermit(ether(10000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: alice});
        // console.log('1 deposit by alice gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(20000));

        await piTorn.withdraw(ether('5000'), { from: alice });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(15000));

        vrs = await getPermitVrs(ether(2000), alice);
        await piTorn.depositWithPermit(ether(2000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: alice});
        // console.log('2 deposit by alice gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(17000));

        vrs = await getPermitVrs(ether(2000), bob);
        await piTorn.depositWithPermit(ether(2000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: bob});
        // console.log('1 deposit by bob gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(19000));

        vrs = await getPermitVrs(ether(1000), bob);
        await piTorn.depositWithPermit(ether(1000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: bob});
        // console.log('2 deposit by bob gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(20000));

        await staking.addBurnRewards(ether('50000'));

        assert.equal(await torn.balanceOf(bob), ether('55000'));
        assert.equal(await piTorn.balanceOf(bob), ether('3000'));
        await expectRevert(piTorn.withdraw(ether('4000'), { from: bob }), 'ERC20: burn amount exceeds balance');
        await piTorn.withdraw(ether('2000'), { from: bob });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(bob), ether('57000'));
        assert.equal(await piTorn.balanceOf(bob), ether('1000'));
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(18000));

        res = await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
        const distributeRewards = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('5000'));

        assert.equal(await torn.balanceOf(governance.address), ether(64250));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(22250));
        assert.equal(await myRouter.getUnderlyingStaked(), ether(22250));
        assert.equal(await myRouter.getAssetsHolderUnderlyingBalance(), ether('0'));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(18000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('22250'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('4250'));
        assert.equal(await torn.balanceOf(piTorn.address), ether('0'));

        await piTorn.withdraw(ether('100'), { from: bob });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(bob), ether('57100'));
        assert.equal(await piTorn.balanceOf(bob), ether('900.001086099314865775'));
        assert.equal(await torn.balanceOf(piTorn.address), '0');
        assert.equal(await governance.lockedBalance(piTorn.address), ether(22150));

        await time.increase(time.duration.hours(10));
        await piTorn.withdraw(ether('100'), { from: bob });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(bob), ether('57200'));
        assert.equal(await piTorn.balanceOf(bob), ether('819.188440112410509722'));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('22050'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('22050'));

        async function getPermitVrs(value, owner) {
          const deadline = (await latestBlockTimestamp()) + 10;
          if(!nonce[owner]) {
            nonce[owner] = 0;
          }
          const permitParams = {
            spender: piTorn.address,
            nonce: nonce[owner],
            owner,
            value,
            deadline,
          };
          nonce[owner]++;

          const connector = new Web3ProviderConnector(web3);
          const eip2612PermitUtils = new Eip2612PermitUtils(connector);
          const signature = await eip2612PermitUtils.buildPermitSignature(
            permitParams,
            chainId,
            'Torn',
            torn.address,
            '1'
          );
          return {
            ...fromRpcSig(signature),
            deadline
          };
        }
      });
    });

    describe('on deposit/withdraw', async () => {
      it('should increase reserve if required', async () => {
        let nonce = {};

        await myRouter.enableRouterCallback(piTorn.address, true, {from: piGov});
        await myRouter.setReserveConfig(ether('0.1'), ether('0.1'), ether('0.1'), '1000', {from: piGov});

        assert.equal(await torn.balanceOf(piTorn.address), ether('10000'));
        assert.equal(await governance.lockedBalance(piTorn.address), '0');

        let vrs = await getPermitVrs(ether(10000), alice);
        await piTorn.depositWithPermit(ether(10000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: alice});
        // console.log('1 deposit by alice gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), ether(2000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(18000));
        assert.equal(await torn.balanceOf(alice), '0');

        await piTorn.withdraw(ether('5000'), { from: alice });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(alice), ether('5000'));
        assert.equal(await torn.balanceOf(piTorn.address), ether(2000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(13000));

        vrs = await getPermitVrs(ether(2000), alice);
        await piTorn.depositWithPermit(ether(2000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: alice});
        // console.log('2 deposit by alice gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), ether(1700));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(15300));

        vrs = await getPermitVrs(ether(2000), bob);
        await piTorn.depositWithPermit(ether(2000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: bob});
        // console.log('1 deposit by bob gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), ether(1900));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(17100));

        vrs = await getPermitVrs(ether(1000), bob);
        await piTorn.depositWithPermit(ether(1000), vrs.deadline, vrs.v, vrs.r, vrs.s, {from: bob});
        // console.log('2 deposit by bob gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(piTorn.address), ether(2000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(18000));

        await staking.addBurnRewards(ether('50000'));

        assert.equal(await torn.balanceOf(bob), ether('55000'));
        assert.equal(await piTorn.balanceOf(bob), ether('3000'));
        await expectRevert(piTorn.withdraw(ether('4000'), { from: bob }), 'ERC20: burn amount exceeds balance');
        await piTorn.withdraw(ether('2000'), { from: bob });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(bob), ether('57000'));
        assert.equal(await piTorn.balanceOf(bob), ether('1000'));
        assert.equal(await torn.balanceOf(piTorn.address), ether(2000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(16000));

        const res = await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
        const distributeRewards = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('4500'));

        assert.equal(await torn.balanceOf(governance.address), ether(62025));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(20025));
        assert.equal(await myRouter.getUnderlyingStaked(), ether(20025));
        assert.equal(await myRouter.getAssetsHolderUnderlyingBalance(), ether(1800));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether(18000));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('21825'));
        assert.equal(await myRouter.calculateLockedProfit(), ether('3825'));
        assert.equal(await torn.balanceOf(piTorn.address), ether(1800));

        await piTorn.withdraw(ether('100'), { from: bob });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(bob), ether('57100'));
        assert.equal(await piTorn.balanceOf(bob), ether('900.000977490445030900'));
        assert.equal(await torn.balanceOf(piTorn.address), ether(2182.5));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(19542.5));

        await time.increase(time.duration.hours(10));
        await piTorn.withdraw(ether('100'), { from: bob });
        // console.log('withdraw gasUsed', res.receipt.gasUsed);
        assert.equal(await torn.balanceOf(bob), ether('57200'));
        assert.equal(await piTorn.balanceOf(bob), ether('817.607417179787056075'));
        assert.equal(await myRouter.calculateLockedProfit(), ether(0));
        assert.equal(await myRouter.getUnderlyingAvailable(), ether('21625'));
        assert.equal(await myRouter.getUnderlyingTotal(), ether('21625'));

        async function getPermitVrs(value, owner) {
          const deadline = (await latestBlockTimestamp()) + 10;
          if(!nonce[owner]) {
            nonce[owner] = 0;
          }
          const permitParams = {
            spender: piTorn.address,
            nonce: nonce[owner],
            owner,
            value,
            deadline,
          };
          nonce[owner]++;

          const connector = new Web3ProviderConnector(web3);
          const eip2612PermitUtils = new Eip2612PermitUtils(connector);
          const signature = await eip2612PermitUtils.buildPermitSignature(
            permitParams,
            chainId,
            'Torn',
            torn.address,
            '1'
          );
          return {
            ...fromRpcSig(signature),
            deadline
          };
        }
      });
    });
  });
});
