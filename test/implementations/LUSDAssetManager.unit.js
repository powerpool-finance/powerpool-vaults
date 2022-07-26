const { time, constants, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, zeroAddress, maxUint256, deployContractWithBytecode } = require('./../helpers');
const { buildBasicRouterConfig } = require('./../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const MockWETH = artifacts.require('MockWETH');
const MockSwapper = artifacts.require('MockSwapper');
const BProtocolPowerIndexConnector = artifacts.require('MockBProtocolConnector');
const AssetManager = artifacts.require('AssetManager');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockPoolRestrictions = artifacts.require('MockPoolRestrictions');
const StablePoolFactory = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePoolFactory');
const StablePool = artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePool');

const MockChainLinkPriceOracle = artifacts.require('MockChainLinkPriceOracle');
const BAMM = artifacts.require('BAMM');

MockERC20.numberFormat = 'String';
BProtocolPowerIndexConnector.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
AssetManager.numberFormat = 'String';
BProtocolPowerIndexConnector.numberFormat = 'String';
StablePool.numberFormat = 'String';

const { web3 } = MockERC20;
const { toBN } = web3.utils;

describe('LUSDAssetManager Tests', () => {
  let deployer, alice, eve, bob, dan, piGov, stub, pvp;

  before(async function () {
    [deployer, alice, eve, bob, dan, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let lusd,
    lqty,
    ausd,
    cvp,
    weth,
    troveManager,
    stabilityPool,
    activePool,
    defaultPool,
    collSurplusPool,
    borrowerOperations,
    lqtyStaking,
    priceFeed,
    sortedTroves,
    communityIssuance,
    authorizer,
    vault,
    stablePoolFactory,
    staking,
    poolRestrictions,
    assetManager,
    connector,
    poke,
    pool,
    pid,
    lusdSecond,
    ethUsdPriceOracle,
    swapper;

  const pauseWindowDuration = 7776000;
  const bufferPeriodDuration = 2592000;

  function approximatelyEqual(num1, num2) {
    num1 = toBN(num1.toString(10));
    num2 = toBN(num2.toString(10));
    assert.equal(
      (num1.gt(num2) ? num1.mul(toBN(ether(1))).div(num2) : num2.mul(toBN(ether(1))).div(num1)).lt(toBN(ether(1.001))),
      true,
    );
  }

  beforeEach(async function () {
    cvp = await MockERC20.new('CVP', 'CVP', 18, ether(10e6.toString()));
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
    lusd = await deployContractWithBytecode('liquidity/LUSDToken', web3, [
      troveManager.address,
      stabilityPool.address,
      borrowerOperations.address,
    ]);
    // mainnet: 0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d                                                                          // fake contract
    lqty = await deployContractWithBytecode('liquidity/LqtyToken', web3, [
      communityIssuance.address,
      lqtyStaking.address,
      weth.address,
      stub,
      stub,
      piGov,
    ]);

    await time.increase(await lqty.ONE_YEAR_IN_SECONDS());

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
      lqtyStaking.address,
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
      lqtyStaking.address,
    );

    await stabilityPool.setAddresses(
      borrowerOperations.address,
      troveManager.address,
      activePool.address,
      lusd.address,
      sortedTroves.address,
      priceFeed.address,
      communityIssuance.address,
    );

    await activePool.setAddresses(
      borrowerOperations.address,
      troveManager.address,
      stabilityPool.address,
      defaultPool.address,
    );

    await defaultPool.setAddresses(troveManager.address, activePool.address);

    await collSurplusPool.setAddresses(borrowerOperations.address, troveManager.address, activePool.address);

    await lqtyStaking.setAddresses(
      lqty.address,
      lusd.address,
      troveManager.address,
      borrowerOperations.address,
      activePool.address,
    );

    swapper = await MockSwapper.new();
    await swapper.setRatio(lqty.address, lusd.address, ether(0.5));
    ethUsdPriceOracle = await MockChainLinkPriceOracle.new(300000000000);
    const lusdUsdPriceOracle = await MockChainLinkPriceOracle.new(100400000);

    await priceFeed.setAddresses(
      ethUsdPriceOracle.address,
      weth.address, // fake contract
    );

    await sortedTroves.setParams(maxUint256, troveManager.address, borrowerOperations.address);

    await communityIssuance.setAddresses(lqty.address, stabilityPool.address);

    // mainnet: 0x00ff66ab8699aafa050ee5ef5041d1503aa0849a
    staking = await BAMM.new(
      ethUsdPriceOracle.address,
      lusdUsdPriceOracle.address,
      stabilityPool.address,
      lusd.address,
      lqty.address,
      400,
      weth.address, // fake contract
      zeroAddress,
    );
    await staking.setParams(20, 100);

    // mainnet: 0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6
    authorizer = await deployContractWithBytecode('balancerV3/Authorizer', web3, [piGov]);
    // mainnet: 0xba12222222228d8ba445958a75a0704d566bf2c8
    vault = await deployContractWithBytecode('balancerV3/Vault', web3, [
      authorizer.address,
      weth.address,
      pauseWindowDuration,
      bufferPeriodDuration,
    ]);
    // mainnet: 0xc66Ba2B6595D3613CCab350C886aCE23866EDe24
    stablePoolFactory = await StablePoolFactory.new(vault.address);

    await authorizer.grantRoles(['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'], deployer, {
      from: piGov,
    });

    poolRestrictions = await MockPoolRestrictions.new();

    // poke = await PPAgentV2.new(
    //   deployer, // owner_,
    //   cvp.address, // cvp_,
    //   ether(1e3), // minKeeperCvp_,
    //   '60', // pendingWithdrawalTimeoutSeconds_
    // );
    poke = await deployContractWithBytecode('ppagent/ppagent', web3, [
      deployer, // owner_,
      cvp.address, // cvp_,
      ether(1e3), // minKeeperCvp_,
      '60', // pendingWithdrawalTimeoutSeconds_
    ]);

    assert.equal(await poke.CVP(), cvp.address);

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
        time.duration.hours(1).toString(),
        0,
        pvp,
        ether('0.15'),
      ),
    );

    ausd = await MockERC20.new('aUSD', 'aUSD', '18', ether(20e6), { from: deployer });
    lusdSecond = web3.utils.toBN(lusd.address).gt(web3.utils.toBN(ausd.address));
    let res = await stablePoolFactory.create(
      'Balancer PP Stable Pool',
      'bb-p-USD',
      lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      lusdSecond ? [zeroAddress, assetManager.address] : [assetManager.address, zeroAddress],
      200,
      5e14,
      deployer,
    );

    pool = await StablePool.at(res.receipt.logs[0].args.pool);

    await web3.eth.sendTransaction({
      from: alice,
      to: deployer,
      value: ether(1e3)
    });
    await web3.eth.sendTransaction({
      from: bob,
      to: deployer,
      value: ether(1e3)
    });
    await web3.eth.sendTransaction({
      from: dan,
      to: deployer,
      value: ether(1e3)
    });

    await borrowerOperations.openTrove(ether(1), ether(2e6), zeroAddress, zeroAddress, { value: ether(3e3) });
    await borrowerOperations.openTrove(ether(1), ether(5e3), zeroAddress, zeroAddress, {
      value: ether(4),
      from: alice,
    });
    await borrowerOperations.openTrove(ether(1), ether(7e3), zeroAddress, zeroAddress, { value: ether(3), from: eve });

    ausd.approve(vault.address, maxUint256);
    lusd.approve(vault.address, maxUint256);

    pid = await pool.getPoolId();

    await assetManager.setPoolInfo(pid, pool.address);

    await vault.joinPool(pid, deployer, deployer, {
      assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
      maxAmountsIn: [ether(2e6), ether(2e6)],
      userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [0, [ether(2e6), ether(2e6)]]),
      fromInternalBalance: false,
    });

    connector = await BProtocolPowerIndexConnector.new(
      assetManager.address,
      staking.address,
      lusd.address,
      vault.address,
      stabilityPool.address,
      lqty.address,
      pid,
      pool.address,
      swapper.address,
    );
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

    res = await poke.registerJob({
      jobAddress: assetManager.address,
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
      resolverAddress: assetManager.address,
      resolverCalldata: '0x39e055aa' // agentResolver
    }, '0x', {from: piGov});

    await poke.depositJobCredits(res.logs[0].args.jobKey, {from: piGov, value: ether(10)});

    await cvp.approve(poke.address, ether(2000), { from: deployer });
    await poke.registerAsKeeper(deployer, ether(2000), {from: deployer});
  });

  async function pokeFromReporter() {
    const jobAddress = assetManager.address;
    const jobId = '000000';
    const jobKey = await poke.getJobKey(jobAddress, jobId);
    const job = await poke.getJob(jobKey);
    const resolverRes = web3.eth.abi.decodeParameters(['bool', 'bytes'], await web3.eth.call({
      to: job.resolver.resolverAddress, // contract address
      data: job.resolver.resolverCalldata
    }));
    console.log('resolverRes', resolverRes);
    const resolverData = resolverRes[1];
    console.log('resolverData', resolverData);
    return web3.eth.sendTransaction({
      from: deployer,
      to: poke.address,
      data: '0x00000000' + jobAddress.replace('0x', '') + jobId + '03' + '000001' + resolverData.replace('0x', ''),
          // '0x      00000000 1b48315d66ba5267aac8d0ab63c49038b56b1dbc 0000f1 03     00001a    402b2eed11'
          // 'name    selector jobContractAddress                       jobId  config keeperId  calldata (optional)'
      gas: '3000000'
    });
  }

  describe('reserve management', () => {
    beforeEach(async () => {
      await lusd.approve(staking.address, ether(1), { from: alice });
      await staking.deposit(ether(1), { from: alice });
      await lusd.transfer(swapper.address, await lusd.balanceOf(alice), {from: alice});
      // await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });

      const res = await lusd.approve(vault.address, await ausd.balanceOf(deployer), { from: deployer });
      await vault.swap(
        {
          poolId: pid,
          kind: '0',
          assetIn: ausd.address,
          assetOut: lusd.address,
          amount: ether(1030000),
          userData: '0x',
        },
        {
          sender: deployer,
          fromInternalBalance: false,
          recipient: deployer,
          toInternalBalance: false,
        },
        '0',
        (await web3.eth.getBlock(res.receipt.blockNumber)).timestamp + 100,
      );

      await lusd.transfer(eve, ether(20000), { from: deployer });
    });

    it('should claim rewards and reinvest', async () => {
      assert.equal(await lusd.balanceOf(vault.address), '974070046021699791322769');
      const firstStake = await pokeFromReporter();
      await expectRevert(pokeFromReporter(), 'NOTHING_TO_DO');
      await time.increase(time.duration.minutes(60));
      let stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '0');
      assert.equal(stakeAndClaimStatus.status, '0');
      assert.equal(stakeAndClaimStatus.forceRebalance, false);
      console.log('NOTHING_TO_DO')
      await expectRevert(pokeFromReporter(), 'NOTHING_TO_DO');

      await ethUsdPriceOracle.setLatestAnswer('190000000000');
      await troveManager.liquidateTroves(2);
      await lusd.approve(staking.address, await lusd.balanceOf(eve), { from: eve });
      // await staking.swap(ether(9000), 0, eve, {from: eve});
      await staking.swap(ether(19000), 0, eve, { from: eve });
      // await borrowerOperations.openTrove(
      //   ether(1),
      //   ether(6e3),
      //   zeroAddress,
      //   zeroAddress,
      //   {value: ether(4), from: charlie}
      // );
      // await borrowerOperations.openTrove(
      //   ether(1),
      //   ether(6e3),
      //   zeroAddress,
      //   zeroAddress,
      //   {value: ether(4), from: dan}
      // );
      // await ethUsdPriceOracle.setLatestAnswer('1000000000');
      // await troveManager.liquidateTroves(2);
      // await staking.swap(ether(9000), 0, eve, {from: eve});
      assert.equal(await assetManager.getUnderlyingStaked(), '790831021963467659876128');
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), '194814009204339958264554');
      assert.equal(await lusd.balanceOf(vault.address), '194814009204339958264554');
      assert.equal(await assetManager.getUnderlyingTotal(), '985645031167807618140682');
      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '2314997029221565363583');
      assert.equal(stakeAndClaimStatus.status, '1');

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '11574985146107826817913',
      );

      await vault.joinPool(pid, deployer, deployer, {
        assets: lusdSecond ? [ausd.address, lusd.address] : [lusd.address, ausd.address],
        maxAmountsIn: [ether(1e6), ether(1e6)],
        userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [1, [ether(1e6), ether(1e6)]]),
        fromInternalBalance: false,
      });

      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), '1194814009204339958264554');

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '797685002970778434636417');
      assert.equal(stakeAndClaimStatus.status, '2');

      assert.equal(await connector.getPendingRewards(), '1265970536445079147102');

      const secondStake = await pokeFromReporter();
      assert.equal(await assetManager.getUnderlyingStaked(), '1588516024934246094512545');
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), '397129006233561523628137');
      assert.equal(await lusd.balanceOf(vault.address), '397129006233561523628137');
      assert.equal(await assetManager.getUnderlyingTotal(), '1985645031167807618140682');
      const timeSpent1 =
        (await web3.eth.getBlock(secondStake.blockNumber)).timestamp -
        (await web3.eth.getBlock(firstStake.blockNumber)).timestamp;
      assert.equal(await connector.getPendingRewards(), '0');

      await time.increase(time.duration.minutes(60));

      let lastWithdrawRes = await staking.withdraw('0', { from: alice });
      const timeSpent2 =
        (await web3.eth.getBlock(lastWithdrawRes.receipt.blockNumber)).timestamp -
        (await web3.eth.getBlock(secondStake.blockNumber)).timestamp;
      const lqtyPerSecond = ether('0.17559594735236413');
      approximatelyEqual(
        await connector.getPendingRewards(),
        toBN(lqtyPerSecond).mul(toBN((timeSpent1 + timeSpent2).toString())),
      );

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '11574985146107827410711',
      );

      let minClaimAmount = await connector.unpackClaimParams((await assetManager.connectors(0)).claimParams || '0x');
      let stakeParams = await connector.unpackStakeParams((await assetManager.connectors(0)).stakeParams || '0x');
      assert.equal(minClaimAmount, '0');
      assert.equal(stakeParams.maxETHOnStaking, '0');
      assert.equal(stakeParams.minLUSDToDistribute, '0');
      await assetManager.setClaimParams('0', await connector.packClaimParams(ether('10')), {from: piGov});
      await assetManager.setStakeParams('0', await connector.packStakeParams(ether('0.1'), ether('1000')), {from: piGov});

      minClaimAmount = await connector.unpackClaimParams((await assetManager.connectors(0)).claimParams);
      stakeParams = await connector.unpackStakeParams((await assetManager.connectors(0)).stakeParams);
      assert.equal(minClaimAmount, ether('10'));
      assert.equal(stakeParams.maxETHOnStaking, ether('0.1'));
      assert.equal(stakeParams.minLUSDToDistribute, ether('1000'));
      await time.increase(time.duration.minutes(60));

      let underlyingStaked = await connector.getUnderlyingStakedWithShares();
      assert.equal(underlyingStaked.shares, '1565265736462611586167109');
      assert.equal(await lqty.balanceOf(pvp), '0');
      console.log('const res = await pokeFromReporter()');
      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', true);
      assert.equal(stakeAndClaimStatus.forceRebalance, true);
      const res = await pokeFromReporter();
      underlyingStaked = await connector.getUnderlyingStakedWithShares();
      assert.equal(underlyingStaked.shares, '1566864933096775460751580');
      assert.equal(await lqty.balanceOf(pvp), '572806210069870415138');
      assert.equal(await connector.isClaimAvailable((await assetManager.connectors(0)).claimParams), false);

      await vault.swap(
        {
          poolId: pid,
          kind: '0',
          assetIn: ausd.address,
          assetOut: lusd.address,
          amount: ether(100),
          userData: '0x',
        },
        {
          sender: deployer,
          fromInternalBalance: false,
          recipient: deployer,
          toInternalBalance: false,
        },
        '0',
        (await web3.eth.getBlock(res.blockNumber)).timestamp + 100,
      );

      await time.increase(time.duration.minutes(60));
      assert.equal(await connector.isClaimAvailable((await assetManager.connectors(0)).claimParams), false);

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '11574985146107827411317',
      );

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', true);
      assert.equal(stakeAndClaimStatus.status, '1');
      assert.equal(stakeAndClaimStatus.diff, '404206111416638623408');

      assert.equal(await lusd.balanceOf(pvp), '0');
      await pokeFromReporter();
      underlyingStaked = await connector.getUnderlyingStakedWithShares();
      assert.equal(underlyingStaked.shares, '1564755807931231175327770');
      assert.equal(await lusd.balanceOf(pvp), '1736247771916174112495');
      assert.equal(await lqty.balanceOf(pvp), '572806210069870415138');

      assert.equal(
        await connector.getActualUnderlyingEarnedByStakeData(await assetManager.connectors('0').then(c => c.stakeData)),
        '592606',
      );
    });

    it('should send eth to perfomance fee receiver', async () => {
      await web3.eth.sendTransaction({
        value: ether(0.1),
        from: deployer,
        to: assetManager.address,
      })
      assert.equal(await web3.eth.getBalance(assetManager.address), ether(0.1));
      assert.equal(await web3.eth.getBalance(pvp), ether('10000'));

      await expectRevert(assetManager.sendEthToPerformanceFeeReceiver({from: deployer}), 'Ownable');
      await assetManager.sendEthToPerformanceFeeReceiver({from: piGov});

      assert.equal(await web3.eth.getBalance(assetManager.address), '0');
      assert.equal(await web3.eth.getBalance(pvp), ether('10000.1'));
    });

    it('should migrate successfully', async () => {
      const newRouter = alice;
      const data = web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [0, [ether(2e6), ether(2e6)]]);
      await expectRevert(assetManager.migrateToNewAssetManager(data, newRouter, []), 'Ownable');
      const res = await assetManager.migrateToNewAssetManager(data, newRouter, [], {from: piGov});
      const testMigrate = BProtocolPowerIndexConnector.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'TestMigrate')[0];
      assert.equal(testMigrate.args.migrateData, data);
    });

    it('emergencyWithdraw should work properly', async () => {
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(),  ether('974070.046021699791322769'));
      await pokeFromReporter();
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(),  ether('194814.009204339958264554'));
      assert.equal(await pool.balanceOf(assetManager.address), '0');
      assert.equal(await lusd.balanceOf(bob), '0');
      let poolBalance = '3999999999999999999000000';
      await pool.transfer(bob, poolBalance);
      assert.equal(await pool.balanceOf(bob), poolBalance);

      await pool.approve(assetManager.address, poolBalance, {from: bob});

      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether('194814.009204339958264554'));
      assert.equal(await assetManager.getUnderlyingStaked(), ether('779256.036817359833058215'));
      await expectRevert(assetManager.emergencyWithdraw(ether(100000), poolBalance, true, {from: bob}), 'NOT_EMERGENCY');
      await expectRevert(assetManager.emergencyWithdraw(ether('194814.009204339958264554'), poolBalance, true, {from: bob}), 'NOT_EMERGENCY');
      await expectRevert(assetManager.emergencyWithdraw(ether(3e6), poolBalance, true, {from: bob}), 'SafeMath: subtraction overflow');

      await assetManager.emergencyWithdraw(ether(200000), poolBalance, true, {from: bob});
      poolBalance = ether('201606.509795451064000000');
      assert.equal(await lusd.balanceOf(bob), ether(200000));
      assert.equal(await pool.balanceOf(bob), poolBalance);
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether('154814.009204339958264554'));
      assert.equal(await assetManager.getUnderlyingStaked(), ether('619256.036817359833058215'));

      let stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '0');
      assert.equal(stakeAndClaimStatus.status, '0');
      assert.equal(stakeAndClaimStatus.forceRebalance, false);

      await assetManager.setReserveConfig(ether('0.01'), ether('0.01'), ether('0.01'), 60 * 60, 60 * 60, {from: piGov});
      await pokeFromReporter();
      assert.equal(await assetManager.getAssetsHolderUnderlyingBalance(), ether('7740.700460216997913228'));
      assert.equal(await assetManager.getUnderlyingStaked(), ether('766329.345561482793409541'));

      await assetManager.setReserveConfig(ether('0.1'), ether('0.1'), ether('0.1'), 60 * 60, 60 * 60, {from: piGov});

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, ether('69666.304141952981219049'));
      assert.equal(stakeAndClaimStatus.status, '1');
      assert.equal(stakeAndClaimStatus.forceRebalance, true);

      await pool.approve(assetManager.address, poolBalance, {from: bob});
      await assetManager.emergencyWithdraw(ether(50000), poolBalance, false, {from: bob});
      await expectRevert(assetManager.emergencyWithdraw(ether(3e6), poolBalance, true, {from: bob}), 'SafeMath: subtraction overflow');

      stakeAndClaimStatus = await assetManager.getStakeAndClaimStatusByConnectorIndex('0', false);
      assert.equal(stakeAndClaimStatus.diff, '0');
      assert.equal(stakeAndClaimStatus.status, '0');
      assert.equal(stakeAndClaimStatus.forceRebalance, false);

      assert.equal(await lusd.balanceOf(bob), ether(250000));
      assert.equal(await pool.balanceOf(bob), '0');
      assert.equal(await pool.balanceOf(assetManager.address), ether('3747860.539036497267058411'));

      await expectRevert(assetManager.emergencyWithdraw(ether(3e6), poolBalance, true, {from: bob}), 'SafeMath: subtraction overflow');

      assert.equal(await pool.balanceOf(pvp), '0');
      await expectRevert(assetManager.distributeRestPoolBalance('0', '0x', {from: bob}), 'Ownable');
      await assetManager.distributeRestPoolBalance('0', '0x', {from: piGov});
      assert.equal(await pool.balanceOf(assetManager.address), '0');
      assert.equal(await pool.balanceOf(pvp), ether('3747860.539036497267058411'));
    });
  });
});
