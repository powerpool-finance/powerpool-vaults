require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-lusd-asset-manager', 'Deploy LUSD Asset Manager').setAction(async (__, {ethers, network}) => {
  const {ether, fromEther, zeroAddress, impersonateAccount, gwei, increaseTime, advanceBlocks} = require('../test/helpers');
  const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');
  const IVault = await artifacts.require('IVault');
  const MockERC20 = await artifacts.require('MockERC20');
  const AssetManager = await artifacts.require('AssetManager');
  const PowerPoke = await artifacts.require('PowerPoke');
  const IAuthorizer = await artifacts.require('IAuthorizer');
  const IStablePoolFactory = await artifacts.require('IStablePoolFactory');
  const IBasePool = await artifacts.require('IBasePool');
  const BAMM = await artifacts.require('BAMM');
  const StabilityPool = await artifacts.require('StabilityPool');
  const BProtocolPowerIndexConnector = await artifacts.require('BProtocolPowerIndexConnector');

  const { web3 } = IERC20;

  const [deployer] = await web3.eth.getAccounts();
  const sendOptions = { from: deployer };

  if (process.env.FORK) {
    const daoMultisigAddress = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';
    const roles = ['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'];
    const authorizer = await IAuthorizer.at('0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6');
    await impersonateAccount(ethers, daoMultisigAddress);
    await authorizer.grantRoles(roles, deployer, {from: daoMultisigAddress});
  }

  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
  const vaultAddress = '0xba12222222228d8ba445958a75a0704d566bf2c8';
  const lusdAddress = '0x5f98805a4e8be255a32880fdec7f6728c6568ba0';
  const lqtyAddress = '0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d';
  const bammAddress = '0x00ff66ab8699aafa050ee5ef5041d1503aa0849a';
  const stabilityPoolAddress = '0x66017d22b0f8556afdd19fc67041899eb65a21bb';

  const assetManager = await AssetManager.new(
    vaultAddress,
    lusdAddress,
    {
      poolRestrictions: '0x698967cA2fB85A6D9a7D2BeD4D2F6D32Bbc5fCdc',
      powerPoke: '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96',
      reserveRatio: ether(0.1),
      reserveRatioLowerBound: ether(0.01),
      reserveRatioUpperBound: ether(0.2),
      claimRewardsInterval: '604800',
      performanceFeeReceiver: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
      performanceFee: ether(0.003)
    }
  );

  const ausd = await MockERC20.new('ausd', 'ausd', '18', ether(1e9));
  const lusd = await IERC20.at(lusdAddress);
  const vault = await IVault.at(vaultAddress);

  const lusdHolder = '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1';
  await impersonateAccount(ethers, lusdHolder);
  await lusd.transfer(deployer, ether(2e6), {from: lusdHolder});

  const lusdSecond = web3.utils.toBN(lusdAddress).gt(web3.utils.toBN(ausd.address));
  const stablePoolFactory = await IStablePoolFactory.at('0xF1C543b98ACDDC98919FBcCC5d94096bed381f05');
  let res = await stablePoolFactory.create(
    "Balancer PP Stable Pool",
    "bb-p-USD",
    lusdSecond ? [ausd.address, lusdAddress] : [lusdAddress, ausd.address],
    lusdSecond ? [zeroAddress, assetManager.address] : [assetManager.address, zeroAddress],
    200,
    5e14,
    deployer
  )

  const pool = await IBasePool.at(res.receipt.logs[0].args.pool);

  await assetManager.setAssetsHolder(vaultAddress,await pool.getPoolId());

  // borrowerOperations.openTrove(
  //   ether(1),
  //   ether(5e6),
  //   zeroAddress,
  //   zeroAddress,
  //   {value : ether(4e3)}
  // );

  // assertEq(IERC20(liquity.lusd()).balanceOf(DEPLOYER), 5e6 ether);

  ausd.approve(vaultAddress, ether(2e6));
  lusd.approve(vaultAddress, ether(2e6));

  // assertEq(IERC20(ausd).balanceOf(DEPLOYER), 1e9 ether);
  // assertEq(IERC20(lusd).balanceOf(DEPLOYER), 5e6 ether);

  vault.joinPool(await pool.getPoolId(), deployer, deployer, {
    assets: lusdSecond ? [ausd.address, lusdAddress] : [lusdAddress, ausd.address],
    maxAmountsIn: [ether(2e6), ether(2e6)],
    userData: web3.eth.abi.encodeParameters(
      ['uint256', 'uint256[]'],
      [0, [ether(2e6), ether(2e6)]],
    ),
    fromInternalBalance: false
  });

  const connector = await BProtocolPowerIndexConnector.new(assetManager.address, bammAddress, lusd.address, vaultAddress, stabilityPoolAddress, lqtyAddress, await pool.getPoolId());
  await assetManager.setConnectorList([
    {
      connector: connector.address,
      share: ether(1),
      callBeforeAfterPoke: false,
      newConnector: true,
      connectorIndex: 0,
    },
  ]);

  console.log('vault.getPoolTokenInfo', await vault.getPoolTokenInfo(await pool.getPoolId(), lusd.address));
  console.log('connector.address', connector.address);
  console.log('assetManager.address', assetManager.address);

  await assetManager.initRouterByConnector('0', '0x');
  await assetManager.transferOwnership(OWNER);

  if (network.name !== 'mainnetfork') {
    return;
  }

  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
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
  await powerPoke.addClient(assetManager.address, OWNER, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: OWNER});
  await powerPoke.setMinimalDeposit(assetManager.address, MIN_SLASHING_DEPOSIT, {from: OWNER});
  await powerPoke.setBonusPlan(assetManager.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: OWNER});
  await powerPoke.setFixedCompensations(assetManager.address, 200000, 60000, {from: OWNER});

  const cvp = await IERC20.at(cvpAddress);
  await cvp.approve(powerPoke.address, ether(10000), {from: OWNER});
  await powerPoke.addCredit(assetManager.address, ether(10000), {from: OWNER});

  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: pokerReporter, compensateInETH: true},
  );

  await impersonateAccount(ethers, pokerReporter);

  const bamm = await BAMM.at(bammAddress);
  console.log('stability pool', await bamm.SP());
  const stabilityPool = await StabilityPool.at(await bamm.SP());
  console.log('getCompoundedLUSDDeposit', await stabilityPool.getCompoundedLUSDDeposit(bammAddress).then(r => r.toString()));
  console.log('getDepositorETHGain', await stabilityPool.getDepositorETHGain(bammAddress).then(r => r.toString()));
  console.log('fetchPrice', await bamm.fetchPrice().then(r => r.toString()));

  let printsNumber = 0;
  async function printState() {
    console.log('\n');
    printsNumber++;
    console.log(printsNumber + ' getUnderlyingReserve', await connector.getUnderlyingReserve().then(r => r.toString()));
    console.log(printsNumber + ' getUnderlyingManaged', await connector.getUnderlyingManaged().then(r => r.toString()));
    console.log(printsNumber + ' getUnderlyingStaked', await connector.getUnderlyingStaked().then(r => r.toString()));
    console.log(printsNumber + ' getPendingRewards', await connector.getPendingRewards().then(r => r.toString()));
  }

  await printState();
  await assetManager.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
  await printState();
  await increaseTime(60 * 60);
  await advanceBlocks(1);
  await printState();
  await increaseTime(60 * 60);
  await advanceBlocks(1);
  await printState();

