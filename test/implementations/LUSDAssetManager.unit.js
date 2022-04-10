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
  let deployer, bob, dan, eve, alice, piGov, stub, pvp;

  before(async function () {
    [deployer, bob, alice, dan, eve, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let lusd, lqty, ausd, weth, troveManager, stabilityPool, activePool, defaultPool, collSurplusPool, borrowerOperations, lqtyStaking, priceFeed, sortedTroves, communityIssuance, authorizer, vault, stablePoolFactory, staking, governance, poolRestrictions, assetManager, connector, poke, pid, lusdSecond;

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
    staking = await BAMM.new(
      ethUsdPriceOracle.address,
      lusdUsdPriceOracle.address,
      stabilityPool.address,
      lusd.address,
      lqty.address,
      400,
      weth.address, // fake contract
      zeroAddress
    );
    await staking.setParams(20, 100);

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
        staking.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        0,
        pvp,
        ether('0.15'),
      ),
    );

    ausd = await MockERC20.new('aUSD', 'aUSD', '18', ether(20e6), {from: deployer});
    lusdSecond = web3.utils.toBN(lusd.address).gt(web3.utils.toBN(ausd.address));
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
      {value: ether(4e3)}
    );
    await borrowerOperations.openTrove(
      ether(1),
      ether(7e6),
      zeroAddress,
      zeroAddress,
      {value: ether(3e3), from: eve}
    );

    await ethUsdPriceOracle.setLatestAnswer('190000000000');

    // assertEq(IERC20(liquity.lusd()).balanceOf(DEPLOYER), 5e6 ether);

    ausd.approve(vault.address, maxUint256);
    lusd.approve(vault.address, maxUint256);

    // assertEq(IERC20(ausd).balanceOf(DEPLOYER), 1e9 ether);
    // assertEq(IERC20(lusd).balanceOf(DEPLOYER), 5e6 ether);

    pid = await pool.getPoolId();
    console.log('ausd balance', await ausd.balanceOf(deployer));
    console.log('lusd balance', await lusd.balanceOf(deployer).then(b => b.toString()));

    await vault.joinPool(pid, deployer, deployer, {
      assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      maxAmountsIn: [ether(2e6), ether(2e6)],
      userData: web3.eth.abi.encodeParameters(
        ['uint256', 'uint256[]'],
        [0, [ether(2e6), ether(2e6)]],
      ),
      fromInternalBalance: false
    });

    connector = await BProtocolPowerIndexConnector.new(assetManager.address, staking.address, lusd.address, vault.address, stabilityPool.address, lqty.address, pid);
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
      await lusd.transfer(bob, ether(1e6));
      await lusd.approve(staking.address, ether(1e6), {from: bob});
      await staking.deposit(ether(1e6), {from: bob});
      await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
    });

    it.only('should claim rewards and reinvest', async () => {
      assert.equal(await lusd.balanceOf(vault.address), ether(2e6));
      const firstStake = await assetManager.pokeFromReporter('1', false, '0x');
      console.log('stability pool ETH balance before', await web3.eth.getBalance(stabilityPool.address));
      const res = await troveManager.liquidateTroves(2);
      console.log('stability pool ETH balance after', await web3.eth.getBalance(stabilityPool.address));
      console.log('liquidateTroves', res.receipt.logs);
      return;
      assert.equal(await assetManager.getUnderlyingStaked(), ether(1.6e6));
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether(4e5));
      assert.equal(await lusd.balanceOf(vault.address), ether(4e5));
      assert.equal(await assetManager.getUnderlyingTotal(), ether(2e6));
      await time.increase(time.duration.minutes(59));
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'INTERVAL_NOT_REACHED_OR_NOT_FORCE');
      await time.increase(time.duration.minutes(1));
      let stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '0');
      assert.equal(stakeAndClaimStatus.status, '0');
      await expectRevert(assetManager.pokeFromReporter(0, false, '0x'), 'NOTHING_TO_DO');

      await vault.joinPool(pid, deployer, deployer, {
        assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
        maxAmountsIn: [ether(1e6), ether(1e6)],
        userData: web3.eth.abi.encodeParameters(
          ['uint256', 'uint256[]'],
          [1, [ether(1e6), ether(1e6)]],
        ),
        fromInternalBalance: false
      });

      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether(1.4e6));

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, ether(8e5));
      assert.equal(stakeAndClaimStatus.status, '2');

      assert.equal(await connector.getPendingRewards(), '0');

      const secondStake = await assetManager.pokeFromReporter('1', false, '0x');
      assert.equal(await assetManager.getUnderlyingStaked(), ether(2.4e6));
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether(6e5));
      assert.equal(await lusd.balanceOf(vault.address), ether(6e5));
      assert.equal(await assetManager.getUnderlyingTotal(), ether(3e6));
      console.log('secondStake.receipt.blockNumber - firstStake.receipt.blockNumber', secondStake.receipt.blockNumber - firstStake.receipt.blockNumber)
      assert.equal(await connector.getPendingRewards(), '0');

      let lastWithdrawRes = await staking.withdraw('0', {from: bob});
      console.log('lastWithdrawRes.receipt.blockNumber - secondStake.receipt.blockNumber', lastWithdrawRes.receipt.blockNumber - secondStake.receipt.blockNumber)
      assert.equal(await connector.getPendingRewards(), '0');


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
