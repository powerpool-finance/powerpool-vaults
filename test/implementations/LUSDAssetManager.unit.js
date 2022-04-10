const { time, constants, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, zeroAddress, maxUint256, fromEther, deployContractWithBytecode } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const MockWETH = artifacts.require('MockWETH');
const BProtocolPowerIndexConnector = artifacts.require('BProtocolPowerIndexConnector');
const AssetManager = artifacts.require('AssetManager');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const MockPoke = artifacts.require('MockPoke');
const StablePoolFactory = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePoolFactory');
const StablePool = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePool');

const MockChainLinkPriceOracle = artifacts.require('MockChainLinkPriceOracle');
const BAMM = artifacts.require('BAMM');

MockERC20.numberFormat = 'String';
BProtocolPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
AssetManager.numberFormat = 'String';

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe.only('LUSDAssetManager Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let lusd, lqty, weth, troveManager, stabilityPool, activePool, defaultPool, collSurplusPool, borrowerOperations, lqtyStaking, priceFeed, sortedTroves, communityIssuance, authorizer, vault, stablePoolFactory, staking, governance, poolRestrictions, piTorn, assetManager, connector, poke;

  const GAS_TO_REINVEST = 1e6;
  const GAS_PRICE = 100 * 1e9;
  const pauseWindowDuration = 7776000;
  const bufferPeriodDuration = 2592000;

  beforeEach(async function () {
    weth = await MockWETH.new();

    // mainnet: 0xa39739ef8b0231dbfa0dcda07d7e29faabcf4bb2
    troveManager = await deployContractWithBytecode('liquidity/TroveManager', web3, []);
    // mainnet: 0x66017d22b0f8556afdd19fc67041899eb65a21bb
    stabilityPool = await deployContractWithBytecode('liquidity/StabilityPool', web3, []);
    // mainnet: 0xdf9eb223bafbe5c5271415c75aecd68c21fe3d7f
    activePool = await deployContractWithBytecode('liquidity/ActivePool', web3, []);
    // mainnet: 0x896a3f03176f05cfbb4f006bfcd8723f2b0d741c
    defaultPool = await deployContractWithBytecode('liquidity/DefaultPool', web3, []);
    // mainnet: 0x3D32e8b97Ed5881324241Cf03b2DA5E2EBcE5521
    collSurplusPool = await deployContractWithBytecode('liquidity/CollSurplusPool', web3, []);
    // mainnet: 0x24179cd81c9e782a4096035f7ec97fb8b783e007
    borrowerOperations = await deployContractWithBytecode('liquidity/BorrowerOperations', web3, []);
    // mainnet: 0x4f9fbb3f1e99b56e0fe2892e623ed36a76fc605d
    lqtyStaking = await deployContractWithBytecode('liquidity/LqtyStaking', web3, []);
    // mainnet: 0x4c517d4e2c851ca76d7ec94b805269df0f2201de
    priceFeed = await deployContractWithBytecode('liquidity/PriceFeed', web3, []);
    // mainnet: 0x8fdd3fbfeb32b28fb73555518f8b361bcea741a6
    sortedTroves = await deployContractWithBytecode('liquidity/SortedTroves', web3, []);
    // mainnet: 0xd8c9d9071123a059c6e0a945cf0e0c82b508d816
    communityIssuance = await deployContractWithBytecode('liquidity/CommunityIssuance', web3, []);
    // mainnet: 0x5f98805a4e8be255a32880fdec7f6728c6568ba0
    lusd = await deployContractWithBytecode('liquidity/LUSDToken', web3, [troveManager.address, stabilityPool.address, borrowerOperations.address]);
    // mainnet: 0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d                                                                          // fake contract
    lqty = await deployContractWithBytecode('liquidity/LqtyToken', web3, [communityIssuance.address, lqtyStaking.address, weth.address, stub, stub, piGov]);

    await troveManager.setAddresses(
      borrowerOperations.address,
      activePool.address,
      defaultPool.address,
      stabilityPool.address,
      weth.address, // fake contract
      collSurplusPool.address,
      priceFeed.address,
      lusd.address,
      sortedTroves.address,
      lqty.address,
      lqtyStaking.address
    );

    await borrowerOperations.setAddresses(
      troveManager.address,
      activePool.address,
      defaultPool.address,
      stabilityPool.address,
      weth.address, // fake contract
      collSurplusPool.address,
      priceFeed.address,
      sortedTroves.address,
      lusd.address,
      lqtyStaking.address
    );

    await stabilityPool.setAddresses(
      borrowerOperations.address,
      troveManager.address,
      activePool.address,
      lusd.address,
      sortedTroves.address,
      priceFeed.address,
      communityIssuance.address
    );

    await activePool.setAddresses(
      borrowerOperations.address,
      troveManager.address,
      stabilityPool.address,
      defaultPool.address
    );

    await defaultPool.setAddresses(
      troveManager.address,
      activePool.address
    );

    await collSurplusPool.setAddresses(
      borrowerOperations.address,
      troveManager.address,
      activePool.address
    );

    await lqtyStaking.setAddresses(
      lqty.address,
      lusd.address,
      troveManager.address,
      borrowerOperations.address,
      activePool.address
    );

    const ethUsdPriceOracle = await MockChainLinkPriceOracle.new(300000000000);
    const lusdUsdPriceOracle = await MockChainLinkPriceOracle.new(100400000);

    await priceFeed.setAddresses(
      ethUsdPriceOracle.address,
      weth.address, // fake contract
    );

    await sortedTroves.setParams(
      maxUint256,
      troveManager.address,
      borrowerOperations.address
    );

    await communityIssuance.setAddresses(
      lqty.address,
      stabilityPool.address
    );

    // mainnet: 0x00ff66ab8699aafa050ee5ef5041d1503aa0849a
    const bamm = await BAMM.new(
      ethUsdPriceOracle.address,
      lusdUsdPriceOracle.address,
      stabilityPool.address,
      lusd.address,
      lqty.address,
      400,
      weth.address, // fake contract
      zeroAddress
    );
    await bamm.setParams(20, 100);

    // mainnet: 0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6
    authorizer = await deployContractWithBytecode('balancerV3/Authorizer', web3, [piGov]);
    // mainnet: 0xba12222222228d8ba445958a75a0704d566bf2c8
    vault = await deployContractWithBytecode('balancerV3/Vault', web3, [authorizer.address, weth.address, pauseWindowDuration, bufferPeriodDuration]);
    // mainnet: 0xc66Ba2B6595D3613CCab350C886aCE23866EDe24
    stablePoolFactory = await StablePoolFactory.new(vault.address);

    await authorizer.grantRoles(['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'], deployer, {from: piGov});

    poolRestrictions = await MockPoolRestrictions.new();

    poke = await MockPoke.new(true);
    assetManager = await AssetManager.new(
      vault.address,
      lusd.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        bamm.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        0,
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
    );

    const ausd = await MockERC20.new('aUSD', 'aUSD', '18', ether('10000000'), {from: deployer});
    const lusdSecond = web3.utils.toBN(lusd.address).gt(web3.utils.toBN(ausd.address));
    let res = await stablePoolFactory.create(
      "Balancer PP Stable Pool",
      "bb-p-USD",
      lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      lusdSecond ? [zeroAddress, assetManager.address] : [assetManager.address, zeroAddress],
      200,
      5e14,
      deployer
    );

    const pool = await StablePool.at(res.receipt.logs[0].args.pool);

    await assetManager.setAssetsHolder(pool.address);

    await borrowerOperations.openTrove(
      ether(1),
      ether(5e6),
      zeroAddress,
      zeroAddress,
      {value : ether(4e3)}
    );

    // assertEq(IERC20(liquity.lusd()).balanceOf(DEPLOYER), 5e6 ether);

    ausd.approve(vault.address, ether(2e6));
    lusd.approve(vault.address, ether(2e6));

    // assertEq(IERC20(ausd).balanceOf(DEPLOYER), 1e9 ether);
    // assertEq(IERC20(lusd).balanceOf(DEPLOYER), 5e6 ether);

    await vault.joinPool(await pool.getPoolId(), deployer, deployer, {
      assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      maxAmountsIn: [ether(2e6), ether(2e6)],
      userData: web3.eth.abi.encodeParameters(
        ['uint256', 'uint256[]'],
        [0, [ether(2e6), ether(2e6)]],
      ),
      fromInternalBalance: false
    });

    connector = await BProtocolPowerIndexConnector.new(assetManager.address, bamm.address, lusd.address, vault.address, stabilityPool.address, lqty.address, await pool.getPoolId());
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

  describe('owner methods', async () => {
    beforeEach(async () => {
      await assetManager.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await lusd.transfer(alice, ether('10000'));
        await lusd.approve(piTorn.address, ether('10000'), { from: alice });
        await piTorn.deposit(ether('10000'), { from: alice });

        await assetManager.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await lusd.balanceOf(piTorn.address), ether(2000));
        assert.equal(await lusd.balanceOf(governance.address), ether(8000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await assetManager.stake('0', ether(2000), { from: piGov });
          const stake = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Stake',
          )[0];
          assert.equal(stake.args.sender, piGov);
          assert.equal(stake.args.amount, ether(2000));
          assert.equal(await lusd.balanceOf(piTorn.address), ether('0'));
          assert.equal(await lusd.balanceOf(governance.address), ether(10000));
          assert.equal(await governance.lockedBalance(piTorn.address), ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(assetManager.stake('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await assetManager.redeem('0', ether(3000), { from: piGov });
          const redeem = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
            l => l.event === 'Redeem',
          )[0];
          assert.equal(redeem.args.sender, piGov);
          assert.equal(redeem.args.amount, ether(3000));
          assert.equal(await lusd.balanceOf(piTorn.address), ether('5000'));
          assert.equal(await governance.lockedBalance(piTorn.address), ether(5000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(assetManager.redeem('0', ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await lusd.transfer(staking.address, ether('200000'));
      await staking.addBurnRewards(ether('200000'));

      // alice
      await lusd.transfer(alice, ether('20000'));
      await lusd.approve(piTorn.address, ether('10000'), { from: alice });
      await piTorn.deposit(ether('10000'), { from: alice });

      // bob
      await lusd.transfer(bob, ether('42000'));
      await lusd.approve(governance.address, ether('42000'), { from: bob });
      await governance.lockWithApproval(ether('42000'), { from: bob });

      await assetManager.pokeFromReporter(REPORTER_ID, true, '0x');

      assert.equal(await governance.lockedBalance(piTorn.address), ether(8000));
      assert.equal(await lusd.balanceOf(governance.address), ether(50000));
      assert.equal(await lusd.balanceOf(piTorn.address), ether(2000));
    });

    it('should claim rewards and reinvest', async () => {
      const reinvestDuration = 60 * 60;
      const claimParams = await connector.packClaimParams(reinvestDuration, GAS_TO_REINVEST);
      await assetManager.setClaimParams('0', claimParams, {from: piGov});

      await time.increase(time.duration.hours(100));
      await expectRevert(assetManager.pokeFromReporter(REPORTER_ID, true, '0x', {gasPrice: GAS_PRICE}), 'NOTHING_TO_DO');
      await lusd.transfer(staking.address, ether('50000'));
      await staking.addBurnRewards(ether('50000'));

      await expectRevert(assetManager.pokeFromReporter(REPORTER_ID, true, '0x', {gasPrice: GAS_PRICE}), 'NOTHING_TO_DO');

      const c = await assetManager.connectors('0');
      const tornNeedToReinvest = await connector.getTornUsedToReinvest(GAS_TO_REINVEST, GAS_PRICE);
      let {pending, forecastByPending} = await connector.getPendingAndForecastReward(c.lastClaimRewardsAt, c.lastChangeStakeAt, reinvestDuration);

      assert.equal(pending, ether('1600'));
      assert.equal(fromEther(forecastByPending) >= fromEther(tornNeedToReinvest), false);
      assert.equal(await connector.isClaimAvailable(claimParams, c.lastClaimRewardsAt, c.lastChangeStakeAt, {
        gasPrice: GAS_PRICE
      }), false);

      await expectRevert(assetManager.pokeFromReporter(REPORTER_ID, true, '0x', {gasPrice: GAS_PRICE}), 'NOTHING_TO_DO');

      await time.increase(time.duration.hours(100));
      await lusd.transfer(staking.address, ether('100000'));
      await staking.addBurnRewards(ether('100000'));

      await connector.getPendingAndForecastReward(c.lastClaimRewardsAt, c.lastChangeStakeAt, reinvestDuration).then(r => {
        pending = r.pending;
        forecastByPending = r.forecastByPending;
      })
      assert.equal(fromEther(forecastByPending) >= fromEther(tornNeedToReinvest), true);
      assert.equal(await connector.isClaimAvailable(claimParams, c.lastClaimRewardsAt, c.lastChangeStakeAt, {
        gasPrice: GAS_PRICE
      }), true);

      await assetManager.pokeFromReporter(REPORTER_ID, true, '0x', {gasPrice: GAS_PRICE});

      assert.equal(fromEther(await governance.lockedBalance(piTorn.address)) > 11300, true);

      assert.equal(fromEther(await assetManager.calculateLockedProfit()) > 3300, true);
      let rewards = await connector.unpackStakeData(await assetManager.connectors(0).then(r => r.stakeData));
      assert.equal(fromEther(await rewards.lockedProfit, ether('2.7197990668')) > 3300, true);
    });


    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await expectRevert(assetManager.pokeFromReporter(REPORTER_ID, false, '0x'), 'NOTHING_TO_DO');
      });

      it('should increase reserve if required', async () => {
        await lusd.transfer(staking.address, ether('50000'));
        await staking.addBurnRewards(ether('50000'));

        await lusd.transfer(piTorn.address, ether(1000), { from: alice });

        assert.equal(await lusd.balanceOf(governance.address), ether(50000));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(8000));
        assert.equal(await lusd.balanceOf(piTorn.address), ether(3000));

        const res = await assetManager.pokeFromReporter(REPORTER_ID, true, '0x');
        const distributeRewards = TornPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(
          l => l.event === 'DistributeReward',
        )[0];
        assert.equal(distributeRewards.args.totalReward, ether('1600'));

        assert.equal(await lusd.balanceOf(governance.address), ether(52160));
        assert.equal(await governance.lockedBalance(piTorn.address), ether(10160));
        assert.equal(await assetManager.getUnderlyingStaked(), ether(10160));
        assert.equal(await assetManager.getUnderlyingReserve(), ether('2200'));
        assert.equal(await assetManager.getUnderlyingAvailable(), ether(11000));
        assert.equal(await assetManager.getUnderlyingTotal(), ether('12360'));
        assert.equal(await assetManager.calculateLockedProfit(), ether('1360'));
        assert.equal(await lusd.balanceOf(piTorn.address), ether('2200'));

        await time.increase(time.duration.hours(10));
        assert.equal(await assetManager.calculateLockedProfit(), ether(0));
        assert.equal(await assetManager.getUnderlyingAvailable(), ether('12360'));
        assert.equal(await assetManager.getUnderlyingTotal(), ether('12360'));
      });
    });
  });
});
