require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-lusd-asset-manager', 'Deploy LUSD Asset Manager').setAction(async (__, { ethers, network }) => {
  const { ether, impersonateAccount, gwei, increaseTime, maxUint256 } = require('../test/helpers');
  const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');
  const IVault = await artifacts.require('contracts/interfaces/balancerV3/IVault.sol:IVault');
  const ILiquidityGauge = await artifacts.require('ILiquidityGauge');
  const AssetManager = await artifacts.require('AssetManager');
  const PowerPoke = await artifacts.require('IPowerPoke');
  const IBalancerMinter = await artifacts.require('IBalancerMinter');
  const IBasePool = await artifacts.require('contracts/interfaces/balancerV3/IBasePool.sol:IBasePool');
  const BAMM = await artifacts.require('BAMM');
  const StabilityPool = await artifacts.require('StabilityPool');
  const BProtocolPowerIndexConnector = await artifacts.require('BProtocolPowerIndexConnector');
  const BalPowerIndexConnector = await artifacts.require('BalPowerIndexConnector');
  const StablePoolFactory = await artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePoolFactory');

  AssetManager.numberFormat = 'String';
  BProtocolPowerIndexConnector.numberFormat = 'String';
  BalPowerIndexConnector.numberFormat = 'String';
  IVault.numberFormat = 'String';

  const { web3 } = IERC20;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);

  // if (network.name === 'mainnetfork') {
  //   await network.provider.request({
  //     method: 'hardhat_reset',
  //     params: [{ forking: { jsonRpcUrl: process.env.FORK } }],
  //   });
  //   const daoMultisigAddress = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';
  //   const roles = ['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'];
  //   const authorizer = await IAuthorizer.at('0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6');
  //   await impersonateAccount(ethers, daoMultisigAddress);
  //   await authorizer.grantRoles(roles, deployer, { from: daoMultisigAddress });
  // }

  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
  const vaultAddress = '0xba12222222228d8ba445958a75a0704d566bf2c8';

  // lusdd
  const lusdAddress = '0x5f98805a4e8be255a32880fdec7f6728c6568ba0';
  const lqtyAddress = '0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d';
  const bammAddress = '0x00ff66ab8699aafa050ee5ef5041d1503aa0849a';
  const stabilityPoolAddress = '0x66017d22b0f8556afdd19fc67041899eb65a21bb';

  //bbausd
  const bbaUSDAddress = '0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb2';
  const liquidityGaugeAddress = '0x68d019f64a7aa97e2d4e7363aee42251d08124fb';
  const balancerMinterAddress = '0x239e55f427d44c3cc793f49bfb507ebe76638a2b';
  const balAddress = '0xba100000625a3754423978a60c9317c58a424e3d';

  const stablePoolFactory = await StablePoolFactory.new(vaultAddress);
  console.log('stablePoolFactory', stablePoolFactory.address);
  const assetManagerOptions = {
    poolRestrictions: '0x698967cA2fB85A6D9a7D2BeD4D2F6D32Bbc5fCdc',
    powerPoke: '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96',
    reserveRatio: ether(0.1),
    reserveRatioLowerBound: ether(0.01),
    reserveRatioUpperBound: ether(0.2),
    claimRewardsInterval: 60 * 60 * 24,
    performanceFeeReceiver: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
    performanceFee: ether(0.003),
  };

  const lusdAssetManager = await AssetManager.new(vaultAddress, lusdAddress, assetManagerOptions);
  const bbausdAssetManager = await AssetManager.new(vaultAddress, lusdAddress, assetManagerOptions);
  console.log('lusdAssetManager', lusdAssetManager.address);
  console.log('bbausdAssetManager', bbausdAssetManager.address);

  const lusd = await IERC20.at(lusdAddress);
  const bbaUSD = await IERC20.at(bbaUSDAddress);
  const lqty = await IERC20.at(lqtyAddress);
  const vault = await IVault.at(vaultAddress);

  const lusdHolder = '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1';
  const bbausdHolder = '0x10bf1dcb5ab7860bab1c3320163c6dddf8dcc0e4';
  await impersonateAccount(ethers, lusdHolder);
  await impersonateAccount(ethers, bbausdHolder);
  const gauge = await ILiquidityGauge.at(liquidityGaugeAddress);
  await gauge.withdraw(ether(4e6), false, {from: bbausdHolder});
  await lusd.transfer(deployer, ether(2e6), { from: lusdHolder });
  await bbaUSD.transfer(deployer, ether(2e6), { from: bbausdHolder });

  const lusdSecond = web3.utils.toBN(lusdAddress).gt(web3.utils.toBN(bbaUSD.address));
  let res = await stablePoolFactory.create(
    'Balancer PP Stable Pool',
    'bb-p-USD',
    lusdSecond ? [bbaUSD.address, lusdAddress] : [lusdAddress, bbaUSD.address],
    lusdSecond ? [bbausdAssetManager.address, lusdAssetManager.address] : [lusdAssetManager.address, bbausdAssetManager.address],
    200,
    5e14,
    deployer,
  );

  const pool = await IBasePool.at(res.receipt.logs[0].args.pool);
  await lusdAssetManager.setAssetsHolder(vaultAddress);
  await bbausdAssetManager.setAssetsHolder(vaultAddress);
  console.log('setAssetsHolder');

  await bbaUSD.approve(vaultAddress, ether(2e6));
  await lusd.approve(vaultAddress, ether(2e6));

  await vault.joinPool(await pool.getPoolId(), deployer, deployer, {
    assets: lusdSecond ? [bbaUSD.address, lusdAddress] : [lusdAddress, bbaUSD.address],
    maxAmountsIn: [ether(2e6), ether(2e6)],
    userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [0, [ether(2e6), ether(2e6)]]),
    fromInternalBalance: false,
  });
  console.log('joinPool');

  const lusdConnector = await BProtocolPowerIndexConnector.new(
    lusdAssetManager.address,
    bammAddress,
    lusd.address,
    vaultAddress,
    stabilityPoolAddress,
    lqtyAddress,
    await pool.getPoolId(),
    pool.address
  );
  console.log('lusdConnector', lusdConnector.address);
  const bbausdConnector = await BalPowerIndexConnector.new(
    bbausdAssetManager.address,
    liquidityGaugeAddress,
    bbaUSD.address,
    balAddress,
    balancerMinterAddress,
    vaultAddress,
    await pool.getPoolId(),
    pool.address
  );
  console.log('bbausdConnector', bbausdConnector.address);
  await lusdAssetManager.setConnectorList([{
    connector: lusdConnector.address,
    share: ether(1),
    callBeforeAfterPoke: false,
    newConnector: true,
    connectorIndex: 0,
  }]);
  await bbausdAssetManager.setConnectorList([{
    connector: bbausdConnector.address,
    share: ether(1),
    callBeforeAfterPoke: false,
    newConnector: true,
    connectorIndex: 0,
  }]);

  console.log('vault.getPoolTokenInfo lusd', await vault.getPoolTokenInfo(await pool.getPoolId(), lusd.address));
  console.log('vault.getPoolTokenInfo bbausd', await vault.getPoolTokenInfo(await pool.getPoolId(), bbaUSD.address));
  console.log('lusdConnector.address', lusdConnector.address);
  console.log('lusdAssetManager.address', lusdAssetManager.address);
  console.log('bbausdConnector.address', bbausdConnector.address);
  console.log('bbausdAssetManager.address', bbausdAssetManager.address);

  await lusdAssetManager.initRouterByConnector('0', '0x');
  const initRes = await bbausdAssetManager.initRouterByConnector('0', '0x');
  console.log('MinterApprovalSet', IBalancerMinter.decodeLogs(initRes.receipt.rawLogs)[0].args)
  console.log('ASSET_MANAGER', await bbausdConnector.ASSET_MANAGER())
  await lusdAssetManager.transferOwnership(OWNER);
  await bbausdAssetManager.transferOwnership(OWNER);

  if (network.name !== 'mainnetfork') {
    return;
  }

  await addPokeClient(lusdAssetManager.address);
  await addPokeClient(bbausdAssetManager.address);

  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  await impersonateAccount(ethers, pokerReporter);
  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: { to: 'address', compensateInETH: 'bool' } },
    { to: pokerReporter, compensateInETH: true },
  );

  const bamm = await BAMM.at(bammAddress);
  const balancerMinter = await IBalancerMinter.at(balancerMinterAddress);

  await showBammInitInfo();

  let printsNumber = 0;

  const bammDepositer = '0xf35da7a42d92c7919172195aa7bc7a0d43ec866c';
  await impersonateAccount(ethers, bammDepositer);

  await lusdAssetManager.setReserveConfig(ether(0.1), ether(0.01), ether(0.2), 10 * 60, {
    from: OWNER,
  });
  await lusdAssetManager.setStakeParams('0', await lusdConnector.packStakeParams(ether('0.1'), ether('10000'), '0'), {
    from: OWNER,
  });
  await lusdAssetManager.setClaimParams('0', await lusdConnector.packClaimParams(ether('1')), {
    from: OWNER,
  });

  await bbausdAssetManager.setReserveConfig(ether(0.1), ether(0.01), ether(0.2), 10 * 60, {
    from: OWNER,
  });
  await bbausdAssetManager.setClaimParams('0', await bbausdConnector.packClaimParams(60 * 60 * 24), {
    from: OWNER,
  });

  await printState('lusd', lusdConnector);
  await lusdAssetManager.pokeFromReporter('1', false, powerPokeOpts, { from: pokerReporter });
  await printState('lusd', lusdConnector);
  await increaseTime(60 * 10);
  await bamm.withdraw('0', { from: bammDepositer });
  await printState('lusd', lusdConnector);
  await increaseTime(60 * 10);
  await bamm.withdraw('0', { from: bammDepositer });
  await printState('lusd', lusdConnector);
  await showBammStakeInfo(1);
  await lusdAssetManager.pokeFromReporter('1', true, powerPokeOpts, { from: pokerReporter });
  await showBammStakeInfo(2);

  console.log('gauge.deposit');
  await gauge.deposit(ether(1e6), bbausdHolder, false, {from: bbausdHolder});
  await bbaUSD.approve(liquidityGaugeAddress, maxUint256, {from: bbausdHolder});
  await balancerMinter.setMinterApproval(bbausdHolder, true, {from: bbausdHolder});
  await balancerMinter.setMinterApproval(deployer, true, {from: bbausdHolder});

  console.log('pokeFromReporter');
  await printState('bbausd', bbausdConnector);
  await bbausdAssetManager.pokeFromReporter('1', false, powerPokeOpts, { from: pokerReporter });
  await gauge.deposit(ether(1e6), bbausdHolder, false, {from: bbausdHolder});
  console.log('reward_data.last_update', await gauge.reward_data(bbausdAssetManager.address).then(r => r.last_update.toString()));

  await printState('bbausd', bbausdConnector);
  await increaseTime(60 * 60 * 24 * 14);
  await printState('bbausd', bbausdConnector);
  console.log('bbausdHolder getPendingRewards   ', await balancerMinter.contract.methods.mintFor(liquidityGaugeAddress, bbausdHolder).call({from: bbausdHolder}).then(r => r.toString()).catch(e => e));
  res = await bbausdAssetManager.pokeFromReporter('1', true, powerPokeOpts, { from: pokerReporter });
  console.log('reward_data.last_update', await gauge.reward_data(bbausdAssetManager.address).then(r => r.last_update.toString()));
  console.log('res.receipt.gasUsed', res.receipt.gasUsed);
  await printState('bbausd', bbausdConnector);

  async function printState(prefix, connector) {
    console.log('\n');
    printsNumber++;
    console.log(prefix, printsNumber + ' getUnderlyingReserve', await connector.getUnderlyingReserve().then(r => r.toString()));
    console.log(prefix, printsNumber + ' getUnderlyingManaged', await connector.getUnderlyingManaged().then(r => r.toString()));
    console.log(prefix, printsNumber + ' getUnderlyingStaked ', await connector.getUnderlyingStaked().then(r => r.toString()));
    console.log(prefix, printsNumber + ' getPendingRewards   ', await connector.contract.methods.getPendingRewards().call({from: await connector.ASSET_MANAGER()}).then(r => r.toString()).catch(e => e));
    console.log(prefix, printsNumber + ' assetManagerRewards ', await lqty.balanceOf(lusdAssetManager.address).then(r => r.toString()));
  }

  async function showBammInitInfo() {
    console.log('stability pool', await bamm.SP());
    const stabilityPool = await StabilityPool.at(await bamm.SP());
    console.log(
      'getCompoundedLUSDDeposit',
      await stabilityPool.getCompoundedLUSDDeposit(bammAddress).then(r => r.toString()),
    );
    console.log('getDepositorETHGain', await stabilityPool.getDepositorETHGain(bammAddress).then(r => r.toString()));
    console.log('fetchPrice', await bamm.fetchPrice().then(r => r.toString()));
  }

  async function showBammStakeInfo(number) {
    const c = await lusdAssetManager.connectors('0');
    console.log('stake ' + number, await bamm.stake(lusdAssetManager.address).then(a => a.toString()));
    console.log('isClaimAvailable', await lusdConnector.isClaimAvailable(c.claimParams));
    console.log('claimRewardsIntervalReached', await lusdAssetManager.claimRewardsIntervalReached(c.lastClaimRewardsAt));
    console.log(
      'getStakeAndClaimStatusByConnectorIndex',
      await lusdAssetManager.getStakeAndClaimStatusByConnectorIndex('0', true),
    );
  }

  async function addPokeClient(assetManagerAddress) {
    const BONUS_NUMERATOR = '7610350076';
    const BONUS_DENUMERATOR = '10000000000000000';
    const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
    const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
    const MAX_GAS_PRICE = gwei(500);
    const PER_GAS = '10000';
    const MIN_SLASHING_DEPOSIT = ether(40);

    await impersonateAccount(ethers, OWNER);

    const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
    const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
    const powerPoke = await PowerPoke.at(powerPokeAddress);
    await powerPoke.addClient(
      assetManagerAddress,
      OWNER,
      true,
      MAX_GAS_PRICE,
      MIN_REPORT_INTERVAL,
      MAX_REPORT_INTERVAL,
      { from: OWNER },
    );
    await powerPoke.setMinimalDeposit(assetManagerAddress, MIN_SLASHING_DEPOSIT, { from: OWNER });
    await powerPoke.setBonusPlan(assetManagerAddress, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {
      from: OWNER,
    });
    await powerPoke.setFixedCompensations(assetManagerAddress, 200000, 60000, { from: OWNER });

    const cvp = await IERC20.at(cvpAddress);
    await cvp.approve(powerPoke.address, ether(10000), { from: OWNER });
    await powerPoke.addCredit(assetManagerAddress, ether(10000), { from: OWNER });
  }
});
