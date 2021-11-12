const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, newCompContract, attachCompContract, fetchLogs } = require('../helpers');
const { buildBasicRouterConfig, buildVenusRouterConfig } = require('../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const VenusVBep20SupplyConnector = artifacts.require('VenusVBep20SupplyConnector');
const PowerIndexRouter = artifacts.require('PowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockPoke = artifacts.require('MockPoke');
const MockOracle = artifacts.require('MockOracle');

MockERC20.numberFormat = 'String';
VenusVBep20SupplyConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const Unitroller = artifactFromBytecode('bsc/Unitroller');
const ComptrollerV1 = artifactFromBytecode('bsc/ComptrollerV1');
const VBep20Delegate = artifactFromBytecode('bsc/VBep20Delegate');
const VBep20Delegator = artifactFromBytecode('bsc/VBep20Delegator');
const WhitePaperInterestRateModel = artifactFromBytecode('bsc/WhitePaperInterestRateModel');

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe('VenusRouter Tests', () => {
  let bob, alice, charlie, venusOwner, piGov, stub, pvp;

  before(async function () {
    [, bob, alice, charlie, venusOwner, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let trollerV5, oracle, usdc, xvs, vUsdc, interestRateModel, poolRestrictions, piUsdc, venusRouter, connector, poke, cake, vCake;

  beforeEach(async function () {
    // bsc: 0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63
    xvs = await MockERC20.new('Venus', 'XVS', '18', ether(1e14));

    // bsc: 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
    usdc = await MockERC20.new('USD Coin', 'USDC', 18, ether('10000000'));
    cake = await MockERC20.new('Pancake', 'CAKE', 18, ether('10000000'));

    // bsc: 0x9e47c4f8654edfb45bc81e7e320c8fc1ad0acb73
    interestRateModel = await WhitePaperInterestRateModel.new(
      // baseRatePerYear
      0,
      // multiplierPerYear
      ether('90'),
    );

    // bsc: 0xd8b6da2bfec71d684d3e2a2fc9492ddad5c3787f
    oracle = await MockOracle.new();
    const replacement = xvs.address.substring(2).toLowerCase();
    const ComptrollerV5 = artifactFromBytecode('bsc/ComptrollerV5', [
      { substr: 'cf6bb5389c92bdda8a3747ddb454cb7a64626c63', newSubstr: replacement },
    ]);

    // bsc: 0xfD36E2c2a6789Db23113685031d7F16329158384 -> (0xb49416b2fb86eed9152f6a53c02bf34c965e8436:V4)
    const comptrollerV1 = await ComptrollerV1.new();
    const comptrollerV5 = await ComptrollerV5.new();
    const unitroller = await newCompContract(Unitroller);
    const trollerV3 = await attachCompContract(ComptrollerV1, unitroller.address);
    trollerV5 = await attachCompContract(ComptrollerV5, unitroller.address);

    // bump to V1
    await unitroller._setPendingImplementation(comptrollerV1.address);
    await comptrollerV1._become(unitroller.address);

    // bsc: 0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8
    const vUsdcImpl = await VBep20Delegate.new();
    vUsdc = await newCompContract(
      VBep20Delegator,
      // address underlying_,
      usdc.address,
      // ComptrollerInterface comptroller_,
      unitroller.address,
      // InterestRateModel interestRateModel_,
      interestRateModel.address,
      // uint initialExchangeRateMantissa_,
      ether(1),
      // string memory name_,
      'Venus USDC',
      // string memory symbol_,
      'vUSDC',
      // uint8 decimals_,
      8,
      // address payable admin_,
      venusOwner,
      // address implementation_,
      vUsdcImpl.address,
      // bytes memory becomeImplementationData
      '0x',
    );
    vCake = await newCompContract(
      VBep20Delegator,
      // address underlying_,
      cake.address,
      // ComptrollerInterface comptroller_,
      unitroller.address,
      // InterestRateModel interestRateModel_,
      interestRateModel.address,
      // uint initialExchangeRateMantissa_,
      ether(1),
      // string memory name_,
      'Venus CAKE',
      // string memory symbol_,
      'vCAKE',
      // uint8 decimals_,
      8,
      // address payable admin_,
      venusOwner,
      // address implementation_,
      vUsdcImpl.address,
      // bytes memory becomeImplementationData
      '0x',
    );

    poolRestrictions = await PoolRestrictions.new();
    piUsdc = await WrappedPiErc20.new(usdc.address, stub, 'Wrapped USDC', 'piUSDC');
    poke = await MockPoke.new(true);
    venusRouter = await PowerIndexRouter.new(
      piUsdc.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        vUsdc.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
      )
    );

    connector = await VenusVBep20SupplyConnector.new(
      vUsdc.address,
      cake.address,
      piUsdc.address,
      unitroller.address,
    );
    await venusRouter.setConnectorList([{connector: connector.address, share: ether(1), callBeforeAfterPoke: true, newConnector: true, connectorIndex: 0}]);

    await piUsdc.changeRouter(venusRouter.address, { from: stub });

    await oracle.setPrice(usdc.address, ether(1));
    await oracle.setPrice(cake.address, ether(20));
    await oracle.setWrapper(vUsdc.address, usdc.address);
    await oracle.setWrapper(vCake.address, cake.address);

    await trollerV3._setPriceOracle(oracle.address);
    await trollerV3._supportMarket(vUsdc.address);
    await trollerV3._supportMarket(vCake.address);
    await trollerV3._setVenusRate(ether(600000));
    await trollerV3._setMaxAssets(10);
    await trollerV3._addVenusMarkets([vUsdc.address]);
    await trollerV3._setCollateralFactor(vUsdc.address, ether(0.8));
    await trollerV3._setCollateralFactor(vCake.address, ether(0.8));

    await trollerV3.enterMarkets([vUsdc.address, vCake.address], { from: bob });
    await trollerV3.enterMarkets([vUsdc.address, vCake.address], { from: charlie });

    // bump to V5
    await unitroller._setPendingImplementation(comptrollerV5.address);
    await comptrollerV5._become(unitroller.address);
    await trollerV5._setVenusSpeed(vUsdc.address, ether(300000));

    await venusRouter.initRouterByConnector('0');

    await usdc.transfer(bob, ether(42000));
    await usdc.approve(vUsdc.address, ether(42000), { from: bob });
    await vUsdc.mint(ether(42000), { from: bob });

    await cake.transfer(charlie, ether(5000));
    await cake.approve(vCake.address, ether(5000), { from: charlie });
    await vCake.mint(ether(5000), { from: charlie });

    await venusRouter.transferOwnership(piGov);

    assert.equal(await venusRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await venusRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await usdc.transfer(alice, ether('10000'));
        await usdc.approve(piUsdc.address, ether('10000'), { from: alice });
        await piUsdc.deposit(ether('10000'), { from: alice });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await venusRouter.stake('0', ether(2000), { from: piGov });

          const stake = VenusVBep20SupplyConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Stake')[0];
          assert.equal(stake.args.sender, piGov);
          assert.equal(stake.args.amount, ether(2000));
          assert.equal(await usdc.balanceOf(piUsdc.address), ether(0));
          assert.equal(await usdc.balanceOf(vUsdc.address), ether(52000));
          assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(10000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(venusRouter.stake('0', ether(0), { from: piGov }), 'CANT_STAKE_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(venusRouter.stake('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await venusRouter.redeem('0', ether(3000), { from: piGov });
          const redeem = VenusVBep20SupplyConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Redeem')[0];
          assert.equal(redeem.args.sender, piGov);
          assert.equal(redeem.args.amount, ether(3000));
          assert.equal(await usdc.balanceOf(piUsdc.address), ether(5000));
          assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(5000));
          assert.equal(await usdc.balanceOf(vUsdc.address), ether(47000));
        });

        it('should deny redeeming 0', async () => {
          await expectRevert(venusRouter.redeem('0', ether(0), { from: piGov }), 'CANT_REDEEM_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(venusRouter.redeem('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });

    describe('setPerformanceFee()', () => {
      it('should allow the owner setting a new performanceFee', async () => {
        const res = await venusRouter.setPerformanceFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPerformanceFee', {
          performanceFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(
          venusRouter.setPerformanceFee(ether('1'), { from: piGov }),
          'PERFORMANCE_FEE_OVER_THE_LIMIT',
        );
      });

      it('should deny non-owner setting a new performanceFee', async () => {
        await expectRevert(
          venusRouter.setPerformanceFee(ether('0'), { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await usdc.transfer(alice, ether(100000));
      await usdc.approve(piUsdc.address, ether(10000), { from: alice });
      await piUsdc.deposit(ether(10000), { from: alice });

      await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
      assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
    });

    describe('non-modified vToken ratio', () => {
      it('should increase reserve on deposit', async () => {
        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });

        const res = await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        await expectEvent.notEmitted.inTransaction(res.tx, VenusVBep20SupplyConnector, 'DistributePerformanceFee');

        assert.equal(await piUsdc.balanceOf(alice), ether(11000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50800));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8800));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2200));
      });

      it('should decrease reserve on withdrawal', async () => {
        assert.equal(await piUsdc.balanceOf(alice), ether(10000));

        await piUsdc.withdraw(ether(1000), { from: alice });

        const res = await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        await expectEvent.notEmitted.inTransaction(res.tx, VenusVBep20SupplyConnector, 'DistributePerformanceFee');

        assert.equal(await piUsdc.balanceOf(alice), ether(9000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(49200));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(7200));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1800));
      });

      it('should revert rebalancing if the staking address is 0', async () => {
        await venusRouter.redeem('0', ether(8000), { from: piGov });
        await expectRevert(venusRouter.setConnectorList([{connector: constants.ZERO_ADDRESS, share: ether(1), callBeforeAfterPoke: false, newConnector: false, connectorIndex: 0}], { from: piGov }), 'CONNECTOR_IS_NULL');
      });
    });

    describe('modified vToken ratio', () => {
      beforeEach(async () => {
        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await connector.getTokenForVToken(ether(3160)), ether(3160));

        // #4. USDC reserve increase 50K -> 80K (+60%)
        await time.advanceBlock(1000);
        await usdc.transfer(vUsdc.address, ether(30000));
        await time.advanceBlock(1000);
        await time.increase(time.duration.years(2));
        await vUsdc.accrueInterest();

        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        assert.equal(await piUsdc.totalSupply(), ether(10000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(80000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await vUsdc.totalSupply(), ether(50000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(12800));
        assert.equal(await connector.getTokenForVToken(ether(2000)), ether(3200));
        assert.equal(await connector.getTokenForVToken(ether(1)), ether('1.6'));
        assert.equal(await venusRouter.getUnderlyingEquivalentForPi(ether(1), ether(10000)), ether('1.48'));
      });

      it('should mint a smaller amount of vToken', async () => {
        // #5. Alice deposits 1K USDC
        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });

        // Changed
        assert.equal(await piUsdc.balanceOf(alice), ether('10675.675675675675675675'));
        assert.equal(await piUsdc.totalSupply(), ether('10675.675675675675675675'));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(3000));

        // Not changed
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await vUsdc.totalSupply(), ether(50000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(80000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(12800));

        // #6. Poke
        const res = await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        const distributePerformanceFee = VenusVBep20SupplyConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'DistributePerformanceFee')[0];
        // console.log('VenusVBep20SupplyConnector.decodeLogs(res.receipt.rawLogs)', VenusVBep20SupplyConnector.decodeLogs(res.receipt.rawLogs));
        assert.equal(distributePerformanceFee.args.performanceFeeDebtBefore, '0');
        assert.equal(distributePerformanceFee.args.performanceFeeDebtAfter, '0');
        assert.equal(distributePerformanceFee.args.underlyingBalance, ether(3000));
        assert.equal(distributePerformanceFee.args.performance, ether(720));

        // Changed
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(3016));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(79264));
        assert.equal(await vUsdc.totalSupply(), ether(49540));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(7540));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(12064));
        assert.equal(await venusRouter.getUnderlyingReserve(), ether(3016));
        assert.equal(await venusRouter.calculateLockedProfit(), ether(4080));
        assert.equal(await venusRouter.getUnderlyingAvailable(), ether(12064 + 3016 - 4080));
        await time.increase(7 * 3600);
        assert.equal(await venusRouter.getUnderlyingAvailable(), ether(12064 + 3016));

        // Not changed
        assert.equal(await piUsdc.balanceOf(alice), ether('10675.675675675675675675'));
        assert.equal(await piUsdc.totalSupply(), ether('10675.675675675675675675'));
        assert.equal(await venusRouter.getTokenForVToken(ether(2000)), ether(3200));
      });

      it('should decrease reserve on withdrawal', async () => {
        // #5. Alice withdraws 1K USDC
        await piUsdc.withdraw(ether(1000), { from: alice });

        // Changed
        assert.equal(await piUsdc.balanceOf(alice), ether('9324.324324324324324325'));
        assert.equal(await piUsdc.totalSupply(), ether('9324.324324324324324325'));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1000));

        // Not changed
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await vUsdc.totalSupply(), ether(50000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(80000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(12800));

        // #6. Poke
        const res = await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        const redeem = VenusVBep20SupplyConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Redeem')[0];
        assert.equal(redeem.args.amount, ether(2336));

        // Changed
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(77664));
        assert.equal(await vUsdc.totalSupply(), ether(48540));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(6540));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2616));
        assert.equal(await venusRouter.calculateLockedProfit(), ether(4080));
        assert.equal(await venusRouter.getUnderlyingReserve(), ether(2616));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(10464));
        assert.equal(await venusRouter.getUnderlyingAvailable(), ether(2616 + 10464 - 4080));

        await time.increase(7 * 3600);
        assert.equal(await venusRouter.getUnderlyingAvailable(), ether(2616 + 10464));

        // Not changed
        assert.equal(await piUsdc.balanceOf(alice), ether('9324.324324324324324325'));
        assert.equal(await piUsdc.totalSupply(), ether('9324.324324324324324325'));
        assert.equal(await venusRouter.getTokenForVToken(ether(3160)), ether(5056));
      });
    });

    describe('rebalancing intervals', () => {
      beforeEach(async () => {
        await venusRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), {
          from: piGov,
        });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2));
        await time.increase(time.duration.minutes(61));
        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      });

      it('should DO rebalance if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });
        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50800));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8800));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piUsdc.withdraw(ether(1000), { from: alice });
        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(49200));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(7200));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1800));
      });

      it("should NOT rebalance if the rebalancing interval hasn't passed", async () => {
        await time.increase(time.duration.minutes(59));

        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });

        assert.equal(await venusRouter.getStakeStatusForBalance(ether(8000), ether(1)).then(s => s.forceRebalance), false);
        await expectRevert(venusRouter.pokeFromReporter('0', false, '0x', { from: bob }), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');

        await time.increase(60);

        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });
      });

      it('should rebalance if the rebalancing interval not passed but reserveRatioToForceRebalance has reached', async () => {
        await time.increase(time.duration.minutes(60));

        assert.equal(await venusRouter.getStakeStatusForBalance(ether('8000'), ether(1)).then(s => s.forceRebalance), false);
        assert.equal(await venusRouter.getStakeStatusForBalance(ether('3000'), ether(1)).then(s => s.forceRebalance), true);
        await piUsdc.withdraw(ether(2000), { from: alice });
        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(48400));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(6400));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1600));
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await usdc.transfer(piUsdc.address, ether(1000), { from: alice });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(3000));
        assert.equal(await piUsdc.totalSupply(), ether(10000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await venusRouter.getUnderlyingReserve(), ether(3000));
        assert.equal(await venusRouter.getUnderlyingAvailable(), ether(11000));

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50800));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8800));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2200));
        assert.equal(await piUsdc.totalSupply(), ether(10000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await venusRouter.getUnderlyingReserve(), ether(2200));
        assert.equal(await venusRouter.getUnderlyingAvailable(), ether(11000));
      });
    });

    describe('edge RRs', async () => {
      it('should stake all the underlying tokens with 0 RR', async () => {
        await venusRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(52000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(0));
      });

      it('should keep all the underlying tokens on piToken with 1 RR', async () => {
        await venusRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(42000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(10000));
      });
    });
  });

  describe.skip('XVS reward claim', () => {
    beforeEach(async () => {
      await venusRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), 60, { from: piGov });
    });

    it('should claim XVS reward if there is one', async () => {
      await xvs.transfer(trollerV5.address, ether(5000000));

      await usdc.transfer(alice, ether(100000));
      await usdc.approve(piUsdc.address, ether(100000), { from: alice });
      await piUsdc.deposit(ether(100000), { from: alice });
      await vUsdc.borrow(ether(20000), { from: charlie });

      await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      await time.advanceBlock(200);
      await time.increase(time.duration.years(2));
      await vUsdc.accrueInterest();

      let res = await venusRouter.pokeFromReporter(REPORTER_ID, true, '0x');
      expectEvent(res, 'ClaimRewards', {
        xvsEarned: '945230516270856776834532',
      });
    });

    it('should revert if there is nothing to claim', async () => {
      await time.increase(100);
      await expectRevert(venusRouter.pokeFromReporter(REPORTER_ID, true, '0x'), 'NO_XVS_CLAIMED');
    });
  });
});
