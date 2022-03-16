require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-torn-vault', 'Deploy VestedLpMining').setAction(async (__, {ethers, network}) => {
  const {ether, fromEther, impersonateAccount, gwei, increaseTime, advanceBlocks} = require('../test/helpers');
  const WrappedPiErc20 = await artifacts.require('WrappedPiErc20');
  const IERC20 = await artifacts.require('IERC20');
  const PowerIndexRouter = await artifacts.require('PowerIndexRouter');
  const PowerPoke = await artifacts.require('PowerPoke');
  const ITornGovernance = await artifacts.require('ITornGovernance');
  const ITornStaking = await artifacts.require('ITornStaking');
  const TornPowerIndexConnector = await artifacts.require('TornPowerIndexConnector');

  if (process.env.FORK) {
    await ethers.provider.send('hardhat_reset', [{forking: {jsonRpcUrl: process.env.FORK}}]);
  }

  const { web3 } = WrappedPiErc20;

  const [deployer] = await web3.eth.getAccounts();
  const sendOptions = { from: deployer };

  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';

  const TORN_STAKING = '0x2fc93484614a34f26f7970cbb94615ba109bb4bf';
  const TORN_GOVERNANCE = '0x5efda50f22d34f262c29268506c5fa42cb56a1ce';
  const torn = await IERC20.at('0x77777feddddffc19ff86db637967013e6c6a116c');
  const piTorn = await WrappedPiErc20.new(torn.address, deployer, 'Wrapped Torn', 'piTORN');
  console.log('piTorn', piTorn.address);

  const tornRouter = await PowerIndexRouter.new(
    piTorn.address,
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
  console.log('tornRouter', tornRouter.address);

  const tornConnector = await TornPowerIndexConnector.new(TORN_STAKING, torn.address, piTorn.address, TORN_GOVERNANCE);
  console.log('tornConnector', tornConnector.address);
  // console.log('calcTornOutByWethIn', fromEther(await tornConnector.calcTornOutByWethIn(ether('0.1'))));
  // console.log('calcWethOutByTornIn', fromEther(await tornConnector.calcWethOutByTornIn(ether('5.38727'))));
  await tornRouter.setConnectorList([
    {
      connector: tornConnector.address,
      share: ether(1),
      callBeforeAfterPoke: false,
      newConnector: true,
      connectorIndex: 0,
    },
  ]);
  await piTorn.changeRouter(tornRouter.address);
  console.log('tornConnector done');
  // console.log('getUnderlyingReserve', await tornRouter.getUnderlyingReserve());
  // console.log('tornConnector.getUnderlyingStaked', await tornConnector.getUnderlyingStaked());
  // console.log('router.getUnderlyingStaked', await tornRouter.getUnderlyingStaked());
  // console.log('calculateLockedProfit', await tornRouter.calculateLockedProfit());
  // console.log('getUnderlyingAvailable', await tornRouter.getUnderlyingAvailable());
  // console.log('getPiEquivalentForUnderlying', await tornRouter.getPiEquivalentForUnderlying(ether(1), '0'));

  await tornRouter.transferOwnership(OWNER, sendOptions);

  if (network.name !== 'mainnetfork') {
    return;
  }

  const tornHolder = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  await impersonateAccount(ethers, tornHolder);
  const amount = ether(	33400);
  console.log('1 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));
  await torn.approve(piTorn.address, amount, {from: tornHolder});
  await piTorn.deposit(amount, {from: tornHolder});
  console.log('2 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));

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
  await powerPoke.addClient(tornRouter.address, OWNER, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: OWNER});
  await powerPoke.setMinimalDeposit(tornRouter.address, MIN_SLASHING_DEPOSIT, {from: OWNER});
  await powerPoke.setBonusPlan(tornRouter.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: OWNER});
  await powerPoke.setFixedCompensations(tornRouter.address, 200000, 60000, {from: OWNER});

  const cvp = await IERC20.at(cvpAddress);
  await cvp.approve(powerPoke.address, ether(10000), {from: OWNER});
  await powerPoke.addCredit(tornRouter.address, ether(10000), {from: OWNER});

  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: pokerReporter, compensateInETH: true},
  );

  await impersonateAccount(ethers, pokerReporter);

  await tornRouter.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});

  console.log('3 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));
  const governance = await ITornGovernance.at(TORN_GOVERNANCE);
  const staking = await ITornStaking.at(TORN_STAKING);
  console.log('lockedBalance', fromEther(await governance.lockedBalance(piTorn.address)));
  console.log('checkReward 1', fromEther(await staking.checkReward(piTorn.address)));

  const TEN_HOURS = 60 * 60 * 10;
  const GAS_TO_REINVEST = '100000';
  await impersonateAccount(ethers, TORN_GOVERNANCE);

  await tornRouter.setClaimParams('0', await getClaimParams(TEN_HOURS), {from: OWNER});

  await increaseTime(TEN_HOURS);
  await advanceBlocks(1);
  await staking.addBurnRewards(ether(1700), {from: TORN_GOVERNANCE});
  console.log('checkReward 2', fromEther(await staking.checkReward(piTorn.address)));
  await printForecast(TEN_HOURS);
  await checkClaimAvailability(TEN_HOURS);

  await increaseTime(TEN_HOURS);
  await advanceBlocks(1);
  await staking.addBurnRewards(ether(1700), {from: TORN_GOVERNANCE});
  console.log('checkReward 3', fromEther(await staking.checkReward(piTorn.address)));
  await printForecast(TEN_HOURS);
  await checkClaimAvailability(TEN_HOURS);

  await tornRouter.pokeFromReporter('1', true, powerPokeOpts, {from: pokerReporter});

  console.log('lockedBalance', fromEther(await governance.lockedBalance(piTorn.address)));

  function getClaimParams(duration) {
    return tornConnector.packClaimParams(duration, GAS_TO_REINVEST);
  }
  async function checkClaimAvailability(duration) {
    const connector = await tornRouter.connectors('0');
    const claimParams = await getClaimParams(duration);
    const res = await tornConnector.isClaimAvailable(claimParams, connector.lastClaimRewardsAt, connector.lastChangeStakeAt);
    const tornNeedToReinvest = await tornConnector.getTornUsedToReinvest(GAS_TO_REINVEST, parseInt(process.env.GAS_PRICE) * 10 ** 9);
    console.log('tornNeedToReinvest', fromEther(tornNeedToReinvest));
    console.log('isClaimAvailable for', parseInt(duration) / (60 * 60), 'hours:', res);
    return res;
  }

  async function printForecast(investDuration) {
    const block = await web3.eth.getBlock('latest');
    const connector = await tornRouter.connectors('0');
    let {lastClaimRewardsAt, lastChangeStakeAt} = connector;
    lastClaimRewardsAt = parseInt(lastClaimRewardsAt.toString(10));
    lastChangeStakeAt = parseInt(lastChangeStakeAt.toString(10));
    const lastRewardsAt = lastClaimRewardsAt > lastChangeStakeAt ? lastClaimRewardsAt : lastChangeStakeAt;

    console.log('forecast after', (block.timestamp - lastRewardsAt) / (60 * 60), 'hours:', fromEther(await tornConnector.getPendingAndForecastReward(
      lastClaimRewardsAt,
      lastChangeStakeAt,
      investDuration
    ).then(r => r.forecastByPending)), 'with invest duration', investDuration / (60 * 60), 'hours');
  }
});