//
  // console.log('3 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));
  // const governance = await ITornGovernance.at(TORN_GOVERNANCE);
  // const staking = await ITornStaking.at(TORN_STAKING);
  // console.log('lockedBalance', fromEther(await governance.lockedBalance(piTorn.address)));
  // console.log('checkReward 1', fromEther(await staking.checkReward(piTorn.address)));
  //
  // const TEN_HOURS = 60 * 60 * 10;
  // const GAS_TO_REINVEST = '100000';
  // await impersonateAccount(ethers, TORN_GOVERNANCE);
  //
  // await tornRouter.setClaimParams('0', await getClaimParams(TEN_HOURS), {from: OWNER});
  //
  // await increaseTime(TEN_HOURS);
  // await advanceBlocks(1);
  // await staking.addBurnRewards(ether(1700), {from: TORN_GOVERNANCE});
  // console.log('checkReward 2', fromEther(await staking.checkReward(piTorn.address)));
  // await printForecast(TEN_HOURS);
  // await checkClaimAvailability(TEN_HOURS);
  //
  // await increaseTime(TEN_HOURS);
  // await advanceBlocks(1);
  // await staking.addBurnRewards(ether(1700), {from: TORN_GOVERNANCE});
  // console.log('checkReward 3', fromEther(await staking.checkReward(piTorn.address)));
  // await printForecast(TEN_HOURS);
  // await checkClaimAvailability(TEN_HOURS);
  //
  // await tornRouter.pokeFromReporter('1', true, powerPokeOpts, {from: pokerReporter});
  //
  // console.log('lockedBalance', fromEther(await governance.lockedBalance(piTorn.address)));
  //
  // await ethers.provider.send('hardhat_reset', [{forking: {jsonRpcUrl: process.env.FORK}}]);


  // function getClaimParams(duration) {
  //   return tornConnector.packClaimParams(duration, GAS_TO_REINVEST);
  // }
  // async function checkClaimAvailability(duration) {
  //   const connector = await tornRouter.connectors('0');
  //   const claimParams = await getClaimParams(duration);
  //   const res = await tornConnector.isClaimAvailable(claimParams, connector.lastClaimRewardsAt, connector.lastChangeStakeAt);
  //   const tornNeedToReinvest = await tornConnector.getTornUsedToReinvest(GAS_TO_REINVEST, parseInt(process.env.GAS_PRICE) * 10 ** 9);
  //   console.log('tornNeedToReinvest', fromEther(tornNeedToReinvest));
  //   console.log('isClaimAvailable for', parseInt(duration) / (60 * 60), 'hours:', res);
  //   return res;
  // }

  // async function printForecast(investDuration) {
  //   const block = await web3.eth.getBlock('latest');
  //   const connector = await tornRouter.connectors('0');
  //   let {lastClaimRewardsAt, lastChangeStakeAt} = connector;
  //   lastClaimRewardsAt = parseInt(lastClaimRewardsAt.toString(10));
  //   lastChangeStakeAt = parseInt(lastChangeStakeAt.toString(10));
  //   const lastRewardsAt = lastClaimRewardsAt > lastChangeStakeAt ? lastClaimRewardsAt : lastChangeStakeAt;
  //
  //   console.log('forecast after', (block.timestamp - lastRewardsAt) / (60 * 60), 'hours:', fromEther(await tornConnector.getPendingAndForecastReward(
  //     lastClaimRewardsAt,
  //     lastChangeStakeAt,
  //     investDuration
  //   ).then(r => r.forecastByPending)), 'with invest duration', investDuration / (60 * 60), 'hours');
  // }
});
